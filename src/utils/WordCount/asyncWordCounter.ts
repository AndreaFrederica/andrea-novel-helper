/**
 * 获取文件的完整 FileMetadata（优先用缓存，结合 gitGuard 判断是否可用，变动则自动刷新）
 * 返回 FileMetadata 或 null
 */

import { fileTrackingDatabase } from '../tracker/fileTrackingData';
import { Worker } from 'worker_threads';
import * as os from 'os';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { countAndAnalyze } from '../utils';
import { TextStats } from './wordCountCore';
import { GitGuard } from '../Git/gitGuard';
import path from 'path';
interface Pending { resolve: (s: TextStats) => void; reject: (e: any) => void; }

let theContext: vscode.ExtensionContext | undefined;

export let persistentCacheClientObject: PersistentCacheClient | undefined = undefined;

interface WorkerInfo {
  worker: Worker;
  ready: boolean;
  queue: Array<{ id: number; filePath: string }>;
}


import { FileMetadata } from '../tracker/fileTrackingData';
type PCMeta = FileMetadata | null;

export async function getFileMetadataFromCache(filePath: string): Promise<FileMetadata | null> {
  if (!persistentCacheClientObject) { return null; }
  let meta: PCMeta = null;
  try { meta = persistentCacheClientObject.getMetaFromCache(filePath); } catch { meta = null; }

  const asyncWordCounter = getAsyncWordCounter();
  // 有 GitGuard 时，判断是否允许直接用缓存
  if ((asyncWordCounter as any).gitGuard) {
    let needRecount = true;
    try { needRecount = await (asyncWordCounter as any).gitGuard.shouldCountByGitOnly(vscode.Uri.file(filePath)); }
    catch { needRecount = true; }
    if (!needRecount && meta) {
      return meta;
    }
    // Git 判定需要重算或缓存无数据，走 worker（重新读分片）
    meta = await persistentCacheClientObject.getMeta(filePath);
    if (meta) {
      return meta;
    }
    return null;
  }

  // 没有 GitGuard，继续用 mtime 校验
  if (meta?.mtime !== undefined) {
    try {
      const st = await fs.promises.stat(filePath);
      if (st && st.mtimeMs === meta.mtime) { return meta; }
    } catch { /* ignore */ }
  }
  // 没有缓存或判定需要重算，走分片
  meta = await persistentCacheClientObject.getMeta(filePath);
  if (meta) {
    return meta;
  }
  return null;
}

class PersistentCacheClient {
  // 缓存计数桶，已读分片 uuid
  private loadedUuidSet = new Set<string>();
  private totalCacheCount = 0;

  private worker: Worker | null = null;
  private ready = false;
  private seq = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

  // —— 索引/缓存状态（上提到管理器）——
  private WORKSPACE_ROOT = '';
  private DB_DIR = '';
  private INDEX_PATH = '';
  private NORMALIZE_CASE = process.platform === 'win32';

  // 只读一次（失败也只尝试一次）
  private indexLoadOnce: Promise<void> | null = null;

  private pathToUuid = new Map<string, string>();     // normPath -> uuid
  private metaCache = new Map<string, PCMeta>();      // 'meta:'+normPath -> meta
  private inflight = new Map<string, Promise<PCMeta>>();

  public allCacheLoaded: boolean = false; // 新增：所有分片加载完毕后设为 true

  constructor(private ctx: vscode.ExtensionContext) { }

  // ———— Worker 基础通信 ————
  private waitForReady(): Promise<void> {
    if (this.ready) {return Promise.resolve();}
    return new Promise((resolve) => {
      const tick = () => (this.ready ? resolve() : setTimeout(tick, 10));
      tick();
    });
  }

  private async ensureWorker(): Promise<void> {
    if (this.worker) {return;}
    const wpath = vscode.Uri.joinPath(this.ctx.extensionUri, 'out', 'workers', 'persistentCache.worker.js');
    const w = new Worker(wpath.fsPath);
    this.worker = w;

    w.on('message', (m: any) => {
      if (m?.type === 'ready') { this.ready = true; return; }
      const id = m?.id;
      if (!id || !this.pending.has(id)) {return;}
      const { resolve, reject } = this.pending.get(id)!;
      this.pending.delete(id);

      if (m.type === 'readJsonResult') {resolve(m.result ?? null);}
      else if (m.type === 'statResult') {resolve(m.stat ?? null);}
      else if (m.type === 'error') {reject(new Error(String(m.error || 'pcache worker error')));}
      else {resolve(m);}
    });

    w.on('error', () => { this.ready = false; });

    w.postMessage({ type: 'init' });
    await this.waitForReady();
  }

