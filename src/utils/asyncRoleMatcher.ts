import { Worker } from 'worker_threads';
import * as path from 'path';
import { roles, onDidChangeRoles } from '../activate';
import * as vscode from 'vscode';

interface WorkerMatch { end:number; pats:string[] }
interface PendingReq { resolve: (m:WorkerMatch[])=>void; reject:(e:any)=>void; ts:number; docVersion?:number; }

let theContext: vscode.ExtensionContext | undefined;

class AsyncRoleMatcher {
  private worker: Worker | null = null;
  private ready = false;
  private building = false;
  private reqId = 0;
  private pending = new Map<number, PendingReq>();
  private disposables: vscode.Disposable[] = [];
  private lastBuildSerial = 0;
  private buildWaiters: Array<() => void> = [];
  private handleConfigChangeDisposable?: vscode.Disposable;
  private lastBuiltRoles?: Array<{ name: string; aliases?: string[]; wordSegmentFilter?: any }>;

  constructor() {
    this.spawn();
    // rebuild on role changes (debounced)
    let timer: NodeJS.Timeout | undefined;
    this.disposables.push(onDidChangeRoles(()=>{
      if (timer) { clearTimeout(timer); }
      timer = setTimeout(()=> this.build(), 100);
    }));
    // 监听配置变化（分词相关），触发重建
    this.handleConfigChangeDisposable = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('AndreaNovelHelper.enableWordSegmentFilter') ||
          e.affectsConfiguration('AndreaNovelHelper.wordSegment.autoFilterMaxLength')) {
        // 仅当已有构建角色缓存时才重建
        if (this.lastBuiltRoles) {
          this.build(this.lastBuiltRoles);
        }
      }
    });
  }
  private spawn() {
  if (this.worker) { return; }
    try {
      if (!theContext) {
        throw new Error('AsyncRoleMatcher context not set');
      }
      const workerPath = vscode.Uri.joinPath(theContext.extensionUri, 'out', 'workers', 'roleAcWorker.js').fsPath;
      // const workerPath = path.join(__dirname, '..', 'workers', 'roleAcWorker.js');
      this.worker = new Worker(workerPath);
      this.worker.on('message', (msg: any)=> this.onMessage(msg));
      this.worker.on('error', err=>{
        console.warn('[AsyncRoleMatcher] worker error', err);
        this.ready = false;
      });
      this.worker.on('exit', code=>{
        this.ready = false;
        this.worker = null;
        if (code !== 0) {
          console.warn('[AsyncRoleMatcher] worker exited, respawn');
          setTimeout(()=> this.spawn(), 500);
        }
      });
    } catch (e) {
      console.warn('[AsyncRoleMatcher] spawn failed, fallback to sync', e);
      this.worker = null;
    }
  }
  private onMessage(msg:any) {
  if (!msg) { return; }
    if (msg.type === 'ready') { this.ready = true; this.build(); }
    else if (msg.type === 'built') {
      this.building = false; this.lastBuildSerial++;
      const ws = this.buildWaiters.slice(); this.buildWaiters = [];
      for (const w of ws) { try { w(); } catch {/*ignore*/} }
    }
    else if (msg.type === 'result') {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
  if (msg.error) { p.reject(new Error(msg.error)); } else { p.resolve(msg.matches || []); }
      }
    }
  }
  build(explicitRoles?: Array<{ name: string; aliases?: string[]; wordSegmentFilter?: any }>) {
  if (!this.worker || !this.ready) { return; }
  if (this.building) { return; }
    this.building = true;
    // include fixes/fixs so worker can build patterns for fixes as well
    const simpleRoles = explicitRoles || roles.map(r => ({
      name: r.name,
      aliases: r.aliases,
      fixes: (r as any).fixes || (r as any).fixs,
      wordSegmentFilter: (r as any).wordSegmentFilter
    }));
    this.lastBuiltRoles = simpleRoles as any;
  let enableWordSegmentFilter = true; let autoFilterMaxLength = 1;
    try {
      const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
      enableWordSegmentFilter = cfg.get<boolean>('enableWordSegmentFilter', true) ?? true;
      autoFilterMaxLength = cfg.get<number>('wordSegment.autoFilterMaxLength', 1) ?? 1;
    } catch {/* ignore */}
  this.worker.postMessage({ type:'build', roles: simpleRoles, config: { enableWordSegmentFilter, autoFilterMaxLength } });
  }
  async search(text: string, docVersion?: number): Promise<WorkerMatch[]> {
    if (!this.worker) { return []; }
    if (!this.ready || this.building) {
      // 等待构建完成再真正搜索（最多 2s）
      return new Promise<WorkerMatch[]>((resolve) => {
        const start = Date.now();
        const retry = () => {
          if (Date.now() - start > 2000) { resolve([]); return; }
          if (this.ready && !this.building) {
            this.search(text, docVersion).then(resolve).catch(()=>resolve([]));
          } else {
            this.buildWaiters.push(retry);
          }
        };
        this.buildWaiters.push(retry);
        // 若还没触发 build 尝试启动
        this.build();
      });
    }
    const id = ++this.reqId;
    return new Promise<WorkerMatch[]>((resolve, reject)=>{
      this.pending.set(id, { resolve, reject, ts: Date.now(), docVersion });
      try { this.worker!.postMessage({ type:'search', id, text }); }
      catch (e) { this.pending.delete(id); reject(e); }
      // timeout
      setTimeout(()=>{
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('search timeout'));
        }
      }, 5000);
    });
  }
  dispose() {
  for (const d of this.disposables) { d.dispose(); }
    if (this.worker) { this.worker.terminate(); }
    this.pending.clear();
  this.handleConfigChangeDisposable?.dispose();
  }
}

let singleton: AsyncRoleMatcher | undefined;
export function getAsyncRoleMatcher(): AsyncRoleMatcher {
  if (!singleton) { singleton = new AsyncRoleMatcher(); }
  return singleton;
}

export function setAsyncRoleMatcherContext(context: vscode.ExtensionContext) {
  theContext = context;
}