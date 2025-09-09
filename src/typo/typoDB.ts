import * as vscode from 'vscode';
import { DocumentTypoDB, ParagraphScanResult } from './typoTypes';

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

export function getDocDB(docKey: string): DocumentTypoDB {
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

export function clearDocDB(docKey: string) {
    store.delete(docKey);
}

export function setParagraphResult(docKey: string, result: ParagraphScanResult) {
    const db = getDocDB(docKey);
    db.paragraphResults.set(result.paragraphHash, result);
    db.lastAccessTs = Date.now();
    pruneIfNeeded();
}

export function getParagraphResult(docKey: string, hash: string): ParagraphScanResult | undefined {
    const db = getDocDB(docKey);
    db.lastAccessTs = Date.now();
    return db.paragraphResults.get(hash);
}

export function resetParagraphs(docKey: string) {
    const db = getDocDB(docKey);
    db.paragraphResults.clear();
    db.lastAccessTs = Date.now();
}

export function pruneStoreToLimit() {
    pruneIfNeeded();
}
