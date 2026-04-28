import * as path from 'path';
import * as vscode from 'vscode';
import JSON5 from 'json5';
import {
    PROJECT_KEYWORD_CONFIG_DEFINITIONS,
    PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME,
    type ProjectKeywordConfigDefinition,
    normalizeKeywordList,
} from './projectKeywordConfig';

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
        const allowedKeys = new Set(PROJECT_KEYWORD_CONFIG_DEFINITIONS.map(definition => definition.key));

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

        this.diagnosticCollection.set(document.uri, diagnostics);
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

        return PROJECT_KEYWORD_CONFIG_DEFINITIONS.map(definition => {
            const item = new vscode.CompletionItem(definition.key, vscode.CompletionItemKind.Property);
            item.detail = definition.detail;
            item.insertText = new vscode.SnippetString(`${definition.key}: [\n  '$1'\n],`);
            item.documentation = new vscode.MarkdownString(definition.detail);
            return item;
        });
    }
}