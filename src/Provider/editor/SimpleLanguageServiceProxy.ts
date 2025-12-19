import * as vscode from 'vscode';

/**
 * 简单的语言服务代理
 * 直接使用原生编辑器的语言服务，不需要虚拟文档
 */
export class SimpleLanguageServiceProxy {
    private static readonly instance = new SimpleLanguageServiceProxy();
    
    private constructor() {}
    
    public static getInstance(): SimpleLanguageServiceProxy {
        return SimpleLanguageServiceProxy.instance;
    }
    
    /**
     * 获取 hover 信息
     */
    public async getHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover[]> {
        try {
            const result = await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                document.uri,
                position
            );
            return result || [];
        } catch (error) {
            console.error('Error getting hover:', error);
            return [];
        }
    }
    
    /**
     * 获取自动完成
     */
    public async getCompletion(
        document: vscode.TextDocument, 
        position: vscode.Position, 
        triggerCharacter?: string
    ): Promise<vscode.CompletionList> {
        return vscode.commands.executeCommand<vscode.CompletionList>(
            'vscode.executeCompletionItemProvider',
            document.uri,
            position,
            triggerCharacter
        );
    }
    
    /**
     * 获取定义
     */
    public async getDefinition(
        document: vscode.TextDocument, 
        position: vscode.Position
    ): Promise<vscode.Location | vscode.Location[] | vscode.LocationLink[]> {
        return vscode.commands.executeCommand<
            vscode.Location | vscode.Location[] | vscode.LocationLink[]
        >('vscode.executeDefinitionProvider', document.uri, position);
    }
    
    /**
     * 获取符号
     */
    public async getSymbols(document: vscode.TextDocument): Promise<vscode.DocumentSymbol[] | vscode.SymbolInformation[]> {
        try {
            const symbols = await vscode.commands.executeCommand<
                Array<vscode.DocumentSymbol | vscode.SymbolInformation>
            >('vscode.executeDocumentSymbolProvider', document.uri);
            
            if (!symbols) {
                return [];
            }
            
            // 根据返回类型进行类型断言
            if (symbols.length > 0 && 'location' in symbols[0]) {
                return symbols as vscode.SymbolInformation[];
            } else {
                return symbols as vscode.DocumentSymbol[];
            }
        } catch (error) {
            console.error('Error getting symbols:', error);
            return [];
        }
    }
    
    /**
     * 获取语义标记
     */
    public async getSemanticTokens(document: vscode.TextDocument): Promise<vscode.SemanticTokens> {
        return vscode.commands.executeCommand<vscode.SemanticTokens>(
            'vscode.executeDocumentSemanticTokensProvider',
            document.uri
        );
    }
    
    /**
     * 获取诊断信息
     */
    public getDiagnostics(document: vscode.TextDocument): vscode.Diagnostic[] {
        return vscode.languages.getDiagnostics(document.uri);
    }
}