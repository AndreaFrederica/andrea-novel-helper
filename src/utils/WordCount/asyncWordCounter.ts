import { Worker } from 'worker_threads';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
// 仅在主线程 fallback 时才会调用 utils 中的 countAndAnalyze (带 vscode 配置读取)
import { countAndAnalyze } from '../utils';
import { TextStats } from './wordCountCore';

interface Pending { resolve:(s:TextStats)=>void; reject:(e:any)=>void; }

interface WorkerInfo {
  worker: Worker;
  ready: boolean;
  queue: Array<{ id:number; filePath:string }>;
}

class AsyncWordCounter {
  private workers: WorkerInfo[] = [];
  private maxWorkers = 1;
  private id = 0;
  private pending = new Map<number, Pending>();

  private ensurePool() {
    if (this.workers.length) { return; }
    // 读取配置（默认：min(cpu/2,4)，不超过8，不低于1）
    try {
      const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
      const user = cfg.get<number>('wordCount.maxWorkers', 0);
      const upper = cfg.get<number>('wordCount.maxWorkersUpperLimit', 8);
      const upperClamped = Math.max(1, Math.min(128, upper || 8));
      if (typeof user === 'number' && user > 0) {
        this.maxWorkers = Math.min(upperClamped, Math.max(1, user));
      } else {
        // 自动： cpu/2 向下取整 >=1，先限制到 4，再受 upperClamped 控制
        const auto = Math.max(1, Math.floor(os.cpus().length / 2) || 1);
        this.maxWorkers = Math.min(upperClamped, Math.min(4, auto));
      }
    } catch { this.maxWorkers = 1; }
    for (let i=0; i< this.maxWorkers; i++) { this.spawnOne(i); }
  }

  private spawnOne(index: number) {
    const workerPath = path.join(__dirname, '..', 'workers', 'wordCountWorker.js');
    try {
      const worker = new Worker(workerPath);
      const info: WorkerInfo = { worker, ready: false, queue: [] };
      worker.on('message', (msg:any)=> this.onMessage(msg, info));
      worker.on('error', err=>{
        console.warn('[AsyncWordCounter] worker error', index, err);
        info.ready = false;
        // 把未发送的队列任务回退到 pending（重新派发）
        const rebound = info.queue.splice(0, info.queue.length);
        for (const t of rebound) {
          // 重新安排（保持同 id / promise 关系）
          this.dispatchExisting(t.id, t.filePath);
        }
        // 终止并重建
        try { worker.terminate(); } catch {/* ignore */}
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
    if (!msg) { return; }
    if (msg.type === 'ready') {
      info.ready = true;
      // flush its queue
      for (const q of info.queue.splice(0, info.queue.length)) {
        info.worker.postMessage({ type:'count', id:q.id, filePath:q.filePath });
      }
    } else if (msg.type === 'countResult') {
      const p = this.pending.get(msg.id);
      if (!p) { return; }
  this.pending.delete(msg.id);
      if (msg.error) { p.reject(new Error(msg.error)); } else { p.resolve(msg.stats as TextStats); }
    }
  }

  private pickWorker(): WorkerInfo | null {
    if (!this.workers.length) { return null; }
    // 选 queue 最短的 worker
    let best = this.workers[0];
    for (const w of this.workers) { if (w.queue.length < best.queue.length) { best = w; } }
    return best;
  }

  private dispatchExisting(id:number, filePath:string) {
    const w = this.pickWorker();
    if (!w || !w.worker) { return; }
    if (w.ready) { w.worker.postMessage({ type:'count', id, filePath }); }
    else { w.queue.push({ id, filePath }); }
  }

  async countFile(filePath: string): Promise<TextStats> {
    this.ensurePool();
    if (!this.workers.length) { return countAndAnalyze(filePath); }
    const id = ++this.id;
    return new Promise<TextStats>((resolve, reject)=>{
      this.pending.set(id, { resolve, reject });
      this.dispatchExisting(id, filePath);
    }).catch(async (e)=>{ try { return await countAndAnalyze(filePath); } catch { throw e; } });
  }

  dispose() {
    for (const w of this.workers) { try { w.worker.terminate(); } catch {/* ignore */} }
    this.workers = [];
  for (const [, p] of this.pending) { p.reject(new Error('disposed')); }
    this.pending.clear();
  }
}

let singleton: AsyncWordCounter | undefined;
export function getAsyncWordCounter(): AsyncWordCounter { if (!singleton) { singleton = new AsyncWordCounter(); } return singleton; }
export async function countAndAnalyzeOffThread(filePath: string) { return getAsyncWordCounter().countFile(filePath); }
