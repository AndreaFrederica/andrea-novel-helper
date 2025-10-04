import * as vscode from 'vscode';
import { Role } from '../extension';
import { roles } from '../activate';
import { getRoleMatches } from '../context/roleAsyncShared';
import { ahoCorasickManager } from '../utils/AhoCorasick/ahoCorasickManager';
import { rangesOverlap } from '../utils/utils';

export interface RoleUsageRangeOptions {
    hits?: Array<[number, string[]]>;
    fullText?: string;
    cancellationToken?: vscode.CancellationToken;
}

export interface RoleUsageRangeResult {
    roleToRanges: Map<Role, vscode.Range[]>;
    hoverEntries: { range: vscode.Range; role: Role }[];
    snapshot: Map<string, vscode.Range[]>;
    fullText: string;
    hits: Array<[number, string[]]>;
}

export async function collectRoleUsageRanges(
    doc: vscode.TextDocument,
    options: RoleUsageRangeOptions = {}
): Promise<RoleUsageRangeResult> {
    const cancellation = options.cancellationToken;
    let hits = options.hits;
    let fullText = options.fullText;

    if (cancellation?.isCancellationRequested) {
        return { roleToRanges: new Map(), hoverEntries: [], snapshot: new Map(), fullText: fullText ?? '', hits: hits ?? [] };
    }

    if (!hits) {
        try {
            const matches = await getRoleMatches(doc, fullText);
            if (cancellation?.isCancellationRequested) {
                return { roleToRanges: new Map(), hoverEntries: [], snapshot: new Map(), fullText: fullText ?? '', hits: [] };
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
    for (const r of roles) {
        patternRoleMap.set(r.name.trim().normalize('NFC'), r);
        for (const al of r.aliases || []) {
            if (!al) continue;
            patternRoleMap.set(al.trim().normalize('NFC'), r);
        }
        for (const fix of r.fixes || []) {
            const f = fix.trim().normalize('NFC');
            if (f) {
                patternRoleMap.set(f.trim().normalize('NFC'), r);
            }
        }
    }

    type Candidate = { role: Role; text: string; start: number; end: number; priority: number };
    const candidates: Candidate[] = [];

    for (const [endIdx, arr] of hits) {
        if (cancellation?.isCancellationRequested) {
            return { roleToRanges: new Map(), hoverEntries: [], snapshot: new Map(), fullText, hits };
        }
        for (const raw of arr) {
            const pat = raw.trim().normalize('NFC');
            let role = patternRoleMap.get(pat) || ahoCorasickManager.getRole(pat);
            if (!role) {
                role = roles.find(r => r.name === pat || r.aliases?.includes(pat));
            }
            if (!role) {
                continue;
            }
            const start = endIdx - pat.length + 1;
            const end = endIdx + 1;
            candidates.push({
                role,
                text: pat,
                start,
                end,
                priority: role.priority ?? (role.type === '敏感词' ? 0 : 100)
            });
        }
    }

    const regexRoles = roles.filter(r => r.type === '正则表达式' && r.regex);
    for (const role of regexRoles) {
        if (cancellation?.isCancellationRequested) {
            return { roleToRanges: new Map(), hoverEntries: [], snapshot: new Map(), fullText, hits };
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
                    priority: (role.priority ?? 500) + 500
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
            return { roleToRanges: new Map(), hoverEntries: [], snapshot: new Map(), fullText, hits };
        }
        if (candidate.role.type === '正则表达式') {
            const segments = calculateFreeSegments(candidate.start, candidate.end);
            for (const segment of segments) {
                if (segment.end > segment.start) {
                    selected.push({
                        role: candidate.role,
                        text: fullText.substring(segment.start, segment.end),
                        start: segment.start,
                        end: segment.end,
                        priority: candidate.priority
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
    for (const c of selected) {
        const range = new vscode.Range(doc.positionAt(c.start), doc.positionAt(c.end));
        hoverEntries.push({ range, role: c.role });
        if (!roleToRanges.has(c.role)) {
            roleToRanges.set(c.role, []);
        }
        roleToRanges.get(c.role)!.push(range);
    }

    const snapshot = new Map<string, vscode.Range[]>();
    for (const [role, ranges] of roleToRanges) {
        snapshot.set(role.name, ranges);
    }

    return { roleToRanges, hoverEntries, snapshot, fullText, hits };
}
