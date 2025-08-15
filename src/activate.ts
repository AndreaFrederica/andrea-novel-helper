/* eslint-disable curly */
import * as fs from 'fs';
import JSON5 from 'json5';
import * as path from 'path';
import * as vscode from 'vscode';

import { Role } from './extension';
import { getSupportedLanguages, loadRoles } from './utils/utils';
import { createCompletionProvider } from './Provider/completionProvider';
import { initAutomaton, updateDecorations } from './events/updateDecorations';
import { WordCountProvider } from './Provider/view/wordCountProvider';
import { ensureRegisterOpenWith } from './utils/openWith';
import { initAhoCorasickManager } from './utils/ahoCorasickManager';

import { addRoleFromSelection } from './commands/addRuleFormSelection';
import { addSensitiveCmd_obj } from './commands/addSensitiveWord';
import { addVocabulary } from './commands/addVocabulary';
import { refreshRoles } from './commands/refreshRoles';
import { OutlineFSProvider } from './Provider/fileSystem/outlineFSProvider';
import { openDoubleOutline } from './commands/openDoubleOutline';
import { refreshOpenOutlines } from './events/refreshOpenOutlines';
import { MemoryOutlineFSProvider } from './Provider/fileSystem/MemoryOutlineFSProvider';
import { activateHover } from './Provider/hoverProvider';
import { activateDef } from './Provider/defProv';
import { registerPackageManagerView } from './Provider/view/packageManagerView';
// import { StatusBarProvider } from './Provider/statusBarProvider'; // 已禁用，使用 timeStats 中的状态栏
import { activateMarkdownToolbar, deactivateMarkdownToolbar } from './Provider/markdownToolbar';
import { activateTimeStats, deactivateTimeStats } from './timeStats';
import { initializeGlobalFileTracking } from './utils/globalFileTracking';
import { showFileTrackingStats, cleanupMissingFiles, exportTrackingData } from './commands/fileTrackingCommands';


export let dir_outline_url = 'andrea-outline://outline/outline_dir.md';
export let file_outline_url = 'andrea-outline://outline/outline_file.md';

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

export let outlineFS: undefined | OutlineFSProvider | MemoryOutlineFSProvider = undefined;

// 在 activate 最外层先定义一个变量，初始化成当前激活 editor 的 scheme
export let lastEditorScheme = vscode.window.activeTextEditor?.document.uri.scheme;

// 用于发布“角色列表已变更”的事件
export const _onDidChangeRoles = new vscode.EventEmitter<void>();
export const onDidChangeRoles = _onDidChangeRoles.event;

