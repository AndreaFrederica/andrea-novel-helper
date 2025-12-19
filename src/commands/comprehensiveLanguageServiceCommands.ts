import * as vscode from 'vscode';

/**
 * 获取文档中所有语言服务数据的命令
 * 通过 VSCode API 直接访问所有注册的语言服务提供器
 */
export function registerComprehensiveLanguageServiceCommands(context: vscode.ExtensionContext) {
    
    // 获取文档中所有 Hover 信息
    const getAllHoversCommand = vscode.commands.registerCommand('andrea.comprehensive.getAllHovers', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('没有活动的编辑器');
            return;
        }
        
        const document = editor.document;
        
        try {
            const allHovers: string[] = [];
            const text = document.getText();
            
            // 逐个字符位置尝试获取 hover
            for (let line = 0; line < document.lineCount; line++) {
                const lineText = document.lineAt(line);
                for (let char = 0; char < lineText.text.length; char++) {
                    const position = new vscode.Position(line, char);
                    
                    try {
                        // 直接调用 VSCode 的 executeHoverProvider
                        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                            'vscode.executeHoverProvider',
                            document.uri,
                            position
                        );
                        
                        if (hovers && Array.isArray(hovers) && hovers.length > 0) {
                            const hoverContent = hovers.map(h => {
                                if (typeof h.contents === 'string') {
                                    return h.contents;
                                } else if (Array.isArray(h.contents)) {
                                    return h.contents.join('\n');
                                } else if (typeof h.contents === 'object' && h.contents !== null) {
                                    // 处理 MarkdownString 对象
                                    const mdString = h.contents as vscode.MarkdownString;
                                    return mdString.value || mdString.baseUri || JSON.stringify(h.contents);
                                } else {
                                    return String(h.contents);
                                }
                            }).join('\n\n');
                            
                            // 获取上下文
                            const start = Math.max(0, char - 10);
                            const end = Math.min(lineText.text.length, char + 20);
                            const context = lineText.text.substring(start, end);
                            
                            allHovers.push(`## 行 ${line + 1}, 列 ${char + 1}\n**上下文**: "${context}"\n**Hover**:\n${hoverContent}\n---`);
                        }
                    } catch (error) {
                        // 忽略单个位置的错误
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
    
    // 获取文档中所有定义信息
    const getAllDefinitionsCommand = vscode.commands.registerCommand('andrea.comprehensive.getAllDefinitions', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('没有活动的编辑器');
            return;
        }
        
        const document = editor.document;
        
        try {
            const allDefinitions: string[] = [];
            const text = document.getText();
            
            // 使用正则表达式找到所有可能的标识符
            const identifierPattern = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
            let match;
            const processedIdentifiers = new Set<string>();
            
            while ((match = identifierPattern.exec(text)) !== null) {
                const identifier = match[0];
                if (processedIdentifiers.has(identifier)) continue;
                processedIdentifiers.add(identifier);
                
                const position = document.positionAt(match.index);
                
                try {
                    // 直接调用 VSCode 的 executeDefinitionProvider
                    const definitions = await vscode.commands.executeCommand<
                        vscode.Location | vscode.Location[] | vscode.LocationLink[]
                    >('vscode.executeDefinitionProvider', document.uri, position);
                    
                    if (definitions) {
                        let defContent = '';
                        if (Array.isArray(definitions)) {
                            defContent = definitions.map(def => {
                                if ('uri' in def) {
                                    return `定义位置: ${def.uri.fsPath}:${def.range.start.line + 1}:${def.range.start.character + 1}`;
                                } else {
                                    return String(def);
                                }
                            }).join('\n');
                        } else if ('uri' in definitions) {
                            defContent = `定义位置: ${definitions.uri.fsPath}:${definitions.range.start.line + 1}:${definitions.range.start.character + 1}`;
                        } else {
                            defContent = String(definitions);
                        }
                        
                        // 获取上下文
                        const start = Math.max(0, match.index - 15);
                        const end = Math.min(text.length, match.index + identifier.length + 15);
                        const context = text.substring(start, end);
                        
                        allDefinitions.push(`## "${identifier}"\n**位置**: 行 ${position.line + 1}, 列 ${position.character + 1}\n**上下文**: "${context}"\n**定义**:\n${defContent}\n---`);
                    }
                } catch (error) {
                    continue;
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
    
    // 获取文档中所有符号信息
    const getAllSymbolsCommand = vscode.commands.registerCommand('andrea.comprehensive.getAllSymbols', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('没有活动的编辑器');
            return;
        }
        
        const document = editor.document;
        
        try {
            // 直接调用 VSCode 的 executeDocumentSymbolProvider
            const symbols = await vscode.commands.executeCommand<
                Array<vscode.DocumentSymbol | vscode.SymbolInformation>
            >('vscode.executeDocumentSymbolProvider', document.uri);
            
            if (!symbols || symbols.length === 0) {
                vscode.window.showInformationMessage('文档中没有找到任何符号');
                return;
            }
            
            // 处理符号信息
            const symbolInfo = symbols.map(symbol => {
                if ('location' in symbol) {
                    // SymbolInformation
                    const pos = symbol.location.range.start;
                    return `## ${symbol.name}\n**类型**: ${vscode.SymbolKind[symbol.kind]}\n**位置**: 行 ${pos.line + 1}, 列 ${pos.character + 1}`;
                } else {
                    // DocumentSymbol
                    const pos = symbol.selectionRange.start;
                    const detail = symbol.detail ? `\n**详情**: ${symbol.detail}` : '';
                    return `## ${symbol.name}\n**类型**: ${vscode.SymbolKind[symbol.kind]}\n**位置**: 行 ${pos.line + 1}, 列 ${pos.character + 1}${detail}`;
                }
            }).join('\n\n---\n\n');
            
            // 显示结果
            const symbolDoc = await vscode.workspace.openTextDocument({
                content: `# 文档所有符号信息\n\n${symbolInfo}`,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(symbolDoc);
            vscode.window.showInformationMessage(`找到 ${symbols.length} 个符号`);
        } catch (error) {
            vscode.window.showErrorMessage(`获取符号信息失败: ${error}`);
        }
    });
    
    // 获取文档中所有自动完成信息
    const getAllCompletionsCommand = vscode.commands.registerCommand('andrea.comprehensive.getAllCompletions', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('没有活动的编辑器');
            return;
        }
        
        const document = editor.document;
        
        try {
            const allCompletions: string[] = [];
            const text = document.getText();
            
            // 使用正则表达式找到所有可能的标识符
            const identifierPattern = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
            let match;
            const processedIdentifiers = new Set<string>();
            
            while ((match = identifierPattern.exec(text)) !== null) {
                const identifier = match[0];
                if (processedIdentifiers.has(identifier)) continue;
                processedIdentifiers.add(identifier);
                
                const position = document.positionAt(match.index);
                
                try {
                    // 直接调用 VSCode 的 executeCompletionItemProvider
                    const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
                        'vscode.executeCompletionItemProvider',
                        document.uri,
                        position
                    );
                    
                    if (completions && completions.items.length > 0) {
                        const completionItems = completions.items.slice(0, 10).map(item => {
                            const kind = item.kind ? vscode.CompletionItemKind[item.kind] : 'Unknown';
                            const detail = item.detail ? `\n**详情**: ${item.detail}` : '';
                            const documentation = item.documentation ? `\n**文档**: ${item.documentation}` : '';
                            return `- **${item.label}** (${kind})${detail}${documentation}`;
                        }).join('\n');
                        
                        // 获取上下文
                        const start = Math.max(0, match.index - 15);
                        const end = Math.min(text.length, match.index + identifier.length + 15);
                        const context = text.substring(start, end);
                        
                        allCompletions.push(`## "${identifier}"\n**位置**: 行 ${position.line + 1}, 列 ${position.character + 1}\n**上下文**: "${context}"\n**自动完成选项**:\n${completionItems}\n---`);
                    }
                } catch (error) {
                    continue;
                }
            }
            
            // 显示结果
            if (allCompletions.length > 0) {
                const completionDoc = await vscode.workspace.openTextDocument({
                    content: `# 文档所有自动完成信息\n\n${allCompletions.join('\n\n')}`,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(completionDoc);
                vscode.window.showInformationMessage(`找到 ${allCompletions.length} 个自动完成信息`);
            } else {
                vscode.window.showInformationMessage('没有找到任何自动完成信息');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`获取自动完成信息失败: ${error}`);
        }
    });
    
    // 获取文档中所有诊断信息
    const getAllDiagnosticsCommand = vscode.commands.registerCommand('andrea.comprehensive.getAllDiagnostics', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('没有活动的编辑器');
            return;
        }
        
        const document = editor.document;
        
        try {
            // 直接获取 VSCode 的诊断信息
            const diagnostics = vscode.languages.getDiagnostics(document.uri);
            
            if (!diagnostics || diagnostics.length === 0) {
                vscode.window.showInformationMessage('文档中没有找到任何诊断信息');
                return;
            }
            
            // 处理诊断信息
            const diagnosticInfo = diagnostics.map(diagnostic => {
                const severity = vscode.DiagnosticSeverity[diagnostic.severity];
                const source = diagnostic.source ? ` (${diagnostic.source})` : '';
                const message = diagnostic.message;
                const line = diagnostic.range.start.line + 1;
                const column = diagnostic.range.start.character + 1;
                
                return `## ${severity}${source}\n**位置**: 行 ${line}, 列 ${column}\n**消息**: ${message}`;
            }).join('\n\n---\n\n');
            
            // 显示结果
            const diagnosticDoc = await vscode.workspace.openTextDocument({
                content: `# 文档所有诊断信息\n\n${diagnosticInfo}`,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(diagnosticDoc);
            vscode.window.showInformationMessage(`找到 ${diagnostics.length} 个诊断信息`);
        } catch (error) {
            vscode.window.showErrorMessage(`获取诊断信息失败: ${error}`);
        }
    });
    
    // 获取文档中所有语义标记信息
    const getAllSemanticTokensCommand = vscode.commands.registerCommand('andrea.comprehensive.getAllSemanticTokens', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('没有活动的编辑器');
            return;
        }
        
        const document = editor.document;
        
        try {
            // 直接调用 VSCode 的 executeDocumentSemanticTokensProvider
            const semanticTokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
                'vscode.executeDocumentSemanticTokensProvider',
                document.uri
            );
            
            if (!semanticTokens || !semanticTokens.resultId) {
                vscode.window.showInformationMessage('文档中没有找到任何语义标记信息');
                return;
            }
            
            // 处理语义标记信息
            const tokenInfo = `语义标记结果ID: ${semanticTokens.resultId}`;
            
            // 显示结果
            const tokenDoc = await vscode.workspace.openTextDocument({
                content: `# 文档所有语义标记信息\n\n${tokenInfo}`,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(tokenDoc);
            vscode.window.showInformationMessage(`获取语义标记信息成功`);
        } catch (error) {
            vscode.window.showErrorMessage(`获取语义标记信息失败: ${error}`);
        }
    });
    
    context.subscriptions.push(
        getAllHoversCommand,
        getAllDefinitionsCommand,
        getAllSymbolsCommand,
        getAllCompletionsCommand,
        getAllDiagnosticsCommand,
        getAllSemanticTokensCommand
    );
}