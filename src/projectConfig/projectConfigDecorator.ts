import * as vscode from 'vscode';
import { ProjectConfigLinter, ValidationResult } from './projectConfigLinter';

export class ProjectConfigDecorator {
    private successDecorationType: vscode.TextEditorDecorationType;
    private errorDecorationType: vscode.TextEditorDecorationType;
    private linter: ProjectConfigLinter;
    private activeEditor: vscode.TextEditor | undefined;

    constructor(context: vscode.ExtensionContext, linter: ProjectConfigLinter) {
        this.linter = linter;
        
        // 创建装饰类型
        this.successDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                contentText: ' ✓',
                color: '#00ff00',
                fontWeight: 'bold',
                margin: '0 0 0 10px'
            }
        });
        
        this.errorDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                contentText: ' ✗',
                color: '#ff0000',
                fontWeight: 'bold',
                margin: '0 0 0 10px'
            }
        });
        
        // 监听编辑器变化
        this.activeEditor = vscode.window.activeTextEditor;
        
        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(this.onActiveEditorChange.bind(this)),
            vscode.workspace.onDidChangeTextDocument(this.onDocumentChange.bind(this)),
            this.successDecorationType,
            this.errorDecorationType
        );
        
        // 初始化当前编辑器
        if (this.activeEditor && this.isProjectConfigFile(this.activeEditor.document)) {
            this.updateDecorations();
        }
    }

    private isProjectConfigFile(document: vscode.TextDocument): boolean {
        return document.fileName.endsWith('anhproject.md');
    }

    private onActiveEditorChange(editor: vscode.TextEditor | undefined): void {
        this.activeEditor = editor;
        if (editor && this.isProjectConfigFile(editor.document)) {
            this.updateDecorations();
        }
    }

    private onDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        if (this.activeEditor && 
            event.document === this.activeEditor.document && 
            this.isProjectConfigFile(event.document)) {
            // 延迟更新装饰，避免频繁触发
            setTimeout(() => {
                this.updateDecorations();
            }, 500);
        }
    }

    private updateDecorations(): void {
        if (!this.activeEditor || !this.isProjectConfigFile(this.activeEditor.document)) {
            return;
        }

        const document = this.activeEditor.document;
        const validationResult = this.linter.validateDocument(document);
        
        const successRanges: vscode.Range[] = [];
        const errorRanges: vscode.Range[] = [];
        
        // 找到所有二级标题行
        const text = document.getText();
        const lines = text.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('## ')) {
                const sectionName = line.substring(3).trim();
                const range = new vscode.Range(
                    new vscode.Position(i, lines[i].length),
                    new vscode.Position(i, lines[i].length)
                );
                
                // 检查该部分的验证状态
                const isValid = validationResult.sectionStatus.get(sectionName);
                if (isValid === true) {
                    successRanges.push(range);
                } else if (isValid === false) {
                    errorRanges.push(range);
                }
                // 如果isValid为undefined（未知部分），不显示任何装饰
            }
        }
        
        // 应用装饰
        this.activeEditor.setDecorations(this.successDecorationType, successRanges);
        this.activeEditor.setDecorations(this.errorDecorationType, errorRanges);
    }

    public dispose(): void {
        this.successDecorationType.dispose();
        this.errorDecorationType.dispose();
    }
}