import * as vscode from 'vscode';

export interface ProxyLanguageEditorConfig {
    useRealFileUri: boolean;
}

export function getConfig(): ProxyLanguageEditorConfig {
    const config = vscode.workspace.getConfiguration('andrea.proxyLanguageEditor');
    return {
        useRealFileUri: config.get<boolean>('useRealFileUri', true),
    };
}

export function updateConfig(config: Partial<ProxyLanguageEditorConfig>): Promise<void> {
    const vscodeConfig = vscode.workspace.getConfiguration('andrea.proxyLanguageEditor');
    return Promise.resolve(vscodeConfig.update('useRealFileUri', config.useRealFileUri, vscode.ConfigurationTarget.Global));
}