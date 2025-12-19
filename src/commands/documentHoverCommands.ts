import * as vscode from 'vscode';
import { SimpleLanguageServiceProxy } from '../Provider/editor/SimpleLanguageServiceProxy';

/**
 * 注册文档级别的 Hover 命令
 */
export function registerDocumentHoverCommands(context: vscode.ExtensionContext) {
    
    // 获取整个文档的所有 hover 信息（逐个字符扫描）
    const getAllDocumentHoversCommand = vscode.commands.registerCommand('andrea.getAllDocumentHovers', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('没有活动的编辑器');
            return;
        }
        
        const document = editor.document;
        const languageServiceProxy = SimpleLanguageServiceProxy.getInstance();
        
        try {
            const allHovers: string[] = [];
            const processedPositions = new Set<string>();
            
            // 逐行扫描，每个字符位置都尝试获取 hover
            for (let line = 0; line < document.lineCount; line++) {
                const lineText = document.lineAt(line);
                
                for (let char = 0; char < lineText.text.length; char++) {
                    const pos = new vscode.Position(line, char);
                    const posKey = `${line}:${char}`;
                    
                    // 避免重复处理同一个位置
                    if (processedPositions.has(posKey)) continue;
                    processedPositions.add(posKey);
                    
                    try {
                        const hovers = await languageServiceProxy.getHover(document, pos);
                        if (hovers && Array.isArray(hovers) && hovers.length > 0) {
                            const hoverText = hovers.map(h => {
                                if (typeof h.contents === 'string') {
                                    return h.contents;
                                } else if (Array.isArray(h.contents)) {
                                    return h.contents.join('\n');
                                } else {
                                    return String(h.contents);
                                }
                            }).join('\n\n');
                            
                            // 获取周围的文本作为上下文
                            const start = Math.max(0, char - 10);
                            const end = Math.min(lineText.text.length, char + 20);
                            const context = lineText.text.substring(start, end);
                            
                            allHovers.push(`## 行 ${line + 1}, 列 ${char + 1}\n**上下文**: "${context}"\n**Hover 信息**:\n${hoverText}\n---`);
                        }
                    } catch (error) {
                        // 忽略单个位置的错误，继续处理下一个位置
                        continue;
                    }
                }
            }
            
            // 显示结果
            if (allHovers.length > 0) {
                const hoverDoc = await vscode.workspace.openTextDocument({
                    content: `# 文档所有 Hover 信息\n\n${allHovers.join('\n\n')}`,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(hoverDoc);
                vscode.window.showInformationMessage(`找到 ${allHovers.length} 个 hover 信息`);
            } else {
                vscode.window.showInformationMessage('没有找到任何 hover 信息');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`获取 hover 信息失败: ${error}`);
        }
    });
    
    // 获取文档中所有位置的 hover 信息（优化版，只检查单词边界）
    const getOptimizedDocumentHoversCommand = vscode.commands.registerCommand('andrea.getOptimizedDocumentHovers', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('没有活动的编辑器');
            return;
        }
        
        const document = editor.document;
        const languageServiceProxy = SimpleLanguageServiceProxy.getInstance();
        const text = document.getText();
        
        try {
            const allHovers: string[] = [];
            const processedPositions = new Set<string>();
            
            // 使用正则表达式找到所有可能的单词和标识符
            const patterns = [
                /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g, // 标识符
                /\b[a-zA-Z]+\b/g, // 英文单词
                /[\u4e00-\u9fff]+/g, // 中文字符
                /\d+/g, // 数字
            ];
            
            const allMatches: {text: string, index: number}[] = [];
            
            for (const pattern of patterns) {
                let match;
                while ((match = pattern.exec(text)) !== null) {
                    allMatches.push({
                        text: match[0],
                        index: match.index
                    });
                }
            }
            
            // 按位置排序
            allMatches.sort((a, b) => a.index - b.index);
            
            // 为每个匹配项获取 hover
            for (const match of allMatches) {
                const pos = document.positionAt(match.index);
                const posKey = `${pos.line}:${pos.character}`;
                
                if (processedPositions.has(posKey)) continue;
                processedPositions.add(posKey);
                
                try {
                    const hovers = await languageServiceProxy.getHover(document, pos);
                    if (hovers && Array.isArray(hovers) && hovers.length > 0) {
                        const hoverText = hovers.map(h => {
                            if (typeof h.contents === 'string') {
                                return h.contents;
                            } else if (Array.isArray(h.contents)) {
                                return h.contents.join('\n');
                            } else {
                                return String(h.contents);
                            }
                        }).join('\n\n');
                        
                        // 获取周围的文本作为上下文
                        const start = Math.max(0, match.index - 15);
                        const end = Math.min(text.length, match.index + match.text.length + 15);
                        const context = text.substring(start, end);
                        
                        allHovers.push(`## "${match.text}"\n**位置**: 行 ${pos.line + 1}, 列 ${pos.character + 1}\n**上下文**: "${context}"\n**Hover 信息**:\n${hoverText}\n---`);
                    }
                } catch (error) {
                    continue;
                }
            }
            
            // 显示结果
            if (allHovers.length > 0) {
                const hoverDoc = await vscode.workspace.openTextDocument({
                    content: `# 文档所有 Hover 信息（优化版）\n\n${allHovers.join('\n\n')}`,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(hoverDoc);
                vscode.window.showInformationMessage(`找到 ${allHovers.length} 个 hover 信息`);
            } else {
                vscode.window.showInformationMessage('没有找到任何 hover 信息');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`获取 hover 信息失败: ${error}`);
        }
    });
    
    // 获取文档中所有定义信息
    const getAllDocumentDefinitionsCommand = vscode.commands.registerCommand('andrea.getAllDocumentDefinitions', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('没有活动的编辑器');
            return;
        }
        
        const document = editor.document;
        const languageServiceProxy = SimpleLanguageServiceProxy.getInstance();
        const text = document.getText();
        
        try {
            const allDefinitions: string[] = [];
            const processedPositions = new Set<string>();
            
            // 使用正则表达式找到所有可能的标识符
            const identifierPattern = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
            let match;
            const identifiers: {text: string, index: number}[] = [];
            
            while ((match = identifierPattern.exec(text)) !== null) {
                identifiers.push({
                    text: match[0],
                    index: match.index
                });
            }
            
            // 去重
            const uniqueIdentifiers = Array.from(new Set(identifiers.map(i => i.text)));
            
            // 为每个唯一标识符获取定义
            for (const identifier of uniqueIdentifiers) {
                const matches = identifiers.filter(i => i.text === identifier);
                if (matches.length > 0) {
                    const firstMatch = matches[0];
                    const pos = document.positionAt(firstMatch.index);
                    const posKey = `${pos.line}:${pos.character}`;
                    
                    if (processedPositions.has(posKey)) continue;
                    processedPositions.add(posKey);
                    
                    try {
                        const definitions = await languageServiceProxy.getDefinition(document, pos);
                        if (definitions) {
                            let defText = '';
                            if (Array.isArray(definitions)) {
                                defText = definitions.map(def => {
                                    if ('uri' in def) {
                                        return `定义位置: ${def.uri.fsPath}:${def.range.start.line + 1}:${def.range.start.character + 1}`;
                                    } else {
                                        return String(def);
                                    }
                                }).join('\n');
                            } else if ('uri' in definitions) {
                                defText = `定义位置: ${definitions.uri.fsPath}:${definitions.range.start.line + 1}:${definitions.range.start.character + 1}`;
                            } else {
                                defText = String(definitions);
                            }
                            
                            // 获取周围的文本作为上下文
                            const start = Math.max(0, firstMatch.index - 15);
                            const end = Math.min(text.length, firstMatch.index + identifier.length + 15);
                            const context = text.substring(start, end);
                            
                            allDefinitions.push(`## "${identifier}"\n**位置**: 行 ${pos.line + 1}, 列 ${pos.character + 1}\n**上下文**: "${context}"\n**定义信息**:\n${defText}\n---`);
                        }
                    } catch (error) {
                        continue;
                    }
                }
            }
            
            // 显示结果
            if (allDefinitions.length > 0) {
                const defDoc = await vscode.workspace.openTextDocument({
                    content: `# 文档所有定义信息\n\n${allDefinitions.join('\n\n')}`,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(defDoc);
                vscode.window.showInformationMessage(`找到 ${allDefinitions.length} 个定义信息`);
            } else {
                vscode.window.showInformationMessage('没有找到任何定义信息');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`获取定义信息失败: ${error}`);
        }
    });
    
    context.subscriptions.push(
        getAllDocumentHoversCommand, 
        getOptimizedDocumentHoversCommand, 
        getAllDocumentDefinitionsCommand
    );
}