import * as vscode from 'vscode';
import { getAsyncRoleMatcher } from './asyncRoleMatcher';

export interface RoleMatch { end: number; pats: string[] }
interface CacheEntry { version: number; promise: Promise<RoleMatch[]> }
const cache = new Map<string, CacheEntry>();

export function invalidateRoleMatch(doc: vscode.TextDocument) {
  cache.delete(doc.uri.fsPath);
}

/**
 * 获取角色匹配（异步 AC）
 * @param doc 文档
 * @param preText 可选：已获取的全文，避免重复 doc.getText()
 */
export function getRoleMatches(doc: vscode.TextDocument, preText?: string): Promise<RoleMatch[]> {
  const key = doc.uri.fsPath;
  const version = doc.version;
  const exist = cache.get(key);
  if (exist && exist.version === version) { return exist.promise; }
  const matcher = getAsyncRoleMatcher();
  const text = preText ?? doc.getText();
  const p = matcher.search(text, version).catch(()=>[] as RoleMatch[]);
  cache.set(key, { version, promise: p });
  return p;
}

export function clearRoleMatchCacheForClosedDocs(openPaths: Set<string>) {
  for (const k of Array.from(cache.keys())) {
    if (!openPaths.has(k)) { cache.delete(k); }
  }
}
