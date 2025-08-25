import * as vscode from 'vscode';
import * as fs from 'fs';
import type { RoleCardModel } from './types/role';

export const COMMAND_ID = 'andrea.roleCardManager.open';

export interface RoleCardPanelOptions {
    spaRoot: vscode.Uri;
    connectSrc?: string[];
    extraLocalResourceRoots?: vscode.Uri[];
    retainContextWhenHidden?: boolean;
    title?: string;
    resourceMapperScriptUri?: string;
}

export function registerRoleCardManager(
    context: vscode.ExtensionContext,
    options?: Partial<RoleCardPanelOptions>
): vscode.Disposable {
    const opts: RoleCardPanelOptions = { ...DEFAULT_OPTIONS(context), ...options };

    const disposable = vscode.commands.registerCommand(COMMAND_ID, () => {
        RoleCardPanel.createOrShow(context, opts);
    });

    context.subscriptions.push(disposable);
    return disposable;
}

export function openRoleCardManager(
    context: vscode.ExtensionContext,
    options?: Partial<RoleCardPanelOptions>
) {
    RoleCardPanel.createOrShow(context, { ...DEFAULT_OPTIONS(context), ...options });
}

export const DEFAULT_OPTIONS = (ctx: vscode.ExtensionContext): RoleCardPanelOptions => ({
    spaRoot: vscode.Uri.joinPath(ctx.extensionUri, 'packages', 'webview', 'dist', 'spa'),
    connectSrc: ['https:', 'http:'],
    retainContextWhenHidden: true,
    title: '角色卡管理器',
});

export class RoleCardPanel {
    private static current?: vscode.WebviewPanel;

