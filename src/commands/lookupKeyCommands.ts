import * as vscode from 'vscode';
import JSON5 from 'json5';
import { getRequestedLookupKeyCandidates } from '../utils/roleLookupKeyGeneration';

type LookupKind = 'pinyin' | 'romanized';

interface ParsedMarkdownField {
    headingStart: number;
    contentStart: number;
    contentEnd: number;
}

interface ParsedMarkdownRole {
    name: string;
    start: number;
    end: number;
    roleLevel: number;
    fields: Map<string, ParsedMarkdownField>;
    aliases: string[];
}

const FIELD_NAME_BY_KIND: Record<LookupKind, string> = {
    pinyin: '拼音查询键',
    romanized: '罗马字查询键',
};

const FIELD_KEY_BY_KIND: Record<LookupKind, string> = {
    pinyin: 'lookupKeys_pinyin',
    romanized: 'lookupKeys_romanized',
};

export function registerLookupKeyCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.generateLookupKeysForCurrentFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('没有当前打开的编辑器');
                return;
            }

            const document = editor.document;
            if (document.uri.scheme !== 'file') {
                vscode.window.showWarningMessage('只能为本地角色文件生成查询键');
                return;
            }

            const lowerPath = document.uri.fsPath.toLowerCase();
            if (lowerPath.endsWith('.md')) {
                await generateForMarkdownDocument(editor);
            } else if (lowerPath.endsWith('.json5') || lowerPath.endsWith('.ojson5')) {
                await generateForJson5Document(editor);
            } else {
                vscode.window.showWarningMessage('当前文件格式暂不支持一键生成查询键。请打开 Markdown、JSON5 或 OJSON5 角色文件。');
            }
        })
    );
}

async function generateForMarkdownDocument(editor: vscode.TextEditor): Promise<void> {
    const document = editor.document;
    const original = document.getText();
    const lines = original.split(/\r?\n/);
    const newline = original.includes('\r\n') ? '\r\n' : '\n';
    const roles = parseMarkdownRolesForLookup(lines);

    if (roles.length === 0) {
        vscode.window.showWarningMessage('当前 Markdown 文件中没有找到可更新的角色条目');
        return;
    }

    let changedRoles = 0;
    let addedValues = 0;
    const nextLines = lines.slice();

    for (const role of roles.slice().reverse()) {
        let roleChanged = false;
        for (const kind of ['romanized', 'pinyin'] as LookupKind[]) {
            const generated = await generateLookupValues({ name: role.name, aliases: role.aliases }, kind, document.uri.fsPath);
            if (generated.length === 0) {
                continue;
            }

            const existing = readMarkdownFieldValues(lines, role.fields.get(FIELD_KEY_BY_KIND[kind]));
            const merged = uniqueValues([...existing, ...generated]);
            if (merged.length === existing.length) {
                continue;
            }

            applyMarkdownField(nextLines, role, kind, merged);
            addedValues += merged.length - existing.length;
            roleChanged = true;
        }
        if (roleChanged) {
            changedRoles++;
        }
    }

    if (changedRoles === 0) {
        vscode.window.showInformationMessage('当前文件没有可新增的查询键');
        return;
    }

    await replaceWholeDocument(editor, nextLines.join(newline));
    vscode.window.showInformationMessage(`已为 ${changedRoles} 个条目生成查询键，新增 ${addedValues} 个值。`);
}

async function generateForJson5Document(editor: vscode.TextEditor): Promise<void> {
    const document = editor.document;
    let data: unknown;
    try {
        data = JSON5.parse(document.getText());
    } catch (error) {
        vscode.window.showErrorMessage(`JSON5 解析失败，无法生成查询键: ${error instanceof Error ? error.message : String(error)}`);
        return;
    }

    const roles = collectJson5RoleObjects(data);
    if (roles.length === 0) {
        vscode.window.showWarningMessage('当前 JSON5 文件中没有找到可更新的角色对象');
        return;
    }

    let changedRoles = 0;
    let addedValues = 0;
    for (const role of roles) {
        const name = typeof role.name === 'string' ? role.name.trim() : '';
        if (!name) {
            continue;
        }
        const aliases = toStringArray(role.aliases);
        let roleChanged = false;

        for (const kind of ['pinyin', 'romanized'] as LookupKind[]) {
            const fieldKey = FIELD_KEY_BY_KIND[kind];
            const existing = toStringArray(role[fieldKey]);
            const generated = await generateLookupValues({ name, aliases }, kind, document.uri.fsPath);
            const merged = uniqueValues([...existing, ...generated]);
            if (merged.length === existing.length) {
                continue;
            }
            role[fieldKey] = merged;
            addedValues += merged.length - existing.length;
            roleChanged = true;
        }

        if (roleChanged) {
            changedRoles++;
        }
    }

    if (changedRoles === 0) {
        vscode.window.showInformationMessage('当前文件没有可新增的查询键');
        return;
    }

    await replaceWholeDocument(editor, `${JSON.stringify(data, null, 2)}\n`);
    vscode.window.showInformationMessage(`已为 ${changedRoles} 个条目生成查询键，新增 ${addedValues} 个值。JSON5 文件已重新格式化。`);
}

