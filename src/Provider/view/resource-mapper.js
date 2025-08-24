(function () {
    var resourceMap = window.__vscode_resource_map__ || {};
    var baseUri = (window.__vscode_resource_baseUri__ || '').replace(/\/$/, '');

    function transformPath(path) {
        if (!path || typeof path !== 'string') { return path; }

        if (path.startsWith(baseUri)) { return path; }

        try {
            const u = new URL(path);
            if (u.protocol === 'vscode-webview:' && u.pathname.startsWith('/assets/')) {
                const key = u.pathname;
                return resourceMap[key] || (baseUri + key);
            }
            if (/^(https?:|data:|blob:|javascript:)/i.test(u.protocol + '')) {
                return path;
            }
        } catch (_) { }

        if (path.startsWith('/assets/')) {
            return resourceMap[path] || (baseUri + path);
        }
        if (path.startsWith('./assets/') || path.startsWith('assets/')) {
            const normalized = path.startsWith('./') ? path.slice(1) : ('/' + path);
            return resourceMap[normalized] || (baseUri + normalized);
        }

        if (/^(https?:|data:|blob:|javascript:)/i.test(path)) { return path; }

        const full = path.startsWith('/') ? path : ('/' + path);
        return baseUri + full;
    }

    function patchURLProp(Ctor, prop) {
        try {
            const proto = Ctor && Ctor.prototype;
            if (!proto) { return; }
            const desc = Object.getOwnPropertyDescriptor(proto, prop);
            if (!desc || !desc.set || !desc.get) { return; }
            Object.defineProperty(proto, prop, {
                configurable: true,
                enumerable: desc.enumerable,
                get: function () { return desc.get.call(this); },
                set: function (v) {
                    try { v = transformPath(String(v)); } catch (_) { }
                    return desc.set.call(this, v);
                }
            });
        } catch (_) { }
    }

    patchURLProp(HTMLScriptElement, 'src');
    patchURLProp(HTMLLinkElement, 'href');
    patchURLProp(HTMLImageElement, 'src');
    patchURLProp(HTMLSourceElement, 'src');
    patchURLProp(HTMLIFrameElement, 'src');
    patchURLProp(HTMLMediaElement, 'src');

    const _setAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
        try {
            if (typeof value === 'string' && /^(src|href|srcset)$/i.test(String(name))) {
                value = transformPath(value);
            }
        } catch (_) { }
        return _setAttr.call(this, name, value);
    };

    function rewriteCssUrls(cssText) {
        if (!cssText) { return cssText; }

        cssText = cssText.replace(
            /url\(\s*(['"]?)(?!data:|blob:)(\/?\.?assets\/[^'")\s?#]+(?:[?#][^'")]*)?)\1\s*\)/gi,
            (_m, q, p) => {
                let path = p;
                if (path.startsWith('./')) { path = path.slice(1); }
                if (path.startsWith('assets/')) { path = '/' + path; }
                if (!path.startsWith('/assets/')) { return _m; }
                const mapped = resourceMap[path] || (baseUri + path);
                return 'url(' + (q || '') + mapped + (q || '') + ')';
            }
        );

        cssText = cssText.replace(
            /@import\s+(?:url\(\s*(['"]?)(\/?\.?assets\/[^'\")\s;]+)\1\s*\)|(['"])(\/?\.?assets\/[^'\")\s;]+)\3)\s*;/gi,
            (_m, q1, p1, q2, p2) => {
                let path = p1 || p2;
                if (path.startsWith('./')) { path = path.slice(1); }
                if (path.startsWith('assets/')) { path = '/' + path; }
                if (!path.startsWith('/assets/')) { return _m; }
                const mapped = resourceMap[path] || (baseUri + path);
                const q = q1 || q2 || '';
                return '@import url(' + q + mapped + q + ');';
            }
        );

        return cssText;
    }

    async function inlineStylesheet(linkEl) {
        try {
            if (!linkEl || linkEl.dataset.__inlined_css__) { return; }
            if (!/stylesheet/i.test(linkEl.rel || '')) { return; }
            if (!linkEl.href) { return; }

            const href = transformPath(linkEl.href);
            const res = await fetch(href, { credentials: 'same-origin' });
            if (!res.ok) { throw new Error('css fetch ' + res.status); }
            const css = await res.text();
            const fixed = rewriteCssUrls(css);

            const style = document.createElement('style');
            style.setAttribute('data-vscode-webview-inlined', '1');
            style.textContent = fixed;

            linkEl.dataset.__inlined_css__ = '1';
            linkEl.parentNode && linkEl.parentNode.insertBefore(style, linkEl);
            linkEl.remove();
        } catch (e) {
            try { linkEl.href = transformPath(linkEl.href); } catch (_) { }
            console.warn('inlineStylesheet failed:', e);
        }
    }

    var originalFetch = window.fetch;
    if (originalFetch) {
        window.fetch = function (url, options) {
            if (typeof url === 'string') { return originalFetch.call(this, transformPath(url), options); }
            if (url && typeof url.url === 'string') {
                var req = url; var newUrl = transformPath(req.url);
                if (newUrl !== req.url) { try { url = new Request(newUrl, req); } catch (_) { return originalFetch.call(this, newUrl, options || { method: req.method, headers: req.headers }); } }
            }
            return originalFetch.call(this, url, options);
        };
    }

    var X = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (X && X.open) {
        var origOpen = X.open;
        X.open = function (method, url) { try { if (typeof url === 'string') { arguments[1] = transformPath(url); } } catch (_) { } return origOpen.apply(this, arguments); };
    }

    if (typeof window.__vitePreload !== 'undefined') {
        var origPreload = window.__vitePreload;
        window.__vitePreload = function (fn, deps, path) {
            if (deps && Array.isArray(deps)) { deps = deps.map(d => transformPath(d)); }
            if (path) { path = transformPath(path); }
            return origPreload.call(this, fn, deps, path);
        };
    }

    function rewriteEl(el) {
        const tag = el.tagName;

        if (tag === 'LINK') {
            const rel = (el.rel || '').toLowerCase();

            if (rel.includes('stylesheet')) {
                inlineStylesheet(el);
                return;
            }

            if (el.href) {
                const next = transformPath(el.href);
                if (next !== el.href) { el.href = next; }
            }
            return;
        }

        if (tag === 'SCRIPT' && el.src) {
            const next = transformPath(el.src);
            if (next !== el.src) { el.src = next; }
            return;
        }

        if ((tag === 'IMG' || tag === 'SOURCE' || tag === 'VIDEO' || tag === 'AUDIO') && el.src) {
            const next = transformPath(el.src);
            if (next !== el.src) { el.src = next; }
        }

        if (el.hasAttribute && el.hasAttribute('srcset')) {
            try {
                const raw = el.getAttribute('srcset') || '';
                const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
                const fixed = parts.map(p => {
                    const sp = p.split(/\s+/);
                    sp[0] = transformPath(sp[0]);
                    return sp.join(' ');
                }).join(', ');
                if (fixed !== raw) { el.setAttribute('srcset', fixed); }
            } catch (_) { }
        }
    }

    if (typeof MutationObserver !== 'undefined') {
        const mo = new MutationObserver(muts => {
            for (const m of muts) {
                if (m.type === 'childList') {
                    m.addedNodes && m.addedNodes.forEach(n => {
                        if (n && n.nodeType === 1) {
                            rewriteEl(n);
                            n.querySelectorAll?.('link[rel],script[src],img[src],source[src],video[src],audio[src],[srcset]').forEach(rewriteEl);
                        }
                    });
                } else if (m.type === 'attributes') {
                    rewriteEl(/** @type {Element} */(m.target));
                }
            }
        });

        const start = () => {
            mo.observe(document.documentElement || document, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['href', 'src', 'srcset', 'rel']
            });

            document.querySelectorAll('link[rel],script[src],img[src],source[src],video[src],audio[src],[srcset]').forEach(rewriteEl);
        };

        document.readyState === 'loading'
            ? document.addEventListener('DOMContentLoaded', start, { once: true })
            : start();
    }

    console.log('VSCode Webview resource mapper initialized');
    console.log('Base URI:', baseUri);
})();
