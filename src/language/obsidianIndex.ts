/* eslint-disable curly */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Worker } from 'worker_threads';
import { CombinedIgnoreParser } from '../utils/Parser/gitignoreParser';
import { isFileIgnored } from '../utils/ignoreUtils';

export interface ObsidianHeadingEntry {
    heading: string;
    normalized: string;
    line: number;
    character: number;
}

export interface ObsidianTagOccurrence {
    tag: string;
    isColor: boolean;
    line: number;
    character: number;
}

export interface ObsidianTagFileHit {
    uri: vscode.Uri;
    count: number;
    firstLine: number;
    firstCharacter: number;
}

export interface ObsidianTagEntry {
    tag: string;
    isColor: boolean;
    files: Map<string, ObsidianTagFileHit>;
}

export interface ObsidianTagReference {
    tag: string;
    isColor: boolean;
    uri: vscode.Uri;
    line: number;
    character: number;
}

interface PersistedFileIndex {
    path: string;
    size: number;
    mtimeMs: number;
    ext: string;
    basename: string;
    headings: ObsidianHeadingEntry[];
    tags: ObsidianTagOccurrence[];
    wikiLinks: string[];
}

interface PersistedObsidianIndex {
    version: 1;
    updatedAt: number;
    files: Record<string, PersistedFileIndex>;
}

const INDEX_VERSION = 1;
const INDEX_FILE_REL = path.join('novel-helper', '.anh-fsdb', 'obsidian-index.json');
export const OBSIDIAN_INDEX_GLOB = '**/*.{md,markdown,csv,json5,ojson5,rjson5,tjson5}';
export const OBSIDIAN_INDEX_EXCLUDE = '{**/.git/**,**/.vscode/**,**/node_modules/**,**/dist/**,**/build/**,**/out/**,**/release_artifacts/**,**/target/**,**/novel-helper/.anh-fsdb/**}';
const WIKI_FILE_EXTENSIONS = new Set(['.md', '.markdown']);
const INDEX_FILE_EXTENSIONS = new Set(['.md', '.markdown', '.csv', '.json5', '.ojson5', '.rjson5', '.tjson5']);
const INDEX_ALLOWED_LANGUAGES = ['md', 'markdown', 'csv', 'json5', 'ojson5', 'rjson5', 'tjson5'];
const EXCLUDED_SEGMENTS = new Set(['.git', '.vscode', 'node_modules', 'dist', 'build', 'out', 'release_artifacts', 'target']);

