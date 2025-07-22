/* eslint-disable curly */
import * as fs from 'fs';
import JSON5 from 'json5';
import * as path from 'path';
import * as vscode from 'vscode';

import { Role } from './extension';
import { getSupportedLanguages, loadRoles } from './utils/utils';
import { createCompletionProvider } from './Provider/completionProvider';
import { hoverProv } from './Provider/hoverProvider';
import { defProv } from './Provider/defProv';
import { initAutomaton, updateDecorations } from './events/updateDecorations';
import { WordCountProvider } from './Provider/wordCountProvider';

import { addRoleFromSelection } from './commands/addRuleFormSelection';
import { addSensitiveCmd_obj } from './commands/addSensitiveWord';
import { addVocabulary } from './commands/addVocabulary';
import { refreshRoles } from './commands/refreshRoles';
import { OutlineFSProvider } from './Provider/outlineFSProvider';
import { openDoubleOutline } from './commands/openDoubleOutline';

// 全局角色列表
export let roles: Role[] = [];

// 存储当前文档中每个角色出现的范围和对应角色
export let hoverRanges: { range: vscode.Range; role: Role }[] = [];

export function setHoverRanges(ranges: { range: vscode.Range; role: Role }[]) {
    hoverRanges = ranges;
}

// editor 装饰类型存储
export let decorationTypes: Map<string, vscode.TextEditorDecorationType> =
    new Map();

export function cleanRoles() {
    roles = [];
}

