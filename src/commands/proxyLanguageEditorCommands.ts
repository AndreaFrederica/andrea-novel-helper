import * as vscode from 'vscode';
import { updateConfig } from '../Provider/editor/proxyLanguageEditorConfig';

export function registerProxyLanguageEditorCommands(context: vscode.ExtensionContext): vscode.Disposable {
    const toggleUseRealFileUri = vscode.commands.registerCommand(
        'andrea.proxyLanguageEditor.toggleUseRealFileUri',
        async () => {
            const config = vscode.workspace.getConfiguration('andrea.proxyLanguageEditor');
            const currentValue = config.get<boolean>('useRealFileUri', true);
            
            // 切换设置
            await updateConfig({ useRealFileUri: !currentValue });
            
            // 显示通知
            const newValue = !currentValue;
            const message = newValue 
                ? '已启用真实文件 URI 模式，语言服务将在真实文件上运行' 
                : '已禁用真实文件 URI 模式，语言服务将在虚拟文档上运行';
            
            vscode.window.showInformationMessage(message, '重新加载窗口').then(selection => {
                if (selection === '重新加载窗口') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        }
    );

    return vscode.Disposable.from(toggleUseRealFileUri);
}