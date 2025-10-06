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
    thinkingProvider: string; // thinking 供应商预设
    customThinkingEnabled: boolean; // 是否启用自定义thinking字段
    customThinkingEnabledValue: boolean; // 自定义thinking字段的启用值
    customThinkingDisabledValue: boolean; // 自定义thinking字段的禁用值
    qwenThinkingMethod: string; // Qwen思考方法：'parameter' 或 'suffix'
    geminiThinkingBudget: number; // Gemini思考预算：-1(动态), 0(禁用), 具体数值(指定预算)
    geminiApiFormat: string; // Gemini API格式：'openai' 或 'native'
}

/**
 * 已知支持思考过程（reasoning_content）的模型列表
 * 支持模型名称前缀匹配和精确匹配
 */
const THINKING_SUPPORTED_MODELS = [
    'glm-4.6',           // 智谱 GLM-4.6
    'glm-4.5',           // 智谱 GLM-4.5
    'glm-4.5-air',       // 智谱 GLM-4.5-air
    'glm-4.5v',          // 智谱 GLM-4.5v (旧名称)
    'glm-4',             // 智谱 GLM-4 系列
    'deepseek-r1',       // DeepSeek R1 系列
    'deepseek-reasoner', // DeepSeek Reasoner
    'qwen-max-r',        // 通义千问推理模型
    'qwen-r',            // 通义千问推理模型
];

/**
 * thinking 供应商预设配置
 */
const THINKING_PROVIDER_PRESETS = {
    'auto': {
        name: '自动检测',
        description: '根据模型名称自动选择合适的thinking参数格式',
        getParams: (model: string, enabled: boolean) => {
            const lowerModel = model.toLowerCase();
            if (lowerModel.startsWith('glm-')) {
                return {
                    param: 'thinking',
                    value: enabled ? { type: 'enabled' } : { type: 'disabled' }
                };
            } else if (lowerModel.includes('deepseek')) {
                return {
                    param: 'extra_body.enable_thinking',
                    value: enabled
                };
            } else if (lowerModel.includes('qwen')) {
                return {
                    param: 'reasoning_effort',
                    value: enabled ? 'high' : 'medium'
                };
            } else if (lowerModel.includes('gemini')) {
                // Gemini使用OpenAI兼容格式的reasoning_effort参数
                return {
                    param: 'reasoning_effort',
                    value: enabled ? 'low' : 'none'
                };
            }
            return {
                param: 'extra_body.enable_thinking',
                value: enabled
            };
        }
    },
    'glm': {
        name: '智谱 GLM',
        description: 'GLM 系列模型的 thinking 参数格式',
        getParams: (_model: string, enabled: boolean) => ({
            param: 'thinking',
            value: enabled ? { type: 'enabled' } : { type: 'disabled' }
        })
    },
    'deepseek': {
        name: 'DeepSeek',
        description: 'DeepSeek 模型的 thinking 参数格式',
        getParams: (_model: string, enabled: boolean) => ({
            param: 'extra_body.enable_thinking',
            value: enabled
        })
    },
    'qwen': {
        name: '通义千问',
        description: '通义千问模型的thinking控制格式，支持两种方法：参数法(/no_think后缀)和请求体法(enable_thinking=False)',
        getParams: (_model: string, enabled: boolean, config?: ClientLLMCfg) => {
            if (!config) {
                // 默认使用参数法
                return {
                    param: 'model',
                    value: enabled ? _model : `${_model}/no_think`
                };
            }

            if (config.qwenThinkingMethod === 'suffix') {
                // 方法1：使用 /no_think 后缀
                return {
                    param: 'model',
                    value: enabled ? _model : `${_model}/no_think`,
                    description: enabled ? '使用模型默认名称' : '在模型名称后添加 /no_think 后缀'
                };
            } else {
                // 方法2：使用 enable_thinking=False 参数（默认）
                return {
                    param: 'extra_body.enable_thinking',
                    value: enabled,
                    description: enabled ? '在extra_body中设置 enable_thinking=true' : '在extra_body中设置 enable_thinking=False'
                };
            }
        }
    },
    'gemini': {
        name: 'Google Gemini',
        description: 'Google Gemini 2.5系列模型的thinking配置，支持OpenAI兼容和原生API两种格式',
        getParams: (_model: string, enabled: boolean, config?: ClientLLMCfg) => {
            if (!config) {
                // 默认使用OpenAI兼容格式
                return {
                    param: 'reasoning_effort',
                    value: enabled ? 'low' : 'none'
                };
            }

            // 根据API格式决定参数
            if (config.geminiApiFormat === 'native') {
                // 原生Gemini API格式
                return {
                    param: 'generationConfig.thinkingConfig',
                    value: {
                        thinking_budget: enabled ? config.geminiThinkingBudget : 0,
                        include_thoughts: enabled
                    },
                    description: enabled
                        ? `使用thinking_budget=${config.geminiThinkingBudget}启用思考(原生API)`
                        : '使用thinking_budget=0禁用思考(原生API)'
                };
            } else {
                // OpenAI兼容API格式
                const effortMapping: { [key: number]: string } = {
                    0: 'none',        // 禁用思考
                    [-1]: 'low',      // 动态思考（低预算）
                    1024: 'low',      // 低预算
                    8192: 'medium',   // 中等预算
                    24576: 'high'     // 高预算
                };

                const budget = config.geminiThinkingBudget;
                let reasoningEffort = 'low'; // 默认值

                if (budget === 0) {
                    reasoningEffort = 'none';
                } else if (budget in effortMapping) {
                    reasoningEffort = effortMapping[budget];
                } else if (budget > 0 && budget < 8192) {
                    reasoningEffort = 'low';
                } else if (budget >= 8192 && budget < 24576) {
                    reasoningEffort = 'medium';
                } else if (budget >= 24576) {
                    reasoningEffort = 'high';
                }

                return {
                    param: 'reasoning_effort',
                    value: enabled ? reasoningEffort : 'none',
                    description: enabled
                        ? `使用reasoning_effort=${reasoningEffort}启用思考(OpenAI兼容)`
                        : '使用reasoning_effort=none禁用思考(OpenAI兼容)'
                };
            }
        }
    },
    'custom': {
        name: '自定义',
        description: '使用用户自定义的 thinking 字段和值',
        getParams: (_model: string, enabled: boolean, customConfig?: any) => {
            if (!customConfig || !customConfig.enabled) {
                return null;
            }
            return {
                param: customConfig.field,
                value: enabled ? customConfig.enabledValue : customConfig.disabledValue
            };
        }
    }
};

