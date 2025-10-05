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
    enableThinking: boolean;
}

/**
 * 已知支持思考过程（reasoning_content）的模型列表
 * 支持模型名称前缀匹配和精确匹配
 */
const THINKING_SUPPORTED_MODELS = [
    'glm-4.5',           // 智谱 GLM-4.5
    'deepseek-r1',       // DeepSeek R1 系列
    'deepseek-reasoner', // DeepSeek Reasoner
    'qwen-max-r',        // 通义千问推理模型
    'qwen-r',            // 通义千问推理模型
];

/**
 * 检测模型是否支持思考过程
 * @param modelName 模型名称
 * @returns 是否支持思考过程
 */
function isThinkingSupported(modelName: string): boolean {
    const lowerModel = modelName.toLowerCase();
    return THINKING_SUPPORTED_MODELS.some(pattern => {
        return lowerModel.includes(pattern.toLowerCase());
    });
}

/**
 * 尝试通过实际调用检测模型是否支持思考过程
 * 这是一个运行时检测方法，会发送一个简单的测试请求
 * @param apiBase API 基础地址
 * @param apiKey API 密钥
 * @param model 模型名称
 * @returns 是否支持思考过程
 */
async function detectThinkingSupport(apiBase: string, apiKey: string, model: string): Promise<boolean> {
    try {
        const url = apiBase.replace(/\/$/, '') + '/chat/completions';
        const fetchFn: any = (globalThis as any).fetch;
        if (!fetchFn) {
            return false;
        }
        
        const headers: any = { 'Content-Type': 'application/json' };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }
        
        // 发送一个简单的测试请求
        const res = await fetchFn(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: '1+1=?' }],
                temperature: 0,
                stream: true,
                extra_body: { enable_thinking: true },
                max_tokens: 10  // 限制 token 数量减少成本
            })
        });
        
        if (!res.ok) {
            return false;
        }
        
        // 检查响应中是否包含 reasoning_content
        const reader = (res.body as any).getReader();
        const decoder = new TextDecoder('utf-8');
        let buf = '';
        let hasReasoningContent = false;
        
        // 只读取前几个 chunk
        for (let i = 0; i < 5; i++) {
            const { value, done } = await reader.read();
            if (done) {
                break;
            }
            buf += decoder.decode(value, { stream: true });
            
            // 检查是否包含 reasoning_content 字段
            if (buf.includes('reasoning_content')) {
                hasReasoningContent = true;
                break;
            }
        }
        
        // 取消剩余的流
        try {
            await reader.cancel();
        } catch {
            // ignore
        }
        
        return hasReasoningContent;
    } catch (err) {
        // 检测失败，默认不支持
        return false;
    }
}

function getClientCfg(): ClientLLMCfg {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const model = cfg.get<string>('typo.clientLLM.model', 'deepseek-v3')!;
    const enableThinkingConfig = cfg.get<boolean>('typo.clientLLM.enableThinking', false) || false;
    
    // 如果用户启用了 enableThinking，检查模型是否在已知支持列表中
    if (enableThinkingConfig && !isThinkingSupported(model)) {
        // 模型不在已知支持列表中，输出警告但仍然允许用户使用
        const trace = isClientLLMTraceEnabled();
        if (trace) {
            appendTrace(`[ClientLLM] ⚠️ 警告: 模型 "${model}" 不在已知支持思考过程的列表中`);
            appendTrace(`[ClientLLM] 已知支持的模型: ${THINKING_SUPPORTED_MODELS.join(', ')}`);
            appendTrace(`[ClientLLM] 如果该模型实际支持思考过程，可以忽略此警告`);
        }
    }
    
    return {
        enabled: cfg.get<boolean>('typo.clientLLM.enabled', false) || false,
        apiBase: cfg.get<string>('typo.clientLLM.apiBase', 'https://api.deepseek.com/v1')!,
        apiKey: cfg.get<string>('typo.clientLLM.apiKey', '')!,
        model,
        temperature: cfg.get<number>('typo.clientLLM.temperature', 0) || 0,
        enableThinking: enableThinkingConfig
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
    enableThinking: boolean,
    traceCtx?: { docUuid?: string; textsCount?: number; ctxLen?: number },
    onProgress?: (accum: string) => void
): Promise<string> {
    const url = apiBase.replace(/\/$/, '') + '/chat/completions';
    const fetchFn: any = (globalThis as any).fetch;
    if (!fetchFn) throw new Error('fetch unavailable');
    const trace = isClientLLMTraceEnabled();
    if (trace) {
        appendTrace(`==> [ClientLLM] POST ${url}`);
        appendTrace(`model=${model} temp=${temperature} thinking=${enableThinking} docUuid=${traceCtx?.docUuid || ''} texts=${traceCtx?.textsCount || 0} ctxLen=${traceCtx?.ctxLen || 0}`);
        try { appendTrace(`system: ${(messages[0]?.content || '').slice(0, 300)}...`); } catch { /* ignore */ }
        try { appendTrace(`user: ${(messages[1]?.content || '').slice(0, 800)}...`); } catch { /* ignore */ }
    }
    const headers: any = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const requestBody: any = {
        model,
        messages,
        temperature,
        stream: true
    };
    if (enableThinking) {
        requestBody.extra_body = { enable_thinking: true };
    }
    const res = await fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
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
    let isAnswering = false; // 是否已进入回复阶段
    if (enableThinking && trace) {
        appendTrace(`\n${'='.repeat(20)}思考过程${'='.repeat(20)}`);
    }
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
                const delta = obj?.choices?.[0]?.delta;
                // 处理思考过程（reasoning_content）
                if (enableThinking && delta?.reasoning_content !== undefined && delta.reasoning_content !== null) {
                    if (!isAnswering && trace) {
                        appendLLMReplyChunk(delta.reasoning_content);
                    }
                }
                // 处理正式回复内容
                const piece = delta?.content;
                if (piece) {
                    if (!isAnswering) {
                        isAnswering = true;
                        if (enableThinking && trace) {
                            appendTrace(`\n${'='.repeat(20)}完整回复${'='.repeat(20)}`);
                        }
                    }
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
            ], c.temperature, c.enableThinking, { docUuid, textsCount: sentences.length, ctxLen: contextJoined.length }, (accum) => {
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
