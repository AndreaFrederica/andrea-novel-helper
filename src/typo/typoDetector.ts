import { TypoApiResult } from './typoTypes';
import { detectTyposBatchHttp } from './typoHttp';

// Allow host to plug an external detector.
export type TypoDetectorFn = (sentence: string) => Promise<TypoApiResult | null>;
export type TypoDetectorBatchFn = (
    sentences: string[],
    ctx?: {
        docFsPath?: string;
        docUri?: string;
        docUuid?: string;
        roleNames?: string[];
        onPartial?: (corrections: TypoApiResult[]) => void;
    }
) => Promise<(TypoApiResult | null)[]>;

let detectorImpl: TypoDetectorFn | null = null;
let detectorBatchImpl: TypoDetectorBatchFn | null = null;

export function setTypoDetector(fn: TypoDetectorFn) {
    detectorImpl = fn;
}

export function setTypoDetectorBatch(fn: TypoDetectorBatchFn) {
    detectorBatchImpl = fn;
}

// Simple stub for local testing. Detects a few common errors.
async function stubDetect(sentence: string): Promise<TypoApiResult | null> {
    const dict: Record<string, string> = {
        '附进': '附近',
        '作孽': '昨夜',
        '一股做气': '一鼓作气',
    };
    // Find first match
    for (const wrong of Object.keys(dict)) {
        const idx = sentence.indexOf(wrong);
        if (idx >= 0) {
            const correct = dict[wrong];
            return {
                index: idx,
                source: sentence,
                target: sentence.slice(0, idx) + correct + sentence.slice(idx + wrong.length),
                errors: [[wrong, correct, idx, 0.9]]
            };
        }
    }
    return null;
}

export async function detectTypo(sentence: string): Promise<TypoApiResult | null> {
    const fn = detectorImpl || stubDetect;
    try {
        return await fn(sentence);
    } catch (e) {
        // Silently ignore failures and return null to keep UX smooth
        return null;
    }
}

export async function detectTyposBatch(
    sentences: string[],
    ctx?: { docFsPath?: string; docUri?: string; docUuid?: string; roleNames?: string[]; onPartial?: (corrections: TypoApiResult[]) => void }
): Promise<(TypoApiResult | null)[]> {
    if (detectorBatchImpl) {
        try { return await detectorBatchImpl(sentences, ctx); } catch { /* ignore */ }
    }
    // Fallback to HTTP client; if not available, fallback to stub per item
    try {
        return await detectTyposBatchHttp(sentences, ctx);
    } catch {
        const arr: (TypoApiResult | null)[] = [];
        for (const s of sentences) arr.push(await stubDetect(s));
        return arr;
    }
}
