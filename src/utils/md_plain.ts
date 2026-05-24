// md_plain.ts
// 零依赖 Markdown → 纯文本；返回整体文本与“块首行”映射用于滚动对齐
import { ObsidianInlineRenderOptions, renderObsidianInlineText } from './obsidianInline';

type MarkdownReferenceDefinition = {
    url: string;
    title?: string;
};

type MarkdownReferenceDefinitionMap = Map<string, MarkdownReferenceDefinition>;

export type MarkdownInlineTextPart = {
    kind: 'text';
    text: string;
    styles: MarkdownInlineStyleRange[];
};

export type MarkdownInlineImagePart = {
    kind: 'image';
    alt: string;
    src: string;
    title?: string;
    placeholder: string;
};

export type MarkdownInlinePart = MarkdownInlineTextPart | MarkdownInlineImagePart;

export type MarkdownPlainBlock = {
    srcLine: number;
    text: string;
    kind?: 'heading' | 'list' | 'blockquote' | 'code' | 'image' | 'separator';
    level?: number;
    listMarkers?: string[];
    inlineStyles?: MarkdownInlineStyleRange[];
    inlineParts?: MarkdownInlinePart[];
    listItemInlineParts?: MarkdownInlinePart[][];
    imageAlt?: string;
    imageSrc?: string;
    imageTitle?: string;
};

export type MarkdownInlineStyleRange = {
    start: number;
    end: number;
    kind: 'bold' | 'italic' | 'boldItalic' | 'strike' | 'code';
};

