import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { ParagraphScanResult, DocumentTypoDB, ParagraphTypoError } from './typoTypes';
import { getFileUuid } from '../utils/tracker/globalFileTracking';

const VERSION = '1.0';

type SaveState = { timer?: NodeJS.Timeout; last?: string };
const saveStateByDoc = new Map<string, SaveState>();

function getWsRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function typoDir(): string | undefined {
  const ws = getWsRoot();
  if (!ws) return undefined;
  const dir = path.join(ws, 'novel-helper', 'typo');
  ensureDir(dir);
  return dir;
}

function typoDataDir(): string | undefined {
  const dir = typoDir();
  if (!dir) return undefined;
  const dataDir = path.join(dir, 'data');
  ensureDir(dataDir);
  return dataDir;
}

export async function getDocUuidForDocument(doc: vscode.TextDocument): Promise<string | undefined> {
  try {
    const u = await getFileUuid(doc.uri.fsPath);
    return u || undefined;
  } catch {
    return undefined;
  }
}

// 文档typo数据文件路径
function typoFilePathForUuid(docUuid: string): string | undefined {
  const dir = typoDataDir();
  if (!dir) return undefined;
  return path.join(dir, `${docUuid}.json`);
}

// Typo文档数据结构
export interface TypoDocumentData {
  version: string;
  docUuid: string;
  lastScanAt: number;
  paragraphResults: { [hash: string]: ParagraphScanResult };
}

// 加载文档的typo数据
export async function loadTypoData(docUuid: string): Promise<TypoDocumentData> {
  const fp = typoFilePathForUuid(docUuid);
  if (!fp) { throw new Error('No workspace'); }
  if (!fs.existsSync(fp)) {
    return {
      version: VERSION,
      docUuid,
      lastScanAt: 0,
      paragraphResults: {}
    };
  }
  try {
    const txt = fs.readFileSync(fp, 'utf8');
    const data = JSON.parse(txt) as TypoDocumentData;
    if (!data.version) data.version = VERSION;
    if (!data.paragraphResults) data.paragraphResults = {};
    if (!data.lastScanAt) data.lastScanAt = 0;
    return data;
  } catch {
    return {
      version: VERSION,
      docUuid,
      lastScanAt: 0,
      paragraphResults: {}
    };
  }
}

// 保存文档的typo数据
export async function saveTypoData(data: TypoDocumentData): Promise<void> {
  const fp = typoFilePathForUuid(data.docUuid);
  if (!fp) { throw new Error('No workspace'); }
  
  // 防抖保存
  const docKey = data.docUuid;
  const state = saveStateByDoc.get(docKey) || {};
  const current = JSON.stringify(data);
  if (state.last === current) return; // 内容未变，跳过保存
  
  if (state.timer) {
    clearTimeout(state.timer);
  }
  
  state.timer = setTimeout(() => {
    try {
      fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
      state.last = current;
    } catch (e) {
      console.error('Failed to save typo data:', e);
    }
    saveStateByDoc.delete(docKey);
  }, 500); // 500ms防抖
  
  saveStateByDoc.set(docKey, state);
}

// 删除文档的typo数据
export async function deleteTypoData(docUuid: string): Promise<void> {
  const fp = typoFilePathForUuid(docUuid);
  if (!fp) return;
  
  // 清除防抖定时器
  const state = saveStateByDoc.get(docUuid);
  if (state?.timer) {
    clearTimeout(state.timer);
    saveStateByDoc.delete(docUuid);
  }
  
  try {
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp);
    }
  } catch (e) {
    console.error('Failed to delete typo data:', e);
  }
}

// 检查typo持久化是否启用
export function isTypoPersistenceEnabled(): boolean {
  const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
  return cfg.get<boolean>('typo.persistence.enabled', false) === true;
}

// 获取持久化配置
export function getTypoPersistenceConfig() {
  const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
  return {
    enabled: cfg.get<boolean>('typo.persistence.enabled', false),
    autoCleanup: cfg.get<boolean>('typo.persistence.autoCleanup', true),
    maxAge: cfg.get<number>('typo.persistence.maxAgeDays', 30)
  };
}

// 清理过期的typo数据
export async function cleanupExpiredTypoData(): Promise<void> {
  const config = getTypoPersistenceConfig();
  if (!config.enabled || !config.autoCleanup) return;
  
  const dir = typoDataDir();
  if (!dir || !fs.existsSync(dir)) return;
  
  const maxAge = config.maxAge * 24 * 60 * 60 * 1000; // 转换为毫秒
  const now = Date.now();
  
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (now - stat.mtime.getTime() > maxAge) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (e) {
    console.error('Failed to cleanup expired typo data:', e);
  }
}

// 将内存中的DocumentTypoDB转换为持久化格式
export function documentDBToTypoData(docUuid: string, db: DocumentTypoDB): TypoDocumentData {
  const paragraphResults: { [hash: string]: ParagraphScanResult } = {};
  for (const [hash, result] of db.paragraphResults) {
    paragraphResults[hash] = result;
  }
  
  return {
    version: VERSION,
    docUuid,
    lastScanAt: Date.now(),
    paragraphResults
  };
}

// 将持久化格式转换为内存中的DocumentTypoDB
export function typoDataToDocumentDB(data: TypoDocumentData): DocumentTypoDB {
  const paragraphResults = new Map<string, ParagraphScanResult>();
  for (const [hash, result] of Object.entries(data.paragraphResults)) {
    paragraphResults.set(hash, result);
  }
  
  return {
    paragraphResults,
    lastAppliedDocVersion: undefined,
    lastAccessTs: Date.now()
  };
}

// 清理所有typo数据
export async function cleanupAllData(): Promise<void> {
  const dir = typoDir();
  if (!dir) return;
  
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) {
    console.error('Failed to cleanup all typo data:', e);
  }
}