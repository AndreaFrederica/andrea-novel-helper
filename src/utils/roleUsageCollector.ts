import * as vscode from 'vscode';
import { Role } from '../extension';
import { roles } from '../activate';
import { getRoleMatches } from '../context/roleAsyncShared';
import { ahoCorasickManager } from '../utils/AhoCorasick/ahoCorasickManager';
import { rangesOverlap } from '../utils/utils';
import { getRoleLookupKeys, roleMatchesKey } from './roleLookupKeys';
import { composeDecorationLayers, resolvePriorityLayer } from './roleDecorationLayers';

export interface RoleUsageRangeOptions {
    hits?: Array<[number, string[]]>;
    fullText?: string;
    cancellationToken?: vscode.CancellationToken;
}

export type RoleMatchSource = 'name' | 'alias' | 'fix' | 'lookup' | 'regex';

export interface RoleDecorationEntry {
    range: vscode.Range;
    role: Role;
    matchedText: string;
    pattern: string;
    matchSource: RoleMatchSource;
    priority: number;
    partial: boolean;
}

export interface RoleUsageRangeResult {
    roleToRanges: Map<Role, vscode.Range[]>;
    hoverEntries: { range: vscode.Range; role: Role }[];
    decorationEntries: RoleDecorationEntry[];
    visualSegments: RoleVisualSegment[];
    snapshot: Map<string, vscode.Range[]>;
    fullText: string;
    hits: Array<[number, string[]]>;
}

export interface RoleVisualSegment {
    range: vscode.Range;
    foreground?: RoleDecorationEntry;
    background?: RoleDecorationEntry;
}

function emptyResult(fullText = '', hits: Array<[number, string[]]> = []): RoleUsageRangeResult {
    return {
        roleToRanges: new Map(),
        hoverEntries: [],
        decorationEntries: [],
        visualSegments: [],
        snapshot: new Map(),
        fullText,
        hits,
    };
}

function roleHasBackground(role: Role): boolean {
    if (role.style && typeof role.style === 'object') {
        return typeof role.style.backgroundColor === 'string' && role.style.backgroundColor.trim().length > 0;
    }
    return typeof role.backgroundColor === 'string' && role.backgroundColor.trim().length > 0;
}

