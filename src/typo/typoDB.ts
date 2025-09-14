import * as vscode from 'vscode';
import { DocumentTypoDB, ParagraphScanResult } from './typoTypes';
import { 
    isTypoPersistenceEnabled, 
    loadTypoData, 
    saveTypoData, 
    deleteTypoData,
    documentDBToTypoData,
    typoDataToDocumentDB,
    getDocUuidForDocument
} from './typoStorage';

// In-memory per-document store
const store = new Map<string, DocumentTypoDB>(); // key: document.uri.toString()

function getMaxDocs(): number {
    try {
        return vscode.workspace.getConfiguration('AndreaNovelHelper').get<number>('typo.maxDocs', 10) || 10;
    } catch { return 10; }
}

function isDocOpen(key: string): boolean {
    try {
        // Prefer textDocuments which include hidden editors as well
        return vscode.workspace.textDocuments.some(d => d.uri.toString() === key);
    } catch { return false; }
}

function pruneIfNeeded() {
    const max = Math.max(1, getMaxDocs());
    if (store.size <= max) return;
    // Collect entries with access ts
    const entries = Array.from(store.entries()).map(([k, db]) => ({ key: k, ts: db.lastAccessTs ?? 0, open: isDocOpen(k) }));
    // Evict closed first by oldest ts
    const closed = entries.filter(e => !e.open).sort((a, b) => a.ts - b.ts);
    while (store.size > max && closed.length) {
        const victim = closed.shift()!;
        store.delete(victim.key);
    }
    if (store.size <= max) return;
    // Still exceeds: evict open ones by oldest ts (rare: too many open docs)
    const open = entries.filter(e => e.open).sort((a, b) => a.ts - b.ts);
    while (store.size > max && open.length) {
        const victim = open.shift()!;
        store.delete(victim.key);
    }
}

export async function getDocDB(docKey: string, doc?: vscode.TextDocument): Promise<DocumentTypoDB> {
    let db = store.get(docKey);
    if (!db) {
        // 尝试从持久化存储加载
        if (isTypoPersistenceEnabled() && doc) {
            const docUuid = getDocUuidForDocument(doc);
            if (docUuid) {
                try {
                    const persistedData = await loadTypoData(docUuid);
                    db = typoDataToDocumentDB(persistedData);
                } catch (e) {
                    console.error('Failed to load persisted typo data:', e);
                }
            }
        }
        
        if (!db) {
            db = { paragraphResults: new Map(), lastAccessTs: Date.now() };
        }
        store.set(docKey, db);
        pruneIfNeeded();
    } else {
        db.lastAccessTs = Date.now();
    }
    return db;
}

// 保持同步版本以兼容现有代码
export function getDocDBSync(docKey: string): DocumentTypoDB {
    let db = store.get(docKey);
    if (!db) {
        db = { paragraphResults: new Map(), lastAccessTs: Date.now() };
        store.set(docKey, db);
        pruneIfNeeded();
    } else {
        db.lastAccessTs = Date.now();
    }
    return db;
}

export async function clearDocDB(docKey: string, doc?: vscode.TextDocument) {
    // 如果启用持久化，先保存当前数据
    if (isTypoPersistenceEnabled() && doc) {
        const db = store.get(docKey);
        if (db) {
            const docUuid = getDocUuidForDocument(doc);
            if (docUuid) {
                try {
                    const persistData = documentDBToTypoData(docUuid, db);
                    await saveTypoData(persistData);
                } catch (e) {
                    console.error('Failed to save typo data before clearing:', e);
                }
            }
        }
    }
    store.delete(docKey);
}

// 保持同步版本以兼容现有代码
export function clearDocDBSync(docKey: string) {
    store.delete(docKey);
}

export async function setParagraphResult(docKey: string, result: ParagraphScanResult, doc?: vscode.TextDocument) {
    const db = await getDocDB(docKey, doc);
    db.paragraphResults.set(result.paragraphHash, result);
    db.lastAccessTs = Date.now();
    pruneIfNeeded();
    
    // 如果启用持久化，异步保存
    if (isTypoPersistenceEnabled() && doc) {
        const docUuid = getDocUuidForDocument(doc);
        if (docUuid) {
            try {
                const persistData = documentDBToTypoData(docUuid, db);
                await saveTypoData(persistData);
            } catch (e) {
                console.error('Failed to persist typo data:', e);
            }
        }
    }
}

// 保持同步版本以兼容现有代码
export function setParagraphResultSync(docKey: string, result: ParagraphScanResult) {
    const db = getDocDBSync(docKey);
    db.paragraphResults.set(result.paragraphHash, result);
    db.lastAccessTs = Date.now();
    pruneIfNeeded();
}

export async function getParagraphResult(docKey: string, hash: string, doc?: vscode.TextDocument): Promise<ParagraphScanResult | undefined> {
    const db = await getDocDB(docKey, doc);
    db.lastAccessTs = Date.now();
    return db.paragraphResults.get(hash);
}

// 保持同步版本以兼容现有代码
export function getParagraphResultSync(docKey: string, hash: string): ParagraphScanResult | undefined {
    const db = getDocDBSync(docKey);
    db.lastAccessTs = Date.now();
    return db.paragraphResults.get(hash);
}

export async function resetParagraphs(docKey: string, doc?: vscode.TextDocument) {
    const db = await getDocDB(docKey, doc);
    db.paragraphResults.clear();
    db.lastAccessTs = Date.now();
    
    // 如果启用持久化，清空持久化数据
    if (isTypoPersistenceEnabled() && doc) {
        const docUuid = getDocUuidForDocument(doc);
        if (docUuid) {
            try {
                await deleteTypoData(docUuid);
            } catch (e) {
                console.error('Failed to delete persisted typo data:', e);
            }
        }
    }
}

// 保持同步版本以兼容现有代码
export function resetParagraphsSync(docKey: string) {
    const db = getDocDBSync(docKey);
    db.paragraphResults.clear();
    db.lastAccessTs = Date.now();
}

export function pruneStoreToLimit() {
    pruneIfNeeded();
}