    static createOrShow(ctx: vscode.ExtensionContext, options?: Partial<RoleCardPanelOptions>) {
        const opts: RoleCardPanelOptions = { ...DEFAULT_OPTIONS(ctx), ...options };
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (RoleCardPanel.current) {
            RoleCardPanel.current.title = opts.title ?? RoleCardPanel.current.title;
            RoleCardPanel.current.reveal(column);
            try {
                const mapperFile = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'resource-mapper.js');
                opts.resourceMapperScriptUri = RoleCardPanel.current.webview.asWebviewUri(mapperFile).toString();
            } catch (_) { }
            RoleCardPanel.current.webview.html = buildHtml(RoleCardPanel.current.webview, opts);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'andreaRoleCardManager',
            opts.title ?? '角色卡管理器',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: !!opts.retainContextWhenHidden,
                localResourceRoots: [opts.spaRoot, vscode.Uri.joinPath(ctx.extensionUri, 'media'), ...(opts.extraLocalResourceRoots ?? [])],
            }
        );

        try {
            const mapperFile = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'resource-mapper.js');
            opts.resourceMapperScriptUri = panel.webview.asWebviewUri(mapperFile).toString();
        } catch (_) { }

        panel.onDidDispose(() => { RoleCardPanel.current = undefined; });
        panel.webview.html = buildHtml(panel.webview, opts);

        // Webview <-> Extension messaging for role cards
        // - 前端发送 { type: 'requestRoleCards' } -> 扩展回送 { type: 'roleCards', list }
        // - 前端发送 { type: 'saveRoleCards', list } -> 扩展保存并回送 { type: 'saveAck', ok: true/false }
                // 测试用示例数据：前端请求时直接返回该数据
                const TEST_ROLECARDS: (RoleCardModel & { id?: string })[] = [
                    { id: 'sample-1', base: { name: '中文对话', type: '正则表达式', regex: '“[^”]*”', regexFlags: 'g', color: '#fbdc98ff', priority: 100, description: '匹配中文引号内的对话内容' }, extended: { 说明: '用于标注中文引号中的对白。' }, custom: { 标签: '- dialogue\n- zh-CN' } },
                    { id: 'sample-2', base: { name: '博丽灵梦', type: '主角', affiliation: '博丽神社', color: '#e94152ff', priority: 10, description: '乐园的巫女，博丽神社现任巫女。', aliases: ['灵梦', 'Reimu'] }, extended: { 外貌: '- 红白巫女服\n- 大红蝴蝶结\n- 阴阳玉随身', 性格: '- 大而化之\n- 懒散随性\n- 直觉敏锐', 背景: '人类；幻想乡“博丽神社”的巫女，调停人妖两界的平衡。', 技能: '- **在空中飞行程度的能力**\n- 御札/御币/结界术\n- 阴阳玉运用', 代表符卡: '- 梦符「梦想封印」\n- 霊符「封魔阵」\n- 結界「八方鬼缚阵」', 爱好: '泡茶，偶尔打扫神社（如果想起来）。' }, custom: { 称号: '- **乐园的巫女**', 备注: '香火清淡与钱包清冷，是常年烦恼。' } },
                    { id: 'sample-3', base: { name: '雾雨魔理沙', type: '主角', affiliation: '魔法森林', color: '#FFD700', description: '人类魔法使，居住于魔法森林。', aliases: ['魔理沙', 'Marisa'] }, extended: { 外貌: '- 黑色魔女服+白围裙\n- 尖顶帽（星月装饰）', 性格: '- 开朗外向\n- 自信好胜\n- 实用主义', 背景: '平民出身，自学魔法+物理结合；爱收集禁书与古器。', 技能: '- 光热系魔法\n- 魔炮\n- 道具改造\n- 高速机动', 代表符卡: '- 「魔砲・散射の弾幕」\n- 「光热魔炮」' }, custom: { 称号: '- **魔女的发明家**\n- **月下的弹幕猎手**', 备注: '口头禅：DA☆ZE' } },
                    { id: 'sample-4', base: { name: '禁忌术', type: '敏感词', description: '需要替换/规避的高危词汇。', fixes: ['禁止术', '秘法', '封印术'], color: '#ff0000' }, extended: { 风险等级: '**高危**\n需重点替换' } },
                    { id: 'sample-5', base: { name: '魔能', type: '词汇', description: '世界观中的能量单位' }, custom: { 分类: '能量体系', 补充说明: '常规范围：0~100；>100 为危险阈值' } },
                    { id: 'sample-6', base: { name: '张三丰', type: '联动角色', affiliation: '武当派', description: '武当派开山祖师，太极拳创始人。', aliases: ['张真人'] }, extended: { 技能: '- 太极拳\n- 纯阳无极功\n- 太极剑法', 性格: '超凡脱俗，主张三教合一' }, custom: { 称号: '“通微显化真人”' } },
                    { id: 'sample-7', base: { name: '黑曜导师', type: '炼金顾问', affiliation: '旧王廷密会', description: '沉默而克制的炼金顾问，偏防御反击，善用环境。', color: '#222233' }, extended: { 战斗风格: '防御反击，环境利用与反制', 信仰: '旧王廷秘教', 装备: '- 黑曜法杖\n- 腐蚀手甲' }, custom: { 备注: '只在主线第三幕短暂现身' } },
                    { id: 'sample-8', base: { name: '十六夜咲夜', type: '配角', affiliation: '红魔馆', description: '红魔馆女仆长，能操纵时间。', aliases: ['咲夜', 'Sakuya'] }, extended: { 技能: '- 投掷银制小刀\n- 停止时间的能力', 性格: '冷静严谨，绝对忠诚' } },
                    { id: 'sample-9', base: { name: '帕秋莉·诺蕾姬', type: '配角', affiliation: '红魔馆', description: '大图书馆的魔法师，体质虚弱但知识渊博。', aliases: ['帕秋莉', 'Patchouli'] }, extended: { 技能: '- 元素魔法\n- 炼金术', 爱好: '阅读、研究' } },
                    { id: 'sample-10', base: { name: '琪露诺', type: '配角', affiliation: '雾之湖', description: '冰之妖精，自称“最强”。', aliases: ['Cirno'] }, extended: { 技能: '操控冷气，制造冰锥弹幕', 性格: '好胜单纯' } },
                    { id: 'sample-11', base: { name: '奈芙尼丝', type: '主角', affiliation: '多萝西的禁密书典', description: '学姐角色' }, extended: { 外貌: '黑发长裙，神秘气质', 性格: '冷静、成熟' } },
                    { id: 'sample-12', base: { name: '凡尼娅', type: '主角', affiliation: '多萝西的禁密书典', description: '灯教修女', aliases: ['修女'] }, extended: { 背景: '灯教的修女，信仰不太虔诚' } },
                ];

                const sendStoredRoleCards = () => {
                        try { panel.webview.postMessage({ type: 'roleCards', list: TEST_ROLECARDS }); } catch (_) { /* ignore */ }
                };

        const isValidRoleCards = (v: any): v is RoleCardModel[] => {
            if (!Array.isArray(v)) { return false; }
            for (const it of v) {
                if (!it || typeof it !== 'object') { return false; }
                if (!('base' in it) || typeof it.base !== 'object') { return false; }
            }
            return true;
        };

        const msgDisp = panel.webview.onDidReceiveMessage(async (msg: any) => {
            if (!msg || typeof msg.type !== 'string') { return; }
            try {
                if (msg.type === 'requestRoleCards') {
                    sendStoredRoleCards();
                } else if (msg.type === 'saveRoleCards') {
                    const list = msg.list;
                    if (!isValidRoleCards(list)) {
                        panel.webview.postMessage({ type: 'saveAck', ok: false, error: 'invalid rolecards payload' });
                        return;
                    }
                    // 测试阶段：只在扩展侧打印收到的数据，不做持久化
                    console.log('[RoleCardManager] received saveRoleCards, payload:', JSON.stringify(list));
                    panel.webview.postMessage({ type: 'saveAck', ok: true });
                }
            } catch (e) {
                panel.webview.postMessage({ type: 'saveAck', ok: false, error: String(e) });
            }
        }, undefined, ctx.subscriptions);

        // 初始推送，方便前端在未显式请求时接收当前数据
        sendStoredRoleCards();

        RoleCardPanel.current = panel;
    }
}

