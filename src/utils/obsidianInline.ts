export type ObsidianTagRenderMode = 'visible' | 'hidden';
export type MarkdownSeparatorRenderMode = 'render' | 'hidden' | 'preserve';

export type ObsidianInlineRenderOptions = {
    renderWikilinks?: boolean;
    tagRenderMode?: ObsidianTagRenderMode;
    renderEscapedTags?: boolean;
    separatorRenderMode?: MarkdownSeparatorRenderMode;
};

export const defaultObsidianInlineRenderOptions: Required<ObsidianInlineRenderOptions> = {
    renderWikilinks: true,
    tagRenderMode: 'visible',
    renderEscapedTags: false,
    separatorRenderMode: 'preserve',
};

export function normalizeObsidianInlineRenderOptions(options?: ObsidianInlineRenderOptions): Required<ObsidianInlineRenderOptions> {
    return {
        renderWikilinks: options?.renderWikilinks ?? defaultObsidianInlineRenderOptions.renderWikilinks,
        tagRenderMode: options?.tagRenderMode ?? defaultObsidianInlineRenderOptions.tagRenderMode,
        renderEscapedTags: options?.renderEscapedTags ?? defaultObsidianInlineRenderOptions.renderEscapedTags,
        separatorRenderMode: options?.separatorRenderMode ?? defaultObsidianInlineRenderOptions.separatorRenderMode,
    };
}

export function renderObsidianInlineText(input: string, options?: ObsidianInlineRenderOptions): string {
    if (!input) { return input; }
    const opts = normalizeObsidianInlineRenderOptions(options);
    if (!opts.renderWikilinks && opts.tagRenderMode === 'visible' && !opts.renderEscapedTags) { return input; }

    let out = '';
    let i = 0;
    while (i < input.length) {
        const codeEnd = findInlineCodeEnd(input, i);
        if (codeEnd > i) {
            out += input.slice(i, codeEnd);
            i = codeEnd;
            continue;
        }

        const wiki = opts.renderWikilinks ? parseWikiLinkAt(input, i) : undefined;
        if (wiki) {
            out += wiki.display;
            i = wiki.end;
            continue;
        }

        if (input[i] === '\\' && input[i + 1] === '#') {
            const tag = parseTagAt(input, i + 1);
            if (tag) {
                out += opts.renderEscapedTags ? tag.text : input.slice(i, tag.end);
                i = tag.end;
                continue;
            }
        }

        if (input[i] === '#') {
            const tag = parseTagAt(input, i);
            if (tag && isTagBoundary(input[i - 1])) {
                if (opts.tagRenderMode === 'visible') { out += tag.text; }
                i = tag.end;
                continue;
            }
        }

        out += input[i];
        i++;
    }
    return out;
}

function findInlineCodeEnd(input: string, index: number): number {
    if (input[index] !== '`') { return -1; }
    let tickCount = 1;
    while (input[index + tickCount] === '`') { tickCount++; }
    const marker = '`'.repeat(tickCount);
    const end = input.indexOf(marker, index + tickCount);
    return end >= 0 ? end + tickCount : -1;
}

function parseWikiLinkAt(input: string, index: number): { end: number; display: string } | undefined {
    const embed = input[index] === '!' && input[index + 1] === '[' && input[index + 2] === '[';
    const plain = input[index] === '[' && input[index + 1] === '[';
    if (!embed && !plain) { return undefined; }
    const start = index + (embed ? 3 : 2);
    const end = input.indexOf(']]', start);
    if (end < 0) { return undefined; }
    const raw = input.slice(start, end).trim();
    if (!raw) { return undefined; }
    const bar = raw.indexOf('|');
    const display = (bar >= 0 ? raw.slice(bar + 1) : raw).trim();
    return { end: end + 2, display: display || raw };
}

function parseTagAt(input: string, index: number): { end: number; text: string } | undefined {
    if (input[index] !== '#') { return undefined; }
    let end = index + 1;
    while (end < input.length && isTagChar(input[end])) { end++; }
    if (end === index + 1) { return undefined; }
    if (input[end - 1] === '/') { end--; }
    if (end === index + 1) { return undefined; }
    return { end, text: input.slice(index, end) };
}

function isTagChar(ch: string): boolean {
    return /[A-Za-z0-9_\-\/\u4e00-\u9fff]/u.test(ch);
}

function isTagBoundary(ch: string | undefined): boolean {
    return !ch || !/[A-Za-z0-9_\-\/\u4e00-\u9fff]/u.test(ch);
}