  private callRaw(type: string, payload: any): Promise<any> {
    if (!this.worker) {throw new Error('pcache worker not inited');}
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ type, id, ...payload });
    });
  }

  private readJsonViaWorker(file: string): Promise<FileMetadata | null> {
    return this.callRaw('readJson', { file }) as Promise<FileMetadata | null>;
  }

  // ———— 归一化/路径工具 ————
  private normFs(p: string): string {
    const abs = path.resolve(p).replace(/\\/g, '/');
    return this.NORMALIZE_CASE ? abs.toLowerCase() : abs;
  }

  private shardPathOfUuid(uuid: string): string {
    const prefix = uuid.slice(0, 2);
    return path.join(this.DB_DIR, prefix, `${uuid}.json`);
  }

  // ———— Index 管理：只读一次 ————
  private async ensureInited(): Promise<void> {
    await this.ensureWorker();

    if (!this.WORKSPACE_ROOT) {
      this.WORKSPACE_ROOT = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      this.DB_DIR = path.join(this.WORKSPACE_ROOT, 'novel-helper', '.anh-fsdb');
      this.INDEX_PATH = path.join(this.DB_DIR, 'index.json');
      this.NORMALIZE_CASE = true; // Windows 建议小写规范化
    }

    if (!this.indexLoadOnce) {
      this.indexLoadOnce = this.loadIndexOnce();
    }
    await this.indexLoadOnce;

    // 统计总缓存数（分片数）
    this.totalCacheCount = this.pathToUuid.size;
  }

  private async loadIndexOnce(): Promise<void> {
    try {
      const buf = await fs.promises.readFile(this.INDEX_PATH);
      const idx = JSON.parse(buf.toString('utf8'));
      const entries = idx?.entries || idx?.files || [];
      if (Array.isArray(entries)) {
        for (const ent of entries) {
          if (!ent || typeof ent !== 'object') {continue;}
          const u = (ent as any).u; const p = (ent as any).p;
          if (typeof u === 'string' && typeof p === 'string') {
            this.pathToUuid.set(this.normFs(p), u);
          }
        }
      }
      // 成功即完成；不设置任何重试
    } catch {
      // 没有 index.json 或解析失败：接受为空映射，不再重试
    }
  }

  // ———— 读取分片 Meta（读文件由 worker 完成，完整缓存） ————
  // 优先从缓存抓数据，没有再读分片
  private async readMetaByUuid(uuid: string): Promise<PCMeta> {
    // 先查缓存
    for (const [key, meta] of this.metaCache.entries()) {
      if (meta && meta.uuid === uuid) {
        return meta;
      }
    }
    // 没有缓存，读分片
    const p = this.shardPathOfUuid(uuid);
    const j = await this.readJsonViaWorker(p).catch(() => null);
    if (!j) {return null;}
    // 记录已读分片 uuid，去重
    if (!this.loadedUuidSet.has(uuid)) {
      this.loadedUuidSet.add(uuid);
    }
    return j;
  }

  // 直接从缓存抓数据（不读分片）
  public getMetaFromCache(filePath: string): PCMeta {
    const norm = this.normFs(filePath);
    const cacheKey = 'meta:' + norm;
    return this.metaCache.get(cacheKey) ?? null;
  }
  // 判断是否已读完全部缓存
  public isAllCacheLoaded(): boolean {
    return this.loadedUuidSet.size >= this.totalCacheCount && this.totalCacheCount > 0;
  }


  // ———— 外部 API：filePath -> Meta（缓存 + 去重；miss 不扫描，直接 null） ————
  async getMeta(filePath: string): Promise<PCMeta> {
    await this.ensureInited();

    const norm = this.normFs(filePath);
    const cacheKey = 'meta:' + norm;

    if (this.metaCache.has(cacheKey)) {return this.metaCache.get(cacheKey)!;}
    if (this.inflight.has(norm)) {return this.inflight.get(norm)!;}

    const work = (async () => {
      const uuid = this.pathToUuid.get(norm);
      if (!uuid) {
        this.metaCache.set(cacheKey, null);
        return null;
      }
      const meta = await this.readMetaByUuid(uuid);
      this.metaCache.set(cacheKey, meta);
      return meta;
    })();

    this.inflight.set(norm, work);
    try { return await work; } finally { this.inflight.delete(norm); }
  }

  dispose(): void {
    const w = this.worker;
    if (w) { try { w.terminate(); } catch { /* ignore */ } }
    this.worker = null;
    this.pending.forEach(p => p.reject(new Error('pcache disposed')));
    this.pending.clear();
    this.ready = false;

    this.metaCache.clear();
    this.pathToUuid.clear();
    this.loadedUuidSet.clear();
    this.totalCacheCount = 0;
    // 不重置 indexLoadOnce，符合“只读一次”的语义
  }
}