export async function collectRoleUsageRanges(
    doc: vscode.TextDocument,
    options: RoleUsageRangeOptions = {}
): Promise<RoleUsageRangeResult> {
    const cancellation = options.cancellationToken;
    let hits = options.hits;
    let fullText = options.fullText;

    if (cancellation?.isCancellationRequested) {
        return emptyResult(fullText ?? '', hits ?? []);
    }

    if (!hits) {
        try {
            const matches = await getRoleMatches(doc, fullText);
            if (cancellation?.isCancellationRequested) {
                return emptyResult(fullText ?? '');
            }
            hits = matches.map(m => [m.end, m.pats]);
            if ((!hits || hits.length === 0) && roles.length > 0) {
                fullText = fullText ?? doc.getText();
                const rawHits = ahoCorasickManager.search(fullText);
                hits = rawHits.map(([endIdx, pat]) => [endIdx, Array.isArray(pat) ? pat : [pat]]);
            }
        } catch {
            fullText = fullText ?? doc.getText();
            const rawHits = ahoCorasickManager.search(fullText);
            hits = rawHits.map(([endIdx, pat]) => [endIdx, Array.isArray(pat) ? pat : [pat]]);
        }
    }

    hits = hits ?? [];
    fullText = fullText ?? doc.getText();

    const patternRoleMap = new Map<string, Role>();
    const patternMetaMap = new Map<string, { role: Role; matchSource: RoleMatchSource; pattern: string }>();
    for (const r of roles) {
        const normalizedName = r.name.trim().normalize('NFC');
        patternRoleMap.set(normalizedName, r);
        patternMetaMap.set(normalizedName, { role: r, matchSource: 'name', pattern: r.name });
        for (const al of r.aliases || []) {
            if (!al) continue;
            const normalizedAlias = al.trim().normalize('NFC');
            patternRoleMap.set(normalizedAlias, r);
            patternMetaMap.set(normalizedAlias, { role: r, matchSource: 'alias', pattern: al });
        }
        for (const fix of r.fixes || []) {
            const f = fix.trim().normalize('NFC');
            if (f) {
                patternRoleMap.set(f, r);
                patternMetaMap.set(f, { role: r, matchSource: 'fix', pattern: fix });
            }
        }
        for (const lookupKey of getRoleLookupKeys(r)) {
            const normalizedLookup = lookupKey.trim().normalize('NFC');
            if (!normalizedLookup) continue;
            patternRoleMap.set(normalizedLookup, r);
            patternMetaMap.set(normalizedLookup, { role: r, matchSource: 'lookup', pattern: lookupKey });
        }
    }

    type Candidate = {
        role: Role;
        text: string;
        start: number;
        end: number;
        priority: number;
        pattern: string;
        matchSource: RoleMatchSource;
        partial: boolean;
    };
    const candidates: Candidate[] = [];

    for (const [endIdx, arr] of hits) {
        if (cancellation?.isCancellationRequested) {
            return emptyResult(fullText, hits);
        }
        for (const raw of arr) {
            const pat = raw.trim().normalize('NFC');
            const meta = patternMetaMap.get(pat);
            let role = meta?.role || patternRoleMap.get(pat) || ahoCorasickManager.getRole(pat);
            if (!role) {
                role = roles.find(r => roleMatchesKey(r, pat));
            }
            if (!role) {
                continue;
            }
            let matchSource: RoleMatchSource = meta?.matchSource || 'name';
            let pattern = meta?.pattern || pat;
            if (!meta) {
                if ((role.aliases || []).includes(pat)) {
                    matchSource = 'alias';
                } else if ((role.fixes || []).includes(pat)) {
                    matchSource = 'fix';
                } else if (getRoleLookupKeys(role).includes(pat)) {
                    matchSource = 'lookup';
                } else {
                    pattern = role.name;
                }
            }
            const start = endIdx - pat.length + 1;
            const end = endIdx + 1;
            candidates.push({
                role,
                text: pat,
                start,
                end,
                priority: role.priority ?? (role.type === '敏感词' ? 0 : 100),
                pattern,
                matchSource,
                partial: false,
            });
        }
    }

    const regexRoles = roles.filter(r => r.type === '正则表达式' && r.regex);
    for (const role of regexRoles) {
        if (cancellation?.isCancellationRequested) {
            return emptyResult(fullText, hits);
        }
        try {
            const regex = new RegExp(role.regex!, role.regexFlags || 'g');
            regex.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = regex.exec(fullText)) !== null) {
                const start = m.index;
                const end = start + m[0].length;
                candidates.push({
                    role,
                    text: m[0],
                    start,
                    end,
                    priority: (role.priority ?? 500) + 500,
                    pattern: role.regex!,
                    matchSource: 'regex',
                    partial: false,
                });
                if (m[0].length === 0) {
                    regex.lastIndex++;
                }
            }
        } catch (err) {
            console.warn(`[RoleUsageCollector] 正则角色 ${role.name} 无效`, err);
        }
    }

    candidates.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return b.text.length - a.text.length;
    });

    const selected: Candidate[] = [];
    const occupied: Array<{ start: number; end: number }> = [];

    const calculateFreeSegments = (start: number, end: number): Array<{ start: number; end: number }> => {
        const overlapping = occupied
            .filter(range => rangesOverlap(range.start, range.end, start, end))
            .sort((a, b) => a.start - b.start);
        if (overlapping.length === 0) {
            return [{ start, end }];
        }
        const segments: Array<{ start: number; end: number }> = [];
        let current = start;
        for (const range of overlapping) {
            if (current < range.start) {
                segments.push({ start: current, end: Math.min(range.start, end) });
            }
            current = Math.max(current, range.end);
            if (current >= end) break;
        }
        if (current < end) {
            segments.push({ start: current, end });
        }
        return segments;
    };

    for (const candidate of candidates) {
        if (cancellation?.isCancellationRequested) {
            return emptyResult(fullText, hits);
        }
        if (candidate.role.type === '正则表达式') {
            const segments = calculateFreeSegments(candidate.start, candidate.end);
            for (const segment of segments) {
                if (segment.end > segment.start) {
                    const matchedText = fullText.substring(segment.start, segment.end);
                    selected.push({
                        role: candidate.role,
                        text: matchedText,
                        start: segment.start,
                        end: segment.end,
                        priority: candidate.priority,
                        pattern: candidate.pattern,
                        matchSource: candidate.matchSource,
                        partial: matchedText !== candidate.text,
                    });
                }
            }
        } else {
            const hasOverlap = occupied.some(range => rangesOverlap(range.start, range.end, candidate.start, candidate.end));
            if (!hasOverlap) {
                selected.push(candidate);
                occupied.push({ start: candidate.start, end: candidate.end });
            }
        }
    }

    const roleToRanges = new Map<Role, vscode.Range[]>();
    const hoverEntries: { range: vscode.Range; role: Role }[] = [];
    const decorationEntries: RoleDecorationEntry[] = [];
    for (const c of selected) {
        const range = new vscode.Range(doc.positionAt(c.start), doc.positionAt(c.end));
        hoverEntries.push({ range, role: c.role });
        decorationEntries.push({
            range,
            role: c.role,
            matchedText: c.text,
            pattern: c.pattern,
            matchSource: c.matchSource,
            priority: c.priority,
            partial: c.partial,
        });
        if (!roleToRanges.has(c.role)) {
            roleToRanges.set(c.role, []);
        }
        roleToRanges.get(c.role)!.push(range);
    }

    const foregroundSegments = resolvePriorityLayer(selected.map(candidate => ({
        start: candidate.start,
        end: candidate.end,
        priority: candidate.priority,
        value: candidate,
    })));
    const backgroundSegments = resolvePriorityLayer(candidates
        .filter(candidate => roleHasBackground(candidate.role))
        .map(candidate => ({
            start: candidate.start,
            end: candidate.end,
            priority: candidate.priority,
            value: candidate,
        })));

    const entryForSegment = (candidate: Candidate, start: number, end: number): RoleDecorationEntry => ({
        range: new vscode.Range(doc.positionAt(start), doc.positionAt(end)),
        role: candidate.role,
        matchedText: fullText.substring(start, end),
        pattern: candidate.pattern,
        matchSource: candidate.matchSource,
        priority: candidate.priority,
        partial: candidate.partial || start !== candidate.start || end !== candidate.end,
    });

    const visualSegments: RoleVisualSegment[] = composeDecorationLayers(foregroundSegments, backgroundSegments)
        .map(segment => ({
            range: new vscode.Range(doc.positionAt(segment.start), doc.positionAt(segment.end)),
            foreground: segment.foreground
                ? entryForSegment(segment.foreground, segment.start, segment.end)
                : undefined,
            background: segment.background
                ? entryForSegment(segment.background, segment.start, segment.end)
                : undefined,
        }));

    const snapshot = new Map<string, vscode.Range[]>();
    for (const [role, ranges] of roleToRanges) {
        snapshot.set(role.name, ranges);
    }

    return {
        roleToRanges,
        hoverEntries,
        decorationEntries,
        visualSegments,
        snapshot,
        fullText,
        hits,
    };
}
