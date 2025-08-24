// src/Provider/defLinksProvider.ts
/* eslint-disable curly */
import * as vscode from 'vscode';
import * as path from 'path';
import { Role } from '../extension';
import { hoverRangesMap } from './hoverProvider';
import { getSupportedExtensions, getSupportedLanguages } from '../utils/utils';
import { findDefinitionInFile } from './defProv';

// 读取开关（支持按资源作用域读取）
function isEnabled(doc?: vscode.TextDocument): boolean {
    return vscode.workspace
        .getConfiguration('andrea', doc)
        .get<boolean>('roleJson5.openWithRoleManager', false) ?? false;
}

export function activateDefLinks(context: vscode.ExtensionContext) {
    const selector: vscode.DocumentSelector = { scheme: 'file' };

    // ★ 关键：用于通知 VS Code “链接集合变了”
    const onDidChangeEmitter = new vscode.EventEmitter<void>();
    context.subscriptions.push(onDidChangeEmitter);

    const provider: vscode.DocumentLinkProvider & { onDidChange?: vscode.Event<void> } = {
        // 告诉 VS Code 我们有变化事件
        onDidChange: onDidChangeEmitter.event,

        provideDocumentLinks(doc) {
            // 每次提供链接时都按当前配置判定（确保热切换后也正确）
            if (!isEnabled(doc)) return [];

            const supportedLangs = getSupportedLanguages();
            const supportedExts = new Set(getSupportedExtensions().map(e => e.toLowerCase()));
            const extMatch = doc.fileName.toLowerCase().match(/\.([a-z0-9_\-]+)$/);
            const ext = extMatch ? extMatch[1] : '';
            if (!supportedLangs.includes(doc.languageId) && !supportedExts.has(ext)) return [];

            const key = doc.uri.toString();
            const ranges = hoverRangesMap.get(key) || [];
            const links: vscode.DocumentLink[] = [];

            for (const h of ranges) {
                const role: Role = h.role;
                const src = role.sourcePath;
                if (!src) continue;

                const srcExt = path.extname(src).toLowerCase();

                if (srcExt === '.json5') {
                    // 分流到自定义编辑器
                    const tuple = [role.name, vscode.Uri.file(src).fsPath]; // ← 统一成 [name, path]
                    const uri = vscode.Uri.parse(
                        `command:andrea.roleJson5Editor.def?${encodeURIComponent(JSON.stringify(tuple))}`
                    );
                    const link = new vscode.DocumentLink(h.range, uri);
                    // link.tooltip = '在角色管理器中打开（JSON5）';
                    links.push(link);
                } else {
                    // 其它类型：二元组 [roleName, fsPath]，避免复杂对象
                    const tuple = [role.name, vscode.Uri.file(src).fsPath];
                    const uri = vscode.Uri.parse(
                        `command:andrea.openRoleSource?${encodeURIComponent(JSON.stringify(tuple))}`
                    );
                    const link = new vscode.DocumentLink(h.range, uri);
                    // link.tooltip = '打开源文件并定位';
                    links.push(link);
                }
            }

            return links;
        }
    };

    // 注册 provider
    const disp = vscode.languages.registerDocumentLinkProvider(selector, provider);
    context.subscriptions.push(disp);

    // ★ 实时监听配置变化：触发 onDidChange，VS Code 会重新拉取链接
    const cfgDisp = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('andrea.roleJson5.openWithRoleManager')) {
            onDidChangeEmitter.fire(); // 刷新所有可见文档的链接
            // （可选）如果你还想立刻重算光标处的下划线：
            // vscode.commands.executeCommand('editor.action.detectLinks').catch(() => {});
        }
    });
    context.subscriptions.push(cfgDisp);
}
