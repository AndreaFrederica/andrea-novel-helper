import * as vscode from 'vscode';
import { roles } from '../activate';
import { getObsidianProjectIndex, ObsidianTagReference } from '../language/obsidianIndex';
import { resolveTagRole } from '../language/tagRoleBridge';
import { getRoleReferenceLocations, referenceLocationKey, shouldFilterReferencePath } from './roleReferenceProvider';

const TAG_IN_LINE_RE = /(^|[\s([{>])(#(?:[A-Fa-f0-9]{3}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})\b|#(?:[A-Za-z0-9_\-\u4e00-\u9fff]+)(?:\/[A-Za-z0-9_\-\u4e00-\u9fff]+)*)/g;

class TagReferenceProvider implements vscode.ReferenceProvider {
    async provideReferences(document: vscode.TextDocument, position: vscode.Position, _context: vscode.ReferenceContext, token: vscode.CancellationToken): Promise<vscode.Location[] | null> {
        const tag = findTagAtPosition(document, position);
        if (!tag || token.isCancellationRequested) return null;

        const role = resolveTagRole(tag, roles).role;
        if (role) {
            return mergeLocations(getRoleReferenceLocations(role, token, document) || [], await getTagReferenceLocations(tag, token));
        }

        return getTagReferenceLocations(tag, token);
    }
}

export function registerTagReferenceProvider(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.languages.registerReferenceProvider({ scheme: 'file' }, new TagReferenceProvider()));
}

export async function getTagReferenceLocations(tag: string, token?: vscode.CancellationToken): Promise<vscode.Location[]> {
    const occurrences = await getObsidianProjectIndex()?.getTagOccurrences(tag) || [];
    if (token?.isCancellationRequested) return [];
    return tagOccurrencesToLocations(occurrences);
}

export async function getReferencesForTagNode(tag: string, token?: vscode.CancellationToken): Promise<{ locations: vscode.Location[]; delegatedRoleName?: string }> {
    const role = resolveTagRole(tag, roles).role;
    if (role) {
        return { locations: mergeLocations(getRoleReferenceLocations(role, token) || [], await getTagReferenceLocations(tag, token)), delegatedRoleName: role.name };
    }
    return { locations: await getTagReferenceLocations(tag, token) };
}

function findTagAtPosition(document: vscode.TextDocument, position: vscode.Position): string | undefined {
    const line = document.lineAt(position.line).text;
    TAG_IN_LINE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TAG_IN_LINE_RE.exec(line))) {
        const tag = match[2];
        const start = match.index + match[1].length;
        const end = start + tag.length;
        if (position.character >= start && position.character <= end) {
            return tag;
        }
    }
    return undefined;
}

function tagOccurrencesToLocations(occurrences: ObsidianTagReference[]): vscode.Location[] {
    const dedupe = new Set<string>();
    const locations: vscode.Location[] = [];
    for (const occurrence of occurrences) {
        if (shouldFilterReferencePath(occurrence.uri.fsPath)) continue;
        const start = new vscode.Position(occurrence.line, occurrence.character);
        const end = new vscode.Position(occurrence.line, occurrence.character + occurrence.tag.length);
        const location = new vscode.Location(occurrence.uri, new vscode.Range(start, end));
        const key = referenceLocationKey(location);
        if (dedupe.has(key)) continue;
        dedupe.add(key);
        locations.push(location);
    }
    return locations;
}

function mergeLocations(primary: vscode.Location[], secondary: vscode.Location[]): vscode.Location[] {
    const dedupe = new Set<string>();
    const merged: vscode.Location[] = [];
    for (const location of [...primary, ...secondary]) {
        const key = referenceLocationKey(location);
        if (dedupe.has(key)) continue;
        dedupe.add(key);
        merged.push(location);
    }
    return merged;
}