class AsyncWordCounter {
  private workers: WorkerInfo[] = [];
  private maxWorkers = 1;
  private id = 0;
  private pending = new Map<number, Pending>();

  // 新增：pcache + gitGuard + 并发去重
  private gitGuard?: GitGuard;
  private inflightByPath = new Map<string, Promise<TextStats>>();

  /** 外部注入 context（activate 时调用） */
  setContext(ctx: vscode.ExtensionContext) {
    theContext = ctx;
    persistentCacheClientObject = new PersistentCacheClient(ctx);
  }
  /** 外部注入 GitGuard */
  setGitGuard(guard: GitGuard) { this.gitGuard = guard; }

  private ensurePool() {
    if (this.workers.length) { return; }
    try {
      const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
      const user = cfg.get<number>('wordCount.maxWorkers', 0);
      const upper = cfg.get<number>('wordCount.maxWorkersUpperLimit', 8);
      const upperClamped = Math.max(1, Math.min(128, upper || 8));
      if (typeof user === 'number' && user > 0) {
        this.maxWorkers = Math.min(upperClamped, Math.max(1, user));
      } else {
        const auto = Math.max(1, Math.floor(os.cpus().length / 2) || 1);
        this.maxWorkers = Math.min(upperClamped, Math.min(4, auto));
      }
    } catch { this.maxWorkers = 1; }
    for (let i = 0; i < this.maxWorkers; i++) { this.spawnOne(i); }
  }

  private spawnOne(index: number) {
    if (theContext === undefined) {
      throw new Error('AsyncWordCounter context not set');
    }
    const workerPath = vscode.Uri.joinPath(theContext.extensionUri, 'out', 'workers', 'wordCountWorker.js');
    try {
      const worker = new Worker(workerPath.fsPath);
      const info: WorkerInfo = { worker, ready: false, queue: [] };
      worker.on('message', (msg: any) => this.onMessage(msg, info));
      worker.on('error', err => {
        console.warn('[AsyncWordCounter] worker error', index, err);
        info.ready = false;
        const rebound = info.queue.splice(0, info.queue.length);
        for (const t of rebound) { this.dispatchExisting(t.id, t.filePath); }
        try { worker.terminate(); } catch { /* ignore */ }
        setTimeout(() => this.spawnOne(index), 1000);
      });
      worker.on('exit', code => {
        info.ready = false;
        if (code !== 0) {
          console.warn('[AsyncWordCounter] worker exit code', code, 'respawn');
          setTimeout(() => this.spawnOne(index), 800);
        }
      });
      this.workers.push(info);
    } catch (e) {
      console.warn('[AsyncWordCounter] spawn failed', e);
    }
  }

  private onMessage(msg: any, info: WorkerInfo) {
    if (!msg) { return; }
    if (msg.type === 'ready') {
      info.ready = true;
      for (const q of info.queue.splice(0, info.queue.length)) {
        info.worker.postMessage({ type: 'count', id: q.id, filePath: q.filePath });
      }
    } else if (msg.type === 'countResult') {
      const p = this.pending.get(msg.id);
      if (!p) { return; }
      this.pending.delete(msg.id);
      if (msg.error) { p.reject(new Error(msg.error)); }
      else { p.resolve(msg.stats as TextStats); }
    }
  }

  private pickWorker(): WorkerInfo | null {
    if (!this.workers.length) { return null; }
    let best = this.workers[0];
    for (const w of this.workers) { if (w.queue.length < best.queue.length) { best = w; } }
    return best;
  }

  private dispatchExisting(id: number, filePath: string) {
    const w = this.pickWorker();
    if (!w) { return; }
    if (w.ready) { w.worker.postMessage({ type: 'count', id, filePath }); }
    else { w.queue.push({ id, filePath }); }
  }