export function activate(context: vscode.ExtensionContext) {
    const cfg1 = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const rolesFile1 = cfg1.get<string>('rolesFile')!;

    const outlineRel = cfg1.get<string>('outlinePath', 'novel-helper/outline');
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const uiLang = vscode.env.language;  // 当前 UI 语言代码

    if (uiLang.startsWith('zh')) {
        dir_outline_url = 'andrea-outline://outline/目录大纲.md';
        file_outline_url = 'andrea-outline://outline/文件大纲.md';
        // } else if (uiLang.startsWith('ja')) {
        //   runJapaneseLogic();
    } else {
        dir_outline_url = 'andrea-outline://outline/outline_dir.md';
        file_outline_url = 'andrea-outline://outline/outline_file.md';
    }
    //TODO工作区里的多个文件夹兼容没做(要命)
    if (!ws) return;
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders?.length) {
        vscode.window.showErrorMessage('请先打开一个工作区');
        return;
    }
    const wsRoot = wsFolders[0].uri.fsPath;
    // outlineFS = new OutlineFSProvider(path.join(wsRoot, outlineRel));
    outlineFS = new MemoryOutlineFSProvider(path.join(wsRoot, outlineRel));
    if (!outlineFS) {
        vscode.window.showErrorMessage('无法初始化大纲文件系统提供器');
        return;
    }

    // 注册 andrea-outline:// 文件系统提供器
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider('andrea-outline', outlineFS, { isReadonly: false })
    );

    // 注册刷新命令
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.refreshOutlineDir', () => {
            if (!outlineFS) { return; }
            outlineFS.refreshDir();
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.refreshOutlineFile', () => {
            if (!outlineFS) { return; }
            outlineFS.refreshFile();
        })
    );


    // 注册“打开双大纲”命令
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'AndreaNovelHelper.openDoubleOutline',
            openDoubleOutline
        )
    );

    // 启动完成后，检查一下有没有已经打开的“内容文件”，如果有就刷新一次大纲
    setTimeout(() => {
        for (const editor of vscode.window.visibleTextEditors) {
            const doc = editor.document;
            if (
                doc.uri.scheme === 'file' &&
                (doc.languageId === 'markdown' || doc.languageId === 'plaintext') &&
                !doc.uri.fsPath.endsWith('_outline.md')
            ) {
                refreshOpenOutlines();
                break; // 找到一个就行了，退出循环
            }
        }
    }, 200); // 延迟下等 VS Code 完全恢复各个 editor

    let lastWasContentFile = isContentEditor(vscode.window.activeTextEditor);

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            // editor === undefined 时肯定不是我们关心的内容文件，直接跳过
            if (!editor) {
                return;
            }

            const isContentFile = isContentEditor(editor);

            // 只有在 “上一个也是内容文件” → “这次也是内容文件” 时，才刷新
            if (lastWasContentFile && isContentFile) {
                refreshOpenOutlines();
            }

            // 不管有没有触发，都更新状态给下次用
            lastWasContentFile = isContentFile;
        }),

        vscode.workspace.onDidSaveTextDocument(doc => {
            // 保存时，只要是普通文件就刷新
            if (doc.uri.scheme === 'file'
                && ['markdown', 'plaintext'].includes(doc.languageId)
                && !doc.uri.fsPath.endsWith('_outline.md')) {
                refreshOpenOutlines();
            }
        })
    );


    /** 判断这个 editor 是不是“真实的内容文件” */
    function isContentEditor(editor?: vscode.TextEditor): boolean {
        if (!editor) return false;
        const doc = editor.document;
        return (
            doc.uri.scheme === 'file' &&
            (doc.languageId === 'markdown' || doc.languageId === 'plaintext') &&
            !doc.uri.fsPath.endsWith('_outline.md')
        );
    }

    // 轮询相关状态
    const pollingInterval = 1000; // 毫秒

    const handle = setInterval(() => {

        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        if (outlineFS === undefined) { return; }
        const outline_2raw_file_dir = outlineFS.getSourceFileFsPath();
        if (outline_2raw_file_dir === undefined && isContentEditor()) { refreshOpenOutlines(); }

        const uriStr = editor?.document.uri.toString();
        const now_fsPath = editor?.document.uri.fsPath;
        // console.log('lastActiveUri:', outline_2raw_file_dir, ' current:', now_fsPath);
        if (now_fsPath !== outline_2raw_file_dir) {

            // 如果新激活的是“内容文件”，就刷新
            if (
                editor.document.uri.scheme === 'file' &&
                (editor.document.languageId === 'markdown' ||
                    editor.document.languageId === 'plaintext') &&
                !editor.document.uri.fsPath.endsWith('_outline.md')
            ) {
                refreshOpenOutlines();
            }
        }
    }, pollingInterval);

    context.subscriptions.push({
        dispose: () => clearInterval(handle)
    });

    registerPackageManagerView(context);

    // 初始化 AhoCorasick 管理器
    initAhoCorasickManager(context);

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

        // 检查是否存在任何描述文件（角色、敏感词、词汇等）
        const hasAnyDescriptionFile = () => {
            const novelHelperDir = path.join(root, 'novel-helper');
            if (!fs.existsSync(novelHelperDir)) {
                return false;
            }

            try {
                const files = fs.readdirSync(novelHelperDir);
                // 检查是否有任何相关描述文件
                return files.some(file => {
                    const fileName = file.toLowerCase();
                    const hasKeywords = /character-gallery|character|role|roles|sensitive-words|sensitive|vocabulary|vocab/.test(fileName);
                    const hasValidExtension = /\.(json5|txt|md)$/i.test(fileName);
                    return hasKeywords && hasValidExtension;
                });
            } catch (error) {
                return false;
            }
        };

        // 只有在默认角色库文件不存在且没有任何描述文件时才提示创建
        if (!fs.existsSync(fullPath) && !hasAnyDescriptionFile()) {
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
    activateHover(context);
    activateDef(context);

    // Markdown 工具条
    activateMarkdownToolbar(context);

    // 注释掉传统的文件监听，改为由包管理器统一处理
    // 监听所有库文件变更（包括 JSON5 和 TXT）
    /*
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
    */

    // 确保 openWith 命令注册一次
    ensureRegisterOpenWith(context);

    // Word Count 树视图
    const wordCountProvider = new WordCountProvider(context.workspaceState);
    const treeView = vscode.window.createTreeView('wordCountExplorer', {
        treeDataProvider: wordCountProvider,
        showCollapseAll: true
    });
    
    // 监听树视图展开/折叠事件以保存状态
    context.subscriptions.push(
        treeView.onDidExpandElement(e => {
            const el: any = e.element;
            if (el && el.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
                wordCountProvider.onDidExpandElement(el as any);
            }
        }),
        treeView.onDidCollapseElement(e => {
            const el: any = e.element;
            if (el && el.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
                wordCountProvider.onDidCollapseElement(el as any);
            }
        }),
        treeView,
        // 确保 WordCountProvider 能正确清理
        { dispose: () => wordCountProvider.dispose() }
    );

    // 状态栏提供器 - 已禁用，使用 timeStats 中的状态栏
    // const statusBarProvider = new StatusBarProvider(wordCountProvider);
    // statusBarProvider.activate(context);

    // 监听 .gitignore 和 .wcignore 文件变化，刷新字数统计
    if (folders1 && folders1.length) {
        const rootUri = folders1[0].uri;
        
        // 监听 .gitignore 文件
        const gitignoreWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(rootUri, '.gitignore')
        );
        gitignoreWatcher.onDidChange(() => {
            wordCountProvider.refreshIgnoreParser();
            vscode.window.showInformationMessage('检测到 .gitignore 变化，已刷新字数统计');
        });
        gitignoreWatcher.onDidCreate(() => {
            wordCountProvider.refreshIgnoreParser();
            vscode.window.showInformationMessage('检测到 .gitignore 创建，已刷新字数统计');
        });
        gitignoreWatcher.onDidDelete(() => {
            wordCountProvider.refreshIgnoreParser();
            vscode.window.showInformationMessage('检测到 .gitignore 删除，已刷新字数统计');
        });
        context.subscriptions.push(gitignoreWatcher);

        // 监听 .wcignore 文件
        const wcignoreWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(rootUri, '.wcignore')
        );
        wcignoreWatcher.onDidChange(() => {
            wordCountProvider.refreshIgnoreParser();
            vscode.window.showInformationMessage('检测到 .wcignore 变化，已刷新字数统计');
        });
        wcignoreWatcher.onDidCreate(() => {
            wordCountProvider.refreshIgnoreParser();
            vscode.window.showInformationMessage('检测到 .wcignore 创建，已刷新字数统计');
        });
        wcignoreWatcher.onDidDelete(() => {
            wordCountProvider.refreshIgnoreParser();
            vscode.window.showInformationMessage('检测到 .wcignore 删除，已刷新字数统计');
        });
        context.subscriptions.push(wcignoreWatcher);
    }

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

    // 注册字数统计视图的右键菜单命令
    registerWordCountContextCommands(context, wordCountProvider);
    
    // 初始化全局文件追踪（为备份等功能提供基础）
    // 注意：必须在 timeStats 之前初始化，因为 timeStats 依赖于全局文件追踪
    initializeGlobalFileTracking(context);
    
    activateTimeStats(context);
    
    // 注册文件追踪相关命令
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.showFileTrackingStats', showFileTrackingStats),
        vscode.commands.registerCommand('AndreaNovelHelper.cleanupMissingFiles', cleanupMissingFiles),
        vscode.commands.registerCommand('AndreaNovelHelper.exportTrackingData', exportTrackingData)
    );
}

