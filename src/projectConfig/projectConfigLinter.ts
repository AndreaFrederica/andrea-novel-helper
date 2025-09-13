import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ProjectConfigManager, ProjectConfig } from './projectConfigManager';

export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
    sectionStatus: Map<string, boolean>; // 各个二级标题的验证状态
}

export interface ValidationError {
    line: number;
    column: number;
    length: number;
    message: string;
    severity: vscode.DiagnosticSeverity;
    code?: string;
    source: string;
}

export class ProjectConfigLinter {
    private static readonly REQUIRED_SECTIONS = [
        '项目名称',
        '项目描述', 
        '作者',
        '项目UUID',
        '标签',
        '封面'
    ];

    private static readonly OPTIONAL_SECTIONS = [
        '项目简介',
        '创建时间',
        '更新时间'
    ];

    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor(context: vscode.ExtensionContext) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('anhproject');
        context.subscriptions.push(this.diagnosticCollection);
        
        // 监听文档变化
        context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(this.onDocumentChange.bind(this)),
            vscode.workspace.onDidOpenTextDocument(this.onDocumentOpen.bind(this)),
            vscode.workspace.onDidCloseTextDocument(this.onDocumentClose.bind(this))
        );

        // 初始化已打开的文档
        vscode.workspace.textDocuments.forEach(doc => {
            if (this.isProjectConfigFile(doc)) {
                this.validateDocument(doc);
            }
        });
    }

    private isProjectConfigFile(document: vscode.TextDocument): boolean {
        return document.fileName.endsWith('anhproject.md');
    }

    private onDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        if (this.isProjectConfigFile(event.document)) {
            // 延迟验证，避免频繁触发
            setTimeout(() => {
                this.validateDocument(event.document);
            }, 500);
        }
    }

    private onDocumentOpen(document: vscode.TextDocument): void {
        if (this.isProjectConfigFile(document)) {
            this.validateDocument(document);
        }
    }

    private onDocumentClose(document: vscode.TextDocument): void {
        if (this.isProjectConfigFile(document)) {
            this.diagnosticCollection.delete(document.uri);
        }
    }

    public validateDocument(document: vscode.TextDocument): ValidationResult {
        const result = this.validateContent(document.getText(), document);
        
        // 转换为VS Code诊断信息
        const diagnostics: vscode.Diagnostic[] = result.errors.map(error => {
            const range = new vscode.Range(
                error.line,
                error.column,
                error.line,
                error.column + error.length
            );
            
            const diagnostic = new vscode.Diagnostic(
                range,
                error.message,
                error.severity
            );
            
            diagnostic.code = error.code;
            diagnostic.source = error.source;
            
            return diagnostic;
        });
        
        this.diagnosticCollection.set(document.uri, diagnostics);
        
        return result;
    }

    private validateContent(content: string, document?: vscode.TextDocument): ValidationResult {
        const errors: ValidationError[] = [];
        const sectionStatus = new Map<string, boolean>();
        const lines = content.split('\n');
        
        // 检查必需的二级标题
        const foundSections = new Set<string>();
        const sectionLines = new Map<string, number>();
        
        // 解析所有二级标题
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('## ')) {
                const sectionName = line.substring(3).trim();
                foundSections.add(sectionName);
                sectionLines.set(sectionName, i);
            }
        }
        
        // 检查必需部分
        for (const requiredSection of ProjectConfigLinter.REQUIRED_SECTIONS) {
            if (!foundSections.has(requiredSection)) {
                errors.push({
                    line: 0,
                    column: 0,
                    length: 0,
                    message: `缺少必需的二级标题: ## ${requiredSection}`,
                    severity: vscode.DiagnosticSeverity.Error,
                    code: 'missing-required-section',
                    source: 'anhproject-linter'
                });
                sectionStatus.set(requiredSection, false);
            } else {
                // 验证该部分的内容
                const isValid = this.validateSection(requiredSection, lines, sectionLines.get(requiredSection)!, errors);
                sectionStatus.set(requiredSection, isValid);
            }
        }
        
        // 检查可选部分
        for (const optionalSection of ProjectConfigLinter.OPTIONAL_SECTIONS) {
            if (foundSections.has(optionalSection)) {
                const isValid = this.validateSection(optionalSection, lines, sectionLines.get(optionalSection)!, errors);
                sectionStatus.set(optionalSection, isValid);
            }
        }
        
        // 检查未知部分
        for (const section of foundSections) {
            if (!ProjectConfigLinter.REQUIRED_SECTIONS.includes(section) && 
                !ProjectConfigLinter.OPTIONAL_SECTIONS.includes(section)) {
                const lineNum = sectionLines.get(section)!;
                errors.push({
                    line: lineNum,
                    column: 0,
                    length: lines[lineNum].length,
                    message: `未知的二级标题: ${section}`,
                    severity: vscode.DiagnosticSeverity.Warning,
                    code: 'unknown-section',
                    source: 'anhproject-linter'
                });
                sectionStatus.set(section, false);
            }
        }
        
        return {
            isValid: errors.filter(e => e.severity === vscode.DiagnosticSeverity.Error).length === 0,
            errors,
            sectionStatus
        };
    }

    /**
     * 解析标签内容，支持换行分割、逗号分割和注释
     */
    private parseTags(content: string): string[] {
        const tags: string[] = [];
        
        // 按行分割内容
        const lines = content.split('\n');
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            // 跳过空行和注释行（以 // 开头）
            if (!trimmedLine || trimmedLine.startsWith('//')) {
                continue;
            }
            
            // 处理逗号分割的标签
            const lineTags = trimmedLine.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
            tags.push(...lineTags);
        }
        
        // 去重并返回
        return [...new Set(tags)];
    }

    private validateSection(sectionName: string, lines: string[], sectionLine: number, errors: ValidationError[]): boolean {
        // 找到该部分的内容（到下一个二级标题或文件结尾）
        let contentStart = sectionLine + 1;
        let contentEnd = lines.length;
        
        for (let i = contentStart; i < lines.length; i++) {
            if (lines[i].trim().startsWith('## ')) {
                contentEnd = i;
                break;
            }
        }
        
        const sectionContent = lines.slice(contentStart, contentEnd)
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join(' ');
        
        let isValid = true;
        
        switch (sectionName) {
            case '项目名称':
                if (!sectionContent || sectionContent.length === 0) {
                    errors.push({
                        line: sectionLine + 1,
                        column: 0,
                        length: 0,
                        message: '项目名称不能为空',
                        severity: vscode.DiagnosticSeverity.Error,
                        code: 'empty-project-name',
                        source: 'anhproject-linter'
                    });
                    isValid = false;
                } else if (sectionContent.length > 100) {
                    errors.push({
                        line: sectionLine + 1,
                        column: 0,
                        length: sectionContent.length,
                        message: '项目名称过长（建议不超过100字符）',
                        severity: vscode.DiagnosticSeverity.Warning,
                        code: 'long-project-name',
                        source: 'anhproject-linter'
                    });
                }
                break;
                
            case '项目描述':
                if (!sectionContent || sectionContent.length === 0) {
                    errors.push({
                        line: sectionLine + 1,
                        column: 0,
                        length: 0,
                        message: '项目描述不能为空',
                        severity: vscode.DiagnosticSeverity.Error,
                        code: 'empty-project-description',
                        source: 'anhproject-linter'
                    });
                    isValid = false;
                }
                break;
                
            case '作者':
                if (!sectionContent || sectionContent.length === 0) {
                    errors.push({
                        line: sectionLine + 1,
                        column: 0,
                        length: 0,
                        message: '作者信息不能为空',
                        severity: vscode.DiagnosticSeverity.Error,
                        code: 'empty-author',
                        source: 'anhproject-linter'
                    });
                    isValid = false;
                }
                break;
                
            case '项目UUID':
                if (!sectionContent || sectionContent.length === 0) {
                    errors.push({
                        line: sectionLine + 1,
                        column: 0,
                        length: 0,
                        message: '项目UUID不能为空',
                        severity: vscode.DiagnosticSeverity.Error,
                        code: 'empty-uuid',
                        source: 'anhproject-linter'
                    });
                    isValid = false;
                } else {
                    // 验证UUID格式
                    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
                    if (!uuidRegex.test(sectionContent)) {
                        errors.push({
                            line: sectionLine + 1,
                            column: 0,
                            length: sectionContent.length,
                            message: '项目UUID格式不正确',
                            severity: vscode.DiagnosticSeverity.Error,
                            code: 'invalid-uuid-format',
                            source: 'anhproject-linter'
                        });
                        isValid = false;
                    }
                }
                break;
                
            case '项目简介':
                // 项目简介是可选字段，如果存在则验证长度
                if (sectionContent && sectionContent.length > 1000) {
                    errors.push({
                        line: sectionLine + 1,
                        column: 0,
                        length: sectionContent.length,
                        message: '项目简介过长（建议不超过1000字符）',
                        severity: vscode.DiagnosticSeverity.Warning,
                        code: 'long-project-intro',
                        source: 'anhproject-linter'
                    });
                }
                break;
                
            case '标签':
                if (!sectionContent || sectionContent.length === 0) {
                    errors.push({
                        line: sectionLine + 1,
                        column: 0,
                        length: 0,
                        message: '标签不能为空（至少需要一个标签）',
                        severity: vscode.DiagnosticSeverity.Error,
                        code: 'empty-tags',
                        source: 'anhproject-linter'
                    });
                    isValid = false;
                } else {
                    // 使用新的标签解析逻辑验证标签
                    const tags = this.parseTags(sectionContent);
                    if (tags.length === 0) {
                        errors.push({
                            line: sectionLine + 1,
                            column: 0,
                            length: sectionContent.length,
                            message: '标签格式不正确（应使用逗号或换行分隔，支持 // 注释）',
                            severity: vscode.DiagnosticSeverity.Error,
                            code: 'invalid-tags-format',
                            source: 'anhproject-linter'
                        });
                        isValid = false;
                    }
                }
                break;
                
            case '创建时间':
            case '更新时间':
                if (sectionContent && sectionContent.length > 0) {
                    // 验证日期格式
                    const date = new Date(sectionContent);
                    if (isNaN(date.getTime())) {
                        errors.push({
                            line: sectionLine + 1,
                            column: 0,
                            length: sectionContent.length,
                            message: `${sectionName}格式不正确（应为有效的日期格式）`,
                            severity: vscode.DiagnosticSeverity.Warning,
                            code: 'invalid-date-format',
                            source: 'anhproject-linter'
                        });
                    }
                }
                break;
                
            case '封面':
                if (!sectionContent || sectionContent.length === 0) {
                    errors.push({
                        line: sectionLine + 1,
                        column: 0,
                        length: 0,
                        message: '封面不能为空，必须包含有效的Markdown图片链接',
                        severity: vscode.DiagnosticSeverity.Error,
                        code: 'empty-cover',
                        source: 'anhproject-linter'
                    });
                    isValid = false;
                } else {
                    // 验证Markdown图片链接格式
                    const mdImageRegex = /!\[.*?\]\((.+?)\)/;
                    const match = sectionContent.match(mdImageRegex);
                    
                    if (!match) {
                        errors.push({
                            line: sectionLine + 1,
                            column: 0,
                            length: sectionContent.length,
                            message: '封面必须是有效的Markdown图片链接格式：![alt](path)',
                            severity: vscode.DiagnosticSeverity.Error,
                            code: 'invalid-cover-format',
                            source: 'anhproject-linter'
                        });
                        isValid = false;
                    } else {
                        const imagePath = match[1];
                        // 检查图片文件是否存在
                        try {
                            // 如果是相对路径，需要相对于项目配置文件的目录
                            let fullImagePath = imagePath;
                            if (!path.isAbsolute(imagePath)) {
                                // 假设项目配置文件在项目根目录
                                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                                if (workspaceFolder) {
                                    fullImagePath = path.join(workspaceFolder.uri.fsPath, imagePath);
                                }
                            }
                            
                            if (!fs.existsSync(fullImagePath)) {
                                errors.push({
                                    line: sectionLine + 1,
                                    column: 0,
                                    length: sectionContent.length,
                                    message: `封面图片文件不存在：${imagePath}`,
                                    severity: vscode.DiagnosticSeverity.Error,
                                    code: 'cover-file-not-found',
                                    source: 'anhproject-linter'
                                });
                                isValid = false;
                            }
                        } catch (error) {
                            errors.push({
                                line: sectionLine + 1,
                                column: 0,
                                length: sectionContent.length,
                                message: `无法检查封面图片文件：${imagePath}`,
                                severity: vscode.DiagnosticSeverity.Warning,
                                code: 'cover-file-check-error',
                                source: 'anhproject-linter'
                            });
                        }
                    }
                }
                break;
        }
        
        return isValid;
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
}