  /** 优化：先读缓存，再做 Git 判断是否可用缓存，否则才派发统计 worker */
  async countFile(filePath: string): Promise<TextStats> {
    // 并发去重
    if (this.inflightByPath.has(filePath)) { return this.inflightByPath.get(filePath)!; }

    const work = (async () => {
      // 优先从缓存抓数据
      let meta: PCMeta = null;
      try { meta = persistentCacheClientObject ? persistentCacheClientObject.getMetaFromCache(filePath) : null; } catch { meta = null; }

      // 首次读取到 meta，暴力注入数据库（写入 files[uuid]，同步 pathToUuid）
      if (meta && fileTrackingDatabase && meta.uuid) {
        try {
          // 仅当 meta.uuid 存在时才写入
          let uuid = fileTrackingDatabase.pathToUuid[filePath];
          if (!uuid) {
            uuid = meta.uuid;
            fileTrackingDatabase.pathToUuid[filePath] = uuid;
          }
          fileTrackingDatabase.files[uuid] = meta;
          fileTrackingDatabase.lastUpdated = Date.now();
        } catch { /* ignore */ }
        // 兜底调用 setFileMetadata
        console.error('数据文件损坏 无法注入数据库');
      }

      // 有 GitGuard 时，判断是否允许直接用缓存
      if (this.gitGuard) {
        let needRecount = true;
        try { needRecount = await this.gitGuard.shouldCountByGitOnly(vscode.Uri.file(filePath)); }
        catch { needRecount = true; }
        if (!needRecount && meta?.wordCountStats) {
          // Git 未变更，直接用缓存
          return meta.wordCountStats;
        }
        // Git 判定需要重算或缓存无数据，走 worker（重新读分片）
        meta = persistentCacheClientObject ? await persistentCacheClientObject.getMeta(filePath) : null;
        if (meta?.wordCountStats) {
          return meta.wordCountStats;
        }
        // 兜底 worker
        console.log('[AsyncWordCounter] git-need recount or cache miss:', filePath);
        return this.recountViaWorkerOrFallback(filePath);
      }

      // 没有 GitGuard，继续用 mtime 校验
      if (meta?.mtime !== undefined && meta.wordCountStats) {
        try {
          const st = await fs.promises.stat(filePath);
          if (st && st.mtimeMs === meta.mtime) { return meta.wordCountStats; }
          // mtime 不一致，视为缓存失效
          console.log('[AsyncWordCounter] pcache stale (mtime mismatch):', filePath, { diskMtime: st?.mtimeMs, cacheMtime: meta.mtime });
        } catch { /* ignore */ }
      }

      // 没有缓存或判定需要重算，走 worker
      meta = persistentCacheClientObject ? await persistentCacheClientObject.getMeta(filePath) : null;
      if (meta?.wordCountStats) {
        return meta.wordCountStats;
      }
      console.log('[AsyncWordCounter] pcache miss or need recount:', filePath, meta ? { mtime: meta?.mtime } : null);
      return this.recountViaWorkerOrFallback(filePath);
    })();

    this.inflightByPath.set(filePath, work);
    try { return await work; } finally { this.inflightByPath.delete(filePath); }
  }

  /** 小工具：派发到统计 worker；失败回退到主线程 countAndAnalyze */
  private recountViaWorkerOrFallback(filePath: string): Promise<TextStats> {
    this.ensurePool();
    if (!this.workers.length) { return countAndAnalyze(filePath); }
    const id = ++this.id;
    return new Promise<TextStats>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.dispatchExisting(id, filePath);
    }).catch(async (e) => {
      try { return await countAndAnalyze(filePath); } catch { throw e; }
    });
  }


  dispose() {
    for (const w of this.workers) { try { w.worker.terminate(); } catch { /* ignore */ } }
    this.workers = [];
    for (const [, p] of this.pending) { p.reject(new Error('disposed')); }
    this.pending.clear();
    try { persistentCacheClientObject?.dispose(); } catch { /* ignore */ }
  }
}

let singleton: AsyncWordCounter | undefined;
export function getAsyncWordCounter(): AsyncWordCounter {
  if (!singleton) { singleton = new AsyncWordCounter(); }
  return singleton;
}
export async function countAndAnalyzeOffThread(filePath: string) {
  return getAsyncWordCounter().countFile(filePath);
}

// —— 外部注入 —— //
export function setWordCounterContext(context: vscode.ExtensionContext) {
  theContext = context;
  getAsyncWordCounter().setContext(context);
}
export function setWordCounterGitGuard(guard: GitGuard) {
  getAsyncWordCounter().setGitGuard(guard);
}
