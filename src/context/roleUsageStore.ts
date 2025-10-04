import * as vscode from 'vscode';
import * as path from 'path';
import { Role } from '../extension';

const STORAGE_KEY = 'roleUsage.index.v2';

type SerializedRange = [number, number, number, number];

interface RoleUsageRoleEntry {
    key: string;
    name: string;
    type?: string;
    occurrences: number;
    ranges: SerializedRange[];
    sourcePath?: string;
    uuid?: string;
}

export interface RoleUsageDocEntry {
    uri: string;
    fsPath?: string;
    version: number;
    updatedAt: number;
    roles: RoleUsageRoleEntry[];
    hash: string;
}

interface RoleUsageStoragePayload {
    version: number;
    docs: RoleUsageDocEntry[];
}

type RoleUsageChangeEvent = { kind: 'doc'; key: string } | { kind: 'role'; key: string } | void;

class RoleUsageStore {
    private context: vscode.ExtensionContext | undefined;
    private docs = new Map<string, RoleUsageDocEntry>();
    private roleIndex = new Map<string, Set<string>>();
    private flushTimer: NodeJS.Timeout | undefined;
    private disposed = false;
    private readonly onDidChangeEmitter = new vscode.EventEmitter<RoleUsageChangeEvent>();

    readonly onDidChange = this.onDidChangeEmitter.event;

    initialize(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadFromStorage();
    }

    dispose() {
        if (this.disposed) { return; }
        this.disposed = true;
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
        this.flushNow().catch(() => {});
        this.onDidChangeEmitter.dispose();
        this.docs.clear();
        this.roleIndex.clear();
    }

    updateFromDocument(doc: vscode.TextDocument, roleToRanges: Map<Role, vscode.Range[]>) {
        if (this.disposed) { return; }
        const key = doc.uri.toString();
        const now = Date.now();
        const entries: RoleUsageRoleEntry[] = [];
        for (const [role, ranges] of roleToRanges) {
            const occurrences = ranges.length;
            if (occurrences <= 0) { continue; }
            const roleKey = getRoleKey(role);
            const serialized: SerializedRange[] = ranges.map(r => [
                r.start.line,
                r.start.character,
                r.end.line,
                r.end.character
            ]);
            entries.push({
                key: roleKey,
                name: role.name,
                type: role.type,
                occurrences,
                ranges: serialized,
                sourcePath: role.sourcePath,
                uuid: role.uuid
            });
        }
        const parts = entries
            .map(e => e.key + ':' + e.occurrences + ':' + e.ranges.map(r => r.join(',')).join(';'))
            .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        const hash = parts.join('|');

        const prev = this.docs.get(key);
        if (entries.length === 0) {
            if (prev) {
                this.docs.delete(key);
                this.dropFromRoleIndex(prev.roles.map(r => r.key), key);
                this.scheduleFlush();
                this.fireChange({ kind: 'doc', key });
            }
            return;
        }

        const docEntry: RoleUsageDocEntry = {
            uri: key,
            fsPath: doc.uri.fsPath,
            version: doc.version,
            updatedAt: now,
            roles: entries,
            hash
        };

        this.docs.set(key, docEntry);
        this.syncRoleIndex(prev?.roles ?? [], entries, key);

        const sameHash = prev?.hash === hash;
        const sameVersion = prev?.version === doc.version;
        if (sameHash && sameVersion) {
            if (!prev || now - prev.updatedAt > 30000) {
                this.scheduleFlush();
            }
            return;
        }

        this.scheduleFlush();
        this.fireChange({ kind: 'doc', key });
    }

    getDocsForRole(role: Role): RoleUsageDocEntry[] {
        const roleKey = getRoleKey(role);
        const docKeys = this.roleIndex.get(roleKey);
        if (!docKeys) { return []; }
        const out: RoleUsageDocEntry[] = [];
        for (const docKey of docKeys) {
            const entry = this.docs.get(docKey);
            if (entry) { out.push(entry); }
        }
        return out;
    }

    getDocsForRoleKey(roleKey: string): RoleUsageDocEntry[] {
        const docKeys = this.roleIndex.get(roleKey);
        if (!docKeys) { return []; }
        const out: RoleUsageDocEntry[] = [];
        for (const docKey of docKeys) {
            const entry = this.docs.get(docKey);
            if (entry) { out.push(entry); }
        }
        return out;
    }

    getDocEntry(uri: string): RoleUsageDocEntry | undefined {
        return this.docs.get(uri);
    }

