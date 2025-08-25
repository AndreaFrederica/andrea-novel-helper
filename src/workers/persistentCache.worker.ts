// src/workers/persistentCache.worker.ts
import { parentPort } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';

// ==== Types ====
type TextStats = { cjkChars: number; asciiChars: number; words: number; nonWSChars: number; total: number };
type Meta = { mtime?: number; wordCountStats?: TextStats | any } | null;

type InitMsg = {
    type: 'init';
    workspaceRoot: string;          // 必填：你的工作区根目录
    dbDirOverride?: string;         // 可选：自定义 .anh-fsdb 目录
    normalizeCase?: boolean;        // Windows 建议 true（默认：win32 自动 true）
    scanConcurrency?: number;       // 分片扫描并发（默认 16）
};

type GetMetaMsg = { type: 'getMeta'; id: number; filePath: string };
type GetMetaManyMsg = { type: 'getMetaMany'; id: number; filePaths: string[] };
type RefreshIndexMsg = { type: 'refreshIndex'; id: number };
type PingMsg = { type: 'ping'; id: number };
type Incoming = InitMsg | GetMetaMsg | GetMetaManyMsg | RefreshIndexMsg | PingMsg;

// ==== Config / State ====
let WORKSPACE_ROOT = '';
let DB_DIR = '';                                 // <workspaceRoot>/novel-helper/.anh-fsdb
let INDEX_PATH = '';                             // <dbDir>/index.json
let NORMALIZE_CASE = process.platform === 'win32';
let SCAN_CONCURRENCY = 16;

// 索引：规范化路径 -> uuid
const pathToUuid = new Map<string, string>();
let indexLoaded = false;

// 结果缓存 / 去重
const metaCache = new Map<string, Meta>();       // key = 'meta:' + normPath
const inflight = new Map<string, Promise<Meta>>();

// —— 工具函数 ——
function normFs(p: string): string {
    const abs = path.resolve(p).replace(/\\/g, '/');
    return NORMALIZE_CASE ? abs.toLowerCase() : abs;
}

function shardPathOfUuid(uuid: string): string {
    const prefix = uuid.slice(0, 2);
    return path.join(DB_DIR, prefix, `${uuid}.json`);
}

async function readJson(file: string): Promise<any | null> {
    try {
        const buf = await fs.promises.readFile(file);
        return JSON.parse(buf.toString('utf8'));
    } catch { return null; }
}

// —— 索引加载（与你的 writeIndex()/loadIndexOnly 对齐）——
async function loadIndex(): Promise<void> {
    pathToUuid.clear();
    indexLoaded = false;

    try {
        const stat = await fs.promises.stat(INDEX_PATH);
        if (!stat.isFile()) {return;}

        const idx = await readJson(INDEX_PATH);
        const entries = idx?.entries || idx?.files || [];
        if (Array.isArray(entries)) {
            for (const ent of entries) {
                if (!ent || typeof ent !== 'object') {continue;}
                const u = ent.u; const p = ent.p;
                if (typeof u === 'string' && typeof p === 'string') {
                    pathToUuid.set(normFs(p), u);
                }
            }
            indexLoaded = true;
        }
    } catch {
        // 没有 index.json：保持 indexLoaded=false，走按需分片扫描
    }
}

// —— 按需扫描：仅在索引未命中时，定位单个 filePath ——
// 遍历 <dbDir>/<xx>/*.json，遇到命中的就停；并把沿途读到的条目都填入 pathToUuid，减少下次开销
async function locateByScanning(targetNormPath: string): Promise<string | null> {
    try {
        const buckets = await fs.promises.readdir(DB_DIR, { withFileTypes: true }).catch(() => []);
        const dirs = buckets.filter(d => d.isDirectory()).map(d => path.join(DB_DIR, d.name));

        // 并发 worker，逐目录扫描；目录内顺序读，避免过多 fd
        let hit: string | null = null;
        let stop = false;

        const workers = Math.min(SCAN_CONCURRENCY, Math.max(1, dirs.length));
        let i = 0;

        async function scanOneDir(dirPath: string) {
            const files = await fs.promises.readdir(dirPath, { withFileTypes: true }).catch(() => []);
            for (const f of files) {
                if (stop) {return;}
                if (!f.isFile() || !f.name.endsWith('.json')) {continue;}
                const full = path.join(dirPath, f.name);
                const j = await readJson(full);
                if (!j || typeof j !== 'object') {continue;}

                const p = typeof j.filePath === 'string' ? normFs(j.filePath) : '';
                const u = typeof j.uuid === 'string' ? j.uuid : '';
                if (p && u) {
                    // 逐步填充缓存映射（加速后续查询）
                    if (!pathToUuid.has(p)) {pathToUuid.set(p, u);}
                    if (p === targetNormPath) {
                        hit = u; stop = true; return;
                    }
                }
            }
        }

        async function runner() {
            while (!stop && i < dirs.length) {
                const dir = dirs[i++]; await scanOneDir(dir);
            }
        }

        await Promise.all(Array.from({ length: workers }, runner));
        return hit;
    } catch {
        return null;
    }
}

