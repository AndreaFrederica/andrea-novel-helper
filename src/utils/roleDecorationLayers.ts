export interface DecorationLayerCandidate<T> {
    start: number;
    end: number;
    priority: number;
    value: T;
}

export interface DecorationLayerSegment<T> {
    start: number;
    end: number;
    value: T;
}

export interface CompositeDecorationSegment<TForeground, TBackground> {
    start: number;
    end: number;
    foreground?: TForeground;
    background?: TBackground;
}

interface IndexedCandidate<T> extends DecorationLayerCandidate<T> {
    order: number;
}

function compareCandidates<T>(a: IndexedCandidate<T>, b: IndexedCandidate<T>): number {
    if (a.priority !== b.priority) {
        return a.priority - b.priority;
    }
    const lengthDiff = (b.end - b.start) - (a.end - a.start);
    if (lengthDiff !== 0) {
        return lengthDiff;
    }
    return a.order - b.order;
}

function appendLayerSegment<T>(segments: DecorationLayerSegment<T>[], segment: DecorationLayerSegment<T>): void {
    const previous = segments[segments.length - 1];
    if (previous && previous.end === segment.start && previous.value === segment.value) {
        previous.end = segment.end;
        return;
    }
    segments.push(segment);
}

export function resolvePriorityLayer<T>(candidates: DecorationLayerCandidate<T>[]): DecorationLayerSegment<T>[] {
    const indexed = candidates
        .filter(candidate => Number.isFinite(candidate.start) && Number.isFinite(candidate.end) && candidate.end > candidate.start)
        .map((candidate, order): IndexedCandidate<T> => ({ ...candidate, order }));
    if (indexed.length === 0) {
        return [];
    }

    const starts = new Map<number, IndexedCandidate<T>[]>();
    const ends = new Map<number, IndexedCandidate<T>[]>();
    const points = new Set<number>();
    for (const candidate of indexed) {
        const atStart = starts.get(candidate.start) || [];
        atStart.push(candidate);
        starts.set(candidate.start, atStart);

        const atEnd = ends.get(candidate.end) || [];
        atEnd.push(candidate);
        ends.set(candidate.end, atEnd);

        points.add(candidate.start);
        points.add(candidate.end);
    }

    const sortedPoints = Array.from(points).sort((a, b) => a - b);
    const active = new Set<IndexedCandidate<T>>();
    const segments: DecorationLayerSegment<T>[] = [];

    for (let index = 0; index < sortedPoints.length - 1; index++) {
        const point = sortedPoints[index];
        for (const candidate of ends.get(point) || []) {
            active.delete(candidate);
        }
        for (const candidate of starts.get(point) || []) {
            active.add(candidate);
        }

        const next = sortedPoints[index + 1];
        if (next <= point || active.size === 0) {
            continue;
        }

        let winner: IndexedCandidate<T> | undefined;
        for (const candidate of active) {
            if (!winner || compareCandidates(candidate, winner) < 0) {
                winner = candidate;
            }
        }
        if (winner) {
            appendLayerSegment(segments, { start: point, end: next, value: winner.value });
        }
    }

    return segments;
}

function appendCompositeSegment<TForeground, TBackground>(
    segments: CompositeDecorationSegment<TForeground, TBackground>[],
    segment: CompositeDecorationSegment<TForeground, TBackground>
): void {
    const previous = segments[segments.length - 1];
    if (
        previous
        && previous.end === segment.start
        && previous.foreground === segment.foreground
        && previous.background === segment.background
    ) {
        previous.end = segment.end;
        return;
    }
    segments.push(segment);
}

export function composeDecorationLayers<TForeground, TBackground>(
    foreground: DecorationLayerSegment<TForeground>[],
    background: DecorationLayerSegment<TBackground>[]
): CompositeDecorationSegment<TForeground, TBackground>[] {
    const points = Array.from(new Set([
        ...foreground.flatMap(segment => [segment.start, segment.end]),
        ...background.flatMap(segment => [segment.start, segment.end]),
    ])).sort((a, b) => a - b);
    if (points.length < 2) {
        return [];
    }

    const output: CompositeDecorationSegment<TForeground, TBackground>[] = [];
    let foregroundIndex = 0;
    let backgroundIndex = 0;

    for (let index = 0; index < points.length - 1; index++) {
        const start = points[index];
        const end = points[index + 1];
        if (end <= start) {
            continue;
        }

        while (foregroundIndex < foreground.length && foreground[foregroundIndex].end <= start) {
            foregroundIndex++;
        }
        while (backgroundIndex < background.length && background[backgroundIndex].end <= start) {
            backgroundIndex++;
        }

        const foregroundSegment = foreground[foregroundIndex];
        const backgroundSegment = background[backgroundIndex];
        const foregroundValue = foregroundSegment && foregroundSegment.start <= start && foregroundSegment.end >= end
            ? foregroundSegment.value
            : undefined;
        const backgroundValue = backgroundSegment && backgroundSegment.start <= start && backgroundSegment.end >= end
            ? backgroundSegment.value
            : undefined;
        if (foregroundValue === undefined && backgroundValue === undefined) {
            continue;
        }

        appendCompositeSegment(output, {
            start,
            end,
            foreground: foregroundValue,
            background: backgroundValue,
        });
    }

    return output;
}

export function buildCompositeDecorationSegments<TForeground, TBackground>(
    foregroundCandidates: DecorationLayerCandidate<TForeground>[],
    backgroundCandidates: DecorationLayerCandidate<TBackground>[]
): CompositeDecorationSegment<TForeground, TBackground>[] {
    return composeDecorationLayers(
        resolvePriorityLayer(foregroundCandidates),
        resolvePriorityLayer(backgroundCandidates)
    );
}
