import * as fs from 'fs';
import * as path from 'path';

interface OrderDB {
  version: number;
  indexes: { [key: string]: number }; // 键：f:uuid | d:uuid(目录) | dir:absPath(旧) | p:absPath(旧)
  folderManual: { [folderPath: string]: boolean }; // 是否启用手动排序（仍按路径）
  dirUuidMap?: { [absPath: string]: string }; // 目录路径 -> 稳定 uuid
}

const DB_VERSION = 3; // v3: 引入目录稳定 uuid (d:uuid) 并迁移旧 dir:/p: 目录键

interface OrderOptions {
  step: number; // 基础步长
  padWidth: number; // 标签显示补零宽度
  autoResequence: boolean; // 自动在间隙不足时重排
}

export class WordCountOrderManager {
  private dbPath: string;
  private db: OrderDB;
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly DEBOUNCE = 600;
  private options: OrderOptions = { step: 10, padWidth: 3, autoResequence: true };

  constructor(workspaceRoot: string) {
    this.dbPath = path.join(workspaceRoot, 'novel-helper', 'wordcount-order.json');
    this.db = this.load();
  }

  public setOptions(opts: Partial<OrderOptions>) {
    this.options = { ...this.options, ...opts };
  }

  private ensureDir() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private load(): OrderDB {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf8');
        const data = JSON.parse(raw);
        if (data.version === DB_VERSION) { return data as OrderDB; }
        // 逐级迁移
        let working: OrderDB = { version: data.version, indexes: data.indexes || {}, folderManual: data.folderManual || {}, dirUuidMap: data.dirUuidMap || {} };
        if (working.version === 1) {
          // v1->v2 （原逻辑：路径键 -> makeKey）
          const migrated: OrderDB = { version: 2, indexes: {}, folderManual: working.folderManual, dirUuidMap: working.dirUuidMap };
          for (const oldPath of Object.keys(working.indexes)) {
            const key = this.makeKey(oldPath);
            migrated.indexes[key] = working.indexes[oldPath];
          }
          working = migrated;
        }
        if (working.version === 2) {
          // v2->v3: 分配目录 uuid，将 dir:/p: 的目录键迁移为 d:uuid
          const migrated: OrderDB = { version: 3, indexes: {}, folderManual: working.folderManual, dirUuidMap: working.dirUuidMap || {} };
          for (const [k,v] of Object.entries(working.indexes)) {
            if (k.startsWith('dir:')) {
              const abs = k.substring(4);
              const uuid = this.ensureDirUuid(abs, migrated);
              migrated.indexes['d:'+uuid] = v;
            } else if (k.startsWith('p:')) {
              const abs = k.substring(2);
              if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
                const uuid = this.ensureDirUuid(abs, migrated);
                migrated.indexes['d:'+uuid] = v;
              } else {
                migrated.indexes[k] = v; // 文件保持 p:
              }
            } else {
              migrated.indexes[k] = v; // f: / 其它保持
            }
          }
          working = migrated;
        }
        if (working.version !== DB_VERSION) {
          working.version = DB_VERSION;
        }
        return working;
      }
    } catch (e) {
      console.warn('加载 wordcount-order.json 失败，使用默认', e);
    }
    return { version: DB_VERSION, indexes: {}, folderManual: {}, dirUuidMap: {} };
  }

  /** 确保目录有 uuid (存储在给定 db 的 dirUuidMap 中)，返回 uuid */
  private ensureDirUuid(absPath: string, db?: OrderDB): string {
    const target = db || this.db;
    if (!target.dirUuidMap) { target.dirUuidMap = {}; }
    const resolved = path.resolve(absPath);
    if (!target.dirUuidMap[resolved]) {
      // 通过 require uuid 包（项目已有 @types/uuid）
      const { v4: uuidv4 } = require('uuid');
      target.dirUuidMap[resolved] = uuidv4();
      console.log(`[WordCountOrder] Created UUID for directory: ${resolved} -> ${target.dirUuidMap[resolved]}`);
      // 立即保存以确保持久化
      if (target === this.db) {
        console.log(`[WordCountOrder] Scheduling save after creating directory UUID`);
        this.scheduleSave();
      }
    }
    return target.dirUuidMap[resolved];
  }

  private makeKey(p: string): string {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        const abs = path.resolve(p);
        const uuid = this.ensureDirUuid(abs);
        return 'd:' + uuid;
      }
    } catch { /* ignore */ }
    try {
      const { getFileUuid } = require('./globalFileTracking');
      const uuid = getFileUuid(p);
      if (uuid) { return 'f:' + uuid; }
    } catch { /* ignore */ }
    return 'p:' + path.resolve(p);
  }

  private scheduleSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => this.saveNow(), this.DEBOUNCE);
  }

  private saveNow() {
    try {
      this.ensureDir();
      console.log(`[WordCountOrder] Saving database with ${Object.keys(this.db.dirUuidMap || {}).length} directory UUIDs`);
      fs.writeFileSync(this.dbPath, JSON.stringify(this.db, null, 2), 'utf8');
    } catch (e) {
      console.error('保存 wordcount-order.json 失败', e);
    }
  }

  public isManual(folder: string): boolean {
    return !!this.db.folderManual[folder];
  }

  public toggleManual(folder: string): boolean {
    const now = !this.db.folderManual[folder];
    if (now) {
      this.db.folderManual[folder] = true;
    } else {
      delete this.db.folderManual[folder];
    }
    this.scheduleSave();
    return now;
  }

  public getIndex(p: string): number | undefined { return this.db.indexes[this.makeKey(p)]; }

  public setIndex(p: string, idx: number) {
    if (Number.isFinite(idx)) {
      const key = this.makeKey(p);
      this.db.indexes[key] = idx;
      this.scheduleSave();
    }
  }

  public clearIndex(p: string) { const key = this.makeKey(p); if (this.db.indexes[key] !== undefined) { delete this.db.indexes[key]; this.scheduleSave(); } }

  /** 重命名路径时迁移索引与手动标记（若为文件夹且路径层级变化） */
  public renamePath(oldPath: string, newPath: string) {
    // 迁移 folderManual 标记
    if (this.db.folderManual[oldPath]) { this.db.folderManual[newPath] = true; delete this.db.folderManual[oldPath]; }
    const prefix = oldPath + path.sep;
    for (const key of Object.keys(this.db.folderManual)) {
      if (key.startsWith(prefix)) {
        const rel = key.substring(prefix.length);
        const newChild = path.join(newPath, rel);
        this.db.folderManual[newChild] = true;
        delete this.db.folderManual[key];
      }
    }
    // 更新 dirUuidMap 中的路径键
    if (this.db.dirUuidMap) {
      const oldRes = path.resolve(oldPath);
      const newRes = path.resolve(newPath);
      const updated: { [k:string]: string } = {};
      for (const [p, u] of Object.entries(this.db.dirUuidMap)) {
        if (p === oldRes || p.startsWith(oldRes + path.sep)) {
          const rel = p.substring(oldRes.length);
          updated[path.join(newRes, rel)] = u;
          delete this.db.dirUuidMap[p];
        }
      }
      Object.assign(this.db.dirUuidMap, updated);
    }
    // 索引迁移：d:uuid 无需改；旧残留 dir:/p: 路径键仍处理（理论上迁移后不应再出现）
    const oldDirResolved = path.resolve(oldPath) + path.sep;
    const newDirResolved = path.resolve(newPath) + path.sep;
    const fix: { [k:string]: number } = {};
    for (const [k,v] of Object.entries(this.db.indexes)) {
      if (k.startsWith('dir:')) {
        const abs = k.substring(4);
        if (abs === oldDirResolved.slice(0,-1) || abs.startsWith(oldDirResolved)) {
          const rel = abs.substring(oldDirResolved.length);
          const newAbs = path.join(newDirResolved, rel);
          const newKey = 'dir:' + newAbs;
          delete this.db.indexes[k];
          fix[newKey] = v;
        }
      } else if (k.startsWith('p:')) {
        const abs = k.substring(2);
        if (abs.startsWith(oldDirResolved)) {
          const rel = abs.substring(oldDirResolved.length);
          const newAbs = path.join(newDirResolved, rel);
          const newKey = 'p:' + newAbs;
          delete this.db.indexes[k];
          fix[newKey] = v;
        }
      }
    }
    Object.assign(this.db.indexes, fix);
    this.scheduleSave();
  }

  /** 删除路径清理索引 */
  public removePath(targetPath: string) {
    const key = this.makeKey(targetPath);
  if (this.db.indexes[key] !== undefined) { delete this.db.indexes[key]; }
  if (this.db.folderManual[targetPath]) { delete this.db.folderManual[targetPath]; }
    const prefix = targetPath + path.sep;
    // 删除子文件夹 manual 标记
    for (const fm of Object.keys(this.db.folderManual)) {
      if (fm.startsWith(prefix)) { delete this.db.folderManual[fm]; }
    }
    this.scheduleSave();
  }

  public nextIndex(folder: string, children: string[]): number {
    let max = 0;
    for (const c of children) {
      const v = this.getIndex(c);
      if (typeof v === 'number' && v > max) {
        max = v;
      }
    }
    return max + this.options.step; // 留间隔
  }

  public generateIndexFromName(filePath: string): number | undefined {
    const base = path.basename(filePath);
    const m = base.match(/(\d{1,6})/); // 取第一个数字片段
    if (m) {
      const idx = parseInt(m[1], 10);
      this.setIndex(filePath, idx);
      return idx;
    }
    return undefined;
  }

  public resequence(folder: string, childPaths: string[]) {
    // 重新整理为 10,20,...
    const sorted = childPaths.slice().sort((a,b)=>{
      const ia = this.getIndex(a) ?? Number.MAX_SAFE_INTEGER;
      const ib = this.getIndex(b) ?? Number.MAX_SAFE_INTEGER;
      if (ia === ib) {
        return a.localeCompare(b,'zh');
      }
      return ia - ib;
    });
  let i = this.options.step;
    for (const p of sorted) {
      if (this.getIndex(p) !== undefined) {
        this.setIndex(p, i);
        i += this.options.step;
      }
    }
    this.scheduleSave();
  }

  /** 在目标上下插入一个新的索引 */
  public allocateBetween(folder: string, before?: number, after?: number): number {
    if (before === undefined && after === undefined) {
      return this.nextIndex(folder, []);
    }
    if (before === undefined) {
      return (after! - Math.ceil(this.options.step / 2));
    }
    if (after === undefined) {
      return (before + Math.ceil(this.options.step / 2));
    }
    if (after - before > 1) {
      return before + Math.floor((after - before)/2);
    }
    // 需要重新排序
    return after + Math.ceil(this.options.step / 2); // 暂给一个后面的值，之后调用 resequence
  }

  /** 确保在空间不足时自动重排后分配 */
  public allocateBetweenWithResequence(folder: string, childPaths: string[], beforePath?: string, afterPath?: string): number {
    const beforeIdx = beforePath ? this.getIndex(beforePath) : undefined;
    const afterIdx = afterPath ? this.getIndex(afterPath) : undefined;
    let idx = this.allocateBetween(folder, beforeIdx, afterIdx);
    if (this.options.autoResequence && beforeIdx !== undefined && afterIdx !== undefined && afterIdx - beforeIdx <= 1) {
      // 空间不足，重排后再尝试
      this.resequence(folder, childPaths);
      const newBefore = beforePath ? this.getIndex(beforePath) : undefined;
      const newAfter = afterPath ? this.getIndex(afterPath) : undefined;
      idx = this.allocateBetween(folder, newBefore, newAfter);
    }
    return idx;
  }

  public formatIndex(idx?: number): string | undefined {
  if (idx === undefined) { return undefined; }
  if (idx < 0) { return idx.toString(); }
    if (this.options.padWidth > 0) {
      return idx.toString().padStart(this.options.padWidth, '0');
    }
    return idx.toString();
  }

  /** 按给定顺序整体重写索引（步长递增） */
  public rewriteSequential(folder: string, orderedPaths: string[]) { let i = this.options.step; for (const p of orderedPaths) { this.setIndex(p, i); i += this.options.step; } this.scheduleSave(); }
}