/* ================= 工具函数（纯静态改写，无运行时注入） ================ */

function readFile(fp: string): string {
    return fs.readFileSync(fp, 'utf-8');
}

function normalizeRel(p: string): string {
    if (p.startsWith('/')) { return p.slice(1); }
    if (p.startsWith('./')) { return p.replace(/^\.\/+/, ''); }
    return p;
}

function rewriteHtmlToWebviewUris(html: string, webview: vscode.Webview, spaRoot: vscode.Uri): string {
    type Attr = 'src' | 'href';
    const fixRelFromVscodeWebview = (u: string) => {
        const m = u.match(/^vscode-webview:\/\/[^/]+\/(.*)$/i);
        return m ? normalizeRel(m[1]) : normalizeRel(u);
    };

    const replaceAttr = (tag: string, attr: Attr) => {
        const re = new RegExp(
            `<${tag}\\b([^>]*?)\\s${attr}\\s*=\\s*(?:"([^"]+)"|'([^']+)'|([^\\s>]+))([^>]*)>`,
            'gi'
        );
        html = html.replace(re, (m, pre, g1, g2, g3, post) => {
            const raw = g1 ?? g2 ?? g3 ?? '';
            // 放过这些：data/mailto/javascript/#/http(s)
            if (/^(data:|mailto:|javascript:|#|https?:)/i.test(raw)) { return m; }

            // 把任何 vscode-webview://.../xxx 也当作相对路径处理
            const rel = fixRelFromVscodeWebview(raw);

            const fileUri = vscode.Uri.joinPath(spaRoot, rel);
            const webUri = webview.asWebviewUri(fileUri).toString();

            const quoted = (g1 !== null && g1 !== undefined) ? `"${webUri}"` : ((g2 !== null && g2 !== undefined) ? `'${webUri}'` : webUri);
            return `<${tag}${pre} ${attr}=${quoted}${post}>`;
        });
    };

    replaceAttr('script', 'src');
    replaceAttr('link', 'href');     // 覆盖 <link rel="modulepreload"> 等
    replaceAttr('img', 'src');
    replaceAttr('source', 'src');
    replaceAttr('video', 'src');
    replaceAttr('audio', 'src');
    replaceAttr('iframe', 'src');
    return html;
}



function injectResourceMapper(html: string, webview: vscode.Webview, spaRoot: vscode.Uri, mapperScriptUri?: string): string {
    // ✅ 正确的基准：构建出来就是 *.vscode-cdn.net 的 https 链接
    const baseUri = webview.asWebviewUri(spaRoot).toString().replace(/\/$/, '');

    // 扫描 /assets 映射
    const assetsPath = vscode.Uri.joinPath(spaRoot, 'assets').fsPath;
    const resourceMap: Record<string, string> = {};
    try {
        if (fs.existsSync(assetsPath)) {
            for (const file of fs.readdirSync(assetsPath)) {
                const key = `/assets/${file}`;
                const val = webview.asWebviewUri(vscode.Uri.joinPath(spaRoot, 'assets', file)).toString(); // ✅ 只信 asWebviewUri
                resourceMap[key] = val;
            }
        }
    } catch (e) {
        console.warn('Failed to scan assets directory:', e);
    }

    const safeResourceMap = JSON.stringify(resourceMap).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    const safeBaseUri = baseUri.replace(/"/g, '\\"');

    // 注入最小的全局数据，然后通过外部脚本加载完整的 mapper 实现（放在扩展主体目录，而不是 spa）
    const injectedData = `<script>window.__vscode_resource_map__ = ${safeResourceMap}; window.__vscode_resource_baseUri__ = "${safeBaseUri}";</script>`;

    // 脚本 URI 优先使用传入的 mapperScriptUri（已经是 asWebviewUri 字符串），否则尝试从 spaRoot 寻找 resource-mapper.js
    let mapperSrc = mapperScriptUri;
    if (!mapperSrc) {
        try {
            mapperSrc = webview.asWebviewUri(vscode.Uri.joinPath(spaRoot, '..', 'media', 'resource-mapper.js')).toString();
        } catch (_) { mapperSrc = undefined; }
    }

    const injectedScript = injectedData + (mapperSrc ? `\n<script src="${mapperSrc}"></script>` : '');

    return html.replace(/<head([^>]*)>/i, `<head$1>\n${injectedScript}`);
}

/** 修复所有资源路径并处理动态导入 */
function fixAllAssetUrls(html: string, webview: vscode.Webview, spaRoot: vscode.Uri): string {
    const base = webview.asWebviewUri(spaRoot).toString().replace(/\/$/, '');

    // 修复各种静态路径引用
    html = html.replace(/(\s(?:href|src)\s*=\s*)(["'])\/assets\//gi, (_m, p1, q) => `${p1}${q}${base}/assets/`);
    html = html.replace(/(\s(?:href|src)\s*=\s*)(["'])(?:\.\/)?assets\//gi, (_m, p1, q) => `${p1}${q}${base}/assets/`);

    // 处理 JavaScript 中的各种动态导入和路径引用
    html = html.replace(/(import\s*\(\s*)(["'`])([^"'`]*\/assets\/[^"'`]*)\2/g, (match, prefix, quote, path) => {
        const normalizedPath = path.replace(/^\.?\//, '');
        return `${prefix}${quote}${base}/${normalizedPath}${quote}`;
    });

    // 处理字符串中的路径拼接
    html = html.replace(/(["'`])\/assets\//g, `$1${base}/assets/`);
    html = html.replace(/(["'`])\.\/assets\//g, `$1${base}/assets/`);

    // 处理更复杂的路径构建模式
    html = html.replace(/(['"`])assets\//g, `$1${base}/assets/`);
    console.log('After fixAllAssetUrls, base:', base);
    console.log('After fixAllAssetUrls, html:', html);
    return html;
}

/** 注入兼容的 CSP，允许必要的内联脚本 */
function applyCsp(html: string, webview: vscode.Webview, connectSrcExtra: string[] = []): string {
    const connectSrc = [webview.cspSource, ...connectSrcExtra].join(' ');
    const csp = [
        `default-src 'none';`,
        `img-src ${webview.cspSource} https: data: blob:;`,
        `style-src ${webview.cspSource} 'unsafe-inline';`,
        `font-src ${webview.cspSource} data:;`,
        `script-src ${webview.cspSource} https: 'unsafe-inline';`,
        `connect-src ${connectSrc};`,
        `frame-src 'none';`, // 禁止框架，避免 CSP 错误
        `worker-src ${webview.cspSource} blob:;`,
        `child-src ${webview.cspSource} blob:;`,
    ].join(' ');

    if (/<meta http-equiv="Content-Security-Policy"/i.test(html)) {
        return html.replace(
            /<meta http-equiv="Content-Security-Policy"[^>]*>/i,
            `<meta http-equiv="Content-Security-Policy" content="${csp}">`
        );
    }
    return html.replace(
        /<head([^>]*)>/i,
        `<head$1>\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`
    );
}

function buildHtml(webview: vscode.Webview, opts: RoleCardPanelOptions): string {
    const indexHtmlUri = vscode.Uri.joinPath(opts.spaRoot, 'index.html');
    const indexHtmlPath = indexHtmlUri.fsPath;
    if (!fs.existsSync(indexHtmlPath)) {
        return `<html><body><h3>角色卡管理器</h3><p>未找到 index.html：<code>${indexHtmlPath}</code></p></body></html>`;
    }
    let html = readFile(indexHtmlPath);

    // 先处理基本的 src/href 属性
    html = rewriteHtmlToWebviewUris(html, webview, opts.spaRoot);

    // 修复所有静态资源路径
    html = fixAllAssetUrls(html, webview, opts.spaRoot);

    // 注入动态资源映射和转换函数（脚本文件位于扩展主体：media/resource-mapper.js）
    html = injectResourceMapper(html, webview, opts.spaRoot, opts.resourceMapperScriptUri);



    // 添加 base 标签作为备用方案
    html = addBaseTag(html, webview, opts.spaRoot);

    // 应用 CSP
    html = applyCsp(html, webview, opts.connectSrc);

    return html;
}

/** 不再注入 base；若原文件有 base，直接移除 */
function addBaseTag(html: string, _webview: vscode.Webview, _spaRoot: vscode.Uri): string {
    // 移除任何已有的 <base>，避免跨源路由/解析
    return html.replace(/<base\s+[^>]*>/gi, '');
}
