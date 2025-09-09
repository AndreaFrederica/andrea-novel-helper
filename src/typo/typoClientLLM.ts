import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TypoApiResult } from './typoTypes';
import { setTypoDetectorBatch } from './typoDetector';
import { appendTrace, isClientLLMTraceEnabled, appendLLMReplyChunk, endLLMReplyLine } from './typoLog';

interface ClientLLMCfg {
    enabled: boolean;
    apiBase: string;
    apiKey: string;
    model: string;
    temperature: number;
}

function getClientCfg(): ClientLLMCfg {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    return {
        enabled: cfg.get<boolean>('typo.clientLLM.enabled', false) || false,
        apiBase: cfg.get<string>('typo.clientLLM.apiBase', 'https://api.deepseek.com/v1')!,
        apiKey: cfg.get<string>('typo.clientLLM.apiKey', '')!,
        model: cfg.get<string>('typo.clientLLM.model', 'deepseek-v3')!,
        temperature: cfg.get<number>('typo.clientLLM.temperature', 0) || 0
    };
}

async function loadPrompt(context: vscode.ExtensionContext): Promise<string> {
    try {
        const p = path.join(context.extensionPath, 'resources', 'typo_llm_prompt.txt');
        return await fs.promises.readFile(p, 'utf8');
    } catch {
        return '你是一个中文错别字纠正助手。只输出 JSON。';
    }
}

async function chatCompletionsStream(
    apiBase: string,
    apiKey: string,
    model: string,
    messages: any[],
    temperature: number,
    traceCtx?: { docUuid?: string; textsCount?: number; ctxLen?: number },
    onProgress?: (accum: string) => void
): Promise<string> {
    const url = apiBase.replace(/\/$/, '') + '/chat/completions';
    const fetchFn: any = (globalThis as any).fetch;
    if (!fetchFn) throw new Error('fetch unavailable');
    const trace = isClientLLMTraceEnabled();
    if (trace) {
        appendTrace(`==> [ClientLLM] POST ${url}`);
        appendTrace(`model=${model} temp=${temperature} docUuid=${traceCtx?.docUuid || ''} texts=${traceCtx?.textsCount || 0} ctxLen=${traceCtx?.ctxLen || 0}`);
        try { appendTrace(`system: ${(messages[0]?.content || '').slice(0, 300)}...`); } catch { /* ignore */ }
        try { appendTrace(`user: ${(messages[1]?.content || '').slice(0, 800)}...`); } catch { /* ignore */ }
    }
    const headers: any = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model,
            messages,
            temperature,
            stream: true
        })
    });
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (ctype.includes('application/json')) {
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content ?? '';
        if (trace) {
            appendLLMReplyChunk(String(content));
            endLLMReplyLine();
        }
        return String(content || '');
    }
    // text/event-stream
    const reader = (res.body as any).getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let accum = '';
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // attempt to parse SSE lines, accumulate content
        const lines = buf.split('\n');
        // keep last partial line in buf
        buf = lines.pop() || '';
        for (const ln of lines) {
            const line = ln.trim();
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
                const obj = JSON.parse(payload);
                const piece = obj?.choices?.[0]?.delta?.content;
                if (piece) {
                    accum += piece;
                    if (trace) appendLLMReplyChunk(piece);
                    try { onProgress?.(accum); } catch { /* ignore */ }
                }
            } catch { /* ignore parse */ }
        }
    }
    // flush last partial chunk (in case it's plain text, not SSE)
    if (buf && !accum) {
        accum += buf;
        if (trace) appendLLMReplyChunk(buf);
    }
    try { onProgress?.(accum); } catch { /* ignore */ }
    if (trace) { endLLMReplyLine(); appendTrace(`<== [ClientLLM] stream done, total=${accum.length}`); }
    return accum;
}

export function registerClientLLMDetector(context: vscode.ExtensionContext) {
    const cfg = getClientCfg();
    const enable = () => {
        setTypoDetectorBatch(async (sentences, ctx) => {
            const c = getClientCfg();
            if (!c.enabled) return []; // fall back to default
            const prompt = await loadPrompt(context);
            const sys = prompt;
            const docUuid = ctx?.docUuid || ctx?.docFsPath || ctx?.docUri || '';
            const roleNames = Array.isArray((ctx as any)?.roleNames) ? (ctx as any).roleNames as string[] : [];
            // Build user content with explicit JSON contract, include a joined context to help reasoning
            const sep = "\n—— 段落分隔 ——\n";
            const contextJoined = sentences.join(sep);
            const user = JSON.stringify({
                instruction: '严格输出 JSON 对象 {"corrections": [...]} ，errors 每项可省略 offset（我们会自行计算）。index 为 texts 下标。不要输出多余内容。',
                doc_uuid: docUuid,
                texts: sentences,
                context: contextJoined,
                separator: sep,
                known_roles: roleNames
            });
            const content = await chatCompletionsStream(c.apiBase, c.apiKey, c.model, [
                { role: 'system', content: sys },
                { role: 'user', content: user }
            ], c.temperature, { docUuid, textsCount: sentences.length, ctxLen: contextJoined.length }, (accum) => {
                // incremental parse and emit partial corrections
                try {
                    const s = accum.indexOf('{');
                    const e = accum.lastIndexOf('}');
                    if (s >= 0 && e > s + 1) {
                        const maybe = accum.slice(s, e + 1);
                        const obj = JSON.parse(maybe);
                        const corrs: TypoApiResult[] = Array.isArray(obj?.corrections) ? obj.corrections : [];
                        if (corrs.length) {
                            (ctx as any)?.onPartial?.(corrs);
                        }
                    }
                } catch { /* ignore */ }
            });
            // try parse JSON from content
            let json: any = null;
            try {
                // heuristic: find first { and last }
                const s = content.indexOf('{');
                const e = content.lastIndexOf('}');
                const text = s >= 0 && e > s ? content.slice(s, e + 1) : content;
                json = JSON.parse(text);
            } catch { return new Array(sentences.length).fill(null); }
            const arr: TypoApiResult[] = Array.isArray(json?.corrections) ? json.corrections : [];
            // Map to per-sentence results by index
            const mapped: (TypoApiResult | null)[] = new Array(sentences.length).fill(null);
            for (let i = 0; i < arr.length; i++) {
                const r = arr[i];
                const idx = typeof r?.index === 'number' ? r.index : i;
                if (idx >= 0 && idx < mapped.length) mapped[idx] = r;
            }
            return mapped;
        });
    };

    if (cfg.enabled) enable();

    // respond to config change
    const disp = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('AndreaNovelHelper.typo.clientLLM')) {
            const c = getClientCfg();
            if (c.enabled) enable();
            else {
                // disable: throw to trigger HTTP fallback in detectTyposBatch
                setTypoDetectorBatch(async () => { throw new Error('clientLLM disabled'); });
            }
        }
    });
    context.subscriptions.push(disp);
}
