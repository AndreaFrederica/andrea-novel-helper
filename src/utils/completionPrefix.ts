const COMPLETION_PREFIX_MAX_SEGMENTS = 8;
const COMPLETION_PREFIX_MAX_CHARS = 48;

export type SegmentTextLike = (text: string) => string[];
export type PrefixMatcher = (target: string, prefix: string) => boolean;

/**
 * 从最近输入中生成补全前缀候选。
 * 候选按长度从长到短排列，优先让补全替换完整输入而不是最后一个分词。
 */
export function getCompletionPrefixCandidates(line: string, segmentText: SegmentTextLike): string[] {
    const normalizedLine = line.replace(/\s+$/u, '');
    if (!normalizedLine) {
        return [];
    }

    const candidates: string[] = [];
    const seen = new Set<string>();
    const pushCandidate = (value: string) => {
        const candidate = value.trim();
        if (!candidate || seen.has(candidate)) {
            return;
        }
        seen.add(candidate);
        candidates.push(candidate);
    };

    pushCandidate(normalizedLine.slice(-COMPLETION_PREFIX_MAX_CHARS));

    const segments = segmentText(normalizedLine).filter(Boolean);
    if (!segments.length) {
        return candidates;
    }

    let combined = '';
    let usedSegments = 0;
    for (let index = segments.length - 1; index >= 0; index--) {
        const next = `${segments[index]}${combined}`;
        if (next.length > COMPLETION_PREFIX_MAX_CHARS && usedSegments > 0) {
            break;
        }
        combined = next;
        pushCandidate(combined);
        usedSegments += 1;
        if (usedSegments >= COMPLETION_PREFIX_MAX_SEGMENTS || combined.length >= COMPLETION_PREFIX_MAX_CHARS) {
            break;
        }
    }

    candidates.sort((left, right) => right.length - left.length);
    return candidates;
}

/**
 * 在候选前缀中选出对目标名称可用的最长一项。
 */
export function findBestCompletionPrefix(
    target: string,
    candidates: readonly string[],
    matchesPrefix: PrefixMatcher,
): string | undefined {
    for (const candidate of candidates) {
        if (matchesPrefix(target, candidate)) {
            return candidate;
        }
    }
    return undefined;
}