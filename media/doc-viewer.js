// @ts-nocheck
(function () {
    'use strict';

    const vscode = acquireVsCodeApi();
    const searchInput = document.getElementById('search');
    const navTree = document.getElementById('navTree');
    const docTitle = document.getElementById('docTitle');
    const docContent = document.getElementById('docContent');
    const backBtn = document.getElementById('backBtn');
    const releaseDocsBtn = document.getElementById('releaseDocsBtn');
    const modeToggle = document.getElementById('modeToggle');

    const docsData = window.__DOCS_DATA__ || {};
    const persistedState = vscode.getState() || {};
    let currentDocId = persistedState.currentDocId || null;

    // Default type-to-color map (matches extension's typeColorMap)
    const typeColorMap = {
        '主角': '#FFD700',
        '配角': '#ADD8E6',
        '联动角色': '#90EE90',
        '正则表达式': '#FFA500'
    };

    // ── Mode Toggle ──────────────────────────────────

    let currentMode = persistedState.currentMode || 'beginner';

    function persistState() {
        vscode.setState({
            currentDocId,
            currentMode,
            search: searchInput.value || ''
        });
    }

    function applyMode(mode) {
        currentMode = mode || 'beginner';
        docContent.classList.remove('mode-beginner', 'mode-pro');
        docContent.classList.add('mode-' + currentMode);
        modeToggle.querySelectorAll('.mode-btn').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-mode') === currentMode);
        });
        persistState();
    }

    modeToggle.addEventListener('click', event => {
        const btn = event.target.closest('.mode-btn');
        if (!btn) { return; }
        const mode = btn.getAttribute('data-mode');
        if (!mode || mode === currentMode) { return; }
        applyMode(mode);
    });

    // ── Syntax Highlighting ──────────────────────────

    function escapeHtml(text) {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    const mdRoleFieldPattern = /^(?:类型|颜色|别名|描述|所属|从属|优先级|性别|年龄|职业|性格|外貌|背景|技能|弱点|目标|动机|恐惧|秘密|台词|备注|标签|修复|严重级别|正则|正则标志|粗体|斜体|删除线|下划线|背景色|type|color|aliases?|description|affiliation|priority|gender|age|occupation|personality|appearance|background|skill|weakness|goal|motivation|fear|secret|quote|note|tag|fixes?|severity|regex|regexFlags?|bold|italic|strikethrough|underline|backgroundColor)$/i;

    function isMdRoleBlock(trimmed) {
        const roleHeadings = trimmed.match(/^##\s+.+$/gm) || [];
        const fieldHeadings = (trimmed.match(/^###\s+(.+)$/gm) || [])
            .map(line => line.replace(/^###\s+/, '').trim());
        return roleHeadings.length > 0 && fieldHeadings.some(field => mdRoleFieldPattern.test(field));
    }

    function isMarkdownBlock(trimmed) {
        const headingCount = (trimmed.match(/^#{1,6}\s.+$/gm) || []).length;
        return headingCount >= 2
            || /^(>\s|[-*+]\s|\d+\.\s|```|~~~|\|.+\||&Def\s|@[^\n:]+:)/m.test(trimmed)
            || /(?:\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`|!\[[^\]]*\]\([^)]*\)|\[[^\]]+\]\([^)]*\)|<!--|%%)/.test(trimmed)
            || /^\s*(?:---|\*\*\*|___)\s*$/m.test(trimmed);
    }

    function detectLang(code) {
        const trimmed = code.trim();
        if (!trimmed) { return 'text'; }
        if (/^export\s|^import\s|^async\s|^function\s|ctx\./m.test(trimmed) && !/^[\[{]/.test(trimmed)) { return 'js'; }
        if (/\[\[roles?\]\]/.test(trimmed)) { return 'toml'; }
        if (/^[\w-]+\s*=\s*["\[{]/m.test(trimmed) && !/^[\[{]/.test(trimmed)) { return 'toml'; }
        if (/^[\[{]/.test(trimmed) && /(?:name|type|角色)\s*:/.test(trimmed)) { return 'json5'; }
        if (/^[\[{]/.test(trimmed) && /(?:name|type)\s*[=:]/.test(trimmed)) { return 'json5'; }
        if (isMdRoleBlock(trimmed)) { return 'md-role'; }
        if (isMarkdownBlock(trimmed)) { return 'markdown'; }
        if (/^[^,\n]*,[^,\n]*,[^,\n]/m.test(trimmed) && /^[^\n{]*$/.test(trimmed.split('\n')[0])) { return 'csv'; }
        if (/^[\[{]/.test(trimmed)) { return 'json5'; }
        return 'text';
    }

    // ── Decoration Style Builder ─────────────────────

    // Mirrors extension's getTextStyleFromRole + DecorationRenderOptions
    function buildDecoStyle(role) {
        const s = role.fields;
        const parts = [];
        const color = s.color || s.颜色 || typeColorMap[s.type] || null;
        if (color) { parts.push('color:' + color); }
        const bg = s.backgroundColor || s.backgroundcolor || s.背景色 || null;
        if (bg) { parts.push('background-color:' + bg); }
        const bold = s.bold === true || s.bold === 'true' || s.粗体 === true || s.粗体 === 'true';
        if (bold) { parts.push('font-weight:bold'); }
        const italic = s.italic === true || s.italic === 'true' || s.斜体 === true || s.斜体 === 'true';
        if (italic) { parts.push('font-style:italic'); }
        const strike = s.strikethrough === true || s.strikethrough === 'true' || s.删除线 === true || s.删除线 === 'true';
        const underline = s.underline === true || s.underline === 'true' || s.下划线 === true || s.下划线 === 'true';
        if (strike && underline) { parts.push('text-decoration:underline line-through'); }
        else if (strike) { parts.push('text-decoration:line-through'); }
        else if (underline) { parts.push('text-decoration:underline'); }
        return parts.length > 0 ? parts.join(';') : '';
    }

    // ── Tokenizers ───────────────────────────────────

    function tokenizeJson5(code) {
        let i = 0;
        let out = '';
        while (i < code.length) {
            if (code[i] === '/' && code[i + 1] === '/') {
                let end = code.indexOf('\n', i);
                if (end === -1) { end = code.length; }
                out += '<span class="sh-comment">' + escapeHtml(code.slice(i, end)) + '</span>';
                i = end;
            } else if (code[i] === '/' && code[i + 1] === '*') {
                let end = code.indexOf('*/', i + 2);
                if (end === -1) { end = code.length; } else { end += 2; }
                out += '<span class="sh-comment">' + escapeHtml(code.slice(i, end)) + '</span>';
                i = end;
            } else if (code[i] === '"') {
                let j = i + 1;
                while (j < code.length && code[j] !== '"') {
                    if (code[j] === '\\') { j++; }
                    j++;
                }
                j++;
                const s = code.slice(i, j);
                if (/^(?:name|type|color|description|aliases|regex|regexFlags|affiliation|fixes)$/i.test(s.slice(1, -1))) {
                    out += '<span class="sh-key">' + escapeHtml(s) + '</span>';
                } else {
                    out += '<span class="sh-str">' + escapeHtml(s) + '</span>';
                }
                i = j;
            } else if (code[i] === "'") {
                let j = i + 1;
                while (j < code.length && code[j] !== "'") {
                    if (code[j] === '\\') { j++; }
                    j++;
                }
                j++;
                out += '<span class="sh-str">' + escapeHtml(code.slice(i, j)) + '</span>';
                i = j;
            } else if (/[0-9]/.test(code[i]) || (code[i] === '-' && /[0-9]/.test(code[i + 1]))) {
                let j = i;
                if (code[j] === '-') { j++; }
                while (j < code.length && /[0-9.]/.test(code[j])) { j++; }
                out += '<span class="sh-num">' + escapeHtml(code.slice(i, j)) + '</span>';
                i = j;
            } else if (/^(?:true|false)/.test(code.slice(i))) {
                const m = code.slice(i).match(/^(?:true|false)/)[0];
                out += '<span class="sh-bool">' + m + '</span>';
                i += m.length;
            } else if (/^null/.test(code.slice(i))) {
                out += '<span class="sh-null">null</span>';
                i += 4;
            } else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*/.test(code.slice(i))) {
                const m = code.slice(i).match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/)[0];
                if (i === 0 || /[\s,:\[{]/.test(code[i - 1])) {
                    out += '<span class="sh-key">' + escapeHtml(m) + '</span>';
                } else {
                    out += escapeHtml(m);
                }
                i += m.length;
            } else if ('{}[]'.includes(code[i])) {
                out += '<span class="sh-bracket">' + code[i] + '</span>';
                i++;
            } else if (code[i] === ':') {
                out += '<span class="sh-colon">:</span>';
                i++;
            } else if (code[i] === ',') {
                out += '<span class="sh-comma">,</span>';
                i++;
            } else {
                out += escapeHtml(code[i]);
                i++;
            }
        }
        return out;
    }

    function tokenizeToml(code) {
        const lines = code.split('\n');
        const out = [];
        for (const line of lines) {
            if (/^\s*#/.test(line)) {
                out.push('<span class="sh-toml-comment">' + escapeHtml(line) + '</span>');
            } else if (/^\s*\[\[/.test(line)) {
                out.push('<span class="sh-toml-section">' + escapeHtml(line) + '</span>');
            } else if (/^\s*\[/.test(line)) {
                out.push('<span class="sh-toml-section">' + escapeHtml(line) + '</span>');
            } else {
                const m = line.match(/^(\s*)([\w-]+)(\s*=\s*)(.*)/);
                if (m) {
                    const val = m[4].trim();
                    let valSpan;
                    if (/^["']/.test(val)) { valSpan = '<span class="sh-toml-str">' + escapeHtml(val) + '</span>'; }
                    else if (/^\d/.test(val)) { valSpan = '<span class="sh-toml-num">' + escapeHtml(val) + '</span>'; }
                    else if (/^(true|false)$/.test(val)) { valSpan = '<span class="sh-toml-bool">' + val + '</span>'; }
                    else if (/^\[/.test(val)) { valSpan = '<span class="sh-toml-bracket">' + escapeHtml(val) + '</span>'; }
                    else { valSpan = escapeHtml(val); }
                    out.push(escapeHtml(m[1]) + '<span class="sh-toml-key">' + escapeHtml(m[2]) + '</span>' + '<span class="sh-toml-eq">' + escapeHtml(m[3]) + '</span>' + valSpan);
                } else {
                    out.push(escapeHtml(line));
                }
            }
        }
        return out.join('\n');
    }

    function wrapMdMarker(text, cls) {
        return '<span class="' + (cls || 'sh-md-marker') + '">' + escapeHtml(text) + '</span>';
    }

    function tryWrapDelimited(text, start, marker, className) {
        const end = text.indexOf(marker, start + marker.length);
        if (end <= start + marker.length) { return null; }
        return {
            end,
            html: wrapMdMarker(marker)
                + '<span class="' + className + '">' + tokenizeMarkdownInline(text.slice(start + marker.length, end)) + '</span>'
                + wrapMdMarker(marker)
        };
    }

    function tryParseMdLink(text, start, isImage) {
        const prefix = isImage ? '![' : '[';
        if (!text.startsWith(prefix, start)) { return null; }
        const altStart = start + prefix.length;
        const closeBracket = text.indexOf(']', altStart);
        if (closeBracket === -1 || text[closeBracket + 1] !== '(') { return null; }
        const closeParen = text.indexOf(')', closeBracket + 2);
        if (closeParen === -1) { return null; }
        const label = text.slice(altStart, closeBracket);
        const target = text.slice(closeBracket + 2, closeParen);
        return {
            end: closeParen,
            html: (isImage ? wrapMdMarker('!') : '')
                + wrapMdMarker('[')
                + '<span class="sh-md-link-text">' + tokenizeMarkdownInline(label) + '</span>'
                + wrapMdMarker('](')
                + '<span class="sh-md-url">' + escapeHtml(target) + '</span>'
                + wrapMdMarker(')')
        };
    }

    function tokenizeMarkdownInline(text) {
        let out = '';
        let i = 0;
        while (i < text.length) {
            let parsed = tryParseMdLink(text, i, true);
            if (parsed) {
                out += parsed.html;
                i = parsed.end + 1;
                continue;
            }

            parsed = tryParseMdLink(text, i, false);
            if (parsed) {
                out += parsed.html;
                i = parsed.end + 1;
                continue;
            }

            if (text.startsWith('***', i) || text.startsWith('___', i)) {
                parsed = tryWrapDelimited(text, i, text.slice(i, i + 3), 'sh-md-bold sh-md-italic');
                if (parsed) {
                    out += parsed.html;
                    i = parsed.end + 3;
                    continue;
                }
            }

            if (text.startsWith('**', i) || text.startsWith('__', i)) {
                parsed = tryWrapDelimited(text, i, text.slice(i, i + 2), 'sh-md-bold');
                if (parsed) {
                    out += parsed.html;
                    i = parsed.end + 2;
                    continue;
                }
            }

            if (text.startsWith('~~', i)) {
                parsed = tryWrapDelimited(text, i, '~~', 'sh-md-strike');
                if (parsed) {
                    out += parsed.html;
                    i = parsed.end + 2;
                    continue;
                }
            }

            if (text[i] === '*' || text[i] === '_') {
                parsed = tryWrapDelimited(text, i, text[i], 'sh-md-italic');
                if (parsed) {
                    out += parsed.html;
                    i = parsed.end + 1;
                    continue;
                }
            }

            if (text[i] === '`') {
                parsed = tryWrapDelimited(text, i, '`', 'sh-md-code');
                if (parsed) {
                    out += parsed.html;
                    i = parsed.end + 1;
                    continue;
                }
            }

            out += escapeHtml(text[i]);
            i++;
        }
        return out;
    }

    function tokenizeMarkdownTableLine(line) {
        const indent = (line.match(/^\s*/) || [''])[0];
        const body = line.slice(indent.length);
        const cells = body.split('|');
        let out = escapeHtml(indent);
        cells.forEach((cell, index) => {
            if (index > 0) {
                out += '<span class="sh-md-table-pipe">|</span>';
            }
            if (index === 0 || index === cells.length - 1) {
                out += escapeHtml(cell);
                return;
            }
            if (/^\s*:?-{3,}:?\s*$/.test(cell)) {
                out += '<span class="sh-md-sep">' + escapeHtml(cell) + '</span>';
                return;
            }
            out += tokenizeMarkdownInline(cell);
        });
        return out;
    }

    function tokenizeMarkdown(code) {
        const lines = code.split('\n');
        const out = [];
        let inFence = false;

        for (const line of lines) {
            const fenceMatch = line.match(/^(\s*)(```|~~~)(.*)$/);
            if (fenceMatch) {
                out.push(escapeHtml(fenceMatch[1])
                    + '<span class="sh-md-marker">' + escapeHtml(fenceMatch[2]) + '</span>'
                    + (fenceMatch[3] ? '<span class="sh-md-url">' + escapeHtml(fenceMatch[3]) + '</span>' : ''));
                inFence = !inFence;
                continue;
            }

            if (inFence) {
                out.push('<span class="sh-md-plain">' + escapeHtml(line) + '</span>');
                continue;
            }

            if (/^\s*<!--.*-->\s*$/.test(line) || /^\s*%%.*%%\s*$/.test(line)) {
                out.push('<span class="sh-comment">' + escapeHtml(line) + '</span>');
                continue;
            }

            const headingMatch = line.match(/^(\s*)(#{1,6})(\s+)(.*)$/);
            if (headingMatch) {
                const headingClass = 'sh-md-h' + Math.min(4, headingMatch[2].length);
                out.push(escapeHtml(headingMatch[1])
                    + '<span class="sh-md-marker">' + escapeHtml(headingMatch[2]) + '</span>'
                    + escapeHtml(headingMatch[3])
                    + '<span class="' + headingClass + '">' + tokenizeMarkdownInline(headingMatch[4]) + '</span>');
                continue;
            }

            const quoteMatch = line.match(/^(\s*)((?:>\s*)+)(.*)$/);
            if (quoteMatch) {
                out.push(escapeHtml(quoteMatch[1])
                    + '<span class="sh-md-quote">' + escapeHtml(quoteMatch[2]) + '</span>'
                    + tokenizeMarkdownInline(quoteMatch[3]));
                continue;
            }

            const taskMatch = line.match(/^(\s*)((?:[-*+]|\d+\.))(\s+)(\[(?: |x|X)\])(\s+)(.*)$/);
            if (taskMatch) {
                out.push(escapeHtml(taskMatch[1])
                    + '<span class="sh-md-list">' + escapeHtml(taskMatch[2]) + '</span>'
                    + escapeHtml(taskMatch[3])
                    + '<span class="sh-md-marker">' + escapeHtml(taskMatch[4]) + '</span>'
                    + escapeHtml(taskMatch[5])
                    + tokenizeMarkdownInline(taskMatch[6]));
                continue;
            }

            const listMatch = line.match(/^(\s*)((?:[-*+]|\d+\.))(\s+)(.*)$/);
            if (listMatch) {
                out.push(escapeHtml(listMatch[1])
                    + '<span class="sh-md-list">' + escapeHtml(listMatch[2]) + '</span>'
                    + escapeHtml(listMatch[3])
                    + tokenizeMarkdownInline(listMatch[4]));
                continue;
            }

            if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) {
                out.push('<span class="sh-md-sep">' + escapeHtml(line) + '</span>');
                continue;
            }

            const defMatch = line.match(/^(\s*)(&Def)(\s+)([^=]+?)(\s*=\s*)(.*)$/);
            if (defMatch) {
                out.push(escapeHtml(defMatch[1])
                    + '<span class="sh-md-meta">' + escapeHtml(defMatch[2]) + '</span>'
                    + escapeHtml(defMatch[3])
                    + '<span class="sh-key">' + escapeHtml(defMatch[4]) + '</span>'
                    + '<span class="sh-punct">' + escapeHtml(defMatch[5]) + '</span>'
                    + '<span class="sh-str">' + tokenizeMarkdownInline(defMatch[6]) + '</span>');
                continue;
            }

            const dialogueMatch = line.match(/^(\s*)(@[^:\[]+)(\[[^\]]+\])?(:\s*)(.*)$/);
            if (dialogueMatch) {
                out.push(escapeHtml(dialogueMatch[1])
                    + '<span class="sh-md-meta">' + escapeHtml(dialogueMatch[2]) + '</span>'
                    + (dialogueMatch[3] ? '<span class="sh-md-marker">' + escapeHtml(dialogueMatch[3]) + '</span>' : '')
                    + '<span class="sh-md-marker">' + escapeHtml(dialogueMatch[4]) + '</span>'
                    + tokenizeMarkdownInline(dialogueMatch[5]));
                continue;
            }

            if (/^\s*\|.*\|\s*$/.test(line)) {
                out.push(tokenizeMarkdownTableLine(line));
                continue;
            }

            out.push(tokenizeMarkdownInline(line));
        }

        return out.join('\n');
    }

    function tokenizeMdRole(code) {
        const lines = code.split('\n');
        const out = [];
        let inColorBlock = false;
        for (let li = 0; li < lines.length; li++) {
            const line = lines[li];
            const h3m = line.match(/^###\s+(.+)/);
            if (h3m) {
                const field = h3m[1].trim();
                const cls = /^颜色|^color/i.test(field) ? 'sh-md-h3' : 'sh-role-field';
                out.push('<span class="' + cls + '">' + escapeHtml(line) + '</span>');
                inColorBlock = /^颜色|^color/i.test(field);
            } else if (/^##\s+/.test(line)) {
                const roleName = line.slice(3).trim();
                const roleData = mdRoleIndex[roleName];
                if (roleData) {
                    const decoStyle = buildDecoStyle(roleData);
                    const extra = decoStyle ? ' style="' + escapeHtml(decoStyle) + '"' : '';
                    out.push('<span class="sh-md-h2 sh-role-name" data-role="' + escapeHtml(roleName) + '"' + extra + '>' + escapeHtml(line) + '</span>');
                } else {
                    out.push('<span class="sh-md-h2">' + escapeHtml(line) + '</span>');
                }
                inColorBlock = false;
            } else if (/^#\s+/.test(line)) {
                out.push('<span class="sh-md-h1">' + escapeHtml(line) + '</span>');
            } else if (inColorBlock && line.trim()) {
                const c = line.trim();
                if (/^#[0-9a-fA-F]{3,8}$/.test(c) || /^rgb/i.test(c) || /^hsl/i.test(c)) {
                    out.push('<span class="sh-role-value" style="color:' + escapeHtml(c) + ';font-weight:bold">' + escapeHtml(line) + '</span>');
                } else {
                    out.push('<span class="sh-role-value">' + escapeHtml(line) + '</span>');
                }
            } else if (/^[-*+]\s/.test(line) || /^\d+\.\s/.test(line)) {
                out.push('<span class="sh-md-list">' + escapeHtml(line) + '</span>');
            } else {
                out.push('<span class="sh-role-value">' + escapeHtml(line) + '</span>');
            }
        }
        return out.join('\n');
    }

    function tokenizeCsv(code) {
        const lines = code.split('\n');
        const out = [];
        for (let li = 0; li < lines.length; li++) {
            const line = lines[li];
            if (li === 0 && /[a-zA-Z一-鿿]/.test(line)) {
                out.push('<span class="sh-csv-header">' + escapeHtml(line) + '</span>');
            } else {
                const parts = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
                const highlighted = parts.map(p => {
                    if (/^["']/.test(p)) { return '<span class="sh-csv-str">' + escapeHtml(p) + '</span>'; }
                    if (/^#[0-9a-fA-F]{3,8}$/.test(p)) { return '<span class="sh-str" style="color:' + escapeHtml(p) + '">' + escapeHtml(p) + '</span>'; }
                    return escapeHtml(p);
                });
                out.push(highlighted.join('<span class="sh-csv-sep">,</span>'));
            }
        }
        return out.join('\n');
    }

    function tokenizeJs(code) {
        const keywords = ['export', 'import', 'default', 'async', 'function', 'const', 'let', 'var', 'return', 'if', 'else', 'for', 'while', 'try', 'catch', 'throw', 'new', 'typeof', 'await'];
        let i = 0;
        let out = '';
        while (i < code.length) {
            if (code[i] === '/' && code[i + 1] === '/') {
                let end = code.indexOf('\n', i);
                if (end === -1) { end = code.length; }
                out += '<span class="sh-js-comment">' + escapeHtml(code.slice(i, end)) + '</span>';
                i = end;
            } else if (code[i] === '/' && code[i + 1] === '*') {
                let end = code.indexOf('*/', i + 2);
                if (end === -1) { end = code.length; } else { end += 2; }
                out += '<span class="sh-js-comment">' + escapeHtml(code.slice(i, end)) + '</span>';
                i = end;
            } else if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
                const q = code[i];
                let j = i + 1;
                while (j < code.length && code[j] !== q) {
                    if (code[j] === '\\') { j++; }
                    j++;
                }
                j++;
                out += '<span class="sh-js-str">' + escapeHtml(code.slice(i, j)) + '</span>';
                i = j;
            } else if (/[a-zA-Z_$]/.test(code[i])) {
                let j = i;
                while (j < code.length && /[a-zA-Z0-9_$]/.test(code[j])) { j++; }
                const w = code.slice(i, j);
                if (keywords.includes(w)) {
                    out += '<span class="sh-js-kw">' + w + '</span>';
                } else if (code[j] === '(') {
                    out += '<span class="sh-js-func">' + escapeHtml(w) + '</span>';
                } else if (/^[A-Z]/.test(w)) {
                    out += '<span class="sh-js-const">' + escapeHtml(w) + '</span>';
                } else {
                    out += '<span class="sh-js-prop">' + escapeHtml(w) + '</span>';
                }
                i = j;
            } else if (/[0-9]/.test(code[i])) {
                let j = i;
                while (j < code.length && /[0-9.]/.test(code[j])) { j++; }
                out += '<span class="sh-js-num">' + escapeHtml(code.slice(i, j)) + '</span>';
                i = j;
            } else if ('{}[](),;.'.includes(code[i])) {
                out += '<span class="sh-js-punct">' + escapeHtml(code[i]) + '</span>';
                i++;
            } else {
                out += escapeHtml(code[i]);
                i++;
            }
        }
        return out;
    }

    function tokenize(text, lang) {
        switch (lang) {
            case 'json5': return tokenizeJson5(text);
            case 'toml': return tokenizeToml(text);
            case 'markdown': return tokenizeMarkdown(text);
            case 'md-role': return tokenizeMdRole(text);
            case 'csv': return tokenizeCsv(text);
            case 'js': return tokenizeJs(text);
            default: return escapeHtml(text);
        }
    }

    // ── Role Parsing ─────────────────────────────────

    let mdRoleIndex = {};

    function resolveColor(role) {
        const s = role.fields;
        return s.color || s.颜色 || typeColorMap[s.type] || null;
    }

    function parseMdRoles(code) {
        const lines = code.split('\n');
        let currentRole = null;
        const roles = [];
        let fields = {};

        function flushRole() {
            if (currentRole) {
                roles.push({ name: currentRole, fields: { ...fields } });
            }
        }

        for (let i = 0; i < lines.length; i++) {
            const h2 = lines[i].match(/^##\s+(.+)/);
            if (h2) {
                flushRole();
                currentRole = h2[1].trim();
                fields = {};
            } else if (currentRole) {
                const h3 = lines[i].match(/^###\s+(.+)/);
                if (h3) {
                    const field = h3[1].trim();
                    let val = '';
                    if (i + 1 < lines.length && !lines[i + 1].match(/^#{2,3}\s/) && lines[i + 1].trim()) {
                        val = lines[i + 1].trim();
                    }
                    fields[field] = val;
                }
            }
        }
        flushRole();
        return roles.length > 0 ? roles : null;
    }

    function parseJson5Roles(code) {
        try {
            const cleaned = code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
            const data = JSON.parse(cleaned);
            let arr = Array.isArray(data) ? data : data.roles || data.characters || Object.entries(data).map(([k, v]) => (typeof v === 'object' && v ? { name: k, ...v } : null)).filter(Boolean);
            return arr.filter(r => r && r.name).map(r => {
                const aliasList = Array.isArray(r.aliases) ? r.aliases : (r.aliases ? [r.aliases] : []);
                const style = r.style || {};
                return {
                    name: r.name,
                    fields: {
                        type: r.type || '',
                        color: r.color || style.color || '',
                        backgroundColor: r.backgroundColor || style.backgroundColor || '',
                        bold: r.bold ?? style.bold ?? false,
                        italic: r.italic ?? style.italic ?? false,
                        strikethrough: r.strikethrough ?? style.strikethrough ?? false,
                        underline: r.underline ?? style.underline ?? false,
                        affiliation: r.affiliation || '',
                        aliases: aliasList.join(', '),
                        aliasList: aliasList,
                        description: r.description || ''
                    }
                };
            });
        } catch { return null; }
    }

    function parseTomlRoles(code) {
        const roles = [];
        const blocks = code.split(/\[\[roles?\]\]/);
        for (let i = 1; i < blocks.length; i++) {
            const block = blocks[i];
            const fields = {};
            for (const line of block.split('\n')) {
                const m = line.match(/^([\w-]+)\s*=\s*(.+)/);
                if (m) {
                    let val = m[2].trim();
                    if (/^["']/.test(val)) { val = val.slice(1, -1); }
                    else if (/^\[/.test(val)) { val = val.slice(1, -1).replace(/["']/g, ''); }
                    fields[m[1]] = val;
                }
            }
            if (fields.name) {
                roles.push({
                    name: fields.name,
                    fields: {
                        type: fields.type || '',
                        color: fields.color || '',
                        affiliation: fields.affiliation || '',
                        aliases: fields.aliases || '',
                        aliasList: (fields.aliases || '').split(/[,;，]/).map(s => s.trim()).filter(Boolean),
                        description: fields.description || ''
                    }
                });
            }
        }
        return roles.length > 0 ? roles : null;
    }

    // ── Tooltip Markdown Renderer ────────────────────

    function renderTooltipMd(text) {
        if (!text) { return ''; }
        let out = escapeHtml(text);
        // `code`
        out = out.replace(/`([^`]+)`/g, '<code style="color:var(--vscode-textPreformat-foreground, var(--vscode-editor-foreground));background:var(--vscode-textCodeBlock-background, var(--vscode-textBlockQuote-background));padding:1px 4px;border-radius:3px;font-size:11px;font-family:var(--vscode-editor-font-family);">$1</code>');
        // **bold**
        out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // *italic*
        out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
        // ~~strikethrough~~
        out = out.replace(/~~(.+?)~~/g, '<del>$1</del>');
        // ![](uri)
        out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="vertical-align:middle;border-radius:2px;">');
        // [text](url)
        out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
        // newlines → breaks
        out = out.replace(/\n\n/g, '</div><div style="margin-top:4px;">');
        out = out.replace(/\n/g, '<br>');
        return out;
    }

    // ── Hover Tooltip ────────────────────────────────

    let tooltipEl = null;

    function ensureTooltip() {
        if (tooltipEl) { return; }
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'role-tooltip';
        tooltipEl.style.cssText = 'display:none;position:fixed;z-index:10000;padding:10px 14px;border-radius:6px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-editorWidget-border);box-shadow:0 4px 16px rgba(0,0,0,0.3);font-size:12px;max-width:340px;pointer-events:none;line-height:1.6;font-family:var(--vscode-font-family);';
        document.body.appendChild(tooltipEl);
    }

    function buildColorSvgDataUri(c) {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="' + c + '"/></svg>';
        return 'data:image/svg+xml;base64,' + btoa(svg);
    }

    function showTooltip(el, role) {
        ensureTooltip();
        const s = role.fields;
        const color = resolveColor(role);
        const type = s.type || '';
        const desc = s.description || s.描述 || '';
        const affiliation = s.affiliation || s.从属 || '';
        const aliases = s.aliases || s.别名 || '';
        const bg = s.backgroundColor || s.backgroundcolor || s.背景色 || '';
        const bold = s.bold === true || s.bold === 'true' || s.粗体 === true;
        const italic = s.italic === true || s.italic === 'true' || s.斜体 === true;
        const strike = s.strikethrough === true || s.strikethrough === 'true' || s.删除线 === true;
        const underline = s.underline === true || s.underline === 'true' || s.下划线 === true;

        let html = '';

        const codeStyle = 'color:var(--vscode-textPreformat-foreground, var(--vscode-editor-foreground));background:var(--vscode-textCodeBlock-background, var(--vscode-textBlockQuote-background));padding:1px 4px;border-radius:3px;font-size:11px;font-family:var(--vscode-editor-font-family);';

        // Header: color swatch + name
        html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">';
        if (color) {
            html += '<img src="' + buildColorSvgDataUri(color) + '" width="16" height="16" style="border-radius:2px">';
        }
        html += '<strong style="font-size:13px;">' + escapeHtml(role.name) + '</strong>';
        if (type) {
            html += '<span style="color:var(--vscode-descriptionForeground);font-size:11px;">' + escapeHtml(type) + '</span>';
        }
        html += '</div>';

        // Description (supports full markdown)
        if (desc) {
            html += '<div style="margin-bottom:4px;">' + renderTooltipMd(desc) + '</div>';
        }

        // Type line
        if (type) {
            html += '<div style="color:var(--vscode-descriptionForeground);"><strong>类型</strong>: ' + escapeHtml(type) + '</div>';
        }

        // Affiliation
        if (affiliation) {
            html += '<div style="color:var(--vscode-descriptionForeground);"><strong>从属</strong>: ' + escapeHtml(affiliation) + '</div>';
        }

        // Aliases
        if (aliases) {
            html += '<div style="color:var(--vscode-descriptionForeground);"><strong>别名</strong>: <code style="' + codeStyle + '">' + escapeHtml(aliases) + '</code></div>';
        }

        // Style info
        const styleParts = [];
        if (color) { styleParts.push('前景色: <code style="' + codeStyle + '">' + escapeHtml(color) + '</code>'); }
        if (bg) { styleParts.push('背景色: <code style="' + codeStyle + '">' + escapeHtml(bg) + '</code>'); }
        if (bold) { styleParts.push('粗体'); }
        if (italic) { styleParts.push('斜体'); }
        if (strike) { styleParts.push('删除线'); }
        if (underline) { styleParts.push('下划线'); }
        if (styleParts.length > 0) {
            html += '<div style="color:var(--vscode-descriptionForeground);"><strong>样式</strong>: ' + styleParts.join('，') + '</div>';
        }

        // Color swatch
        if (color) {
            html += '<div style="color:var(--vscode-descriptionForeground);margin-top:2px;"><strong>颜色</strong>: <img src="' + buildColorSvgDataUri(color) + '" width="16" height="16" style="vertical-align:middle;border-radius:2px"> <code style="' + codeStyle + '">' + escapeHtml(color) + '</code></div>';
        }

        tooltipEl.innerHTML = html;
        tooltipEl.style.display = 'block';

        const rect = el.getBoundingClientRect();
        const tipW = tooltipEl.offsetWidth;
        const tipH = tooltipEl.offsetHeight;
        let left = rect.left;
        let top = rect.bottom + 4;
        if (left + tipW > window.innerWidth - 8) { left = window.innerWidth - tipW - 8; }
        if (left < 8) { left = 8; }
        if (top + tipH > window.innerHeight - 8) { top = rect.top - tipH - 4; }
        tooltipEl.style.left = left + 'px';
        tooltipEl.style.top = top + 'px';
    }

    function hideTooltip() {
        if (tooltipEl) { tooltipEl.style.display = 'none'; }
    }

    // ── Code Block Highlighting ──────────────────────

    function highlightCodeBlocks(container) {
        const blocks = container.querySelectorAll('pre > code');
        const docRoles = [];

        // Pass 1: collect all roles from the whole document
        blocks.forEach(codeEl => {
            const raw = codeEl.textContent || '';
            const lang = detectLang(raw);
            let roles = null;
            if (lang === 'md-role') { roles = parseMdRoles(raw); }
            else if (lang === 'json5') { roles = parseJson5Roles(raw); }
            else if (lang === 'toml') { roles = parseTomlRoles(raw); }
            if (roles) { docRoles.push(...roles); }
        });

        // Pass 2: tokenize code blocks, highlight role names in prose blocks
        blocks.forEach(codeEl => {
            const raw = codeEl.textContent || '';
            const lang = detectLang(raw);

            if (lang === 'text') {
                if (docRoles.length > 0) {
                    codeEl.innerHTML = highlightProseRoles(raw, docRoles);
                    attachHover(codeEl, docRoles);
                }
                return;
            }

            // Build per-block role index for md-role tokenizer
            let roles = null;
            if (lang === 'md-role') { roles = parseMdRoles(raw); }
            else if (lang === 'json5') { roles = parseJson5Roles(raw); }
            else if (lang === 'toml') { roles = parseTomlRoles(raw); }

            mdRoleIndex = {};
            if (roles) {
                for (const r of roles) { mdRoleIndex[r.name] = r; }
            }

            // Tokenize
            codeEl.innerHTML = tokenize(raw, lang);

            // After tokenizing, find and highlight role name strings + aliases in JSON5/TOML/CSV blocks
            if (roles && roles.length > 0 && (lang === 'json5' || lang === 'toml' || lang === 'csv')) {
                applyRoleNameHighlights(codeEl, roles);
            }

            // Add hover to role names in md-role blocks
            if (roles && roles.length > 0) {
                attachHover(codeEl, roles);
            }
        });
    }

    // Highlight role names and aliases that appear as string values in tokenized code
    function applyRoleNameHighlights(codeEl, roles) {
        // Build set of all names + aliases
        const nameSet = new Map(); // text -> role
        for (const r of roles) {
            nameSet.set(r.name, r);
            const aliasList = r.fields.aliasList || [];
            for (const a of aliasList) {
                if (a && !nameSet.has(a)) { nameSet.set(a, r); }
            }
        }
        // Sort by length descending
        const sorted = [...nameSet.entries()].sort((a, b) => b[0].length - a[0].length);
        if (sorted.length === 0) { return; }

        // Find all sh-str spans (string values) and check if their content matches a role name
        codeEl.querySelectorAll('.sh-str, .sh-csv-str').forEach(span => {
            const text = span.textContent;
            // Strip quotes
            const unquoted = text.replace(/^['"]|['"]$/g, '');
            for (const [name, role] of sorted) {
                if (unquoted === name) {
                    const decoStyle = buildDecoStyle(role);
                    const cls = 'sh-role-name';
                    const extra = decoStyle ? ' style="background:transparent;' + escapeHtml(decoStyle) + '"' : '';
                    span.outerHTML = '<span class="' + cls + '" data-role="' + escapeHtml(name) + '"' + extra + '>' + escapeHtml(text) + '</span>';
                    break;
                }
            }
        });
    }

    // Attach hover handlers to all .sh-role-name and .sh-prose-role elements
    function attachHover(container, roles) {
        container.querySelectorAll('.sh-role-name, .sh-prose-role').forEach(el => {
            const name = el.dataset.role;
            const role = roles.find(r => r.name === name);
            if (!role) { return; }
            el.style.cursor = 'pointer';
            if (!el.style.textDecoration && !el.style.fontWeight) {
                el.style.borderBottom = '1px dotted currentColor';
            }
            el.addEventListener('mouseenter', () => showTooltip(el, role));
            el.addEventListener('mouseleave', hideTooltip);
        });
    }

    // Default regex rules from workspace init (punctuation coloring)
    const DEFAULT_REGEX_RULES = [
        { pattern: '"[^"]*"', color: 'var(--sh-prose-dialogue-double)' },
        { pattern: '「[^」]*」', color: 'var(--sh-prose-dialogue-corner)' },
        { pattern: "'[^']*'", color: 'var(--sh-prose-thought-single)' },
        { pattern: '《[^》]*》', color: 'var(--sh-prose-book-title)' }
    ];

    function highlightProseRoles(text, roles) {
        const nameMap = new Map();
        for (const r of roles) {
            nameMap.set(r.name, r);
            const aliasList = r.fields.aliasList || [];
            for (const a of aliasList) {
                if (a && !nameMap.has(a)) { nameMap.set(a, r); }
            }
        }

        // Collect all matches: role names (priority 2) + regex patterns (priority 1)
        const allMatches = [];

        const sortedNames = [...nameMap.entries()].sort((a, b) => b[0].length - a[0].length);
        for (const [name, role] of sortedNames) {
            const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
            let m;
            while ((m = re.exec(text)) !== null) {
                allMatches.push({ index: m.index, length: m[0].length, type: 'role', name: name, role: role });
            }
        }

        for (const rule of DEFAULT_REGEX_RULES) {
            const re = new RegExp(rule.pattern, 'g');
            let m;
            while ((m = re.exec(text)) !== null) {
                allMatches.push({ index: m.index, length: m[0].length, type: 'regex', text: m[0], color: rule.color });
            }
        }

        if (allMatches.length === 0) { return escapeHtml(text); }

        // Sort by position, then role names before regex patterns
        allMatches.sort(function (a, b) {
            if (a.index !== b.index) { return a.index - b.index; }
            return (b.type === 'role' ? 1 : 0) - (a.type === 'role' ? 1 : 0);
        });

        // Filter overlapping (first wins)
        const filtered = [];
        let lastEnd = 0;
        for (const m of allMatches) {
            if (m.index >= lastEnd) {
                filtered.push(m);
                lastEnd = m.index + m.length;
            }
        }

        let out = '';
        let lastIdx = 0;
        for (const m of filtered) {
            out += escapeHtml(text.slice(lastIdx, m.index));
            if (m.type === 'role') {
                const decoStyle = buildDecoStyle(m.role);
                const extra = decoStyle ? ' style="' + escapeHtml(decoStyle) + '"' : '';
                out += '<span class="sh-prose-role" data-role="' + escapeHtml(m.name) + '"' + extra + '>' + escapeHtml(m.name) + '</span>';
            } else {
                out += '<span style="color:' + m.color + ';">' + escapeHtml(m.text) + '</span>';
            }
            lastIdx = m.index + m.length;
        }
        out += escapeHtml(text.slice(lastIdx));
        return out;
    }

    // ── Doc Reference Links ─────────────────────────

    const REGEX_FILE_CONTENT = [
        '[',
        '  {',
        "    name: '中文对话',",
        "    type: '正则表达式',",
        "    regex: '\"[^\"]*\"',",
        "    regexFlags: 'g',",
        "    color: '#fbdc98ff',",
        '    priority: 100,',
        "    description: '匹配中文引号内的对话内容',",
        '  },',
        '  {',
        "    name: '中文对话2',",
        "    type: '正则表达式',",
        "    regex: '「[^」]*」',",
        "    regexFlags: 'g',",
        "    color: '#fbdc98ff',",
        '    priority: 100,',
        "    description: '匹配中文引号内的对话内容',",
        '  },',
        '  {',
        "    name: '中文思考',",
        "    type: '正则表达式',",
        "    regex: \"'[^']*'\",",
        "    regexFlags: 'g',",
        "    color: '#98bbfbff',",
        '    priority: 95,',
        "    description: '匹配中文引号内的对话内容',",
        '  },',
        '  {',
        "    name: '书名号',",
        "    type: '正则表达式',",
        "    regex: '《[^》]*》',",
        "    regexFlags: 'g',",
        "    color: '#fbbc98ff',",
        '    priority: 90,',
        "    description: '匹配书名号内的内容',",
        '  },',
        ']'
    ].join('\n');

    function attachDocRefLinks(container) {
        container.querySelectorAll('.doc-ref-link').forEach(function (link) {
            link.addEventListener('click', function (e) {
                e.preventDefault();
                hideTooltip();
                var docId = link.dataset.doc;
                if (docId && docsData[docId]) { loadDoc(docId); }
            });

            if (link.dataset.tooltip === 'regex') {
                link.addEventListener('mouseenter', function () {
                    ensureTooltip();
                    var highlighted = tokenizeJson5(REGEX_FILE_CONTENT);
                    tooltipEl.innerHTML = '<div style="margin-bottom:4px;font-size:11px;color:var(--vscode-descriptionForeground);">regex-patterns.json5</div>'
                        + '<pre style="margin:0;padding:8px;border-radius:4px;color:var(--vscode-textPreformat-foreground, var(--vscode-editor-foreground));background:var(--vscode-textCodeBlock-background, var(--vscode-textBlockQuote-background));border:1px solid var(--vscode-panel-border);overflow-x:auto;font-size:12px;line-height:1.5;max-height:300px;overflow-y:auto;">'
                        + '<code style="font-family:var(--vscode-editor-font-family);">' + highlighted + '</code></pre>';
                    tooltipEl.style.display = 'block';

                    var rect = link.getBoundingClientRect();
                    var tipW = tooltipEl.offsetWidth;
                    var tipH = tooltipEl.offsetHeight;
                    var left = rect.left;
                    var top = rect.bottom + 4;
                    if (left + tipW > window.innerWidth - 8) { left = window.innerWidth - tipW - 8; }
                    if (left < 8) { left = 8; }
                    if (top + tipH > window.innerHeight - 8) { top = rect.top - tipH - 4; }
                    tooltipEl.style.left = left + 'px';
                    tooltipEl.style.top = top + 'px';
                });
                link.addEventListener('mouseleave', hideTooltip);
            }
        });
    }

    // ── Completion Demo Animation ───────────────────

    let _demoRunning = false;
    let _demoTimers = [];

    function stopCompletionDemo() {
        _demoRunning = false;
        for (const t of _demoTimers) { clearTimeout(t); }
        _demoTimers = [];
    }

    function _ddelay(ms) {
        return new Promise(function (r) {
            const t = setTimeout(r, ms);
            _demoTimers.push(t);
        });
    }

    function initCompletionDemo(root) {
        const typed = root.querySelector('#demoTyped');
        const suggest = root.querySelector('#demoSuggest');
        const status = root.querySelector('#demoStatus');
        const modeBar = root.querySelector('.demo-mode-bar');
        if (!typed || !suggest || !status) { return; }

        const ROLE = { name: '林小满', alias: '小满', type: '主角', color: '#FF6B6B' };
        const ROLE_OBJ = {
            name: ROLE.name,
            fields: {
                type: ROLE.type, color: ROLE.color, description: '一个喜欢雨天咖啡店的女孩。',
                affiliation: '', aliases: ROLE.alias, aliasList: [ROLE.alias],
                backgroundColor: '', bold: false, italic: false, strikethrough: false, underline: false
            }
        };
        const DECO_STYLE = 'color:' + ROLE.color + ';font-weight:bold;';

        var validModes = ['loose', 'startsWith', 'symbolLoose', 'symbolStartsWith'];
        var initialMode = (window.__SETTINGS__ && window.__SETTINGS__.triggerMode) || 'loose';
        if (validModes.indexOf(initialMode) === -1) { initialMode = 'loose'; }
        let currentMode = initialMode;

        if (modeBar) {
            modeBar.querySelectorAll('.demo-mode-btn').forEach(function (b) {
                b.classList.toggle('active', b.dataset.mode === currentMode);
            });
        }

        function buildWidget(items, selIdx) {
            return items.map(function (it, i) {
                const sel = i === selIdx ? ' selected' : '';
                const iconBg = it.color || 'var(--vscode-descriptionForeground)';
                const labelStyle = it.color ? 'color:' + it.color + ';font-weight:bold;' : '';
                return '<div class="demo-suggest-item' + sel + '">'
                    + '<div style="width:16px;height:16px;border-radius:2px;background:' + iconBg + ';flex-shrink:0;"></div>'
                    + '<span class="demo-suggest-label" style="' + labelStyle + '">' + escapeHtml(it.label) + '</span>'
                    + '<span class="demo-suggest-detail">' + escapeHtml(it.detail || '') + '</span>'
                    + '</div>';
            }).join('');
        }

        function coloredName(name) {
            return '<span class="sh-prose-role" data-role="' + escapeHtml(name) + '" style="' + DECO_STYLE + ';cursor:pointer;border-bottom:1px dotted currentColor;">' + escapeHtml(name) + '</span>';
        }

        function setTyped(html) {
            typed.innerHTML = html;
        }

        function attachRoleHover(el) {
            el.addEventListener('mouseenter', function () { showTooltip(el, ROLE_OBJ); });
            el.addEventListener('mouseleave', hideTooltip);
        }

        function insertColored(name) {
            setTyped(coloredName(name));
            attachRoleHover(typed.querySelector('.sh-prose-role'));
        }

        // ── loose: 输入任意字符，包含匹配 ──
        async function runLoose() {
            setTyped('');
            suggest.style.display = 'none';
            suggest.innerHTML = '';
            status.textContent = 'loose 模式：输入任意字符，模糊匹配角色名';
            await _ddelay(600);

            setTyped('林');
            status.textContent = '输入 "林"，名字包含"林"的角色都会出现';
            await _ddelay(400);

            suggest.innerHTML = buildWidget([
                { label: ROLE.name, detail: ROLE.type, color: ROLE.color }
            ], 0);
            suggest.style.display = 'block';
            await _ddelay(1500);

            suggest.style.display = 'none';
            insertColored(ROLE.name);
            status.textContent = '✓ 包含匹配——"' + ROLE.name + '" 含有"林"，自动着色';
            await _ddelay(1500);

            status.textContent = '继续写作，名字颜色会保留...';
            const prefix = typed.innerHTML;
            const rest = '推开咖啡店的门。';
            let i = 0;
            while (i < rest.length && _demoRunning) {
                typed.innerHTML = prefix + escapeHtml(rest.slice(0, i + 1));
                i++;
                await _ddelay(40);
            }
            await _ddelay(1200);
        }

        // ── startsWith: 输入字符，前缀匹配 ──
        async function runStartsWith() {
            setTyped('');
            suggest.style.display = 'none';
            suggest.innerHTML = '';
            status.textContent = 'startsWith 模式：输入字符，前缀匹配角色名';
            await _ddelay(600);

            setTyped('满');
            status.textContent = '输入 "满"——没有角色名以"满"开头';
            await _ddelay(500);

            suggest.innerHTML = '<div style="padding:6px 8px;color:var(--vscode-descriptionForeground);font-size:12px;">无匹配项</div>';
            suggest.style.display = 'block';
            await _ddelay(1200);

            suggest.style.display = 'none';
            setTyped('');
            await _ddelay(300);

            setTyped('林');
            status.textContent = '换成 "林"——"' + ROLE.name + '" 以"林"开头，匹配成功';
            await _ddelay(400);

            suggest.innerHTML = buildWidget([
                { label: ROLE.name, detail: ROLE.type, color: ROLE.color }
            ], 0);
            suggest.style.display = 'block';
            await _ddelay(1500);

            suggest.style.display = 'none';
            insertColored(ROLE.name);
            status.textContent = '✓ 前缀匹配——名字必须以输入字符开头';
            await _ddelay(1500);
        }

        // ── symbolLoose: @ 触发，模糊匹配 ──
        async function runSymbolLoose() {
            setTyped('');
            suggest.style.display = 'none';
            suggest.innerHTML = '';
            status.textContent = 'symbolLoose 模式：输入 @ 触发补全';
            await _ddelay(600);

            setTyped('@');
            status.textContent = '输入 @ 后，所有角色都会出现';
            await _ddelay(400);

            suggest.innerHTML = buildWidget([
                { label: ROLE.name, detail: ROLE.type, color: ROLE.color },
                { label: ROLE.alias, detail: '别名 → ' + ROLE.name, color: ROLE.color }
            ], 0);
            suggest.style.display = 'block';
            await _ddelay(1500);

            suggest.style.display = 'none';
            insertColored(ROLE.name);
            status.textContent = '✓ @ 被自动替换，角色名"' + ROLE.name + '"着色插入';
            await _ddelay(1500);
        }

        // ── symbolStartsWith: @ 触发，前缀匹配，逐字过滤 ──
        async function runSymbolStartsWith() {
            setTyped('');
            suggest.style.display = 'none';
            suggest.innerHTML = '';
            status.textContent = 'symbolStartsWith 模式：输入 @ 触发，前缀匹配';
            await _ddelay(600);

            setTyped('@');
            status.textContent = '输入 @ 后，所有角色都会出现';
            await _ddelay(400);

            suggest.innerHTML = buildWidget([
                { label: ROLE.name, detail: ROLE.type, color: ROLE.color },
                { label: ROLE.alias, detail: '别名 → ' + ROLE.name, color: ROLE.color }
            ], -1);
            suggest.style.display = 'block';
            await _ddelay(1200);

            setTyped('@' + '小');
            status.textContent = '继续输入 "小"，列表实时过滤';
            suggest.innerHTML = buildWidget([
                { label: ROLE.alias, detail: '别名 → ' + ROLE.name, color: ROLE.color }
            ], 0);
            await _ddelay(1200);

            suggest.style.display = 'none';
            insertColored(ROLE.alias);
            status.textContent = '✓ @ 前缀匹配——"小满"以"小"开头，' + ROLE.alias + '着色插入';
            await _ddelay(1500);
        }

        var modeAnimations = {
            loose: runLoose,
            startsWith: runStartsWith,
            symbolLoose: runSymbolLoose,
            symbolStartsWith: runSymbolStartsWith
        };

        async function runLoop() {
            _demoRunning = true;
            while (_demoRunning) {
                await modeAnimations[currentMode]();
                if (!_demoRunning) { break; }
                await _ddelay(2000);
            }
        }

        if (modeBar) {
            modeBar.addEventListener('click', function (e) {
                var btn = e.target.closest('.demo-mode-btn');
                if (!btn) { return; }
                var mode = btn.dataset.mode;
                if (!mode || mode === currentMode) { return; }
                currentMode = mode;
                modeBar.querySelectorAll('.demo-mode-btn').forEach(function (b) {
                    b.classList.toggle('active', b.dataset.mode === mode);
                });
                stopCompletionDemo();
                runLoop();
            });
        }

        if (typeof IntersectionObserver !== 'undefined') {
            var obs = new IntersectionObserver(function (entries) {
                if (entries.some(function (e) { return e.isIntersecting; })) {
                    if (!_demoRunning) { runLoop(); }
                } else {
                    stopCompletionDemo();
                }
            });
            obs.observe(root);
        } else {
            runLoop();
        }
    }

    // ── Build Navigation ─────────────────────────────

    function buildNav() {
        const categories = {};
        for (const [id, doc] of Object.entries(docsData)) {
            if (!categories[doc.categoryId]) {
                categories[doc.categoryId] = {
                    title: doc.category,
                    items: []
                };
            }
            categories[doc.categoryId].items.push({ id, title: doc.title });
        }

        navTree.innerHTML = '';
        for (const [catId, cat] of Object.entries(categories)) {
            const catDiv = document.createElement('div');
            catDiv.className = 'nav-category';
            catDiv.dataset.category = catId;

            const titleDiv = document.createElement('div');
            titleDiv.className = 'nav-category-title';
            titleDiv.textContent = cat.title;
            catDiv.appendChild(titleDiv);

            for (const item of cat.items) {
                const navItem = document.createElement('div');
                navItem.className = 'nav-item';
                navItem.dataset.id = item.id;
                navItem.textContent = item.title;
                navItem.addEventListener('click', () => loadDoc(item.id));
                catDiv.appendChild(navItem);
            }

            navTree.appendChild(catDiv);
        }
    }

    // ── Load Document ────────────────────────────────

    function loadDoc(docId) {
        const doc = docsData[docId];
        if (!doc) { return; }

        stopCompletionDemo();
        hideTooltip();

        currentDocId = docId;
        docTitle.textContent = doc.title;
        docContent.innerHTML = doc.html;
        docContent.classList.add('mode-' + currentMode);
        backBtn.style.display = '';
        releaseDocsBtn.style.display = '';

        navTree.querySelectorAll('.nav-item').forEach(el => {
            el.classList.toggle('active', el.dataset.id === docId);
        });

        highlightCodeBlocks(docContent);

        attachDocRefLinks(docContent);

        const demoEl = docContent.querySelector('.completion-demo');
        if (demoEl) { initCompletionDemo(demoEl); }

        docContent.scrollTop = 0;
        persistState();
    }

    // ── Search / Filter ──────────────────────────────

    function filterNav() {
        const query = (searchInput.value || '').toLowerCase().trim();
        const items = navTree.querySelectorAll('.nav-item');
        const cats = navTree.querySelectorAll('.nav-category');

        items.forEach(item => {
            const id = item.dataset.id;
            const doc = docsData[id];
            const text = (doc.title + ' ' + id).toLowerCase();
            item.classList.toggle('hidden', query && text.indexOf(query) === -1);
        });

        cats.forEach(cat => {
            const visibleItems = cat.querySelectorAll('.nav-item:not(.hidden)');
            cat.style.display = visibleItems.length === 0 && query ? 'none' : '';
        });
    }

    searchInput.addEventListener('input', filterNav);
    searchInput.addEventListener('input', persistState);

    // ── Back Button ──────────────────────────────────

    backBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'openGuide' });
    });

    // ── Release Docs Button ──────────────────────────

    releaseDocsBtn.addEventListener('click', () => {
        if (!currentDocId) { return; }
        vscode.postMessage({ command: 'releaseDocs', docId: currentDocId });
    });

    // ── Message Handler ──────────────────────────────

    window.addEventListener('message', event => {
        const msg = event.data || {};
        if (msg.command === 'loadDoc' && msg.docId) {
            loadDoc(msg.docId);
        } else if (msg.command === 'themeColors' && msg.colors) {
            const root = document.documentElement;
            for (const [key, val] of Object.entries(msg.colors)) {
                root.style.setProperty('--sh-' + key, val);
            }
        }
    });

    // ── Init ─────────────────────────────────────────

    buildNav();
    applyMode(currentMode);
    if (persistedState.search) {
        searchInput.value = persistedState.search;
        filterNav();
    }

    const initialDocId = window.__INITIAL_DOC_ID__ || currentDocId;
    if (initialDocId && docsData[initialDocId]) {
        loadDoc(initialDocId);
    }

    vscode.postMessage({ command: 'ready' });
    vscode.postMessage({ command: 'requestThemeColors' });
})();