    private loadFromStorage() {
        if (!this.context) { return; }
        const raw = this.context.workspaceState.get<RoleUsageStoragePayload>(STORAGE_KEY);
        if (!raw || !raw.docs) { return; }
        this.docs.clear();
        this.roleIndex.clear();
        for (const doc of raw.docs) {
            const sanitizedRoles = (doc.roles || []).map(role => ({
                key: role.key,
                name: role.name,
                type: role.type,
                occurrences: role.occurrences ?? (Array.isArray(role.ranges) ? role.ranges.length : 0),
                ranges: Array.isArray(role.ranges) ? role.ranges.map(r => [
                    Number(r[0]) || 0,
                    Number(r[1]) || 0,
                    Number(r[2]) || 0,
                    Number(r[3]) || 0
                ] as SerializedRange) : [],
                sourcePath: role.sourcePath,
                uuid: role.uuid
            }));
            const entry: RoleUsageDocEntry = {
                uri: doc.uri,
                fsPath: doc.fsPath,
                version: doc.version ?? 0,
                updatedAt: doc.updatedAt ?? 0,
                roles: sanitizedRoles,
                hash: doc.hash ?? ''
            };
            this.docs.set(entry.uri, entry);
            for (const role of sanitizedRoles) {
                if (!role.key) { continue; }
                let set = this.roleIndex.get(role.key);
                if (!set) {
                    set = new Set();
                    this.roleIndex.set(role.key, set);
                }
                set.add(entry.uri);
            }
        }
    }

    private syncRoleIndex(prev: RoleUsageRoleEntry[], next: RoleUsageRoleEntry[], docKey: string) {
        const prevKeys = new Set(prev.map(r => r.key));
        const nextKeys = new Set(next.map(r => r.key));

        for (const key of prevKeys) {
            if (!nextKeys.has(key)) {
                const set = this.roleIndex.get(key);
                if (!set) { continue; }
                set.delete(docKey);
                if (set.size === 0) {
                    this.roleIndex.delete(key);
                }
                this.fireChange({ kind: 'role', key });
            }
        }

        for (const key of nextKeys) {
            let set = this.roleIndex.get(key);
            if (!set) {
                set = new Set();
                this.roleIndex.set(key, set);
            }
            if (!set.has(docKey)) {
                set.add(docKey);
                this.fireChange({ kind: 'role', key });
            }
        }
    }

    private dropFromRoleIndex(roleKeys: string[], docKey: string) {
        for (const key of roleKeys) {
            const set = this.roleIndex.get(key);
            if (!set) { continue; }
            set.delete(docKey);
            if (set.size === 0) {
                this.roleIndex.delete(key);
            }
            this.fireChange({ kind: 'role', key });
        }
    }

    renameDocument(oldUri: string, newUri: string, newFsPath?: string) {
        if (this.disposed) { return; }
        if (oldUri === newUri) { return; }
        const entry = this.docs.get(oldUri);
        if (!entry) { return; }
        this.docs.delete(oldUri);
        entry.uri = newUri;
        if (newFsPath) { entry.fsPath = newFsPath; }
        this.docs.set(newUri, entry);
        for (const role of entry.roles) {
            const set = this.roleIndex.get(role.key);
            if (!set) { continue; }
            if (set.has(oldUri)) {
                set.delete(oldUri);
            }
            set.add(newUri);
        }
        this.scheduleFlush();
        this.fireChange({ kind: 'doc', key: newUri });
    }

    renameDirectory(oldDir: string, newDir: string) {
        if (this.disposed) { return; }
        const oldResolved = path.resolve(oldDir);
        const newResolved = path.resolve(newDir);
        const updates: Array<{ oldUri: string; newUri: string; newFsPath: string }> = [];
        for (const [uri, entry] of this.docs) {
            const fsPath = entry.fsPath;
            if (!fsPath) { continue; }
            const entryResolved = path.resolve(fsPath);
            const rel = path.relative(oldResolved, entryResolved);
            if (rel && (rel.startsWith('..') || path.isAbsolute(rel))) {
                continue;
            }
            if (!rel && oldResolved !== entryResolved) {
                continue;
            }
            const newFsPath = path.join(newResolved, rel || '');
            const newUri = vscode.Uri.file(newFsPath).toString();
            updates.push({ oldUri: uri, newUri, newFsPath });
        }
        if (!updates.length) { return; }
        for (const { oldUri, newUri, newFsPath } of updates) {
            this.renameDocument(oldUri, newUri, newFsPath);
        }
    }

    deleteDirectory(dir: string) {
        if (this.disposed) { return; }
        const resolved = path.resolve(dir);
        const toDelete: string[] = [];
        for (const [uri, entry] of this.docs) {
            const fsPath = entry.fsPath;
            if (!fsPath) { continue; }
            const entryResolved = path.resolve(fsPath);
            const rel = path.relative(resolved, entryResolved);
            if (rel && (rel.startsWith('..') || path.isAbsolute(rel))) {
                continue;
            }
            if (!rel && resolved !== entryResolved) {
                continue;
            }
            toDelete.push(uri);
        }
        if (!toDelete.length) { return; }
        for (const uri of toDelete) {
            this.deleteDocument(uri);
        }
    }

