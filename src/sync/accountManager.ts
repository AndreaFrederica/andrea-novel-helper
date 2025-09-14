import * as vscode from 'vscode';
import * as path from 'path';
import { Worker } from 'worker_threads';

interface SyncMessage {
  id: string;
  type: 'webdav-sync' | 'file-read' | 'file-write' | 'file-list' | 'account-load' | 'account-save';
  data: any;
}

interface SyncResponse {
  id: string;
  success: boolean;
  data?: any;
  error?: string;
}

export type WebDAVAccount = {
  id: string; // uuid or user-defined key
  name: string; // display name
  url: string; // base url, e.g., https://dav.example.com/remote.php/dav/files/user/
  username: string;
  // password is stored in SecretStorage using key `webdav:${id}`
  rootPath?: string; // remote subdir to sync under base url
  enabled?: boolean; // whether the account is enabled, defaults to true
};

const ACCOUNTS_KEY = 'andrea.webdav.accounts';

export class WebDAVAccountManager {
  private worker: Worker | null = null;
  private messageId = 0;
  private pendingMessages = new Map<string, { resolve: Function; reject: Function }>();

  constructor(private context: vscode.ExtensionContext) {
    this.initWorker();
  }

  private get secrets() { return this.context.secrets; }

  private initWorker(): void {
    const workerPath = path.join(__dirname, '../workers/syncWorker.js');
    
    // 获取配置数据传递给worker
     const config = vscode.workspace.getConfiguration('AndreaNovelHelper.webdav.sync');
     const ignoredDirectories = config.get('ignoredDirectories', []);
     const ignoredFiles = config.get('ignoredFiles', []);
     const ignoreAppDataDirectories = config.get('ignoreAppDataDirectories', true);
    
    const workerData = {
      config: {
        ignoredDirectories,
        ignoredFiles,
        ignoreAppDataDirectories
      }
    };
    
    this.worker = new Worker(workerPath, { workerData });
    
    this.worker.on('message', (response: SyncResponse) => {
      const pending = this.pendingMessages.get(response.id);
      if (pending) {
        this.pendingMessages.delete(response.id);
        if (response.success) {
          pending.resolve(response.data);
        } else {
          pending.reject(new Error(response.error || 'Unknown error'));
        }
      }
    });

    this.worker.on('error', (error) => {
      console.error('Account manager worker error:', error);
    });
  }

  private async sendMessage(type: string, data: any): Promise<any> {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }

    const id = `msg_${++this.messageId}`;
    const message: SyncMessage = { id, type: type as any, data };

    return new Promise((resolve, reject) => {
      this.pendingMessages.set(id, { resolve, reject });
      this.worker!.postMessage(message);
      
      // 设置超时
      setTimeout(() => {
        if (this.pendingMessages.has(id)) {
          this.pendingMessages.delete(id);
          reject(new Error('Worker message timeout'));
        }
      }, 10000); // 10秒超时
    });
  }

  async getAccounts(): Promise<WebDAVAccount[]> {
    return await this.listAccounts();
  }

  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingMessages.clear();
  }

  async listAccounts(): Promise<WebDAVAccount[]> {
    const raw = this.context.globalState.get<string>(ACCOUNTS_KEY);
    if (!raw) return [];
    try { 
      const accounts = JSON.parse(raw) as WebDAVAccount[];
      // 为旧数据设置默认的enabled值
      return accounts.map(account => ({
        ...account,
        enabled: account.enabled ?? true
      }));
    } catch { return []; }
  }

  private async saveAccounts(list: WebDAVAccount[]) {
    await this.context.globalState.update(ACCOUNTS_KEY, JSON.stringify(list));
  }

  async getPassword(id: string): Promise<string | undefined> {
    return await this.secrets.get(`webdav:${id}`) ?? undefined;
  }
  async setPassword(id: string, password: string | undefined) {
    const key = `webdav:${id}`;
    if (password == null) await this.secrets.delete(key);
    else await this.secrets.store(key, password);
  }

  async addOrEdit(initial?: Partial<WebDAVAccount> & { id?: string }): Promise<WebDAVAccount | undefined> {
    const id = initial?.id ?? ((await vscode.window.showInputBox({ prompt: '为此账户设置一个标识（留空自动生成）', value: initial?.id ?? '' })) || cryptoRandomId());
    const name = await vscode.window.showInputBox({ prompt: '显示名称', value: initial?.name ?? '' });
    if (name == null) return;
    const url = await vscode.window.showInputBox({ prompt: 'WebDAV 基础 URL（以 / 结尾更佳）', value: initial?.url ?? '' });
    if (url == null) return;
    const username = await vscode.window.showInputBox({ prompt: '用户名', value: initial?.username ?? '' });
    if (username == null) return;
    const password = await vscode.window.showInputBox({ prompt: '密码', password: true, value: '' });
    if (password == null) return;
    const rootPath = await vscode.window.showInputBox({ prompt: '远端子目录（可留空）', value: initial?.rootPath ?? '' });

    const list = await this.listAccounts();
    const acc: WebDAVAccount = { id, name, url, username, rootPath: rootPath || undefined, enabled: true } as WebDAVAccount;
    const idx = list.findIndex(a => a.id === id);
    if (idx >= 0) {
      // 编辑现有账户时保持原有的enabled状态
      acc.enabled = list[idx].enabled ?? true;
      list[idx] = acc;
    } else {
      list.push(acc);
    }
    await this.saveAccounts(list);
    await this.setPassword(id, password);
    vscode.window.showInformationMessage(`已保存 WebDAV 账户：${name}`);
    return acc;
  }

  async remove(id?: string) {
    const list = await this.listAccounts();
    const picks = list.map(a => ({ label: a.name, description: `${a.username}@${a.url}`, id: a.id }));
    const pick = id ? picks.find(p => p.id === id) : await vscode.window.showQuickPick(picks, { placeHolder: '选择要删除的账户' });
    if (!pick) return;
    const idx = list.findIndex(a => a.id === pick.id);
    if (idx >= 0) list.splice(idx, 1);
    await this.saveAccounts(list);
    await this.setPassword(pick.id, undefined);
    vscode.window.showInformationMessage(`已删除 WebDAV 账户：${pick.label}`);
  }

  async pickAccount(): Promise<WebDAVAccount | undefined> {
    const list = await this.listAccounts();
    if (!list.length) {
      const create = await vscode.window.showWarningMessage('尚未配置 WebDAV 账户，是否现在添加？', '添加', '取消');
      if (create === '添加') return await this.addOrEdit({});
      return undefined;
    }
    const pick = await vscode.window.showQuickPick([
      ...list.map(a => ({ label: a.name, description: `${a.username}@${a.url}`, acc: a })),
      { label: '➕ 新增账户', description: '', acc: null as any }
    ], { placeHolder: '选择 WebDAV 账户' });
    if (!pick) return;
    if (!pick.acc) return await this.addOrEdit({});
    return pick.acc as WebDAVAccount;
  }
}

function cryptoRandomId() {
  const buf = Buffer.alloc(8);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  return [...buf].map(x => x.toString(16).padStart(2, '0')).join('');
}