const WIKI_LINK_RE = /!??\[\[([^\]\n]+)\]\]/g;
const TAG_RE = /(^|[\s([{>])(#(?:[A-Za-z0-9_\-\u4e00-\u9fff]+)(?:\/[A-Za-z0-9_\-\u4e00-\u9fff]+)*)/g;
const COLOR_RE = /#(?:[A-Fa-f0-9]{3}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})\b/g;

let projectIndex: ObsidianProjectIndex | undefined;
let watcherRegistered = false;
let extensionContext: vscode.ExtensionContext | undefined;
const onDidChangeEmitter = new vscode.EventEmitter<void>();

export const onDidChangeObsidianIndex = onDidChangeEmitter.event;

export function registerObsidianIndex(context: vscode.ExtensionContext): void {
    extensionContext = context;
    if (watcherRegistered) return;
    watcherRegistered = true;

    const watcher = vscode.workspace.createFileSystemWatcher(OBSIDIAN_INDEX_GLOB);
    const ignoreWatcher = vscode.workspace.createFileSystemWatcher('**/{.gitignore,.wcignore}');
    const update = (uri: vscode.Uri) => {
        void getObsidianProjectIndex()?.updateFile(uri).then(changed => {
            if (changed) onDidChangeEmitter.fire();
        });
    };
    const remove = (uri: vscode.Uri) => {
        void getObsidianProjectIndex()?.removeFile(uri).then(changed => {
            if (changed) onDidChangeEmitter.fire();
        });
    };

    context.subscriptions.push(
        watcher,
        ignoreWatcher,
        watcher.onDidCreate(update),
        watcher.onDidChange(update),
        watcher.onDidDelete(remove),
        ignoreWatcher.onDidCreate(() => { getObsidianProjectIndex()?.refreshIgnoreRules(); onDidChangeEmitter.fire(); }),
        ignoreWatcher.onDidChange(() => { getObsidianProjectIndex()?.refreshIgnoreRules(); onDidChangeEmitter.fire(); }),
        ignoreWatcher.onDidDelete(() => { getObsidianProjectIndex()?.refreshIgnoreRules(); onDidChangeEmitter.fire(); }),
        onDidChangeEmitter,
        { dispose: () => { void projectIndex?.flush(); obsidianScanWorker.dispose(); } },
    );

    void getObsidianProjectIndex()?.ensureReady();
}

export function getObsidianProjectIndex(): ObsidianProjectIndex | undefined {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return undefined;
    if (!projectIndex || !samePath(projectIndex.workspaceRoot, workspaceRoot)) {
        projectIndex = new ObsidianProjectIndex(workspaceRoot);
    }
    return projectIndex;
}

class ObsidianIndexScanWorker {
    private worker: Worker | undefined;
    private nextId = 0;
    private pending = new Map<number, { resolve: (result: ScanContentResult) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
    private spawnFailed = false;

    async scanFile(fsPath: string): Promise<ScanContentResult | undefined> {
        const worker = this.getWorker();
        if (!worker) return undefined;
        const id = ++this.nextId;
        return new Promise<ScanContentResult>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('obsidian index worker scan timeout'));
            }, 30000);
            this.pending.set(id, { resolve, reject, timer });
            try {
                worker.postMessage({ type: 'scanFile', id, fsPath });
            } catch (error) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        }).catch(error => {
            console.warn('[ObsidianIndex] Worker scan failed, falling back to extension host scan', error);
            return undefined;
        });
    }

    dispose(): void {
        for (const [id, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error('obsidian index worker disposed'));
            this.pending.delete(id);
        }
        void this.worker?.terminate();
        this.worker = undefined;
    }

    private getWorker(): Worker | undefined {
        if (this.worker) return this.worker;
        if (this.spawnFailed || !extensionContext) return undefined;
        try {
            const workerPath = vscode.Uri.joinPath(extensionContext.extensionUri, 'out', 'workers', 'obsidianIndexWorker.js').fsPath;
            this.worker = new Worker(workerPath);
            this.worker.on('message', message => this.onMessage(message));
            this.worker.on('error', error => {
                console.warn('[ObsidianIndex] worker error', error);
            });
            this.worker.on('exit', code => {
                this.worker = undefined;
                if (code !== 0) {
                    console.warn('[ObsidianIndex] worker exited with code', code);
                }
            });
        } catch (error) {
            this.spawnFailed = true;
            console.warn('[ObsidianIndex] failed to spawn scan worker', error);
            return undefined;
        }
        return this.worker;
    }

    private onMessage(message: WorkerScanMessage): void {
        if (!message || message.type !== 'scanResult') return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error || !message.result) {
            pending.reject(new Error(message.error || 'empty obsidian scan result'));
            return;
        }
        pending.resolve(message.result);
    }
}

const obsidianScanWorker = new ObsidianIndexScanWorker();

export class ObsidianProjectIndex {
    private cache: PersistedObsidianIndex = { version: INDEX_VERSION, updatedAt: 0, files: {} };
    private loaded = false;
    private synchronized = false;
    private syncPromise: Promise<void> | undefined;
    private saveTimer: NodeJS.Timeout | undefined;
    private ignoreParser: CombinedIgnoreParser | undefined;

    constructor(public readonly workspaceRoot: string) {}

    async ensureReady(force = false): Promise<void> {
        await this.load();
        if (force || !this.synchronized) {
            await this.syncWorkspace(force);
        }
    }

    async refresh(): Promise<void> {
        await this.loadAndSyncInBackground(true);
    }

    refreshIgnoreRules(): void {
        this.ignoreParser = undefined;
        this.synchronized = false;
        this.startBackgroundSync(true);
    }

    async getWikiFiles(): Promise<vscode.Uri[]> {
        await this.loadAndSyncInBackground();
        return Object.values(this.cache.files)
            .filter(file => this.shouldUseCachedFile(file) && WIKI_FILE_EXTENSIONS.has(file.ext))
            .map(file => this.toUri(file.path))
            .sort((left, right) => vscode.workspace.asRelativePath(left).localeCompare(vscode.workspace.asRelativePath(right), 'zh-CN'));
    }

    isIndexableUri(uri: vscode.Uri): boolean {
        return this.shouldIndexUri(uri);
    }

    async getTags(): Promise<string[]> {
        const entries = await this.getTagEntries();
        return entries.map(entry => entry.tag).sort((left, right) => left.localeCompare(right, 'zh-CN'));
    }

