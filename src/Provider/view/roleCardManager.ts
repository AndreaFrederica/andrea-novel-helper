import * as vscode from 'vscode';
import * as fs from 'fs';

const COMMAND_ID = 'andrea.roleCardManager.open';

/** 读取文件为字符串（utf-8） */
function readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
}

/** 生成随机 nonce（给内联脚本用） */
function getNonce(len = 32): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < len; i++) { s += chars.charAt(Math.floor(Math.random() * chars.length)); }
    return s;
}

/** 归一化相对路径（去掉开头的 / 与 ./） */
function normalizeRel(p: string): string {
    return p.replace(/^[/.]+/, '');
}

/**
 * 把 index.html 里的 src/href 逐个改成 asWebviewUri 绝对地址，并移除 <base>
 * 这样避免由于 <base> 指向 vscode-resource 域而触发 history.replaceState 跨源报错
 */
function rewriteHtmlToWebviewUris(
    html: string,
    webview: vscode.Webview,
    spaRoot: vscode.Uri
): string {
    // 1) 移除任何现存 <base>
    html = html.replace(/<base\s+[^>]*>/gi, '');

    // 2) 把以 / 开头的路径改相对，便于 joinPath
    html = html.replace(/(\s(?:src|href))=(["'])\/(.*?)\2/g, (_m, p1, q, p2) => `${p1}=${q}${p2}${q}`);

    // 3) 逐个标签替换资源地址为 asWebviewUri
    type Attr = 'src' | 'href';
    const replaceAttr = (tag: string, attr: Attr) => {
        const re = new RegExp(`<${tag}\\b([^>]*?)\\s${attr}=(["'])([^"']+)\\2([^>]*)>`, 'gi');
        html = html.replace(re, (m, pre, q, url, post) => {
            // 跳过 data:, http(s):, vscode-webview:, vscode-resource:, mailto:
            if (/^(data:|https?:|mailto:|vscode-webview:|vscode-resource:)/i.test(url)) { return m; }
            const rel = normalizeRel(url);
            const fileUri = vscode.Uri.joinPath(spaRoot, rel);
            const webUri = webview.asWebviewUri(fileUri).toString();
            return `<${tag}${pre} ${attr}=${q}${webUri}${q}${post}>`;
        });
    };

    // 常见需要处理的标签
    replaceAttr('script', 'src');
    replaceAttr('link', 'href');
    replaceAttr('img', 'src');
    replaceAttr('source', 'src');

    return html;
}

/** 在运行时兜底：拦截 fetch/XHR/Worker/元素属性赋值，自动把相对 URL 重写为 asWebviewUri 基址 */
function injectRuntimeBasePatch(html: string, webview: vscode.Webview, spaRoot: vscode.Uri, nonce: string) {
  const BASE = webview.asWebviewUri(spaRoot).toString() + '/';
  const patch = `
<script nonce="${nonce}">
(function(){
  const ABS = /^(?:[a-z]+:|data:|mailto:|vscode-)/i;
  const BASE = ${JSON.stringify(BASE)};
  const toAbs = (u) => {
    if (typeof u !== 'string' || ABS.test(u)) return u;
    if (u.startsWith('/')) u = u.slice(1);     // 修正 /assets/... -> assets/...
    return new URL(u, BASE).toString();
  };

  // fetch
  const _fetch = window.fetch;
  window.fetch = function(input, init) {
    const u = (typeof input === 'string') ? toAbs(input) : input;
    return _fetch(u, init);
  };

  // XHR
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    return _open.call(this, method, toAbs(url), ...rest);
  };

  // Worker / SharedWorker
  if ('Worker' in window) {
    const _Worker = window.Worker;
    window.Worker = function(spec, opts) {
      const u = typeof spec === 'string' ? toAbs(spec) : spec;
      return new _Worker(u, opts);
    };
  }
  if ('SharedWorker' in window) {
    const _SharedWorker = window.SharedWorker;
    window.SharedWorker = function(spec, opts) {
      const u = typeof spec === 'string' ? toAbs(spec) : spec;
      return new _SharedWorker(u, opts);
    };
  }

  // 动态创建/赋值到 href/src 的统一改写
  const origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (typeof value === 'string' && (name === 'src' || name === 'href')) {
      value = toAbs(value);
    }
    return origSetAttribute.call(this, name, value);
  };
  function rewriteProp(ctor, prop) {
    const d = ctor && ctor.prototype && Object.getOwnPropertyDescriptor(ctor.prototype, prop);
    if (!d || !d.set) return;
    Object.defineProperty(ctor.prototype, prop, {
      ...d,
      set(v) { d.set.call(this, (typeof v === 'string') ? toAbs(v) : v); }
    });
  }
  rewriteProp(HTMLScriptElement, 'src');
  rewriteProp(HTMLLinkElement,   'href');   // 覆盖 rel=stylesheet/modulepreload
  rewriteProp(HTMLImageElement,  'src');
  rewriteProp(HTMLSourceElement, 'src');
  rewriteProp(HTMLAudioElement,  'src');
  rewriteProp(HTMLVideoElement,  'src');
  rewriteProp(HTMLIFrameElement, 'src');

  // ===== 样式重写：把 CSS 内的 url(/...) / @import "/..." 改为 BASE 下的绝对地址，并内联 =====
  async function inlineStylesheet(link) {
    try {
      const href = link.getAttribute('href');
      if (!href) return;
      const res = await fetch(href, { credentials: 'same-origin' });
      if (!res.ok) return;
      let css = await res.text();

      // url("/...") / url('/...') / url(/...)
      css = css.replace(/url\\(\\s*(['"]?)(\\/[^)'"]+)\\1\\s*\\)/g, function(_m, q, p) {
        return 'url(' + (q || '') + new URL(p.slice(1), BASE).toString() + (q || '') + ')';
      });
      // @import "/..."; 或 @import '/...';
      css = css.replace(/@import\\s+(['"])(\\/[^'"]+)\\1/g, function(_m, q, p) {
        return '@import ' + q + new URL(p.slice(1), BASE).toString() + q;
      });

      const style = document.createElement('style');
      style.setAttribute('data-inlined-from', href);
      style.textContent = css; // style-src 'unsafe-inline' 已允许
      const media = link.getAttribute('media');
      if (media) style.setAttribute('media', media);

      link.rel = 'prefetch';
      link.disabled = true;
      if (link.parentNode) link.parentNode.insertBefore(style, link.nextSibling);
    } catch (e) {}
  }

  function fixExistingLinks() {
    // 先把现有的 modulepreload 改成绝对（避免 /assets/...）
    var mpl = document.querySelectorAll('link[rel~="modulepreload"][href]');
    for (var i=0;i<mpl.length;i++){
      var h = mpl[i].getAttribute('href');
      if (h) mpl[i].setAttribute('href', toAbs(h));
    }
    // 把现有的 stylesheet 内联并改写 url(...)
    var cssL = document.querySelectorAll('link[rel~="stylesheet"]');
    for (var j=0;j<cssL.length;j++) inlineStylesheet(cssL[j]);
  }

  function observeNewLinks() {
    var mo = new MutationObserver(function(list){
      for (var k=0;k<list.length;k++){
        var rec = list[k];
        if (rec.type === 'childList') {
          rec.addedNodes.forEach(function(n){
            if (n && n.nodeType === 1 && n.tagName === 'LINK') {
              var link = n;
              var rel = link.getAttribute('rel') || '';
              if (/\\bmodulepreload\\b/i.test(rel)) {
                var h = link.getAttribute('href');
                if (h) link.setAttribute('href', toAbs(h));
              } else if (/\\bstylesheet\\b/i.test(rel)) {
                inlineStylesheet(link);
              }
            }
          });
        }
      }
    });
    mo.observe(document.documentElement, { subtree: true, childList: true });
  }

  // 立即执行一次，随后继续监听（不等 DOMContentLoaded）
  try { fixExistingLinks(); } catch (e) {}
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ fixExistingLinks(); observeNewLinks(); }, { once: true });
  } else {
    observeNewLinks();
  }
})();
</script>`;
  // 尽量在 <head> 起始注入，保证最早生效
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n${patch}`);
  }
  const i = html.indexOf('<script');
  return (i >= 0) ? html.slice(0, i) + patch + html.slice(i)
                  : html.replace(/<\/head>/i, patch + '\n</head>');
}




/** 读取并重写 index.html + 注入 CSP + 运行时补丁 */
function buildHtml(panel: vscode.WebviewPanel, spaRoot: vscode.Uri): string {
    const indexHtmlUri = vscode.Uri.joinPath(spaRoot, 'index.html');
    const indexHtmlPath = indexHtmlUri.fsPath;
    if (!fs.existsSync(indexHtmlPath)) {
        return `<html><body><h3>角色卡管理器</h3><p>未找到 index.html：<code>${indexHtmlPath}</code></p></body></html>`;
    }

    let html = readFile(indexHtmlPath);

    // 首批资源改成 asWebviewUri（不再用 <base>）
    html = rewriteHtmlToWebviewUris(html, panel.webview, spaRoot);

    // 带 nonce 的 CSP，允许补丁脚本执行；如用到 Worker，加上 blob:
    const nonce = getNonce();
    const csp = [
        `default-src 'none';`,
        `img-src ${panel.webview.cspSource} https: data:;`,
        `style-src ${panel.webview.cspSource} 'unsafe-inline';`,
        `font-src ${panel.webview.cspSource} data:;`,
        `script-src ${panel.webview.cspSource} 'nonce-${nonce}';`,
        `connect-src ${panel.webview.cspSource} https: http:;`,
        `frame-src ${panel.webview.cspSource};`,
        `worker-src ${panel.webview.cspSource} blob:;`
    ].join(' ');

    if (/<meta http-equiv="Content-Security-Policy"/i.test(html)) {
        html = html.replace(
            /<meta http-equiv="Content-Security-Policy"[^>]*>/i,
            `<meta http-equiv="Content-Security-Policy" content="${csp}">`
        );
    } else {
        html = html.replace(
            /<head([^>]*)>/i,
            `<head$1>\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`
        );
    }

    // 注入运行时补丁，兜底后续动态请求与模块预加载
    html = injectRuntimeBasePatch(html, panel.webview, spaRoot, nonce);

    return html;
}

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand(COMMAND_ID, () => {
        // 你的 dist/spa 打包到扩展里的路径
        const spaRoot = vscode.Uri.joinPath(context.extensionUri, 'packages', 'webview', 'dist', 'spa');

        const panel = vscode.window.createWebviewPanel(
            'andreaRoleCardManager',
            '角色卡管理器',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [spaRoot],
            }
        );

        panel.webview.html = buildHtml(panel, spaRoot);
    });

    context.subscriptions.push(disposable);
}

export function deactivate() { }