export function deactivate() {
    decorationTypes.forEach((d) => d.dispose());
    deactivateMarkdownToolbar();
    deactivateTimeStats();
}

export { loadRoles };

// —— 新增：注册 WordCount 视图上下文命令 ——
function registerWordCountContextCommands(context: vscode.ExtensionContext, provider: WordCountProvider) {
    const ensureDir = (dir: string) => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    };

    const createFile = async (baseDir: string) => {
        ensureDir(baseDir);
        const type = await vscode.window.showQuickPick([
            { label: 'Markdown (.md)', ext: '.md' },
            { label: 'Text (.txt)', ext: '.txt' }
        ], { placeHolder: '选择新文章格式' });
        if (!type) return;
        const name = await vscode.window.showInputBox({ prompt: '输入文件名（不含扩展名）', value: '未命名' });
        if (!name) return;
        const full = path.join(baseDir, `${name}${type.ext}`);
        if (fs.existsSync(full)) {
            vscode.window.showErrorMessage('文件已存在');
            return;
        }
        fs.writeFileSync(full, '');
        provider.refresh();
        const doc = await vscode.workspace.openTextDocument(full);
        await vscode.window.showTextDocument(doc);
    };

    const createFolder = async (baseDir: string) => {
        ensureDir(baseDir);
        const name = await vscode.window.showInputBox({ prompt: '输入文件夹名称', value: '新建文件夹' });
        if (!name) return;
        const full = path.join(baseDir, name);
        if (fs.existsSync(full)) {
            vscode.window.showErrorMessage('文件夹已存在');
            return;
        }
        fs.mkdirSync(full);
        provider.refresh();
    };

    context.subscriptions.push(
        // 列表末尾按钮点击
        vscode.commands.registerCommand('AndreaNovelHelper.wordCount.createNewFile', (node: any) => {
            const base = node?.baseDir ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!base) return;
            createFile(base);
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.wordCount.createNewFolder', (node: any) => {
            const base = node?.baseDir ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!base) return;
            createFolder(base);
        }),

        // 右键菜单：在此处上方/下方新建
        vscode.commands.registerCommand('AndreaNovelHelper.wordCount.insertFileAbove', async (node: any) => {
            const dir = path.dirname(node.resourceUri.fsPath);
            await createFile(dir);
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.wordCount.insertFileBelow', async (node: any) => {
            const dir = path.dirname(node.resourceUri.fsPath);
            await createFile(dir);
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.wordCount.insertFolderAbove', async (node: any) => {
            const dir = path.dirname(node.resourceUri.fsPath);
            await createFolder(dir);
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.wordCount.insertFolderBelow', async (node: any) => {
            const dir = path.dirname(node.resourceUri.fsPath);
            await createFolder(dir);
        }),

        // 基础：打开/在资源管理器显示/重命名/删除
        vscode.commands.registerCommand('AndreaNovelHelper.wordCount.open', async (node: any) => {
            const uri = node.resourceUri as vscode.Uri;
            if (!uri) return;
            if (fs.existsSync(uri.fsPath) && fs.statSync(uri.fsPath).isDirectory()) return; // 目录无需打开
            await vscode.commands.executeCommand('vscode.open', uri);
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.wordCount.revealInOS', async (node: any) => {
            const uri = node.resourceUri as vscode.Uri;
            if (!uri) return;
            await vscode.commands.executeCommand('revealFileInOS', uri);
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.wordCount.rename', async (node: any) => {
            const p = node.resourceUri.fsPath as string;
            const isDir = fs.statSync(p).isDirectory();
            const oldName = path.basename(p);
            const input = await vscode.window.showInputBox({ prompt: `重命名${isDir ? '文件夹' : '文件'}`, value: oldName });
            if (!input || input === oldName) return;
            const newPath = path.join(path.dirname(p), input);
            if (fs.existsSync(newPath)) {
                vscode.window.showErrorMessage('目标名称已存在');
                return;
            }
            fs.renameSync(p, newPath);
            provider.refresh();
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.wordCount.delete', async (node: any) => {
            const p = node.resourceUri.fsPath as string;
            const isDir = fs.existsSync(p) && fs.statSync(p).isDirectory();
            const confirm = await vscode.window.showWarningMessage(`确定删除${isDir ? '文件夹' : '文件'} ${path.basename(p)}?`, { modal: true }, '确定');
            if (confirm !== '确定') return;
            try {
                if (isDir) fs.rmSync(p, { recursive: true, force: true });
                else fs.unlinkSync(p);
                provider.refresh();
            } catch (e) {
                vscode.window.showErrorMessage(`删除失败: ${e}`);
            }
        })
    );
}
