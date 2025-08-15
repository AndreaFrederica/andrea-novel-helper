import * as fs from 'fs';
import * as path from 'path';

interface OrderDB {
  version: number;
  indexes: { [filePath: string]: number }; // 文件或目录索引
  folderManual: { [folderPath: string]: boolean }; // 是否启用手动排序
}

const DB_VERSION = 1;

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
        if (data.version === DB_VERSION) {
          return data;
        }
      }
    } catch (e) {
      console.warn('加载 wordcount-order.json 失败，使用默认', e);
    }
    return { version: DB_VERSION, indexes: {}, folderManual: {} };
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

  public getIndex(p: string): number | undefined { return this.db.indexes[p]; }

  public setIndex(p: string, idx: number) {
    if (Number.isFinite(idx)) {
      this.db.indexes[p] = idx;
      this.scheduleSave();
    }
  }

  public clearIndex(p: string) { if (this.db.indexes[p] !== undefined) { delete this.db.indexes[p]; this.scheduleSave(); } }

  /** 重命名路径时迁移索引与手动标记（若为文件夹且路径层级变化） */
  public renamePath(oldPath: string, newPath: string) {
    if (this.db.indexes[oldPath] !== undefined) {
      this.db.indexes[newPath] = this.db.indexes[oldPath];
      delete this.db.indexes[oldPath];
    }
    if (this.db.folderManual[oldPath]) {
      this.db.folderManual[newPath] = true;
      delete this.db.folderManual[oldPath];
    }
    // 迁移所有子项索引（文件夹移动）
    const prefix = oldPath + path.sep;
    const newPrefix = newPath + path.sep;
    for (const key of Object.keys(this.db.indexes)) {
      if (key.startsWith(prefix)) {
        const rel = key.substring(prefix.length);
        const newChild = path.join(newPath, rel);
        this.db.indexes[newChild] = this.db.indexes[key];
        delete this.db.indexes[key];
      }
    }
    for (const key of Object.keys(this.db.folderManual)) {
      if (key.startsWith(prefix)) {
        const rel = key.substring(prefix.length);
        const newChild = path.join(newPath, rel);
        this.db.folderManual[newChild] = true;
        delete this.db.folderManual[key];
      }
    }
    this.scheduleSave();
  }

  /** 删除路径清理索引 */
  public removePath(targetPath: string) {
    if (this.db.indexes[targetPath] !== undefined) {
      delete this.db.indexes[targetPath];
    }
    if (this.db.folderManual[targetPath]) {
      delete this.db.folderManual[targetPath];
    }
    // 清理子项
    const prefix = targetPath + path.sep;
    for (const key of Object.keys(this.db.indexes)) {
      if (key.startsWith(prefix)) {
        delete this.db.indexes[key];
      }
    }
    for (const key of Object.keys(this.db.folderManual)) {
      if (key.startsWith(prefix)) {
        delete this.db.folderManual[key];
      }
    }
    this.scheduleSave();
  }

  public nextIndex(folder: string, children: string[]): number {
    let max = 0;
    for (const c of children) {
      const v = this.db.indexes[c];
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
        this.db.indexes[p] = i;
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
  public rewriteSequential(folder: string, orderedPaths: string[]) {
    let i = this.options.step;
    for (const p of orderedPaths) {
      if (this.getIndex(p) !== undefined || true) { // 即便无索引也写入
        this.db.indexes[p] = i;
        i += this.options.step;
      }
    }
    this.scheduleSave();
  }
}