    async getHeadings(uri: vscode.Uri): Promise<ObsidianHeadingEntry[]> {
        await this.loadAndSyncInBackground();
        const entry = await this.ensureFileFresh(uri);
        return entry?.headings || [];
    }

    async findHeadingPosition(uri: vscode.Uri, heading: string): Promise<vscode.Position | undefined> {
        const wanted = normalizeHeading(heading);
        const found = (await this.getHeadings(uri)).find(item => item.normalized === wanted);
        return found ? new vscode.Position(found.line, found.character) : undefined;
    }

    async resolveWikiFileByName(filePart: string): Promise<vscode.Uri | undefined> {
        await this.loadAndSyncInBackground();
        const normalized = stripKnownExtension(path.basename(filePart)).toLowerCase();
        if (!normalized) return undefined;
        const files = Object.values(this.cache.files).filter(file => this.shouldUseCachedFile(file) && WIKI_FILE_EXTENSIONS.has(file.ext));
        const found = files.find(file => stripKnownExtension(file.basename).toLowerCase() === normalized);
        return found ? this.toUri(found.path) : undefined;
    }

    async getTagEntries(): Promise<ObsidianTagEntry[]> {
        await this.loadAndSyncInBackground();
        const tagMap = new Map<string, ObsidianTagEntry>();
        for (const file of Object.values(this.cache.files)) {
            if (!this.shouldUseCachedFile(file)) continue;
            const uri = this.toUri(file.path);
            const fileKey = toStorageKey(file.path);
            for (const occurrence of file.tags) {
                let entry = tagMap.get(occurrence.tag.toLowerCase());
                if (!entry) {
                    entry = { tag: occurrence.tag, isColor: occurrence.isColor, files: new Map() };
                    tagMap.set(occurrence.tag.toLowerCase(), entry);
                }
                const existing = entry.files.get(fileKey);
                if (existing) {
                    existing.count += 1;
                    continue;
                }
                entry.files.set(fileKey, {
                    uri,
                    count: 1,
                    firstLine: occurrence.line,
                    firstCharacter: occurrence.character,
                });
            }
        }
        return Array.from(tagMap.values()).sort(compareTagEntries);
    }

    async getTagOccurrences(tag: string): Promise<ObsidianTagReference[]> {
        await this.loadAndSyncInBackground();
        const wanted = tag.trim().toLowerCase();
        if (!wanted) return [];
        const references: ObsidianTagReference[] = [];
        for (const file of Object.values(this.cache.files)) {
            if (!this.shouldUseCachedFile(file)) continue;
            const uri = this.toUri(file.path);
            for (const occurrence of file.tags) {
                if (occurrence.tag.toLowerCase() !== wanted) continue;
                references.push({
                    tag: occurrence.tag,
                    isColor: occurrence.isColor,
                    uri,
                    line: occurrence.line,
                    character: occurrence.character,
                });
            }
        }
        return references.sort((left, right) => {
            const byPath = vscode.workspace.asRelativePath(left.uri).localeCompare(vscode.workspace.asRelativePath(right.uri), 'zh-CN');
            if (byPath !== 0) return byPath;
            return left.line - right.line || left.character - right.character;
        });
    }

    async updateFile(uri: vscode.Uri): Promise<boolean> {
        await this.load();
        if (!this.shouldIndexUri(uri)) return this.removeFileFromCache(uri);
        const changed = await this.scanFile(uri);
        if (changed) this.scheduleSave();
        return changed;
    }

    async removeFile(uri: vscode.Uri): Promise<boolean> {
        await this.load();
        return this.removeFileFromCache(uri);
    }

    private removeFileFromCache(uri: vscode.Uri): boolean {
        const rel = this.toRelativePath(uri);
        if (!rel) return false;
        const key = toStorageKey(rel);
        if (!this.cache.files[key]) return false;
        delete this.cache.files[key];
        this.cache.updatedAt = Date.now();
        this.scheduleSave();
        return true;
    }