// —— 读分片并抽取需要的字段 ——
// 只返回 { mtime, wordCountStats }，避免大量冗余回传
async function readMetaByUuid(uuid: string): Promise<Meta> {
    const p = shardPathOfUuid(uuid);
    const j = await readJson(p);
    if (!j) {return null;}
    const mtime = typeof j.mtime === 'number' ? j.mtime : undefined;
    const wordCountStats = j.wordCountStats ?? j.stats ?? null;
    return { mtime, wordCountStats };
}

// —— 主查询：filePath -> Meta ——
// 1) 命中缓存 → 返回
// 2) 用索引找到 uuid → 读分片
// 3) 未命中索引 → 按需扫描一次，定位 uuid → 读分片
async function getOne(filePath: string): Promise<Meta> {
    const norm = normFs(filePath);
    const cacheKey = 'meta:' + norm;

    if (metaCache.has(cacheKey)) {return metaCache.get(cacheKey)!;}
    if (inflight.has(norm)) {return inflight.get(norm)!;}

    const work = (async () => {
        // 1) 索引命中
        if (!indexLoaded) {await loadIndex();} // 首次惰性加载
        let uuid = pathToUuid.get(norm);

        // 2) 索引未命中：按需扫描一次
        if (!uuid) {
            uuid = await locateByScanning(norm) || undefined as any;
        }
        if (!uuid) { metaCache.set(cacheKey, null); return null; }

        // 3) 读分片
        const meta = await readMetaByUuid(uuid);
        metaCache.set(cacheKey, meta);
        return meta;
    })();

    inflight.set(norm, work);
    try { return await work; } finally { inflight.delete(norm); }
}

// —— 批量查询（带限流与去重）——
async function getMany(paths: string[]): Promise<Record<string, Meta>> {
    const out: Record<string, Meta> = {};
    const uniq = Array.from(new Set(paths.map(normFs)));

    let i = 0;
    const CONC = Math.min(24, Math.max(1, SCAN_CONCURRENCY)); // 复用并发参数
    async function worker() {
        while (i < uniq.length) {
            const p = uniq[i++];
            try { out[p] = await getOne(p); } catch { out[p] = null; }
        }
    }
    await Promise.all(Array.from({ length: CONC }, worker));

    // 按调用方原路径返回（而不是规范化键）
    const mapBack: Record<string, Meta> = {};
    for (const raw of paths) {
        mapBack[raw] = out[normFs(raw)];
    }
    return mapBack;
}

// ==== Message Loop ====
parentPort!.on('message', async (msg: Incoming) => {
    try {
        switch (msg.type) {
            case 'init': {
                WORKSPACE_ROOT = msg.workspaceRoot;
                DB_DIR = msg.dbDirOverride || path.join(WORKSPACE_ROOT, 'novel-helper', '.anh-fsdb');
                INDEX_PATH = path.join(DB_DIR, 'index.json');
                NORMALIZE_CASE = typeof msg.normalizeCase === 'boolean' ? msg.normalizeCase : NORMALIZE_CASE;
                SCAN_CONCURRENCY = typeof msg.scanConcurrency === 'number' && msg.scanConcurrency > 0 ? msg.scanConcurrency : SCAN_CONCURRENCY;

                // 尝试预加载索引（不存在则懒加载）
                await loadIndex();
                parentPort!.postMessage({ type: 'inited', ok: true, dbDir: DB_DIR, indexLoaded });
                break;
            }

            case 'refreshIndex': {
                await loadIndex();
                parentPort!.postMessage({ type: 'refreshIndexResult', id: msg.id, ok: true, indexLoaded });
                break;
            }

            case 'getMeta': {
                const res = await getOne(msg.filePath);
                parentPort!.postMessage({ type: 'getMetaResult', id: msg.id, result: res });
                break;
            }

            case 'getMetaMany': {
                const res = await getMany(msg.filePaths || []);
                parentPort!.postMessage({ type: 'getMetaManyResult', id: msg.id, result: res });
                break;
            }

            case 'ping': {
                parentPort!.postMessage({ type: 'pong', id: msg.id });
                break;
            }
        }
    } catch (e: any) {
        parentPort!.postMessage({ type: 'error', id: (msg as any)?.id, error: String(e?.message ?? e) });
    }
});
