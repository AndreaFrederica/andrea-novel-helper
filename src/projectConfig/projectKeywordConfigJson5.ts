import * as path from 'path';
import * as vscode from 'vscode';
import JSON5 from 'json5';
import {
    PROJECT_KEYWORD_CONFIG_DEFINITIONS,
    PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME,
    type ProjectKeywordConfigDefinition,
    normalizeKeywordList,
} from './projectKeywordConfig';
import { PROJECT_JSON5_EXTRA_FIELD_DEFINITIONS } from './projectJson5Config';

export class ProjectKeywordConfigJson5Linter implements vscode.Disposable {
    private readonly diagnosticCollection: vscode.DiagnosticCollection;

    constructor(context: vscode.ExtensionContext) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('anhproject-keyword-config');
        context.subscriptions.push(this.diagnosticCollection);

        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(document => this.onOpenOrChange(document)),
            vscode.workspace.onDidChangeTextDocument(event => this.onOpenOrChange(event.document)),
            vscode.workspace.onDidCloseTextDocument(document => this.onClose(document))
        );

        vscode.workspace.textDocuments.forEach(document => this.onOpenOrChange(document));
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
    }

    public validateDocument(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();
        let parsed: unknown;

        try {
            parsed = JSON5.parse(text);
        } catch (error) {
            diagnostics.push(this.createParseErrorDiagnostic(document, error));
            this.diagnosticCollection.set(document.uri, diagnostics);
            return diagnostics;
        }

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(0, 0, 0, 1),
                'project-config.json5 顶层必须是对象',
                vscode.DiagnosticSeverity.Error
            ));
            this.diagnosticCollection.set(document.uri, diagnostics);
            return diagnostics;
        }

        const record = parsed as Record<string, unknown>;
        const allowedKeys = new Set([
            ...PROJECT_KEYWORD_CONFIG_DEFINITIONS.map(definition => definition.key),
            ...PROJECT_JSON5_EXTRA_FIELD_DEFINITIONS.map(definition => definition.key),
        ]);

        for (const key of Object.keys(record)) {
            if (allowedKeys.has(key as any)) {
                continue;
            }

            diagnostics.push(new vscode.Diagnostic(
                this.findKeyRange(document, key),
                `未知配置项: ${key}`,
                vscode.DiagnosticSeverity.Warning
            ));
        }

        for (const definition of PROJECT_KEYWORD_CONFIG_DEFINITIONS) {
            if (!(definition.key in record)) {
                continue;
            }

            diagnostics.push(...this.validateKeywordValue(document, definition, record[definition.key]));
        }

        diagnostics.push(...this.validateResourceManifest(document, record));

        this.diagnosticCollection.set(document.uri, diagnostics);
        return diagnostics;
    }

    private validateResourceManifest(document: vscode.TextDocument, record: Record<string, unknown>): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const manifestRange = this.findKeyRange(document, 'includes');
        if ('resourceDiscovery' in record && (typeof record.resourceDiscovery !== 'string' || !['marker', 'explicit', 'all'].includes(record.resourceDiscovery))) {
            diagnostics.push(new vscode.Diagnostic(this.findKeyRange(document, 'resourceDiscovery'), 'resourceDiscovery 必须是 marker、explicit 或 all', vscode.DiagnosticSeverity.Error));
        }
        if ('autoDiscovery' in record && typeof record.autoDiscovery !== 'boolean') {
            diagnostics.push(new vscode.Diagnostic(this.findKeyRange(document, 'autoDiscovery'), 'autoDiscovery 必须是布尔值', vscode.DiagnosticSeverity.Error));
        }
        if ('excludes' in record && !(Array.isArray(record.excludes) && record.excludes.every(item => typeof item === 'string'))) {
            diagnostics.push(new vscode.Diagnostic(this.findKeyRange(document, 'excludes'), 'excludes 必须是字符串数组', vscode.DiagnosticSeverity.Error));
        }
        if (!('includes' in record)) {
            return diagnostics;
        }
        if (!Array.isArray(record.includes)) {
            diagnostics.push(new vscode.Diagnostic(manifestRange, 'includes 必须是数组', vscode.DiagnosticSeverity.Error));
            return diagnostics;
        }
        const allowedKinds = new Set(['role', 'sensitive', 'vocabulary', 'regex', 'auto']);
        const validateIncludePath = (includePath: string, index: number) => {
            const normalized = includePath.trim().replace(/\\/g, '/');
            if (path.isAbsolute(normalized) || normalized.split('/').includes('..')) {
                diagnostics.push(new vscode.Diagnostic(manifestRange, `includes[${index}].path 必须是工作区内的相对路径`, vscode.DiagnosticSeverity.Error));
            } else if (normalized === '.' || normalized === './') {
                diagnostics.push(new vscode.Diagnostic(manifestRange, `includes[${index}].path 不能直接包含工作区根目录`, vscode.DiagnosticSeverity.Error));
            }
        };
        record.includes.forEach((entry, index) => {
            if (typeof entry === 'string') {
                if (!entry.trim()) {
                    diagnostics.push(new vscode.Diagnostic(manifestRange, `includes[${index}] 不能为空`, vscode.DiagnosticSeverity.Error));
                } else {
                    validateIncludePath(entry, index);
                }
                return;
            }
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                diagnostics.push(new vscode.Diagnostic(manifestRange, `includes[${index}] 必须是路径字符串或对象`, vscode.DiagnosticSeverity.Error));
                return;
            }
            const item = entry as Record<string, unknown>;
            if (typeof item.path !== 'string' || !item.path.trim()) {
                diagnostics.push(new vscode.Diagnostic(manifestRange, `includes[${index}].path 必须是非空字符串`, vscode.DiagnosticSeverity.Error));
            } else {
                validateIncludePath(item.path, index);
            }
            if (item.kind !== undefined && (typeof item.kind !== 'string' || !allowedKinds.has(item.kind))) {
                diagnostics.push(new vscode.Diagnostic(manifestRange, `includes[${index}].kind 类型无效`, vscode.DiagnosticSeverity.Error));
            }
            if (item.recursive !== undefined && typeof item.recursive !== 'boolean') {
                diagnostics.push(new vscode.Diagnostic(manifestRange, `includes[${index}].recursive 必须是布尔值`, vscode.DiagnosticSeverity.Error));
            }
        });
        return diagnostics;
    }

    private onOpenOrChange(document: vscode.TextDocument): void {
        if (!this.isKeywordConfigDocument(document)) {
            return;
        }
        this.validateDocument(document);
    }

    private onClose(document: vscode.TextDocument): void {
        if (!this.isKeywordConfigDocument(document)) {
            return;
        }
        this.diagnosticCollection.delete(document.uri);
    }

    private isKeywordConfigDocument(document: vscode.TextDocument): boolean {
        return path.basename(document.fileName).toLowerCase() === PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME;
    }

    private validateKeywordValue(
        document: vscode.TextDocument,
        definition: ProjectKeywordConfigDefinition,
        value: unknown
    ): vscode.Diagnostic[] {
        const range = this.findKeyRange(document, definition.key);

        if (typeof value === 'string') {
            if (value.trim() && normalizeKeywordList(value).length === 0) {
                return [new vscode.Diagnostic(
                    range,
                    `${definition.key} 格式不正确，应为字符串数组或可分隔的字符串`,
                    vscode.DiagnosticSeverity.Error
                )];
            }
            return [];
        }

        if (Array.isArray(value)) {
            const diagnostics: vscode.Diagnostic[] = [];
            value.forEach((entry, index) => {
                if (typeof entry !== 'string') {
                    diagnostics.push(new vscode.Diagnostic(
                        range,
                        `${definition.key}[${index}] 必须是字符串`,
                        vscode.DiagnosticSeverity.Error
                    ));
                    return;
                }
                if (!entry.trim()) {
                    diagnostics.push(new vscode.Diagnostic(
                        range,
                        `${definition.key}[${index}] 不能为空字符串`,
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
            });
            return diagnostics;
        }

        return [new vscode.Diagnostic(
            range,
            `${definition.key} 必须是字符串或字符串数组`,
            vscode.DiagnosticSeverity.Error
        )];
    }

    private createParseErrorDiagnostic(document: vscode.TextDocument, error: unknown): vscode.Diagnostic {
        const lineNumber = typeof error === 'object' && error && 'lineNumber' in error ? Number((error as any).lineNumber) - 1 : 0;
        const columnNumber = typeof error === 'object' && error && 'columnNumber' in error ? Number((error as any).columnNumber) - 1 : 0;
        const safeLine = Number.isFinite(lineNumber) && lineNumber >= 0 ? lineNumber : 0;
        const safeColumn = Number.isFinite(columnNumber) && columnNumber >= 0 ? columnNumber : 0;
        return new vscode.Diagnostic(
            new vscode.Range(safeLine, safeColumn, safeLine, safeColumn + 1),
            `project-config.json5 解析失败: ${(error as Error)?.message || String(error)}`,
            vscode.DiagnosticSeverity.Error
        );
    }

    private findKeyRange(document: vscode.TextDocument, key: string): vscode.Range {
        const text = document.getText();
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(["'])?${escapedKey}\\1?\\s*:`, 'm');
        const match = regex.exec(text);
        if (!match || match.index === undefined) {
            return new vscode.Range(0, 0, 0, 1);
        }

        const start = document.positionAt(match.index);
        return new vscode.Range(start, start.translate(0, key.length));
    }
}

export class ProjectKeywordConfigJson5CompletionProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(document: vscode.TextDocument): vscode.ProviderResult<vscode.CompletionItem[]> {
        if (path.basename(document.fileName).toLowerCase() !== PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME) {
            return [];
        }

        const keywordItems = PROJECT_KEYWORD_CONFIG_DEFINITIONS.map(definition => {
            const item = new vscode.CompletionItem(definition.key, vscode.CompletionItemKind.Property);
            item.detail = definition.detail;
            item.insertText = new vscode.SnippetString(`${definition.key}: [\n  '$1'\n],`);
            item.documentation = new vscode.MarkdownString(definition.detail);
            return item;
        });

        const extraItems = PROJECT_JSON5_EXTRA_FIELD_DEFINITIONS.map(definition => {
            const item = new vscode.CompletionItem(definition.key, vscode.CompletionItemKind.Property);
            item.detail = definition.detail;
            item.insertText = new vscode.SnippetString(definition.snippet);
            item.documentation = new vscode.MarkdownString(definition.detail);
            return item;
        });

        return [...keywordItems, ...extraItems];
    }
}
