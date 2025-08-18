// md_plain.ts
// 零依赖 Markdown → 纯文本；返回整体文本与“块首行”映射用于滚动对齐
export function mdToPlainText(src: string): { text: string; blocks: { srcLine: number; text: string }[] } {
    const lines = src.split(/\r?\n/);
    const blocks: { srcLine: number; text: string }[] = [];
    let i = 0;

    const pushBlock = (start: number, text: string) =>
        blocks.push({ srcLine: start, text: text.replace(/\s+$/, '') });

    while (i < lines.length) {
        const line = lines[i];

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
            pushBlock(i, stripInline(atx[2]));
            i++;
            continue;
        }

        // 3) Setext Heading
        if (i + 1 < lines.length && /^\s*[-=]{3,}\s*$/.test(lines[i + 1])) {
            pushBlock(i, stripInline(line));
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
            pushBlock(start, stripInline(buf.join('\n')));
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
            pushBlock(start, stripInline(buf.join('\n')));
            continue;
        }

        // 6) Table（简化处理）
        if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*[-:| ]+\|[-:| ]+\s*\|?\s*$/.test(lines[i + 1])) {
            const start = i;
            const buf: string[] = [];
            buf.push(stripTableRow(line));
            i += 2; // skip separator
            while (i < lines.length && /\|/.test(lines[i])) {
                buf.push(stripTableRow(lines[i]));
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

        // 8) Paragraph / 连续非空行
        const start = i;
        const buf: string[] = [];
        while (i < lines.length && lines[i].trim() !== '') {
            if (/^(```+|~~~+)\s*\w*\s*$/.test(lines[i]) || /^\s*>/.test(lines[i]) || /^\s*([*+\-]|\d+\.)\s+/.test(lines[i])) { break; }
            buf.push(lines[i]);
            i++;
        }
        if (buf.length) { pushBlock(start, stripInline(buf.join('\n'))); }
        while (i < lines.length && lines[i].trim() === '') { i++; } // 跳过空行
    }

    const text = blocks.map(b => b.text).join('\n\n').replace(/\n{3,}/g, '\n\n');
    return { text, blocks };
}

/* —— 行内清理：去掉强调/链接/图片/行内代码/标签/实体 —— */
export function stripInline(s: string): string {
    let t = s;

    // 行内代码
    t = t.replace(/`([^`]+)`/g, '$1');

    // 链接 [text](url) → text；保留裸链接（http...）不处理
    t = t.replace(/\[([^\]]*?)\]\(([^)]+)\)/g, (_m, a1) => a1 || '');
    // 图片 ![alt](src) → alt
    t = t.replace(/!\[([^\]]*?)\]\([^)]+\)/g, (_m, a1) => a1 || '');

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

export function stripTableRow(line: string): string {
    const cells = line.trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map(c => stripInline(c.trim()));
    return cells.join('\t'); // 用制表符拼列
}
