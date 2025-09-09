import * as vscode from 'vscode';
import { TypoApiResult } from './typoTypes';
import { appendTrace, isServerTraceEnabled } from './typoLog';
import { getFileTracker } from '../utils/tracker/fileTracker';

export interface TypoHttpConfig {
    baseUrl: string; // e.g. http://127.0.0.1:8001
    mode: 'macro' | 'llm';
    batchSize: number; // request texts per batch
    timeoutMs: number; // request timeout
    llm?: {
        model?: string;
        apiKey?: string;
        apiBase?: string;
    }
}

function getConfig(): TypoHttpConfig {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const baseUrl = cfg.get<string>('typo.service.baseUrl', 'http://127.0.0.1:8001');
    const mode = cfg.get<'macro' | 'llm'>('typo.mode', 'macro');
    const batchSize = cfg.get<number>('typo.batchSize', 30);
    const timeoutMs = cfg.get<number>('typo.timeoutMs', mode === 'llm' ? 120000 : 30000);
    const llm = {
        model: cfg.get<string>('typo.llm.model', 'deepseek-v3') || undefined,
        apiKey: cfg.get<string>('typo.llm.apiKey', '') || undefined,
        apiBase: cfg.get<string>('typo.llm.apiBase', '') || undefined,
    };
    return { baseUrl, mode, batchSize, timeoutMs, llm };
}

async function fetchJson(url: string, init: any, timeoutMs: number): Promise<any> {
    const fetchFn = (globalThis as any).fetch as any;
    if (!fetchFn) throw new Error('fetch is not available in this runtime');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchFn(url, { ...init, signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

async function requestMacro(baseUrl: string, texts: string[], timeoutMs: number, docUuid?: string, roleNames?: string[]): Promise<TypoApiResult[]> {
    const body: any = { texts };
    if (docUuid) body.doc_uuid = docUuid;
    if (Array.isArray(roleNames) && roleNames.length) body.known_roles = roleNames;
    const trace = isServerTraceEnabled();
    if (trace) {
        appendTrace(`==> [ServerMacro] POST ${baseUrl.replace(/\/$/, '')}/correct texts=${texts.length} docUuid=${docUuid || ''}`);
        appendTrace(`body: ${JSON.stringify(body).slice(0, 1200)}...`);
    }
    const json = await fetchJson(`${baseUrl.replace(/\/$/, '')}/correct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }, timeoutMs);
    if (trace) {
        try { appendTrace(`<== [ServerMacro] resp: ${JSON.stringify(json).slice(0, 1200)}...`); } catch { /* ignore */ }
    }
    const arr = Array.isArray(json?.corrections) ? json.corrections : [];
    return arr as TypoApiResult[];
}

async function requestLLM(baseUrl: string, texts: string[], timeoutMs: number, llm?: TypoHttpConfig['llm'], docUuid?: string, roleNames?: string[]): Promise<TypoApiResult[]> {
    const body: any = { texts };
    if (llm?.model) body.model = llm.model;
    if (llm?.apiKey) body.api_key = llm.apiKey;
    if (llm?.apiBase) body.api_base = llm.apiBase;
    if (docUuid) body.doc_uuid = docUuid; // optional context id for server-side usage
    if (Array.isArray(roleNames) && roleNames.length) body.known_roles = roleNames;
    const trace = isServerTraceEnabled();
    if (trace) {
        appendTrace(`==> [ServerLLM] POST ${baseUrl.replace(/\/$/, '')}/correct/llm texts=${texts.length} docUuid=${docUuid || ''}`);
        appendTrace(`body: ${JSON.stringify({ ...body, api_key: body.api_key ? '***' : undefined }).slice(0, 1200)}...`);
    }
    const json = await fetchJson(`${baseUrl.replace(/\/$/, '')}/correct/llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }, timeoutMs);
    if (trace) {
        try { appendTrace(`<== [ServerLLM] resp: ${JSON.stringify(json).slice(0, 1200)}...`); } catch { /* ignore */ }
    }
    const arr = Array.isArray(json?.corrections) ? json.corrections : [];
    return arr as TypoApiResult[];
}

export async function detectTyposBatchHttp(sentences: string[], ctx?: { docFsPath?: string; docUri?: string; docUuid?: string; roleNames?: string[] }): Promise<(TypoApiResult | null)[]> {
    const cfg = getConfig();
    if (sentences.length === 0) return [];

    // resolve doc uuid if available and LLM mode selected
    let docUuid: string | undefined = ctx?.docUuid;
    const roleNames = ctx?.roleNames;
    const fsPath = ctx?.docFsPath || (ctx?.docUri ? vscode.Uri.parse(ctx.docUri).fsPath : undefined);
    if (!docUuid && fsPath) {
        try { docUuid = getFileTracker()?.getFileUuid(fsPath); } catch { /* ignore */ }
    }

    const byChunks: (TypoApiResult | null)[][] = [];
    for (let i = 0; i < sentences.length; i += Math.max(1, cfg.batchSize)) {
        const chunk = sentences.slice(i, i + Math.max(1, cfg.batchSize));
        try {
            const results = cfg.mode === 'llm'
                ? await requestLLM(cfg.baseUrl, chunk, cfg.timeoutMs, cfg.llm, docUuid, roleNames)
                : await requestMacro(cfg.baseUrl, chunk, cfg.timeoutMs, docUuid, roleNames);
            // Map results to per-sentence array, use index field when present
            const mapped: (TypoApiResult | null)[] = new Array(chunk.length).fill(null);
            if (Array.isArray(results)) {
                for (let j = 0; j < results.length; j++) {
                    const r = results[j];
                    const idx = (typeof r?.index === 'number') ? r.index : j;
                    if (idx >= 0 && idx < chunk.length) mapped[idx] = r;
                }
            }
            byChunks.push(mapped);
        } catch (e) {
            // On error, fill nulls for this chunk
            byChunks.push(new Array(chunk.length).fill(null));
        }
    }

    return byChunks.flat();
}

export function onTypoConfigChanged(e: vscode.ConfigurationChangeEvent): boolean {
    return e.affectsConfiguration('AndreaNovelHelper.typo');
}