    async flush(): Promise<void> {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = undefined;
        }
        await this.save();
    }

    private async load(): Promise<void> {
        if (this.loaded) return;
        this.loaded = true;
        try {
            const raw = await fs.promises.readFile(this.cachePath, 'utf8');
            const parsed = JSON.parse(raw) as PersistedObsidianIndex;
            if (parsed?.version === INDEX_VERSION && parsed.files && typeof parsed.files === 'object') {
                this.cache = parsed;
            }
        } catch {
            this.cache = { version: INDEX_VERSION, updatedAt: 0, files: {} };
        }
    }

    private async loadAndSyncInBackground(force = false): Promise<void> {
        await this.load();
        this.startBackgroundSync(force);
    }

    private startBackgroundSync(force = false): void {
        if (!force && this.synchronized) return;
        void this.syncWorkspace(force).catch(error => {
            console.warn('[ObsidianIndex] background sync failed', error);
        });
    }

    private async syncWorkspace(force: boolean): Promise<void> {
        if (this.syncPromise) return this.syncPromise;
        this.syncPromise = this.doSyncWorkspace(force).finally(() => {
            this.syncPromise = undefined;
        });
        return this.syncPromise;
    }

    private async doSyncWorkspace(force: boolean): Promise<void> {
        const files = await vscode.workspace.findFiles(OBSIDIAN_INDEX_GLOB, OBSIDIAN_INDEX_EXCLUDE);
        const seen = new Set<string>();
        let changed = false;
        let changedSinceNotify = 0;
        let scannedSinceYield = 0;

        for (const uri of files) {
            if (!this.shouldIndexUri(uri)) continue;
            const rel = this.toRelativePath(uri);
            if (!rel) continue;
            seen.add(toStorageKey(rel));
            if (await this.scanFile(uri, force)) {
                changed = true;
                changedSinceNotify++;
            }
            scannedSinceYield++;
            if (changedSinceNotify >= 25) {
                this.cache.updatedAt = Date.now();
                this.scheduleSave();
                onDidChangeEmitter.fire();
                changedSinceNotify = 0;
            }
            if (scannedSinceYield >= 50) {
                scannedSinceYield = 0;
                await yieldToEventLoop();
            }
        }

        for (const key of Object.keys(this.cache.files)) {
            if (seen.has(key)) continue;
            delete this.cache.files[key];
            changed = true;
        }

        this.synchronized = true;
        if (changed) {
            this.cache.updatedAt = Date.now();
            await this.save();
            onDidChangeEmitter.fire();
        }
    }

    private async ensureFileFresh(uri: vscode.Uri): Promise<PersistedFileIndex | undefined> {
        if (!this.shouldIndexUri(uri)) return undefined;
        const changed = await this.scanFile(uri);
        if (changed) {
            this.scheduleSave();
            onDidChangeEmitter.fire();
        }
        const rel = this.toRelativePath(uri);
        return rel ? this.cache.files[toStorageKey(rel)] : undefined;
    }

    private async scanFile(uri: vscode.Uri, force = false): Promise<boolean> {
        const rel = this.toRelativePath(uri);
        if (!rel) return false;
        const key = toStorageKey(rel);
        let stat: fs.Stats;
        try {
            stat = await fs.promises.stat(uri.fsPath);
        } catch {
            if (!this.cache.files[key]) return false;
            delete this.cache.files[key];
            return true;
        }
        if (!stat.isFile()) return false;

        const existing = this.cache.files[key];
        if (!force && existing && existing.size === stat.size && existing.mtimeMs === stat.mtimeMs) return false;

        let scanned = await obsidianScanWorker.scanFile(uri.fsPath);
        if (!scanned) {
            let content = '';
            try {
                content = await fs.promises.readFile(uri.fsPath, 'utf8');
            } catch {
                return false;
            }
            scanned = scanContent(content);
        }

        this.cache.files[key] = {
            path: rel,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            ext: path.extname(rel).toLowerCase(),
            basename: path.basename(rel),
            ...scanned,
        };
        this.cache.updatedAt = Date.now();
        return true;
    }

    private scheduleSave(): void {
        this.cache.updatedAt = Date.now();
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            this.saveTimer = undefined;
            void this.save();
        }, 400);
    }

    private async save(): Promise<void> {
        await fs.promises.mkdir(path.dirname(this.cachePath), { recursive: true });
        await fs.promises.writeFile(this.cachePath, JSON.stringify(this.cache), 'utf8');
    }

    private get cachePath(): string {
        return path.join(this.workspaceRoot, INDEX_FILE_REL);
    }

    private toUri(relPath: string): vscode.Uri {
        return vscode.Uri.file(path.join(this.workspaceRoot, relPath));
    }

    private toRelativePath(uri: vscode.Uri): string | undefined {
        const relative = path.relative(this.workspaceRoot, uri.fsPath).replace(/\\/g, '/');
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
        return relative;
    }

    private shouldIndexUri(uri: vscode.Uri): boolean {
        if (uri.scheme !== 'file') return false;
        const rel = this.toRelativePath(uri);
        if (!rel) return false;
        const lowerRel = rel.toLowerCase();
        if (lowerRel === INDEX_FILE_REL.replace(/\\/g, '/').toLowerCase()) return false;
        if (lowerRel.startsWith('novel-helper/.anh-fsdb/')) return false;
        const segments = lowerRel.split('/');
        if (segments.some(segment => EXCLUDED_SEGMENTS.has(segment))) return false;
        if (!INDEX_FILE_EXTENSIONS.has(path.extname(lowerRel))) return false;
        return !isFileIgnored(uri.fsPath, {
            workspaceRoot: this.workspaceRoot,
            respectGitignore: true,
            respectWcignore: true,
            allowedLanguages: INDEX_ALLOWED_LANGUAGES,
            ignoreParser: this.getIgnoreParser(),
        });
    }

    private shouldUseCachedFile(file: PersistedFileIndex): boolean {
        if (!INDEX_FILE_EXTENSIONS.has(file.ext)) return false;
        return this.shouldIndexUri(this.toUri(file.path));
    }

    private getIgnoreParser(): CombinedIgnoreParser {
        if (!this.ignoreParser) {
            this.ignoreParser = new CombinedIgnoreParser(this.workspaceRoot);
        }
        return this.ignoreParser;
    }
}

