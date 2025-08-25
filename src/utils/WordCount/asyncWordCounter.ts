import { Worker } from 'worker_threads';
import * as os from 'os';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { countAndAnalyze } from '../utils';
import { TextStats } from './wordCountCore';
import { GitGuard } from '../Git/gitGuard';

interface Pending { resolve:(s:TextStats)=>void; reject:(e:any)=>void; }

let theContext: vscode.ExtensionContext | undefined;

interface WorkerInfo {
  worker: Worker;
  ready: boolean;
  queue: Array<{ id:number; filePath:string }>;
}

/** 持久化缓存 worker 客户端 */
type PCMeta = { mtime?: number; wordCountStats?: TextStats } | null;

class PersistentCacheClient {
  private worker: Worker | null = null;
  private ready = false;
  private seq = 1;
  private pending = new Map<number, { resolve:(v:any)=>void; reject:(e:any)=>void }>();

  constructor(private ctx: vscode.ExtensionContext) {}

  private waitForReady(): Promise<void> {
    if (this.ready) {return Promise.resolve();}
    return new Promise((resolve) => {
      const tick = () => { this.ready ? resolve() : setTimeout(tick, 10); };
      tick();
    });
  }

  private async ensureInited(): Promise<void> {
    if (this.worker) {return;}
    const wpath = vscode.Uri.joinPath(this.ctx.extensionUri, 'out', 'workers', 'persistentCache.worker.js');
    const w = new Worker(wpath.fsPath);
    this.worker = w;

    w.on('message', (m:any) => {
      if (m?.type === 'inited') { this.ready = true; return; }
      const id = m?.id;
      if (!id || !this.pending.has(id)) {return;}
      const { resolve, reject } = this.pending.get(id)!;
      this.pending.delete(id);
      if (m.type === 'getMetaResult') {resolve(m.result ?? null);}
      else if (m.type === 'getMetaManyResult') {resolve(m.result ?? {});}
      else if (m.type === 'refreshIndexResult') {resolve(m);}
      else if (m.type === 'error') {reject(new Error(String(m.error || 'pcache worker error')));}
    });

    w.on('error', () => { this.ready = false; });

    w.postMessage({
      type: 'init',
      workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
      normalizeCase: true,
      scanConcurrency: 16,
    });

    await this.waitForReady();
  }

  private call(type:string, payload:any): Promise<any> {
    if (!this.worker) {throw new Error('pcache worker not inited');}
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ type, id, ...payload });
    });
  }

  async getMeta(filePath: string): Promise<PCMeta> {
    await this.ensureInited();
    return this.call('getMeta', { filePath }) as Promise<PCMeta>;
  }

  dispose(): void {
    const w = this.worker;
    if (w) { try { w.terminate(); } catch { /* ignore */ } }
    this.worker = null;
    this.pending.forEach(p => p.reject(new Error('pcache disposed')));
    this.pending.clear();
    this.ready = false;
  }
}

class AsyncWordCounter {
  private workers: WorkerInfo[] = [];
  private maxWorkers = 1;
  private id = 0;
  private pending = new Map<number, Pending>();

  // 新增：pcache + gitGuard + 并发去重
  private pc?: PersistentCacheClient;
  private gitGuard?: GitGuard;
  private inflightByPath = new Map<string, Promise<TextStats>>();

  /** 外部注入 context（activate 时调用） */
  setContext(ctx: vscode.ExtensionContext) {
    theContext = ctx;
    this.pc = new PersistentCacheClient(ctx);
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
    for (let i = 0; i < this.maxWorkers; i++) {this.spawnOne(i);}
  }

  private spawnOne(index: number) {
    if (theContext === undefined) {
      throw new Error('AsyncWordCounter context not set');
    }
    const workerPath = vscode.Uri.joinPath(theContext.extensionUri, 'out', 'workers', 'wordCountWorker.js');
    try {
      const worker = new Worker(workerPath.fsPath);
      const info: WorkerInfo = { worker, ready: false, queue: [] };
      worker.on('message', (msg:any)=> this.onMessage(msg, info));
      worker.on('error', err=>{
        console.warn('[AsyncWordCounter] worker error', index, err);
        info.ready = false;
        const rebound = info.queue.splice(0, info.queue.length);
        for (const t of rebound) {this.dispatchExisting(t.id, t.filePath);}
        try { worker.terminate(); } catch { /* ignore */ }
        setTimeout(()=> this.spawnOne(index), 1000);
      });
      worker.on('exit', code=>{
        info.ready = false;
        if (code !== 0) {
          console.warn('[AsyncWordCounter] worker exit code', code, 'respawn');
          setTimeout(()=> this.spawnOne(index), 800);
        }
      });
      this.workers.push(info);
    } catch (e) {
      console.warn('[AsyncWordCounter] spawn failed', e);
    }
  }

