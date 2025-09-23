// src/Provider/utils/html-builder.ts
import * as vscode from 'vscode';
import * as fs from 'fs';

function readFile(fp: string): string {
    return fs.readFileSync(fp, 'utf-8');
}

function normalizeRel(p: string): string {
    return p.replace(/\\/g, '/');
}

function rewriteHtmlToWebviewUris(html: string, webview: vscode.Webview, spaRoot: vscode.Uri): string {
    const baseUri = webview.asWebviewUri(spaRoot).toString().replace(/\/$/, '');
    const patterns = [
        { regex: /href=["']([^"']+)["']/g, attr: 'href' },
        { regex: /src=["']([^"']+)["']/g, attr: 'src' },
        { regex: /url\(["']?([^"')]+)["']?\)/g, attr: 'url' },
    ];
    for (const { regex, attr } of patterns) {
        html = html.replace(regex, (match, url) => {
            // 跳过已经是完整URL的情况
            if (url.startsWith('http') || url.startsWith('//') || url.startsWith('data:') || url.startsWith('blob:') || url.includes('vscode-resource')) {
                return match;
            }
            const cleanUrl = url.startsWith('./') ? url.slice(2) : url.startsWith('/') ? url.slice(1) : url;
            const newUrl = `${baseUri}/${cleanUrl}`;
            return attr === 'url' ? `url(${newUrl})` : `${attr}="${newUrl}"`;
        });
    }
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

function fixAllAssetUrls(html: string, webview: vscode.Webview, spaRoot: vscode.Uri): string {
    const assetsPath = vscode.Uri.joinPath(spaRoot, 'assets').fsPath;
    if (!fs.existsSync(assetsPath)) return html;
    try {
        for (const file of fs.readdirSync(assetsPath)) {
            const oldPath = `/assets/${file}`;
            const newPath = webview.asWebviewUri(vscode.Uri.joinPath(spaRoot, 'assets', file)).toString();
            // 避免重复替换已经转换过的URL - 简单检查是否已包含vscode-resource
            if (!html.includes(newPath)) {
                const escapedOldPath = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                html = html.replace(new RegExp(escapedOldPath, 'g'), newPath);
            }
        }
    } catch (e) {
        console.warn('Failed to fix asset URLs:', e);
    }
    return html;
}

function applyCsp(html: string, webview: vscode.Webview, connectSrcExtra: string[] = []): string {
    const connectSrc = ['https:', 'http:', ...connectSrcExtra].join(' ');
    const csp = `default-src 'none'; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource} data:; connect-src ${connectSrc};`;
    return html.replace(/<head([^>]*)>/i, `<head$1>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`);
}

function addBaseTag(html: string): string {
    return html.replace(/<head([^>]*)>/i, '<head$1>\n<base href="./">');
}

export function buildHtml(webview: vscode.Webview, opts: { spaRoot: vscode.Uri; connectSrc?: string[]; resourceMapperScriptUri?: string; route?: string }): string {
    const indexHtmlUri = vscode.Uri.joinPath(opts.spaRoot, 'index.html');
    const indexHtmlPath = indexHtmlUri.fsPath;
    if (!fs.existsSync(indexHtmlPath)) {
        return `<html><body><h3>关系图编辑器</h3><p>未找到 index.html：<code>${indexHtmlPath}</code></p></body></html>`;
    }
    let html = readFile(indexHtmlPath);
    html = rewriteHtmlToWebviewUris(html, webview, opts.spaRoot);
    html = fixAllAssetUrls(html, webview, opts.spaRoot);
    html = injectResourceMapper(html, webview, opts.spaRoot, opts.resourceMapperScriptUri);
    
    // 如果指定了路由，注入路由信息
    if (opts.route) {
        const routeScript = `<script>window.__vscode_initial_route__ = "${opts.route}";</script>`;
        html = html.replace(/<head([^>]*)>/i, `<head$1>\n${routeScript}`);
    }
    
    html = addBaseTag(html);
    html = applyCsp(html, webview, opts.connectSrc ?? ['https:', 'http:']);
    return html;
}
