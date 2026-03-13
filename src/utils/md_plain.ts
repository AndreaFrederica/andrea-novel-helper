// md_plain.ts
// 零依赖 Markdown → 纯文本；返回整体文本与“块首行”映射用于滚动对齐
export function mdToPlainText(src: string): { text: string; blocks: { srcLine: number; text: string }[] } {
    const rawLines = src.split(/\r?\n/);
    const lines = stripCommentsFromLines(rawLines);
    const blocks: { srcLine: number; text: string }[] = [];
    let i = 0;
    const refDefs = collectRefDefinitions(lines);

    const pushBlock = (start: number, text: string) =>
        blocks.push({ srcLine: start, text: text.replace(/\s+$/, '') });

    while (i < lines.length) {
        const line = lines[i];

        // Reference-style link definition: keep line mapping but drop content
        if (isReferenceDefinitionLine(line)) {
            pushBlock(i, '');
            i++;
            continue;
        }

        // 1) Fenced code block ```lang / ~~~
        const fence = line.match(/^(```+|~~~+)\s*(\w+)?\s*$/);
        if (fence) {
            const start = i;
            const mark = fence[1];
            i++;
            const buf: string[] = [];
            while (i < lines.length && !new RegExp(`^${mark}\\s*$`).test(lines[i])) {
                buf.push(lines[i]);
                i++;
            }
            if (i < lines.length) { i++; } // skip closing
            pushBlock(start, buf.join('\n'));
            continue;
        }

        // 2) ATX Heading
        const atx = line.match(/^(#{1,6})\s*(.+?)\s*#*\s*$/);
        if (atx) {
            pushBlock(i, stripInline(atx[2], refDefs));
            i++;
            continue;
        }

        // 3) Setext Heading
        if (i + 1 < lines.length && /^\s*[-=]{3,}\s*$/.test(lines[i + 1])) {
            pushBlock(i, stripInline(line, refDefs));
            i += 2;
            continue;
        }

        // 4) Blockquote
        if (/^\s*>/.test(line)) {
            const start = i;
            const buf: string[] = [];
            while (i < lines.length && /^\s*>/.test(lines[i])) {
                buf.push(lines[i].replace(/^\s*>+\s?/, ''));
                i++;
            }
            pushBlock(start, stripInline(buf.join('\n'), refDefs));
            continue;
        }

        // 5) List (unordered/ordered/task)
        if (/^\s*([*+\-]|\d+\.)\s+/.test(line)) {
            const start = i;
            const buf: string[] = [];
            while (i < lines.length && /^\s*([*+\-]|\d+\.)\s+/.test(lines[i])) {
                const li = lines[i]
                    .replace(/^\s*(?:\d+\.|[*+\-])\s+/, '')
                    .replace(/^\[([ xX])\]\s+/, (_m, g1) => (g1 === 'x' || g1 === 'X') ? '[x] ' : '[ ] ');
                buf.push(li);
                i++;
            }
            pushBlock(start, stripInline(buf.join('\n'), refDefs));
            continue;
        }

        // 6) Table（简化处理）
        if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*[-:| ]+\|[-:| ]+\s*\|?\s*$/.test(lines[i + 1])) {
            const start = i;
            const buf: string[] = [];
            buf.push(stripTableRow(line, refDefs));
            i += 2; // skip separator
            while (i < lines.length && /\|/.test(lines[i])) {
                buf.push(stripTableRow(lines[i], refDefs));
                i++;
            }
            pushBlock(start, buf.join('\n'));
            continue;
        }

        // 7) Horizontal rule
        if (/^\s*([-*_]\s*){3,}\s*$/.test(line)) {
            pushBlock(i, ''); // 不输出分隔符文本
            i++;
            continue;
        }

        // 8) Paragraph / 连续非空行 或 空行：保留空行为独立空块
        const start = i;
        const buf: string[] = [];
        while (i < lines.length && lines[i].trim() !== '') {
            if (/^(```+|~~~+)\s*\w*\s*$/.test(lines[i]) || /^\s*>/.test(lines[i]) || /^\s*([*+\-]|\d+\.)\s+/.test(lines[i])) { break; }
            buf.push(lines[i]);
            i++;
        }
        if (buf.length) {
            // 推入段落块
            pushBlock(start, stripInline(buf.join('\n'), refDefs));
            // 保留段落后面的空行，每个空行都作为单独空块
            while (i < lines.length && lines[i].trim() === '') {
                pushBlock(i, '');
                i++;
            }
            continue;
        } else {
            // 当前就是空行：把连续的每一行都作为单独空块保存
            while (i < lines.length && lines[i].trim() === '') {
                pushBlock(i, '');
                i++;
            }
            continue;
        }
    }
    // 用单个换行符连接 blocks；因为空行由空块表示，能精确保留原始空行数量
    const text = blocks.map(b => b.text).join('\n');
    return { text, blocks };
}