/**
 * 根据供应商预设和配置获取thinking参数
 */
function getThinkingParams(model: string, enabled: boolean, config: ClientLLMCfg): { param: string, value: any } | null {
    const preset = THINKING_PROVIDER_PRESETS[config.thinkingProvider as keyof typeof THINKING_PROVIDER_PRESETS];

    if (!preset) {
        return null;
    }

    if (config.thinkingProvider === 'custom') {
        const customConfig: any = {
            enabled: config.customThinkingEnabled,
            field: 'thinking', // 默认字段，将来可以配置
            enabledValue: config.customThinkingEnabledValue,
            disabledValue: config.customThinkingDisabledValue
        };
        return preset.getParams(model, enabled, customConfig);
    }

    return preset.getParams(model, enabled, config);
}


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
    const thinkingProvider = cfg.get<string>('typo.clientLLM.thinkingProvider', 'auto') || 'auto';

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
        enableThinking: enableThinkingConfig,
        thinkingProvider: thinkingProvider,
        customThinkingEnabled: cfg.get<boolean>('typo.clientLLM.customThinkingEnabled', false) || false,
        customThinkingEnabledValue: cfg.get<boolean>('typo.clientLLM.customThinkingEnabledValue', true) || true,
        customThinkingDisabledValue: cfg.get<boolean>('typo.clientLLM.customThinkingDisabledValue', false) || false,
        qwenThinkingMethod: cfg.get<string>('typo.clientLLM.qwenThinkingMethod', 'parameter') || 'parameter',
        geminiThinkingBudget: cfg.get<number>('typo.clientLLM.geminiThinkingBudget', -1) || -1,
        geminiApiFormat: cfg.get<string>('typo.clientLLM.geminiApiFormat', 'openai') || 'openai'
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

    // 根据thinking配置处理参数
    const cfg = getClientCfg();
    const thinkingParams = getThinkingParams(model, enableThinking, cfg);

    if (enableThinking && thinkingParams) {
        // 启用thinking - 使用供应商预设或自定义配置
        if (thinkingParams.param === 'model') {
            // Qwen的特殊情况：修改模型名称
            requestBody.model = thinkingParams.value;
        } else if (thinkingParams.param === 'extra_body.enable_thinking') {
            requestBody.extra_body = { enable_thinking: thinkingParams.value };
        } else if (thinkingParams.param.includes('.')) {
            // 处理嵌套参数，如 "extra_body.some_param"
            const [parent, child] = thinkingParams.param.split('.');
            if (!requestBody[parent]) {
                requestBody[parent] = {};
            }
            requestBody[parent][child] = thinkingParams.value;
        } else {
            // 直接参数
            requestBody[thinkingParams.param] = thinkingParams.value;
        }
    } else if (!enableThinking) {
        // 禁用thinking - 获取禁用参数并应用
        const disabledThinkingParams = getThinkingParams(model, false, cfg);
        if (disabledThinkingParams) {
            if (disabledThinkingParams.param === 'model') {
                // Qwen的特殊情况：修改模型名称添加/no_think后缀
                requestBody.model = disabledThinkingParams.value;
            } else if (disabledThinkingParams.param === 'extra_body.enable_thinking') {
                // 对于这种格式，直接删除整个 extra_body
                delete requestBody.extra_body;
            } else if (disabledThinkingParams.param.includes('.')) {
                // 处理嵌套参数
                const [parent, child] = disabledThinkingParams.param.split('.');
                if (requestBody[parent]) {
                    requestBody[parent][child] = disabledThinkingParams.value;
                }
            } else {
                // 直接参数
                requestBody[disabledThinkingParams.param] = disabledThinkingParams.value;
            }
        }
    }
    const res = await fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
    });

    // 检查HTTP响应状态
    if (!res.ok) {
        const errorText = await res.text();
        const errorMessage = `HTTP ${res.status} ${res.statusText}: ${errorText}`;

        if (trace) {
            appendTrace(`HTTP ERROR: ${errorMessage}`);
        }

        // 构造调试信息，显示完整的请求和响应
        const debugInfo = {
            url,
            method: 'POST',
            headers,
            requestBody,
            status: res.status,
            statusText: res.statusText,
            response: errorText,
            fullRequest: `-d '${JSON.stringify(requestBody)}'`
        };

        // 弹出通知提醒用户API错误
        vscode.window.showErrorMessage(
            `LLM API请求失败 (${res.status}): ${res.statusText}`,
            '查看详细信息', '复制请求信息'
        ).then(selection => {
            if (selection === '查看详细信息') {
                // 显示详细错误信息
                const errorDetails = `API请求失败\n\n状态码: ${res.status}\n状态信息: ${res.statusText}\n\n请求URL: ${url}\n\n错误响应:\n${errorText}`;
                vscode.window.showInformationMessage(errorDetails, '确定');
            } else if (selection === '复制请求信息') {
                // 复制请求信息到剪贴板
                vscode.env.clipboard.writeText(JSON.stringify(debugInfo, null, 2));
                vscode.window.showInformationMessage('请求信息已复制到剪贴板');
            }
        });

        throw new Error(errorMessage);
    }

    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (ctype.includes('application/json')) {
        const data = await res.json();
        const message = data?.choices?.[0]?.message;
        let content = message?.content ?? '';
        let thinkingContent = null;

        // 处理不同格式的thinking内容
        if (enableThinking && message) {
            if (message.reasoning_content) {
                thinkingContent = message.reasoning_content;
            } else if (message.thinking) {
                thinkingContent = message.thinking;
            } else if (message.reasoning) {
                thinkingContent = message.reasoning;
            }
        }

        if (trace) {
            if (thinkingContent && thinkingContent.trim()) {
                appendTrace(`\n${'='.repeat(20)}思考过程${'='.repeat(20)}`);
                appendLLMReplyChunk(thinkingContent);
                appendTrace(`\n${'='.repeat(20)}完整回复${'='.repeat(20)}`);
            }
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
    let hasThinkingContent = false; // 是否有思考内容

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

                // 处理思考过程 - 支持不同模型的格式
                let reasoningContent = null;
                if (enableThinking) {
                    // 标准的reasoning_content格式
                    if (delta?.reasoning_content !== undefined && delta.reasoning_content !== null) {
                        reasoningContent = delta.reasoning_content;
                    }
                    // GLM模型可能使用的格式
                    else if (delta?.thinking !== undefined && delta.thinking !== null) {
                        reasoningContent = delta.thinking;
                    }
                    // 其他可能的格式
                    else if (delta?.reasoning !== undefined && delta.reasoning !== null) {
                        reasoningContent = delta.reasoning;
                    }

                    // 过滤掉空的思考内容
                    if (reasoningContent && reasoningContent.trim()) {
                        hasThinkingContent = true;
                        if (!isAnswering && trace) {
                            appendLLMReplyChunk(reasoningContent);
                        }
                    }
                }

                // 处理正式回复内容
                const piece = delta?.content;
                if (piece) {
                    if (!isAnswering) {
                        isAnswering = true;
                        if (enableThinking && trace) {
                            // 只有当真正有思考内容时才显示分隔线
                            if (hasThinkingContent) {
                                appendTrace(`\n${'='.repeat(20)}完整回复${'='.repeat(20)}`);
                            }
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

    // 检查是否有内容输出
    if (!accum || accum.trim().length === 0) {
        const debugInfo = {
            url,
            method: 'POST',
            headers,
            requestBody,
            fullRequest: `-d '${JSON.stringify(requestBody)}'`,
            response: 'Empty response'
        };

        if (trace) {
            appendTrace(`WARNING: Empty response received`);
            appendTrace(`Full request: ${debugInfo.fullRequest}`);
        }

        // 弹出通知提醒用户空响应
        vscode.window.showWarningMessage(
            `LLM API返回空响应，可能是配置错误或API限制`,
            '查看请求信息', '复制请求信息'
        ).then(selection => {
            if (selection === '查看请求信息') {
                const requestDetails = `API返回空响应\n\n请求URL: ${url}\n\n完整请求:\n${debugInfo.fullRequest}`;
                vscode.window.showInformationMessage(requestDetails, '确定');
            } else if (selection === '复制请求信息') {
                vscode.env.clipboard.writeText(JSON.stringify(debugInfo, null, 2));
                vscode.window.showInformationMessage('请求信息已复制到剪贴板');
            }
        });
    }

    try { onProgress?.(accum); } catch { /* ignore */ }
    if (trace) { endLLMReplyLine(); appendTrace(`<== [ClientLLM] stream done, total=${accum.length}`); }
    return accum;
}

async function geminiNativeStream(
    apiBase: string,
    apiKey: string,
    model: string,
    systemPrompt: string,
    userPrompt: string,
    temperature: number,
    enableThinking: boolean,
    traceCtx?: { docUuid?: string; textsCount?: number; ctxLen?: number },
    onProgress?: (accum: string) => void
): Promise<string> {
    // 构建Gemini原生API URL
    const url = `${apiBase.replace(/\/$/, '')}/models/${model}:generateContent`;
    const fetchFn: any = (globalThis as any).fetch;
    if (!fetchFn) throw new Error('fetch unavailable');

    const trace = isClientLLMTraceEnabled();
    if (trace) {
        appendTrace(`==> [Gemini Native] POST ${url}`);
        appendTrace(`model=${model} temp=${temperature} thinking=${enableThinking} docUuid=${traceCtx?.docUuid || ''} texts=${traceCtx?.textsCount || 0} ctxLen=${traceCtx?.ctxLen || 0}`);
        try { appendTrace(`system: ${systemPrompt.slice(0, 300)}...`); } catch { /* ignore */ }
        try { appendTrace(`user: ${userPrompt.slice(0, 800)}...`); } catch { /* ignore */ }
    }

    const cfg = getClientCfg();
    const thinkingParams = getThinkingParams(model, enableThinking, cfg);

    // 构建Gemini原生请求体
    const requestBody: any = {
        contents: [
            {
                parts: [
                    { text: systemPrompt },
                    { text: userPrompt }
                ]
            }
        ],
        generationConfig: {
            temperature,
            maxOutputTokens: 8192
        }
    };

    // 添加thinking配置
    if (thinkingParams && enableThinking) {
        if (thinkingParams.param === 'generationConfig.thinkingConfig') {
            requestBody.generationConfig.thinkingConfig = thinkingParams.value;
        }
    }

    const headers: any = {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
    };

    const res = await fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
    });

    // 检查HTTP响应状态
    if (!res.ok) {
        const errorText = await res.text();
        const errorMessage = `HTTP ${res.status} ${res.statusText}: ${errorText}`;

        if (trace) {
            appendTrace(`HTTP ERROR: ${errorMessage}`);
        }

        const debugInfo = {
            url,
            method: 'POST',
            headers,
            requestBody,
            status: res.status,
            statusText: res.statusText,
            response: errorText,
            fullRequest: `-d '${JSON.stringify(requestBody)}'`
        };

        vscode.window.showErrorMessage(
            `Gemini API请求失败 (${res.status}): ${res.statusText}`,
            '查看详细信息', '复制请求信息'
        ).then(selection => {
            if (selection === '查看详细信息') {
                const errorDetails = `Gemini API请求失败\n\n状态码: ${res.status}\n状态信息: ${res.statusText}\n\n请求URL: ${url}\n\n错误响应:\n${errorText}`;
                vscode.window.showInformationMessage(errorDetails, '确定');
            } else if (selection === '复制请求信息') {
                vscode.env.clipboard.writeText(JSON.stringify(debugInfo, null, 2));
                vscode.window.showInformationMessage('请求信息已复制到剪贴板');
            }
        });

        throw new Error(errorMessage);
    }

    const data = await res.json();

    // 处理响应
    let content = '';
    let thinkingContent = null;

    // Gemini原生API的响应格式
    if (data.candidates && data.candidates.length > 0) {
        const candidate = data.candidates[0];
        if (candidate.content && candidate.content.parts) {
            for (const part of candidate.content.parts) {
                if (part.text) {
                    content += part.text;
                }
                if (part.thought) {
                    thinkingContent = part.thought;
                }
            }
        }
    }

    // 处理thinking内容
    if (trace) {
        if (thinkingContent && thinkingContent.trim()) {
            appendTrace(`\n${'='.repeat(20)}思考过程${'='.repeat(20)}`);
            appendLLMReplyChunk(thinkingContent);
            appendTrace(`\n${'='.repeat(20)}完整回复${'='.repeat(20)}`);
        }
        appendLLMReplyChunk(String(content));
        endLLMReplyLine();
    }

    // 检查是否有内容输出
    if (!content || content.trim().length === 0) {
        const debugInfo = {
            url,
            method: 'POST',
            headers,
            requestBody,
            fullRequest: `-d '${JSON.stringify(requestBody)}'`,
            response: 'Empty response'
        };

        if (trace) {
            appendTrace(`WARNING: Empty response received`);
            appendTrace(`Full request: ${debugInfo.fullRequest}`);
        }

        vscode.window.showWarningMessage(
            `Gemini API返回空响应，可能是配置错误或API限制`,
            '查看请求信息', '复制请求信息'
        ).then(selection => {
            if (selection === '查看请求信息') {
                const requestDetails = `Gemini API返回空响应\n\n请求URL: ${url}\n\n完整请求:\n${debugInfo.fullRequest}`;
                vscode.window.showInformationMessage(requestDetails, '确定');
            } else if (selection === '复制请求信息') {
                vscode.env.clipboard.writeText(JSON.stringify(debugInfo, null, 2));
                vscode.window.showInformationMessage('请求信息已复制到剪贴板');
            }
        });
    }

    try { onProgress?.(content); } catch { /* ignore */ }
    if (trace) { endLLMReplyLine(); appendTrace(`<== [Gemini Native] stream done, total=${content.length}`); }

    return content;
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
            let content = '';
            try {
                // 检查是否使用Gemini原生API
                if (c.thinkingProvider === 'gemini' && c.geminiApiFormat === 'native') {
                    content = await geminiNativeStream(
                        c.apiBase, c.apiKey, c.model, sys, user,
                        c.temperature, c.enableThinking,
                        { docUuid, textsCount: sentences.length, ctxLen: contextJoined.length },
                        (accum) => {
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
                        }
                    );
                } else {
                    // 使用OpenAI兼容API
                    content = await chatCompletionsStream(c.apiBase, c.apiKey, c.model, [
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
                }
            } catch (error) {
                // LLM API调用失败时的处理
                console.error('LLM API call failed:', error);

                // 显示错误通知
                vscode.window.showErrorMessage(
                    `LLM API调用失败: ${error instanceof Error ? error.message : String(error)}`,
                    '查看配置', '禁用LLM'
                ).then(selection => {
                    if (selection === '查看配置') {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'AndreaNovelHelper.typo.clientLLM');
                    } else if (selection === '禁用LLM') {
                        vscode.workspace.getConfiguration('AndreaNovelHelper').update('typo.clientLLM.enabled', false, vscode.ConfigurationTarget.Global);
                        vscode.window.showInformationMessage('已禁用LLM错别字检测');
                    }
                });

                // 返回空结果而不是抛出异常，避免中断整个错别字检测流程
                return new Array(sentences.length).fill(null);
            }
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