async function generateLookupValues(role: { name?: string; aliases?: string[] }, kind: LookupKind, resourcePath: string): Promise<string[]> {
    const candidates = await getRequestedLookupKeyCandidates(role, kind, resourcePath);
    return uniqueValues(candidates.map(candidate => candidate.value));
}

function parseMarkdownRolesForLookup(lines: string[]): ParsedMarkdownRole[] {
    const roles: ParsedMarkdownRole[] = [];
    let fenced: '```' | '~~~' | undefined;

    const headers: Array<{ line: number; level: number; text: string }> = [];
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        const fenceMatch = trimmed.match(/^(```|~~~)/);
        if (fenceMatch) {
            const marker = fenceMatch[1] as '```' | '~~~';
            fenced = fenced === marker ? undefined : marker;
            continue;
        }
        if (fenced) {
            continue;
        }
        const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch) {
            headers.push({ line: i, level: headerMatch[1].length, text: headerMatch[2].trim() });
        }
    }

    for (let i = 0; i < headers.length; i++) {
        const header = headers[i];
        const nextSameOrParent = headers.find(next => next.line > header.line && next.level <= header.level);
        const end = nextSameOrParent ? nextSameOrParent.line : lines.length;
        const childHeaders = headers.filter(next => next.line > header.line && next.line < end && next.level === header.level + 1);
        const hasRoleField = childHeaders.some(child => normalizeMarkdownFieldName(child.text) === 'type');
        if (!hasRoleField) {
            continue;
        }

        const fields = new Map<string, ParsedMarkdownField>();
        for (let c = 0; c < childHeaders.length; c++) {
            const child = childHeaders[c];
            const nextChild = childHeaders[c + 1];
            const contentEnd = nextChild ? nextChild.line : end;
            fields.set(normalizeMarkdownFieldName(child.text), {
                headingStart: child.line,
                contentStart: child.line + 1,
                contentEnd,
            });
        }

        roles.push({
            name: header.text,
            start: header.line,
            end,
            roleLevel: header.level,
            fields,
            aliases: readMarkdownFieldValues(lines, fields.get('aliases')),
        });
    }

    return roles;
}

function normalizeMarkdownFieldName(text: string): string {
    const normalized = text.trim().toLowerCase();
    if (normalized === '类型' || normalized === 'type') return 'type';
    if (normalized === '别名' || normalized === 'alias' || normalized === 'aliases') return 'aliases';
    if (normalized === '拼音查询键' || normalized === '拼音检索键' || normalized === 'lookupkeys_pinyin') return 'lookupKeys_pinyin';
    if (normalized === '罗马字查询键' || normalized === '罗马字检索键' || normalized === 'lookupkeys_romanized') return 'lookupKeys_romanized';
    return normalized;
}

function readMarkdownFieldValues(lines: string[], field: ParsedMarkdownField | undefined): string[] {
    if (!field) {
        return [];
    }
    return splitValues(lines.slice(field.contentStart, field.contentEnd).join('\n'));
}

function applyMarkdownField(lines: string[], role: ParsedMarkdownRole, kind: LookupKind, values: string[]): void {
    const key = FIELD_KEY_BY_KIND[kind];
    const existing = role.fields.get(key);
    if (existing) {
        lines.splice(existing.contentStart, existing.contentEnd - existing.contentStart, ...values);
        return;
    }

    const heading = `${'#'.repeat(role.roleLevel + 1)} ${FIELD_NAME_BY_KIND[kind]}`;
    const insert = ['', heading, ...values];
    lines.splice(role.end, 0, ...insert);
}

function collectJson5RoleObjects(data: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(data)) {
        return data.filter(isRecord);
    }
    if (!isRecord(data)) {
        return [];
    }
    if (Array.isArray(data.roles)) {
        return data.roles.filter(isRecord);
    }
    if (Array.isArray(data.characters)) {
        return data.characters.filter(isRecord);
    }

    const records: Array<Record<string, unknown>> = [];
    for (const [key, value] of Object.entries(data)) {
        if (!isRecord(value)) {
            continue;
        }
        if (typeof value.name !== 'string') {
            value.name = key;
        }
        records.push(value);
    }
    return records;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return uniqueValues(value.flatMap(item => toStringArray(item)));
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return splitValues(String(value));
    }
    return [];
}

function splitValues(value: string): string[] {
    return uniqueValues(
        value
            .split(/[\r\n\t,，;；、]+/)
            .map(item => item.replace(/^[-*+]\s*/, '').trim())
            .filter(Boolean)
    );
}

function uniqueValues(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed) {
            continue;
        }
        const key = trimmed.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(trimmed);
    }
    return result;
}

async function replaceWholeDocument(editor: vscode.TextEditor, content: string): Promise<void> {
    const document = editor.document;
    const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
    );
    await editor.edit(builder => builder.replace(fullRange, content));
}