/* —— 行内清理：去掉强调/链接/图片/行内代码/标签/实体 —— */
export function stripInline(s: string, refDefs?: Set<string>): string {
    let t = s;

    const formatImageText = (alt?: string) => {
        const text = (alt || '').trim();
        return text ? `[image: ${text}]` : '[image]';
    };

    // 行内代码
    t = t.replace(/`([^`]+)`/g, '$1');

    // 图片必须先于链接处理，否则链接正则会先吃掉 [alt](url) 部分，留下多余的 !
    // 图片 ![alt](src) → [image: alt]
    t = t.replace(/!\[([^\]]*?)\]\([^)]+\)/g, (_m, a1) => formatImageText(a1));
    // Reference-style image ![alt][id] → [image: alt]
    t = t.replace(/!\[([^\]]*?)\]\s*\[[^\]]*?\]/g, (_m, a1) => formatImageText(a1));

    // 链接 [text](url) → text；使用负向后顾排除图片（![ 已被上面处理过，此处做双重保险）
    t = t.replace(/\[([^\]]*?)\]\(([^)]+)\)/g, (_m, a1) => a1 || '');
    // Reference-style link [text][id] / [text][] → text
    t = t.replace(/\[([^\]]+?)\]\s*\[[^\]]*?\]/g, (_m, a1) => a1 || '');
    // Shortcut reference link [text] (only if defined)
    if (refDefs && refDefs.size) {
        t = t.replace(/\[([^\]]+?)\](?!\()/g, (m, a1) => {
            const key = normalizeRefLabel(a1);
            return refDefs.has(key) ? a1 : m;
        });
    }
    // Autolink <https://...> or <mailto:...>
    t = t.replace(/<((?:https?:\/\/|mailto:)[^>]+)>/gi, '$1');

    // 强调/斜体
    t = t.replace(/(\*\*|__)(.*?)\1/g, '$2');
    t = t.replace(/(\*|_)(.*?)\1/g, '$2');

    // 删除 HTML 标签（保留内容）
    t = t.replace(/<\/?[^>]+>/g, '');

    // 实体
    t = t.replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, '\'');

    // 行尾空白
    return t.replace(/[ \t]+$/gm, '');
}

export function stripTableRow(line: string, refDefs?: Set<string>): string {
    const cells = line.trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map(c => stripInline(c.trim(), refDefs));
    return cells.join('\t'); // 用制表符拼列
}

function normalizeRefLabel(label: string): string {
    return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function collectRefDefinitions(lines: string[]): Set<string> {
    const defs = new Set<string>();
    for (const line of lines) {
        const m = line.match(/^\s*\[([^\]]+)\]\s*:\s*\S+/);
        if (m) {
            defs.add(normalizeRefLabel(m[1]));
        }
    }
    return defs;
}

/**
 * 从行数组中去掉注释内容，保持总行数不变（从而保留 srcLine 索引映射）。
 * 支持：
 *  - HTML 注释  <!-- ... -->（单行/多行）
 *  - Obsidian 风格  %% ... %%（单行/多行）
 *  - 整行 / 行尾  %% 无闭合 → 从 %% 起到行尾均忽略
 */
function stripCommentsFromLines(lines: string[]): string[] {
    const out = lines.slice();

    // Pass 1: HTML <!-- ... -->
    let inHtml = false;
    for (let i = 0; i < out.length; i++) {
        let s = out[i];
        if (inHtml) {
            const e = s.indexOf('-->');
            if (e !== -1) { s = s.slice(e + 3); inHtml = false; }
            else { out[i] = ''; continue; }
        }
        let res = '';
        let j = 0;
        while (j < s.length) {
            const open = s.indexOf('<!--', j);
            if (open === -1) { res += s.slice(j); break; }
            res += s.slice(j, open);
            const close = s.indexOf('-->', open + 4);
            if (close !== -1) { j = close + 3; }
            else { inHtml = true; break; }
        }
        out[i] = res;
    }

    // Pass 2: Obsidian %% ... %%  /  %% EOL
    let inPct = false;
    for (let i = 0; i < out.length; i++) {
        let s = out[i];
        if (inPct) {
            const e = s.indexOf('%%');
            if (e !== -1) { s = s.slice(e + 2); inPct = false; }
            else { out[i] = ''; continue; }
        }
        let res = '';
        let j = 0;
        while (j < s.length) {
            const open = s.indexOf('%%', j);
            if (open === -1) { res += s.slice(j); break; }
            res += s.slice(j, open);
            const close = s.indexOf('%%', open + 2);
            if (close !== -1) { j = close + 2; }
            else { inPct = true; break; }  // %% 到行尾或跨行注释
        }
        out[i] = res;
    }

    return out;
}

function isReferenceDefinitionLine(line: string): boolean {
    return /^\s*\[[^\]]+\]\s*:\s*\S+/.test(line);
}
