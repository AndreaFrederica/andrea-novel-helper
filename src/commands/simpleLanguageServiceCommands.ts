import * as vscode from 'vscode';
import { SimpleLanguageServiceProxy } from '../Provider/editor/SimpleLanguageServiceProxy';

/**
 * 注册简单的语言服务命令
 */
export function registerSimpleLanguageServiceCommands(context: vscode.ExtensionContext) {
    
    // 获取当前编辑器的 hover 信息
    const getHoverCommand = vscode.commands.registerCommand('andrea.getHover', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('没有活动的编辑器');
            return;
        }
        
        const position = editor.selection.active;
        const hoverResults = await SimpleLanguageServiceProxy.getInstance().getHover(editor.document, position);
        
        if (hoverResults && hoverResults.length > 0) {
            const hoverText = hoverResults.map(h => {
                if (typeof h.contents === 'string') {
                    return h.contents;
                } else if (Array.isArray(h.contents)) {
                    return h.contents.map(c => typeof c === 'string' ? c : (c as any).value || '').join('\n');
                } else {
                    return (h.contents as any).value || '';
                }
            }).join('\n\n');
            
            // 显示结果
            const doc = await vscode.workspace.openTextDocument({
                content: hoverText,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc);
        } else {
            vscode.window.showInformationMessage('没有找到 hover 信息');
        }
    });
    
    // 获取当前编辑器的自动完成
    const getCompletionCommand = vscode.commands.registerCommand('andrea.getCompletion', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('没有活动的编辑器');
            return;
        }
        
        const position = editor.selection.active;
        const completionResults = await SimpleLanguageServiceProxy.getInstance().getCompletion(editor.document, position);
        
        if (completionResults && completionResults.items.length > 0) {
            const completionText = completionResults.items.map(item => {
                return `${item.label}: ${item.detail || item.documentation || '无描述'}`;
            }).join('\n');
            
            // 显示结果
            const doc = await vscode.workspace.openTextDocument({
                content: completionText,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc);
        } else {
            vscode.window.showInformationMessage('没有找到自动完成项');
        }
    });
    
    // 获取当前编辑器的定义
    const getDefinitionCommand = vscode.commands.registerCommand('andrea.getDefinition', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('没有活动的编辑器');
            return;
        }
        
        const position = editor.selection.active;
        const definitionResults = await SimpleLanguageServiceProxy.getInstance().getDefinition(editor.document, position);
        
        if (definitionResults) {
            let locations: vscode.Location[];
            
            if (Array.isArray(definitionResults)) {
                if (definitionResults.length > 0 && 'uri' in definitionResults[0]) {
                    locations = definitionResults as vscode.Location[];
                } else {
                    // LocationLink[] 转 Location[]
                    locations = (definitionResults as vscode.LocationLink[]).map(link => 
                        new vscode.Location(link.targetUri, link.targetRange)
                    );
                }
            } else {
                locations = [definitionResults as vscode.Location];
            }
            
            // 显示位置信息
            const locationText = locations.map(loc => {
                return `${loc.uri.fsPath}:${loc.range.start.line + 1}:${loc.range.start.character + 1}`;
            }).join('\n');
            
            // 显示结果
            const doc = await vscode.workspace.openTextDocument({
                content: locationText,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc);
        } else {
            vscode.window.showInformationMessage('没有找到定义');
        }
    });
    
    // 获取当前编辑器的符号
    const getSymbolsCommand = vscode.commands.registerCommand('andrea.getSymbols', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('没有活动的编辑器');
            return;
        }
        
        const symbols = await SimpleLanguageServiceProxy.getInstance().getSymbols(editor.document);
        
        if (symbols && symbols.length > 0) {
            let symbolText = '';
            
            if ('location' in symbols[0]) {
                // SymbolInformation[]
                symbolText = (symbols as vscode.SymbolInformation[]).map(sym => {
                    return `${sym.kind}: ${sym.name} (${sym.location.range.start.line + 1}:${sym.location.range.start.character + 1})`;
                }).join('\n');
            } else {
                // DocumentSymbol[]
                const formatDocumentSymbol = (sym: vscode.DocumentSymbol, indent = ''): string => {
                    let result = `${indent}${sym.kind}: ${sym.name} (${sym.range.start.line + 1}:${sym.range.start.character + 1})\n`;
                    if (sym.children) {
                        for (const child of sym.children) {
                            result += formatDocumentSymbol(child, indent + '  ');
                        }
                    }
                    return result;
                };
                
                symbolText = (symbols as vscode.DocumentSymbol[]).map(sym => formatDocumentSymbol(sym)).join('\n');
            }
            
            // 显示结果
            const doc = await vscode.workspace.openTextDocument({
                content: symbolText,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc);
        } else {
            vscode.window.showInformationMessage('没有找到符号');
        }
    });
    
    // 获取当前编辑器的诊断信息
    const getDiagnosticsCommand = vscode.commands.registerCommand('andrea.getDiagnostics', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('没有活动的编辑器');
            return;
        }
        
        const diagnostics = SimpleLanguageServiceProxy.getInstance().getDiagnostics(editor.document);
        
        if (diagnostics && diagnostics.length > 0) {
            const diagnosticText = diagnostics.map(diag => {
                return `${diag.severity}: ${diag.message} (${diag.range.start.line + 1}:${diag.range.start.character + 1})`;
            }).join('\n');
            
            // 显示结果
            const doc = await vscode.workspace.openTextDocument({
                content: diagnosticText,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc);
        } else {
            vscode.window.showInformationMessage('没有找到诊断信息');
        }
    });
    
    // 获取当前编辑器的语义标记
    const getSemanticTokensCommand = vscode.commands.registerCommand('andrea.getSemanticTokens', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('没有活动的编辑器');
            return;
        }
        
        const semanticTokens = await SimpleLanguageServiceProxy.getInstance().getSemanticTokens(editor.document);
        
        if (semanticTokens && semanticTokens.data.length > 0) {
            // 简单地显示语义标记的数量
            const tokenText = `语义标记数量: ${semanticTokens.data.length / 5}\n数据: ${JSON.stringify(semanticTokens.data.slice(0, 50))}...`;
            
            // 显示结果
            const doc = await vscode.workspace.openTextDocument({
                content: tokenText,
                language: 'json'
            });
            await vscode.window.showTextDocument(doc);
        } else {
            vscode.window.showInformationMessage('没有找到语义标记');
        }
    });
    
    context.subscriptions.push(
        getHoverCommand,
        getCompletionCommand,
        getDefinitionCommand,
        getSymbolsCommand,
        getDiagnosticsCommand,
        getSemanticTokensCommand
    );
}