function scanContent(content: string): Pick<PersistedFileIndex, 'headings' | 'tags' | 'wikiLinks'> {
    const headings: ObsidianHeadingEntry[] = [];
    const tags: ObsidianTagOccurrence[] = [];
    const wikiLinks = new Set<string>();
    const lines = content.split(/\r?\n/);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        const headingMatch = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
        if (headingMatch) {
            const heading = headingMatch[2].trim();
            headings.push({
                heading,
                normalized: normalizeHeading(heading),
                line: lineIndex,
                character: Math.max(line.indexOf(headingMatch[2]), 0),
            });
        }

        WIKI_LINK_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = WIKI_LINK_RE.exec(line))) {
            const target = match[1].split('|')[0].trim();
            if (target) wikiLinks.add(target);
        }

        TAG_RE.lastIndex = 0;
        while ((match = TAG_RE.exec(line))) {
            if (!isColorTag(match[2])) {
                tags.push({ tag: match[2], isColor: false, line: lineIndex, character: match.index + match[1].length });
            }
        }

        COLOR_RE.lastIndex = 0;
        while ((match = COLOR_RE.exec(line))) {
            tags.push({ tag: match[0], isColor: true, line: lineIndex, character: match.index });
        }
    }

    return { headings, tags, wikiLinks: Array.from(wikiLinks).sort((left, right) => left.localeCompare(right, 'zh-CN')) };
}

export function isColorTag(tag: string): boolean {
    return /^#(?:[A-Fa-f0-9]{3}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/.test(tag);
}

export function normalizeColor(tag: string): string {
    if (/^#[A-Fa-f0-9]{8}$/.test(tag)) return tag.slice(0, 7);
    return tag;
}

export function stripKnownExtension(fileName: string): string {
    const extension = path.extname(fileName).toLowerCase();
    return WIKI_FILE_EXTENSIONS.has(extension) ? fileName.slice(0, -extension.length) : fileName;
}

export function normalizeHeading(input: string): string {
    return input.trim().replace(/#+$/, '').trim().toLowerCase();
}

function compareTagEntries(left: ObsidianTagEntry, right: ObsidianTagEntry): number {
    if (left.isColor !== right.isColor) return left.isColor ? 1 : -1;
    const byFileCount = right.files.size - left.files.size;
    if (byFileCount !== 0) return byFileCount;
    return left.tag.localeCompare(right.tag, 'zh-CN');
}

function toStorageKey(relPath: string): string {
    const normalized = relPath.replace(/\\/g, '/');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function samePath(left: string, right: string): boolean {
    const normalizedLeft = path.resolve(left);
    const normalizedRight = path.resolve(right);
    return process.platform === 'win32'
        ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
        : normalizedLeft === normalizedRight;
}

function yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

type ScanContentResult = Pick<PersistedFileIndex, 'headings' | 'tags' | 'wikiLinks'>;

interface WorkerScanMessage {
    type: 'scanResult';
    id: number;
    result?: ScanContentResult;
    error?: string;
}