  private onMessage(msg:any, info: WorkerInfo) {
    if (!msg) {return;}
    if (msg.type === 'ready') {
      info.ready = true;
      for (const q of info.queue.splice(0, info.queue.length)) {
        info.worker.postMessage({ type:'count', id:q.id, filePath:q.filePath });
      }
    } else if (msg.type === 'countResult') {
      const p = this.pending.get(msg.id);
      if (!p) {return;}
      this.pending.delete(msg.id);
      if (msg.error) {p.reject(new Error(msg.error));}
      else {p.resolve(msg.stats as TextStats);}
    }
  }

  private pickWorker(): WorkerInfo | null {
    if (!this.workers.length) {return null;}
    let best = this.workers[0];
    for (const w of this.workers) {if (w.queue.length < best.queue.length) {best = w;}}
    return best;
  }

  private dispatchExisting(id:number, filePath:string) {
    const w = this.pickWorker();
    if (!w) {return;}
    if (w.ready) {w.worker.postMessage({ type:'count', id, filePath });}
    else {w.queue.push({ id, filePath });}
  }

  /** 核心：先做 Git 判定；未变更再读持久化缓存；必要时才派发统计 worker */
async countFile(filePath: string): Promise<TextStats> {
  // 并发去重
  if (this.inflightByPath.has(filePath)) {return this.inflightByPath.get(filePath)!;}

  const work = (async () => {
    const uri = vscode.Uri.file(filePath);

    // 0) 有 GitGuard：先走“只看 Git 是否改动”的快速路径（不读整文件、不读数据库）
    if (this.gitGuard) {
      let needRecount = true;
      try { needRecount = await this.gitGuard.shouldCountByGitOnly(uri); }
      catch { needRecount = true; } // 保守：算

      // 改动了 → 直接重算，完全跳过数据库
      if (needRecount) {
        return this.recountViaWorkerOrFallback(filePath);
      }

      // 未改动 → 这时再去查持久化缓存（命中则返回，即使 mtime 不一致也信缓存，保持旧逻辑）
      let meta: PCMeta = null;
      try { meta = this.pc ? await this.pc.getMeta(filePath) : null; } catch { meta = null; }
  if (meta?.wordCountStats) {return meta.wordCountStats;}
  // 缓存未命中（或没有可用的 wordCountStats）
  console.log('[AsyncWordCounter] pcache miss (git-unchanged):', filePath, meta ? { mtime: meta.mtime } : null);

      // 缓存未命中：兜底重算
      return this.recountViaWorkerOrFallback(filePath);
    }

    // 1) 没有 GitGuard 的场景：只能依赖 mtime 短路（需要读一次持久化缓存）
    let meta: PCMeta = null;
    try { meta = this.pc ? await this.pc.getMeta(filePath) : null; } catch { meta = null; }
    if (meta?.mtime !== undefined && meta.wordCountStats) {
      try {
        const st = await fs.promises.stat(filePath);
        if (st && st.mtimeMs === meta.mtime) {return meta.wordCountStats;}
        // mtime 不一致，视为缓存失效
        console.log('[AsyncWordCounter] pcache stale (mtime mismatch):', filePath, { diskMtime: st?.mtimeMs, cacheMtime: meta.mtime });
      } catch { /* ignore */ }
    } else {
      // 没有缓存或缓存缺少统计数据
      console.log('[AsyncWordCounter] pcache miss (no meta or no stats):', filePath, meta ? { mtime: meta?.mtime } : null);
    }

    // 2) 兜底：派发统计 worker；失败退回主线程
    return this.recountViaWorkerOrFallback(filePath);
  })();

  this.inflightByPath.set(filePath, work);
  try { return await work; } finally { this.inflightByPath.delete(filePath); }
}

/** 小工具：派发到统计 worker；失败回退到主线程 countAndAnalyze */
private recountViaWorkerOrFallback(filePath: string): Promise<TextStats> {
  this.ensurePool();
  if (!this.workers.length) {return countAndAnalyze(filePath);}
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
    try { this.pc?.dispose(); } catch { /* ignore */ }
  }
}

let singleton: AsyncWordCounter | undefined;
export function getAsyncWordCounter(): AsyncWordCounter {
  if (!singleton) {singleton = new AsyncWordCounter();}
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
