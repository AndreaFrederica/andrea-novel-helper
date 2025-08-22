// txt_plain.ts
// 将纯文本按段落/空行分块，保留原始空行数量（每个空行作为独立块）
// 返回格式与 mdToPlainText 保持兼容：{ text, blocks: { srcLine, text }[] }

export function txtToPlainText(src: string): { text: string; blocks: { srcLine: number; text: string }[] } {
    const lines = src.split(/\r?\n/);
    const blocks: { srcLine: number; text: string }[] = [];
    let i = 0;

    const pushBlock = (start: number, text: string) => {
        // 去除行尾多余空白，但保留段内换行
        blocks.push({ srcLine: start, text: text.replace(/[ \t]+$/gm, '') });
    };

    while (i < lines.length) {
        // 空行 -> 单独空块（保留数量）
        if (lines[i].trim() === '') {
            pushBlock(i, '');
            i++;
            continue;
        }

        // 连续非空行构成一个段落块
        const start = i;
        const buf: string[] = [];
        while (i < lines.length && lines[i].trim() !== '') {
            buf.push(lines[i].replace(/[ \t]+$/u, ''));
            i++;
        }
        if (buf.length) {
            pushBlock(start, buf.join('\n'));
        }
    }

    // 直接以单换行连接各块，空块会导致连续空行，从而保留原始空白分布
    const text = blocks.map(b => b.text).join('\n');
    return { text, blocks };
}

// 兼容别名与默认导出
export const txt_plain = txtToPlainText;
export default txtToPlainText;