    deleteDocument(uri: string) {
        if (this.disposed) { return; }
        const entry = this.docs.get(uri);
        if (!entry) { return; }
        this.docs.delete(uri);
        this.dropFromRoleIndex(entry.roles.map(r => r.key), uri);
        this.scheduleFlush();
        this.fireChange({ kind: 'doc', key: uri });
    }

    clearAll() {
        if (this.disposed) { return; }
        this.docs.clear();
        this.roleIndex.clear();
        this.scheduleFlush();
        this.fireChange(undefined);
    }

    getRoleReferencesByKey(roleKey: string) {
        const docKeys = this.roleIndex.get(roleKey);
        if (!docKeys) { return [] as { uri: string; fsPath?: string; ranges: SerializedRange[]; updatedAt: number; version: number }[]; }
        const out: { uri: string; fsPath?: string; ranges: SerializedRange[]; updatedAt: number; version: number }[] = [];
        for (const key of docKeys) {
            const entry = this.docs.get(key);
            if (!entry) { continue; }
            const roleEntry = entry.roles.find(r => r.key === roleKey);
            if (!roleEntry) { continue; }
            out.push({
                uri: entry.uri,
                fsPath: entry.fsPath,
                ranges: roleEntry.ranges,
                updatedAt: entry.updatedAt,
                version: entry.version
            });
        }
        return out;
    }

    getRoleReferences(role: Role) {
        return this.getRoleReferencesByKey(getRoleKey(role));
    }

    async flush() {
        return this.flushNow();
    }

    private scheduleFlush() {
        if (!this.context || this.disposed) { return; }
        if (this.flushTimer) { return; }
        this.flushTimer = setTimeout(() => {
            this.flushTimer = undefined;
            this.flushNow().catch(() => {});
        }, 1500);
    }

    private async flushNow() {
        if (!this.context) { return; }
        const payload: RoleUsageStoragePayload = {
            version: 1,
            docs: Array.from(this.docs.values()).map(doc => ({
                uri: doc.uri,
                fsPath: doc.fsPath,
                version: doc.version,
                updatedAt: doc.updatedAt,
                roles: doc.roles.map(role => ({
                    key: role.key,
                    name: role.name,
                    type: role.type,
                    occurrences: role.occurrences,
                    ranges: role.ranges ?? [],
                    sourcePath: role.sourcePath,
                    uuid: role.uuid
                })),
                hash: doc.hash
            }))
        };
        try {
            await this.context.workspaceState.update(STORAGE_KEY, payload);
        } catch (err) {
            console.warn('[RoleUsageStore] Failed to persist usage data', err);
        }
    }

    private fireChange(evt: RoleUsageChangeEvent) {
        try {
            this.onDidChangeEmitter.fire(evt);
        } catch (err) {
            console.warn('[RoleUsageStore] change event handler failed', err);
        }
    }
}

function getRoleKey(role: Role): string {
    if (role.uuid) {
        return 'uuid:' + role.uuid;
    }
    const src = role.sourcePath ? role.sourcePath : '';
    return 'name:' + role.name + '|src:' + src;
}

export function roleUsageKeyForRole(role: Role): string {
    return getRoleKey(role);
}

const store = new RoleUsageStore();

export function initializeRoleUsageStore(context: vscode.ExtensionContext) {
    store.initialize(context);
}

export function disposeRoleUsageStore() {
    store.dispose();
}

export function updateRoleUsageFromDocument(doc: vscode.TextDocument, roleToRanges: Map<Role, vscode.Range[]>) {
    store.updateFromDocument(doc, roleToRanges);
}

export function getDocsUsingRole(role: Role): RoleUsageDocEntry[] {
    return store.getDocsForRole(role);
}

export function getDocsUsingRoleKey(roleKey: string): RoleUsageDocEntry[] {
    return store.getDocsForRoleKey(roleKey);
}

export function getRoleUsageForDoc(uri: string): RoleUsageDocEntry | undefined {
    return store.getDocEntry(uri);
}

export function renameRoleUsageDocument(oldUri: string, newUri: string, newFsPath?: string) {
    store.renameDocument(oldUri, newUri, newFsPath);
}

export function renameRoleUsageDirectory(oldDir: string, newDir: string) {
    store.renameDirectory(oldDir, newDir);
}

export function deleteRoleUsageDocument(uri: string) {
    store.deleteDocument(uri);
}

export function deleteRoleUsageDirectory(dir: string) {
    store.deleteDirectory(dir);
}

export function clearRoleUsageIndex() {
    store.clearAll();
}

export async function flushRoleUsageStore() {
    return store.flush();
}

export type RoleReferenceHit = { uri: string; fsPath?: string; ranges: SerializedRange[]; updatedAt: number; version: number };

export function getRoleReferencesForRole(role: Role): RoleReferenceHit[] {
    return store.getRoleReferences(role);
}

export function getRoleReferencesForKey(roleKey: string): RoleReferenceHit[] {
    return store.getRoleReferencesByKey(roleKey);
}

export const onDidChangeRoleUsage = store.onDidChange;
