import { parentPort } from 'worker_threads';
import * as fs from 'fs';

interface ObsidianHeadingEntry {
    heading: string;
    normalized: string;
    line: number;
    character: number;
}

interface ObsidianTagOccurrence {
    tag: string;
    isColor: boolean;
    line: number;
    character: number;
}

interface ScanResult {
    headings: ObsidianHeadingEntry[];
    tags: ObsidianTagOccurrence[];
    wikiLinks: string[];
}

const WIKI_LINK_RE = /!??\[\[([^\]\n]+)\]\]/g;
const TAG_RE = /(^|[\s([{>])(#(?:[A-Za-z0-9_\-\u4e00-\u9fff]+)(?:\/[A-Za-z0-9_\-\u4e00-\u9fff]+)*)/g;
const COLOR_RE = /#(?:[A-Fa-f0-9]{3}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})\b/g;

parentPort?.on('message', async (message: any) => {
    if (!message || message.type !== 'scanFile') return;
    try {
        const content = await fs.promises.readFile(message.fsPath, 'utf8');
        parentPort?.postMessage({ type: 'scanResult', id: message.id, result: scanContent(content) });
    } catch (error) {
        parentPort?.postMessage({ type: 'scanResult', id: message.id, error: error instanceof Error ? error.message : String(error) });
    }
});

parentPort?.postMessage({ type: 'ready' });

function scanContent(content: string): ScanResult {
    const headings: ObsidianHeadingEntry[] = [];
    const tags: ObsidianTagOccurrence[] = [];
    const wikiLinks = new Set<string>();
    const lines = content.split(/\r?\n/);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        const headingMatch = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
        if (headingMatch) {
            const heading = headingMatch[2].trim();
            headings.push({
                heading,
                normalized: normalizeHeading(heading),
                line: lineIndex,
                character: Math.max(line.indexOf(headingMatch[2]), 0),
            });
        }

        WIKI_LINK_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = WIKI_LINK_RE.exec(line))) {
            const target = match[1].split('|')[0].trim();
            if (target) wikiLinks.add(target);
        }

        TAG_RE.lastIndex = 0;
        while ((match = TAG_RE.exec(line))) {
            if (!isColorTag(match[2])) {
                tags.push({ tag: match[2], isColor: false, line: lineIndex, character: match.index + match[1].length });
            }
        }

        COLOR_RE.lastIndex = 0;
        while ((match = COLOR_RE.exec(line))) {
            tags.push({ tag: match[0], isColor: true, line: lineIndex, character: match.index });
        }
    }

    return { headings, tags, wikiLinks: Array.from(wikiLinks).sort((left, right) => left.localeCompare(right, 'zh-CN')) };
}

function isColorTag(tag: string): boolean {
    return /^#(?:[A-Fa-f0-9]{3}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/.test(tag);
}

function normalizeHeading(input: string): string {
    return input.trim().replace(/#+$/, '').trim().toLowerCase();
}