export function activate(context: vscode.ExtensionContext) {
    const cfg1 = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const rolesFile1 = cfg1.get<string>('rolesFile')!;

    const outlineRel = cfg1.get<string>('outlinePath', 'novel-helper/outline');
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) return;

    // 注册 FS Provider
    const outlineRoot = path.join(ws, outlineRel);
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider(
            'andrea-outline',
            new OutlineFSProvider(outlineRoot),
            { isCaseSensitive: true }
        )
    );

    // 注册“打开双大纲”命令
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'AndreaNovelHelper.openDoubleOutline',
            openDoubleOutline
        )
    );

    // // 可选：自动刷新
    // context.subscriptions.push(
    //     vscode.window.onDidChangeActiveTextEditor(() =>
    //         vscode.commands.executeCommand('AndreaNovelHelper.openDoubleOutline')
    //     ),
    //     vscode.workspace.onDidSaveTextDocument(() =>
    //         vscode.commands.executeCommand('AndreaNovelHelper.openDoubleOutline')
    //     )
    // );

    // 若角色库不存在，提示创建示例
    const folders1 = vscode.workspace.workspaceFolders;
    if (folders1 && folders1.length) {
        const root = folders1[0].uri.fsPath;
        const fullPath = path.join(root, rolesFile1);

        const createWizard = async () => {
            const choice = await vscode.window.showInformationMessage(
                `角色库文件 "${rolesFile1}" 不存在，是否初始化示例角色库？`,
                '创建',
                '取消'
            );

            if (choice === '创建') {
                const example: Role[] = [
                    {
                        name: '示例角色',
                        type: '配角',
                        affiliation: '示例阵营',
                        aliases: ['示例'],
                        description: '这是一个示例角色，用于说明角色库格式。',
                        color: '#FFA500'
                    }
                ];

                fs.mkdirSync(path.dirname(fullPath), { recursive: true });
                fs.writeFileSync(fullPath, JSON5.stringify(example, null, 2), 'utf8');
                vscode.window.showInformationMessage(
                    `已创建示例角色库：${rolesFile1}`
                );
            }
        };

        if (!fs.existsSync(fullPath)) {
            createWizard().then(() => {
                loadRoles();
                updateDecorations();
            });
        }
    }

    // 初始加载
    loadRoles();
    initAutomaton();

    // 防抖更新
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleUpdate = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => updateDecorations(), 200);
    };

    context.subscriptions.push(
        // 编辑器切换 / 文档变动 / 保存 文件触发
        vscode.window.onDidChangeActiveTextEditor(scheduleUpdate),
        vscode.workspace.onDidChangeTextDocument(scheduleUpdate),
        vscode.workspace.onDidSaveTextDocument(scheduleUpdate)
    );

    // 首次执行
    scheduleUpdate();

    // 配置变更监听
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (
                e.affectsConfiguration('AndreaNovelHelper.rolesFile') ||
                e.affectsConfiguration('AndreaNovelHelper.minChars') ||
                e.affectsConfiguration('AndreaNovelHelper.defaultColor')
            ) {
                loadRoles();
                updateDecorations();
            }
        })
    );

    // 注册命令
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'AndreaNovelHelper.addRoleFromSelection',
            addRoleFromSelection
        ),
        vscode.commands.registerCommand(
            'AndreaNovelHelper.addSensitiveWord',
            addSensitiveCmd_obj
        ),
        vscode.commands.registerCommand(
            'AndreaNovelHelper.addVocabulary',
            addVocabulary
        ),
        vscode.commands.registerCommand(
            'AndreaNovelHelper.refreshRoles',
            refreshRoles
        )
    );

    // 自动补全提供器
    createCompletionProvider(roles);

    // Hover 和 Definition 提供器
    context.subscriptions.push(hoverProv, defProv);

    // 监听所有库文件变更（包括 JSON5 和 TXT）
    if (folders1 && folders1.length) {
        const rootUri = folders1[0].uri;
        const fileKeys = [
            { key: 'rolesFile', label: '角色库' },
            { key: 'sensitiveWordsFile', label: '敏感词库' },
            { key: 'vocabularyFile', label: '词汇库' }
        ];

        for (const { key, label } of fileKeys) {
            const fileSetting = cfg1.get<string>(key)!;
            const absPath = path.isAbsolute(fileSetting)
                ? fileSetting
                : path.join(rootUri.fsPath, fileSetting);

            let relPath = path.relative(rootUri.fsPath, absPath).split(path.sep).join('/');
            const txtPath = relPath.replace(/\.[^/.]+$/, '.txt');

            const watcherJson = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(rootUri, relPath)
            );
            watcherJson.onDidChange(() => {
                loadRoles();
                updateDecorations();
                vscode.window.showInformationMessage(`${label}（JSON5）已自动刷新`);
            });
            watcherJson.onDidCreate(() => {
                loadRoles();
                updateDecorations();
                vscode.window.showInformationMessage(
                    `${label}（JSON5）文件已创建，已刷新`
                );
            });
            watcherJson.onDidDelete(() => {
                roles = [];
                loadRoles();
                updateDecorations();
                vscode.window.showWarningMessage(
                    `${label}（JSON5）文件已删除，已清空列表`
                );
            });
            context.subscriptions.push(watcherJson);

            const watcherTxt = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(rootUri, txtPath)
            );
            watcherTxt.onDidChange(() => {
                loadRoles();
                updateDecorations();
                vscode.window.showInformationMessage(`${label}（TXT）已自动刷新`);
            });
            watcherTxt.onDidCreate(() => {
                loadRoles();
                updateDecorations();
                vscode.window.showInformationMessage(
                    `${label}（TXT）文件已创建，已刷新`
                );
            });
            watcherTxt.onDidDelete(() => {
                roles = [];
                loadRoles();
                updateDecorations();
                vscode.window.showWarningMessage(
                    `${label}（TXT）文件已删除，已清空列表`
                );
            });
            context.subscriptions.push(watcherTxt);
        }
    }

    // Word Count 树视图
    const wordCountProvider = new WordCountProvider();
    const treeView = vscode.window.createTreeView('wordCountExplorer', {
        treeDataProvider: wordCountProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(treeView);

    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.refreshWordCount', () => {
            wordCountProvider.refresh();
        }),
        vscode.window.onDidChangeActiveTextEditor(async (editor) => {
            if (!editor || !treeView.visible) return;
            const stub = { id: editor.document.uri.fsPath, resourceUri: editor.document.uri } as any;
            try {
                await treeView.reveal(stub, { expand: true, select: true, focus: false });
            } catch {
                // 忽略
            }
        })
    );
}

export function deactivate() {
    decorationTypes.forEach((d) => d.dispose());
}

export { loadRoles };