export function mdToPlainText(src: string, inlineOptions?: ObsidianInlineRenderOptions): { text: string; blocks: MarkdownPlainBlock[] } {
    const rawLines = src.split(/\r?\n/);
    const lines = stripCommentsFromLines(rawLines);
    const blocks: MarkdownPlainBlock[] = [];
    let i = 0;
    const refDefs = collectRefDefinitions(lines);
    const separatorMode = inlineOptions?.separatorRenderMode ?? 'preserve';

    const pushBlock = (start: number, text: string, meta?: Omit<MarkdownPlainBlock, 'srcLine' | 'text'>) =>
        blocks.push({ srcLine: start, text: text.replace(/\s+$/, ''), ...meta });

    const pushRichBlock = (start: number, raw: string, meta?: Omit<MarkdownPlainBlock, 'srcLine' | 'text' | 'inlineStyles' | 'inlineParts'>) => {
        const rich = stripInlineRich(raw, refDefs, inlineOptions);
        pushBlock(start, rich.text, { ...meta, inlineStyles: rich.styles, inlineParts: rich.parts });
    };

    while (i < lines.length) {
        const line = lines[i];

        // Reference-style link definition: keep line mapping but drop content
        if (isReferenceDefinitionLine(line)) {
            pushBlock(i, '');
            i++;
            continue;
        }

        const separator = parseSeparatorLine(lines, i);
        if (separator) {
            if (separatorMode === 'hidden') {
                pushBlock(i, '');
            } else if (separatorMode === 'render') {
                pushBlock(i, formatRenderedSeparatorText(separator.raw), { kind: 'separator' });
            } else {
                pushBlock(i, separator.raw);
            }
            i++;
            continue;
        }

        // 1) Fenced code block ```lang / ~~~
        const fence = line.match(/^\s*(```+|~~~+)\s*(\w+)?\s*$/);
        if (fence) {
            const start = i;
            const mark = fence[1];
            i++;
            const buf: string[] = [];
            while (i < lines.length && !new RegExp(`^\\s*${mark}\\s*$`).test(lines[i])) {
                buf.push(lines[i]);
                i++;
            }
            if (i < lines.length) { i++; } // skip closing
            pushBlock(start, buf.join('\n'), { kind: 'code' });
            continue;
        }

        // 2) ATX Heading
        const atx = line.match(/^(#{1,6})(?:\s+(.+?)\s*#*\s*)$/);
        if (atx) {
            pushRichBlock(i, atx[2], { kind: 'heading', level: atx[1].length });
            i++;
            continue;
        }

        // 3) Setext Heading
        if (i + 1 < lines.length && /^\s*[-=]{3,}\s*$/.test(lines[i + 1])) {
            pushRichBlock(i, line, { kind: 'heading', level: /^\s*=/.test(lines[i + 1]) ? 1 : 2 });
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
            pushRichBlock(start, buf.join('\n'), { kind: 'blockquote' });
            continue;
        }

        // 5) List (unordered/ordered/task)
        if (/^\s*([*+\-]|\d+\.)\s+/.test(line)) {
            const start = i;
            const buf: string[] = [];
            const markers: string[] = [];
            const listItemInlineParts: MarkdownInlinePart[][] = [];
            const inlineStyles: MarkdownInlineStyleRange[] = [];
            let inlineOffset = 0;
            while (i < lines.length && /^\s*([*+\-]|\d+\.)\s+/.test(lines[i])) {
                const markerMatch = lines[i].match(/^\s*(\d+\.|[*+\-])\s+/);
                markers.push(markerMatch && /\d+\./.test(markerMatch[1]) ? markerMatch[1] : '•');
                const li = lines[i]
                    .replace(/^\s*(?:\d+\.|[*+\-])\s+/, '')
                    .replace(/^\[([ xX])\]\s+/, (_m, g1) => (g1 === 'x' || g1 === 'X') ? '[x] ' : '[ ] ');
                const rich = stripInlineRich(li, refDefs, inlineOptions);
                buf.push(rich.text);
                listItemInlineParts.push(rich.parts);
                rich.styles.forEach(style => inlineStyles.push({
                    ...style,
                    start: style.start + inlineOffset,
                    end: style.end + inlineOffset,
                }));
                inlineOffset += rich.text.length + 1;
                i++;
            }
            pushBlock(start, buf.join('\n'), {
                kind: 'list',
                listMarkers: markers,
                inlineStyles,
                listItemInlineParts,
            });
            continue;
        }

        // 6) Table（简化处理）
        if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*[-:| ]+\|[-:| ]+\s*\|?\s*$/.test(lines[i + 1])) {
            const start = i;
            const buf: string[] = [];
            buf.push(stripTableRow(line, refDefs, inlineOptions));
            i += 2; // skip separator
            while (i < lines.length && /\|/.test(lines[i])) {
                buf.push(stripTableRow(lines[i], refDefs, inlineOptions));
                i++;
            }
            pushBlock(start, buf.join('\n'));
            continue;
        }

        // 7) Standalone image paragraph
        const standaloneImage = parseStandaloneImageLine(line, refDefs);
        if (standaloneImage) {
            pushBlock(i, formatImageText(standaloneImage.alt), {
                kind: 'image',
                imageAlt: standaloneImage.alt,
                imageSrc: standaloneImage.src,
                imageTitle: standaloneImage.title,
            });
            i++;
            continue;
        }

        // 8) Paragraph / 连续非空行 或 空行：保留空行为独立空块
        const start = i;
        const buf: string[] = [];
        while (i < lines.length && lines[i].trim() !== '') {
            if (/^\s*(```+|~~~+)\s*\w*\s*$/.test(lines[i]) || /^\s*>/.test(lines[i]) || /^\s*([*+\-]|\d+\.)\s+/.test(lines[i])) { break; }
            buf.push(lines[i]);
            i++;
        }
        if (buf.length) {
            // 推入段落块
            pushRichBlock(start, buf.join('\n'));
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
export function stripInline(s: string, refDefs?: MarkdownReferenceDefinitionMap, inlineOptions?: ObsidianInlineRenderOptions): string {
    return stripInlineRich(s, refDefs, inlineOptions).text;
}

export function stripInlineRich(s: string, refDefs?: MarkdownReferenceDefinitionMap, inlineOptions?: ObsidianInlineRenderOptions): { text: string; styles: MarkdownInlineStyleRange[]; parts: MarkdownInlinePart[] } {
    const imageTokens = collectInlineImageTokens(s, refDefs);
    const tokenized = imageTokens.length ? buildTokenizedInlineSource(s, imageTokens) : s;
    const richText = stripInlineTextRich(tokenized, refDefs, inlineOptions);
    if (!imageTokens.length) {
        return {
            text: richText.text,
            styles: richText.styles,
            parts: richText.text ? [{ kind: 'text', text: richText.text, styles: richText.styles }] : [],
        };
    }

    const parts: MarkdownInlinePart[] = [];
    const styles: MarkdownInlineStyleRange[] = [];
    let text = '';
    let cursor = 0;
    for (const token of imageTokens) {
        const marker = inlineImageMarker(token.index);
        const markerIndex = richText.text.indexOf(marker, cursor);
        if (markerIndex === -1) {
            continue;
        }
        appendInlineTextSegment(richText, cursor, markerIndex, text.length, parts, styles, segment => {
            text += segment;
        });
        const placeholder = formatImageText(token.alt);
        text += placeholder;
        parts.push({ kind: 'image', alt: token.alt, src: token.src, title: token.title, placeholder });
        cursor = markerIndex + marker.length;
    }
    appendInlineTextSegment(richText, cursor, richText.text.length, text.length, parts, styles, segment => {
        text += segment;
    });
    return { text, styles, parts };
}

export function stripTableRow(line: string, refDefs?: MarkdownReferenceDefinitionMap, inlineOptions?: ObsidianInlineRenderOptions): string {
    const cells = line.trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map(c => stripInline(c.trim(), refDefs, inlineOptions));
    return cells.join('\t'); // 用制表符拼列
}

function formatImageText(alt?: string): string {
    const text = (alt || '').trim();
    return text ? `[image: ${text}]` : '[image]';
}

function formatRenderedSeparatorText(_raw: string): string {
    return '------';
}

function parseSeparatorLine(lines: string[], index: number): { raw: string } | undefined {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
        return undefined;
    }
    const compact = trimmed.replace(/\s+/g, '');
    if (/^[-*_]{3,}$/.test(compact)) {
        return { raw: trimmed };
    }
    if (/^~{5,}$/.test(compact) && isSeparatorBlankBoundary(lines, index)) {
        return { raw: trimmed };
    }
    return undefined;
}

function isSeparatorBlankBoundary(lines: string[], index: number): boolean {
    const prev = index > 0 ? lines[index - 1].trim() : '';
    const next = index + 1 < lines.length ? lines[index + 1].trim() : '';
    return !prev && !next;
}

function parseStandaloneImageLine(line: string, refDefs?: MarkdownReferenceDefinitionMap): { alt: string; src: string; title?: string } | undefined {
    const trimmed = line.trim();
    if (!trimmed.startsWith('![')) {
        return undefined;
    }
    const parsed = parseInlineImageAt(trimmed, 0, refDefs);
    if (!parsed || parsed.end !== trimmed.length) {
        return undefined;
    }
    return { alt: parsed.alt, src: parsed.src, title: parsed.title };
}

function normalizeRefLabel(label: string): string {
    return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function collectRefDefinitions(lines: string[]): MarkdownReferenceDefinitionMap {
    const defs: MarkdownReferenceDefinitionMap = new Map();
    for (const line of lines) {
        const parsed = parseReferenceDefinitionLine(line);
        if (parsed) {
            defs.set(normalizeRefLabel(parsed.label), { url: parsed.url, title: parsed.title });
        }
    }
    return defs;
}

function parseReferenceDefinitionLine(line: string): { label: string; url: string; title?: string } | undefined {
    const labelMatch = line.match(/^\s*\[([^\]]+)\]\s*:\s*/);
    if (!labelMatch) {
        return undefined;
    }
    const label = labelMatch[1];
    const rest = line.slice(labelMatch[0].length).trim();
    const target = parseImageTarget(rest, false);
    if (!target || target.end !== rest.length) {
        return undefined;
    }
    return { label, url: target.src, title: target.title };
}

type InlineImageToken = {
    index: number;
    start: number;
    end: number;
    alt: string;
    src: string;
    title?: string;
};

function collectInlineImageTokens(text: string, refDefs?: MarkdownReferenceDefinitionMap): InlineImageToken[] {
    const tokens: InlineImageToken[] = [];
    let cursor = 0;
    while (cursor < text.length) {
        const bang = text.indexOf('![', cursor);
        if (bang === -1) {
            break;
        }
        const parsed = parseInlineImageAt(text, bang, refDefs);
        if (!parsed) {
            cursor = bang + 2;
            continue;
        }
        tokens.push({ index: tokens.length, ...parsed });
        cursor = parsed.end;
    }
    return tokens;
}

function buildTokenizedInlineSource(text: string, tokens: InlineImageToken[]): string {
    let cursor = 0;
    let out = '';
    for (const token of tokens) {
        out += text.slice(cursor, token.start);
        out += inlineImageMarker(token.index);
        cursor = token.end;
    }
    out += text.slice(cursor);
    return out;
}

function inlineImageMarker(index: number): string {
    return `\uE000IMG${index}\uE001`;
}

function appendInlineTextSegment(
    rich: { text: string; styles: MarkdownInlineStyleRange[] },
    start: number,
    end: number,
    outputOffset: number,
    parts: MarkdownInlinePart[],
    styles: MarkdownInlineStyleRange[],
    appendText: (segment: string) => void,
): void {
    if (end <= start) {
        return;
    }
    const segment = rich.text.slice(start, end);
    if (!segment) {
        return;
    }
    const segmentStyles = rich.styles
        .filter(style => style.start < end && start < style.end)
        .map(style => ({
            ...style,
            start: Math.max(0, style.start - start),
            end: Math.min(segment.length, style.end - start),
        }))
        .filter(style => style.end > style.start);
    appendText(segment);
    parts.push({ kind: 'text', text: segment, styles: segmentStyles });
    segmentStyles.forEach(style => styles.push({
        ...style,
        start: style.start + outputOffset,
        end: style.end + outputOffset,
    }));
}

function stripInlineTextRich(text: string, refDefs?: MarkdownReferenceDefinitionMap, inlineOptions?: ObsidianInlineRenderOptions): { text: string; styles: MarkdownInlineStyleRange[] } {
    let t = text;
    const styles: MarkdownInlineStyleRange[] = [];

    t = t.replace(/\[([^\]]*?)\]\(([^)]+)\)/g, (_m, a1) => a1 || '');
    t = t.replace(/\[([^\]]+?)\]\s*\[[^\]]*?\]/g, (_m, a1) => a1 || '');
    if (refDefs && refDefs.size) {
        t = t.replace(/\[([^\]]+?)\](?!\()/g, (m, a1) => {
            const key = normalizeRefLabel(a1);
            return refDefs.has(key) ? a1 : m;
        });
    }
    t = t.replace(/<((?:https?:\/\/|mailto:)[^>]+)>/gi, '$1');
    t = t.replace(/<\/?[^>]+>/g, '');
    t = t.replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, '\'');

    if (inlineOptions) {
        t = renderObsidianInlineText(t, inlineOptions);
    }

    const inlineStyle = /(`+)([\s\S]*?)\1|~~([\s\S]*?)~~|(\*{3,}|_{3,})([\s\S]*?)\4|(\*\*|__)([\s\S]*?)\6|(\*|_)([\s\S]*?)\8/g;
    let out = '';
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = inlineStyle.exec(t)) !== null) {
        out += t.slice(last, match.index);
        const content = match[2] ?? match[3] ?? match[5] ?? match[7] ?? match[9] ?? '';
        const contentStart = out.length;
        out += content;
        let kind: MarkdownInlineStyleRange['kind'] = 'italic';
        if (match[1]) { kind = 'code'; }
        else if (match[3] !== undefined) { kind = 'strike'; }
        else if (match[4]) { kind = 'boldItalic'; }
        else if (match[6]) { kind = 'bold'; }
        styles.push({ start: contentStart, end: contentStart + content.length, kind });
        last = match.index + match[0].length;
    }
    out += t.slice(last);
    const trimmed = out.replace(/[ \t]+$/gm, '');
    const max = trimmed.length;
    return {
        text: trimmed,
        styles: styles
            .map(style => ({ ...style, start: Math.max(0, Math.min(style.start, max)), end: Math.max(0, Math.min(style.end, max)) }))
            .filter(style => style.end > style.start)
            .sort((a, b) => a.start - b.start || b.end - a.end)
    };
}

function parseInlineImageAt(text: string, start: number, refDefs?: MarkdownReferenceDefinitionMap): { start: number; end: number; alt: string; src: string; title?: string } | undefined {
    if (text.slice(start, start + 2) !== '![') {
        return undefined;
    }
    const altEnd = text.indexOf(']', start + 2);
    if (altEnd === -1) {
        return undefined;
    }
    const rawAlt = text.slice(start + 2, altEnd);
    const alt = stripInlineTextRich(rawAlt, refDefs).text;
    const next = text[altEnd + 1];
    if (next === '(') {
        const target = parseImageTarget(text.slice(altEnd + 2), true);
        if (!target) {
            return undefined;
        }
        return { start, end: altEnd + 2 + target.end + 1, alt, src: target.src, title: target.title };
    }
    if (next === '[') {
        const labelEnd = text.indexOf(']', altEnd + 2);
        if (labelEnd === -1) {
            return undefined;
        }
        const label = text.slice(altEnd + 2, labelEnd) || rawAlt;
        const ref = refDefs?.get(normalizeRefLabel(label));
        if (!ref) {
            return undefined;
        }
        return { start, end: labelEnd + 1, alt, src: ref.url, title: ref.title };
    }
    const shortcut = refDefs?.get(normalizeRefLabel(rawAlt));
    if (shortcut) {
        return { start, end: altEnd + 1, alt, src: shortcut.url, title: shortcut.title };
    }
    return undefined;
}

function parseImageTarget(text: string, requireClosingParen: boolean): { src: string; title?: string; end: number } | undefined {
    let index = 0;
    while (index < text.length && /\s/.test(text[index])) {
        index++;
    }
    if (index >= text.length) {
        return undefined;
    }
    let src = '';
    if (text[index] === '<') {
        const close = text.indexOf('>', index + 1);
        if (close === -1) {
            return undefined;
        }
        src = text.slice(index + 1, close).trim();
        index = close + 1;
    } else {
        const srcStart = index;
        while (index < text.length && text[index] !== ')' && !/\s/.test(text[index])) {
            index++;
        }
        src = text.slice(srcStart, index).trim();
    }
    if (!src) {
        return undefined;
    }
    while (index < text.length && /\s/.test(text[index])) {
        index++;
    }
    let title: string | undefined;
    if (text[index] === '"' || text[index] === '\'') {
        const quote = text[index];
        const close = text.indexOf(quote, index + 1);
        if (close === -1) {
            return undefined;
        }
        title = text.slice(index + 1, close);
        index = close + 1;
        while (index < text.length && /\s/.test(text[index])) {
            index++;
        }
    }
    if (requireClosingParen) {
        if (text[index] !== ')') {
            return undefined;
        }
        return { src, title, end: index };
    }
    return { src, title, end: index };
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
