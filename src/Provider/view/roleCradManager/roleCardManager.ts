import * as vscode from 'vscode';
import * as fs from 'fs';

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
                const mapperFile = vscode.Uri.joinPath(ctx.extensionUri, 'src', 'Provider', 'view', 'resource-mapper.js');
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
                localResourceRoots: [opts.spaRoot, vscode.Uri.joinPath(ctx.extensionUri, 'src', 'Provider', 'view'), ...(opts.extraLocalResourceRoots ?? [])],
            }
        );

        try {
            const mapperFile = vscode.Uri.joinPath(ctx.extensionUri, 'src', 'Provider', 'view', 'resource-mapper.js');
            opts.resourceMapperScriptUri = panel.webview.asWebviewUri(mapperFile).toString();
        } catch (_) { }

        panel.onDidDispose(() => { RoleCardPanel.current = undefined; });
        panel.webview.html = buildHtml(panel.webview, opts);
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
            mapperSrc = webview.asWebviewUri(vscode.Uri.joinPath(spaRoot, '..', 'src', 'Provider', 'view', 'resource-mapper.js')).toString();
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

    // 注入动态资源映射和转换函数（脚本文件位于扩展主体：src/Provider/view/resource-mapper.js）
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
