/* eslint-disable curly */
import * as fs from 'fs';
import JSON5 from 'json5';
import * as path from 'path';
import * as vscode from 'vscode';

import { Role } from './extension';
import { getSupportedLanguages, loadRoles, getPrefix } from './utils/utils';
import { createRoleCompletionProvider } from './Provider/completionProvider';
import { initAutomaton, updateDecorations } from './events/updateDecorations';
import { WordCountProvider } from './Provider/view/wordCountProvider';
import { WordCountOrderManager } from './utils/wordCountOrder';
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
import { registerRoleTreeView } from './Provider/view/roleTreeView';
import { registerDocRolesTreeView } from './Provider/view/docRolesTreeView';
import { registerDocRolesExplorerView } from './Provider/view/docRolesExplorerView';
// import { StatusBarProvider } from './Provider/statusBarProvider'; // 已禁用，使用 timeStats 中的状态栏
import { activateMarkdownToolbar, deactivateMarkdownToolbar } from './Provider/markdownToolbar';
import { activateTimeStats, deactivateTimeStats } from './timeStats';
import { initializeGlobalFileTracking } from './utils/globalFileTracking';
import { setCutClipboard } from './utils/wordCountCutHelper';
import { getFileTracker } from './utils/fileTracker';
import { showFileTrackingStats, cleanupMissingFiles, exportTrackingData, gcFileTracking } from './commands/fileTrackingCommands';
import { checkGitConfigAndGuide, registerGitConfigCommand, registerGitDownloadTestCommand, registerGitSimulateNoGitCommand } from './utils/gitConfigWizard';
import { projectInitWizardRunning } from './wizard/projectInitWizard';
import { clearAllRoleMatchCache } from './utils/roleAsyncShared';
import { registerSetupWizardCommands } from './wizard/setupWalkthrough';
import { registerProjectInitWizard } from './wizard/projectInitWizard';
import { maybePromptProjectInit } from './wizard/workspaceInitCheck';
import { registerMissingRolesBootstrap } from './commands/missingRolesBootstrap';
import { generateExampleRoleList } from './templates/templateGenerators';
import { generateCSpellDictionary } from './utils/generateCSpellDictionary';
import { registerPreviewPane } from './Provider/view/previewPane';
// 避免重复注册相同命令
let gitCommandRegistered = false;


export let dir_outline_url = 'andrea-outline://outline/outline_dir.md';
export let file_outline_url = 'andrea-outline://outline/outline_file.md';

// 全局角色列表
export let roles: Role[] = [];
// 敏感词库源文件集合（包含 json5 / md / txt 自定义命名）
export const sensitiveSourceFiles = new Set<string>();

// 存储当前文档中每个角色出现的范围和对应角色
export let hoverRanges: { range: vscode.Range; role: Role }[] = [];

export function setHoverRanges(ranges: { range: vscode.Range; role: Role }[]) {
    hoverRanges = ranges;
}

// editor 装饰类型存储
export let decorationTypes: Map<string, vscode.TextEditorDecorationType> =
    new Map();

export function cleanRoles() {
    // 改为就地清空，确保引用在异步增量加载过程中保持
    roles.length = 0;
}

export let outlineFS: undefined | OutlineFSProvider | MemoryOutlineFSProvider = undefined;

// 在 activate 最外层先定义一个变量，初始化成当前激活 editor 的 scheme
export let lastEditorScheme = vscode.window.activeTextEditor?.document.uri.scheme;

// 用于发布“角色列表已变更”的事件
export const _onDidChangeRoles = new vscode.EventEmitter<void>();
export const onDidChangeRoles = _onDidChangeRoles.event;
// 角色全量加载完成事件（一次完整扫描结束时触发）
export const _onDidFinishRoles = new vscode.EventEmitter<void>();
export const onDidFinishRoles = _onDidFinishRoles.event;

export async function activate(context: vscode.ExtensionContext) {
    // 输出通道用于调试激活阶段错误/栈
    const logChannel = vscode.window.createOutputChannel('Andrea Novel Helper');
    context.subscriptions.push(logChannel);
    const log = (msg: string, err?: any) => {
        const time = new Date().toISOString();
        logChannel.appendLine(`[${time}] ${msg}`);
        if (err) {
            if (err instanceof Error) {
                logChannel.appendLine(err.message);
                if (err.stack) { logChannel.appendLine(err.stack); }
            } else {
                try { logChannel.appendLine(JSON.stringify(err)); } catch { logChannel.appendLine(String(err)); }
            }
        }
    };
    const cfg1 = vscode.workspace.getConfiguration('AndreaNovelHelper');
    if (cfg1.get<boolean>('workspaceDisabled', false)) {
        console.log('[ANH] workspaceDisabled=true 跳过激活主体');
        return;
    }
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
    // 兼容后续旧代码引用
    const folders1 = wsFolders;
    if (!wsFolders?.length) {
        vscode.window.showErrorMessage('请先打开一个工作区');
        return;
    }
    const wsRoot = wsFolders[0].uri.fsPath;
    // 提前注册 Git 向导命令（即使后续激活流程出错也可用）
    if (!gitCommandRegistered) {
        try { registerGitConfigCommand(context); gitCommandRegistered = true; log('Git 配置命令已注册'); } catch (e) { log('注册 Git 配置命令失败', e); }
    } else { log('Git 配置命令已存在，跳过注册'); }
    // 注册测试下载链接命令
    try { registerGitDownloadTestCommand(context); log('Git 下载测试命令已注册'); } catch (e) { log('注册 Git 下载测试命令失败', e); }
    try { registerGitSimulateNoGitCommand(context); log('Git 未安装模拟命令已注册'); } catch (e) { log('注册 Git 未安装模拟命令失败', e); }
    try { registerSetupWizardCommands(context); log('配置向导命令已注册'); } catch (e) { log('注册 配置向导命令 失败', e); }
    try { registerProjectInitWizard(context); log('项目初始化向导命令已注册'); } catch (e) { log('注册 项目初始化向导命令 失败', e); }
    // 注册启用/禁用命令
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.disableWorkspace', async () => {
            await vscode.workspace.getConfiguration('AndreaNovelHelper').update('workspaceDisabled', true, vscode.ConfigurationTarget.Workspace);
            vscode.window.showInformationMessage('已禁用小说助手（本工作区），重新加载窗口后生效。');
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.enableWorkspace', async () => {
            await vscode.workspace.getConfiguration('AndreaNovelHelper').update('workspaceDisabled', false, vscode.ConfigurationTarget.Workspace);
            vscode.window.showInformationMessage('已启用小说助手（本工作区），重新加载窗口后生效。');
        })
    );

    // 将后续复杂初始化包裹在 try/catch 内，避免单点异常导致整个扩展未激活（从而命令缺失）
    try {
        log('开始执行主初始化');
        // 统一由独立模块检测并可提示初始化
        maybePromptProjectInit();
        // outlineFS = new OutlineFSProvider(path.join(wsRoot, outlineRel));
        outlineFS = new MemoryOutlineFSProvider(path.join(wsRoot, outlineRel));
        if (!outlineFS) {
            vscode.window.showErrorMessage('无法初始化大纲文件系统提供器');
            log('outlineFS 初始化失败: outlineFS 为空');
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
        const manager = registerPreviewPane(context);

        // 启动完成后，若非惰性模式或已有大纲编辑器可见，再做一次初始刷新
        setTimeout(() => {
            const cfgLazyBoot = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const lazyMode = cfgLazyBoot.get<boolean>('outline.lazyMode', true);
            const anyOutlineVisible = vscode.window.visibleTextEditors.some(ed => ed.document.uri.scheme === 'andrea-outline');
            if (lazyMode && !anyOutlineVisible) return;
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
        }, 200);

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
                    const cfgLazyEvt = vscode.workspace.getConfiguration('AndreaNovelHelper');
                    const lazyMode = cfgLazyEvt.get<boolean>('outline.lazyMode', true);
                    const anyOutlineVisible = vscode.window.visibleTextEditors.some(ed => ed.document.uri.scheme === 'andrea-outline');
                    if (!lazyMode || anyOutlineVisible) {
                        refreshOpenOutlines();
                    }
                }

                // 不管有没有触发，都更新状态给下次用
                lastWasContentFile = isContentFile;
            }),

            vscode.workspace.onDidSaveTextDocument(doc => {
                // 保存时，只要是普通文件就刷新
                if (doc.uri.scheme === 'file'
                    && ['markdown', 'plaintext'].includes(doc.languageId)
                    && !doc.uri.fsPath.endsWith('_outline.md')) {
                    const cfgLazySave = vscode.workspace.getConfiguration('AndreaNovelHelper');
                    const lazyMode = cfgLazySave.get<boolean>('outline.lazyMode', true);
                    const anyOutlineVisible = vscode.window.visibleTextEditors.some(ed => ed.document.uri.scheme === 'andrea-outline');
                    if (!lazyMode || anyOutlineVisible) {
                        refreshOpenOutlines();
                    }
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
            if (outline_2raw_file_dir === undefined && isContentEditor()) {
                const cfgLazyPoll = vscode.workspace.getConfiguration('AndreaNovelHelper');
                const lazyMode = cfgLazyPoll.get<boolean>('outline.lazyMode', true);
                const anyOutlineVisible = vscode.window.visibleTextEditors.some(ed => ed.document.uri.scheme === 'andrea-outline');
                if (!lazyMode || anyOutlineVisible) {
                    refreshOpenOutlines();
                }
            }

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
                    const cfgLazyPoll2 = vscode.workspace.getConfiguration('AndreaNovelHelper');
                    const lazyMode = cfgLazyPoll2.get<boolean>('outline.lazyMode', true);
                    const anyOutlineVisible = vscode.window.visibleTextEditors.some(ed => ed.document.uri.scheme === 'andrea-outline');
                    if (!lazyMode || anyOutlineVisible) {
                        refreshOpenOutlines();
                    }
                }
            }
        }, pollingInterval);

        context.subscriptions.push({
            dispose: () => clearInterval(handle)
        });

        registerPackageManagerView(context);
        registerRoleTreeView(context);
        registerDocRolesTreeView(context);
        registerDocRolesExplorerView(context);

        // 初始化 AhoCorasick 管理器
        initAhoCorasickManager(context);

        // 注册缺省角色库缺失提示（避免与项目初始化向导重复）
        registerMissingRolesBootstrap(context);

    // 角色文件监听：已在 packageManagerView 中实现更全面的 watcher（含目录/文件/保存逻辑与 UI 刷新），
    // 这里移除原简化 watcher，避免重复触发 loadRoles / _onDidChangeRoles 造成双重扫描与事件抖动。
    // 若未来需要独立于包管理器的精简模式，可在设置中加开关再恢复。

    // 首次激活：强制全量刷新（清空缓存）再做异步批次扫描，避免潜在遗留缓存/过滤导致的初次缺失
    loadRoles(true); // 不阻塞激活；内部仍按批次异步触发 _onDidChangeRoles / 完成事件
        initAutomaton();

        // 防抖更新
        let timer: ReturnType<typeof setTimeout> | undefined;
        const scheduleUpdate = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => updateDecorations(), 200);
        };

        // 角色库变化后：去抖重建自动机 + 刷新装饰（Hover 已在自身模块监听 onDidChangeRoles，无需额外处理；Def 依赖 hoverRangesMap 也会间接更新）
        let acRebuildTimer: ReturnType<typeof setTimeout> | undefined;
    const onRolesChanged = onDidChangeRoles(() => {
            if (acRebuildTimer) clearTimeout(acRebuildTimer);
            acRebuildTimer = setTimeout(() => {
                try {
                    initAutomaton(); // 重建 AC 自动机（包含别名）
                } catch (e) { console.warn('[ANH] initAutomaton after roles change failed', e); }
        try { clearAllRoleMatchCache(); } catch {/* ignore */}
                scheduleUpdate(); // 触发装饰刷新
            }, 150);
        });
        context.subscriptions.push(onRolesChanged);

        // 最终一次全量加载完成后：立即重建 & 立即刷新（不再二次防抖），确保拿到完整 roles 状态至少跑一次
        const onRolesFinishedDisp = onDidFinishRoles(() => {
            try { initAutomaton(); } catch (e) { console.warn('[ANH] initAutomaton after roles FINISH failed', e); }
            try { clearAllRoleMatchCache(); } catch {/* ignore */}
            // 直接调用而非 schedule，避免再等待 200ms
            updateDecorations();
        });
        context.subscriptions.push(onRolesFinishedDisp);

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
                    loadRoles(true);
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

        // 自动补全提供器：使用纯 provider 工厂 + 显式语言列表（附加 scheme 与触发字符）
        let completionDisposable: vscode.Disposable | undefined;
        const registerCompletion = () => {
            try {
                // 基于用户配置获取语言，强制确保 markdown 在列（避免用户误删导致写作主场景失效）
                const langs = Array.from(new Set([...getSupportedLanguages(), 'markdown']));
                // 组合成更精确的 document selector：file + untitled 都支持
                const selector: (string | vscode.DocumentFilter)[] = [];
                for (const l of langs) {
                    selector.push({ language: l, scheme: 'file' });
                    selector.push({ language: l, scheme: 'untitled' });
                }
                // 若已有旧的，先释放
                if (completionDisposable) {
                    completionDisposable.dispose();
                }
                const provider = createRoleCompletionProvider();
                // 触发字符：常见分隔/结构 & 中西括号等（输入任意文字仍可由 VSCode 自动触发 word-based，再由我们过滤）
                const triggers = ['#', '!', '[', '(', '（', '【'];
                completionDisposable = vscode.languages.registerCompletionItemProvider(selector, provider, ...triggers);
                context.subscriptions.push(completionDisposable);
                log(`Completion provider registered for selector langs=[${langs.join(', ')}], triggers=${triggers.join('')}, initial roles=${roles.length}`);
            } catch (e) {
                log('Completion provider registration FAILED', e);
            }
        };
        registerCompletion();
        // 监听 supportedFileTypes 等配置变化，动态重新注册
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('AndreaNovelHelper.supportedFileTypes')) {
                    registerCompletion();
                }
            })
        );


        // Hover 和 Definition 提供器
        activateHover(context);
        activateDef(context);
        // 敏感词修复 CodeAction
        try {
            const { registerFixsCodeAction } = await import('./Provider/fixsCodeActionProvider.js');
            registerFixsCodeAction(context);
        } catch (e) { console.warn('[ANH] 注册 fixs CodeAction 失败', e); }

        // Markdown 工具条
        activateMarkdownToolbar(context);


        // 确保 openWith 命令注册一次
        ensureRegisterOpenWith(context);

        // Word Count 树视图
        // 手动排序管理器
        let orderManager: WordCountOrderManager | null = null;
        if (folders1 && folders1.length) {
            orderManager = new WordCountOrderManager(folders1[0].uri.fsPath);
            // 应用用户配置
            const cfg = vscode.workspace.getConfiguration();
            orderManager.setOptions({
                step: cfg.get<number>('AndreaNovelHelper.wordCount.order.step', 10),
                padWidth: cfg.get<number>('AndreaNovelHelper.wordCount.order.padWidth', 3),
                autoResequence: cfg.get<boolean>('AndreaNovelHelper.wordCount.order.autoResequence', true)
            });
        }
        const wordCountProvider = new WordCountProvider(context.workspaceState, orderManager || undefined);

        // 拖拽排序控制器（需在 createTreeView 选项中声明才能真正启用）
        const dndController: vscode.TreeDragAndDropController<any> = {
            dragMimeTypes: ['application/vnd.andrea.wordcount.item'],
            dropMimeTypes: ['application/vnd.andrea.wordcount.item'],
            async handleDrag(source, data) {
                const paths = source.filter((s: any) => s?.resourceUri?.fsPath).map((s: any) => s.resourceUri.fsPath);
                data.set('application/vnd.andrea.wordcount.item', new vscode.DataTransferItem(JSON.stringify(paths)));
            },
            async handleDrop(target, data) {
                try {
                    const item = data.get('application/vnd.andrea.wordcount.item');
                    if (!item) return;
                    const json = await item.asString();
                    const moved: string[] = JSON.parse(json);
                    if (moved.length === 0) return;
                    const om = (wordCountProvider as any).getOrderManager?.();
                    const targetPath = target?.resourceUri?.fsPath;
                    const parentDir = (targetPath && fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) ? targetPath : path.dirname(targetPath || moved[0]);
                    if (!om) return;
                    const manual = om.isManual(parentDir);

                    // 判定是否是“同一父目录内部重排”
                    const originalParents = new Set(moved.map(p => path.dirname(p)));
                    const isPureReorder = originalParents.size === 1 && originalParents.has(parentDir);

                    // 如果是跨目录移动，执行物理移动；如果是同目录且自动模式，则提示是否启用手动；否则直接重排
                    if (isPureReorder) {
                        if (!manual) {
                            const choice = await vscode.window.showInformationMessage('当前为自动排序。启用手动排序以调整顺序？', '启用', '取消');
                            if (choice !== '启用') return; // 取消
                            om.toggleManual(parentDir);
                        }
                    }

                    // 计算目标插入参考（如果 target 是文件，表示插入其后；如果 target 是目录表达放入该目录末尾）。
                    const targetIsDir = targetPath && fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();

                    // 跨目录移动：物理移动文件/文件夹
                    if (!isPureReorder) {
                        for (const p of moved) {
                            const baseName = path.basename(p);
                            let dest = targetIsDir ? path.join(parentDir, baseName) : path.join(parentDir, baseName);
                            if (dest === p) continue; // 同路径无需移动
                            // 防止移动到子目录造成递归
                            if (p.startsWith(dest + path.sep)) {
                                vscode.window.showWarningMessage(`无法将 ${baseName} 移动到其自身的子目录中`);
                                continue;
                            }
                            if (fs.existsSync(dest)) {
                                vscode.window.showWarningMessage(`目标已存在: ${baseName}，已跳过`);
                                continue;
                            }
                            try { fs.renameSync(p, dest); } catch (e) { vscode.window.showErrorMessage(`移动失败: ${e}`); continue; }
                            // 更新 moved 集合中的路径以便后续排序
                            const idx = moved.indexOf(p);
                            if (idx >= 0) moved[idx] = dest;
                        }
                    }

                    // 排序/索引处理：仅当 parentDir 为手动模式才写入索引
                    if (om.isManual(parentDir)) {
                        // 获取当前 children（移动后状态）
                        const parentItem = wordCountProvider.getItemById?.(parentDir) || { resourceUri: vscode.Uri.file(parentDir) };
                        const children = await wordCountProvider.getChildren(parentItem as any) as any[];
                        let order = children.filter(c => c.resourceUri && fs.existsSync(c.resourceUri.fsPath) && !c.id?.includes('__new')).map(c => c.resourceUri.fsPath);
                        // 移除已移动项（它们可能旧位置）
                        order = order.filter(p => !moved.includes(p));
                        let insertIndex = -1;
                        if (targetPath && !targetIsDir) {
                            insertIndex = order.indexOf(targetPath);
                        } else {
                            insertIndex = order.length - 1; // 末尾
                        }
                        order.splice(insertIndex + 1, 0, ...moved);
                        om.rewriteSequential(parentDir, order);
                    }

                    // 对原始父目录若为手动且发生了跨目录移动，需要刷新原父目录索引
                    if (!isPureReorder) {
                        for (const op of originalParents) {
                            if (op !== parentDir && om.isManual(op) && fs.existsSync(op)) {
                                const parentItemOld = wordCountProvider.getItemById?.(op) || { resourceUri: vscode.Uri.file(op) };
                                const oldChildren = await wordCountProvider.getChildren(parentItemOld as any) as any[];
                                const oldOrder = oldChildren.filter(c => c.resourceUri && fs.existsSync(c.resourceUri.fsPath) && !c.id?.includes('__new')).map(c => c.resourceUri.fsPath);
                                om.rewriteSequential(op, oldOrder);
                            }
                        }
                    }

                    wordCountProvider.refresh();
                } catch (e) {
                    vscode.window.showErrorMessage('拖拽排序失败: ' + e);
                }
            }
        };

        const treeView = vscode.window.createTreeView('wordCountExplorer', {
            treeDataProvider: wordCountProvider,
            showCollapseAll: true,
            dragAndDropController: dndController
        });
        context.subscriptions.push(treeView);

        // —— 文件/目录 复制 剪切 粘贴 ——
        type ClipEntry = { source: string; isDir: boolean };
        let clipboard: { entries: ClipEntry[]; cut: boolean } | null = null;

        function collectSelectedWordCountPaths(): string[] {
            const sel = (treeView as any).selection as any[] || [];
            const paths = sel.filter(s => s?.resourceUri?.fsPath).map(s => s.resourceUri.fsPath);
            return paths.length ? paths : [];
        }

        context.subscriptions.push(vscode.commands.registerCommand('AndreaNovelHelper.wordCount.copy', (node: any) => {
            const primary = node?.resourceUri?.fsPath;
            const paths = new Set<string>(collectSelectedWordCountPaths());
            if (primary) paths.add(primary);
            const entries: ClipEntry[] = Array.from(paths).map(p => ({ source: p, isDir: fs.existsSync(p) && fs.statSync(p).isDirectory() }));
            clipboard = { entries, cut: false };
            try { setCutClipboard(null); } catch { /* ignore */ }
            vscode.window.setStatusBarMessage(`已复制 ${entries.length} 项`, 2000);
        }));

        context.subscriptions.push(vscode.commands.registerCommand('AndreaNovelHelper.wordCount.cut', (node: any) => {
            const primary = node?.resourceUri?.fsPath;
            const paths = new Set<string>(collectSelectedWordCountPaths());
            if (primary) paths.add(primary);
            const entries: ClipEntry[] = Array.from(paths).map(p => ({ source: p, isDir: fs.existsSync(p) && fs.statSync(p).isDirectory() }));
            clipboard = { entries, cut: true };
            try { setCutClipboard(entries.map(e => e.source)); } catch { /* ignore */ }
            vscode.window.setStatusBarMessage(`已剪切 ${entries.length} 项`, 2000);
            // 触发 TreeView 刷新以显示剪切视觉标记
            wordCountProvider.refresh();
        }));

        context.subscriptions.push(vscode.commands.registerCommand('AndreaNovelHelper.wordCount.paste', async (targetNode: any) => {
            if (!clipboard || clipboard.entries.length === 0) {
                vscode.window.showInformationMessage('剪贴板为空');
                return;
            }
            let targetPath = targetNode?.resourceUri?.fsPath;
            // 支持在空白区域粘贴：默认工作区根
            if (!targetPath) {
                const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (!root) { vscode.window.showWarningMessage('没有工作区，无法粘贴'); return; }
                targetPath = root;
            }
            if (!fs.existsSync(targetPath)) { vscode.window.showWarningMessage('目标不存在'); return; }
            if (!fs.statSync(targetPath).isDirectory()) {
                // 若是文件节点，则使用其父目录
                targetPath = path.dirname(targetPath);
            }
            const om = (wordCountProvider as any).getOrderManager?.();
            const isManual = om ? om.isManual(targetPath) : false;
            const step = (om as any)?.options?.step || 10;
            let seqBase = step;
            if (om && isManual) {
                // 获取现有 children 用于后续索引
                const parentItem = wordCountProvider.getItemById?.(targetPath) || { resourceUri: vscode.Uri.file(targetPath) };
                const children = await wordCountProvider.getChildren(parentItem as any) as any[];
                const ordered = children.filter(c => c.resourceUri && fs.existsSync(c.resourceUri.fsPath) && !c.id?.includes('__new'));
                for (const c of ordered) {
                    const idxVal = om.getIndex(c.resourceUri.fsPath);
                    if (typeof idxVal === 'number' && idxVal >= seqBase) seqBase = idxVal + step;
                }
            }
            const results: string[] = [];
            for (const entry of clipboard.entries) {
                const baseName = path.basename(entry.source);
                let dest = path.join(targetPath, baseName);
                if (dest === entry.source) {
                    // 粘贴到自身目录避免覆盖：添加副本后缀
                    const ext = path.extname(baseName);
                    const stem = ext ? baseName.slice(0, -ext.length) : baseName;
                    let i = 1;
                    while (fs.existsSync(dest)) {
                        const newName = `${stem}_copy${i}${ext}`;
                        dest = path.join(targetPath, newName);
                        i++;
                    }
                } else if (fs.existsSync(dest)) {
                    // 目标存在：生成不重复名称
                    const ext = path.extname(baseName);
                    const stem = ext ? baseName.slice(0, -ext.length) : baseName;
                    let i = 1; let variant = dest;
                    while (fs.existsSync(variant)) {
                        variant = path.join(targetPath, `${stem}_copy${i}${ext}`);
                        i++;
                    }
                    dest = variant;
                }
                try {
                    if (clipboard.cut) {
                        fs.renameSync(entry.source, dest);
                    } else {
                        if (entry.isDir) {
                            copyDirectoryRecursive(entry.source, dest);
                        } else {
                            fs.copyFileSync(entry.source, dest);
                        }
                    }
                    results.push(dest);
                    if (om && isManual) {
                        om.setIndex(dest, seqBase);
                        seqBase += step;
                    }
                } catch (e) {
                    vscode.window.showErrorMessage(`粘贴失败: ${e}`);
                }
            }
            if (clipboard.cut) {
                clipboard = null; // 剪切后清空
                try { setCutClipboard(null); } catch { /* ignore */ }
            }
            wordCountProvider.refresh();
            vscode.window.setStatusBarMessage(`粘贴完成: ${results.length} 项`, 3000);
        }));

        function copyDirectoryRecursive(src: string, dest: string) {
            if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
            const entries = fs.readdirSync(src, { withFileTypes: true });
            for (const e of entries) {
                const s = path.join(src, e.name);
                const d = path.join(dest, e.name);
                if (e.isDirectory()) {
                    copyDirectoryRecursive(s, d);
                } else if (e.isFile()) {
                    fs.copyFileSync(s, d);
                }
            }
        }

        // 监听配置变化动态更新排序参数
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (!orderManager) return;
            let changed = false;
            const cfg = vscode.workspace.getConfiguration();
            const affects = (k: string) => e.affectsConfiguration(k);
            if (affects('AndreaNovelHelper.wordCount.order.step') || affects('AndreaNovelHelper.wordCount.order.padWidth') || affects('AndreaNovelHelper.wordCount.order.autoResequence')) {
                orderManager.setOptions({
                    step: cfg.get<number>('AndreaNovelHelper.wordCount.order.step', 10),
                    padWidth: cfg.get<number>('AndreaNovelHelper.wordCount.order.padWidth', 3),
                    autoResequence: cfg.get<boolean>('AndreaNovelHelper.wordCount.order.autoResequence', true)
                });
                changed = true;
            }
            if (affects('AndreaNovelHelper.wordCount.order.showIndexInLabel')) {
                changed = true; // 仅刷新视图
            }
            if (changed) {
                wordCountProvider.refresh();
            }
        }));

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
            vscode.commands.registerCommand('AndreaNovelHelper.wordCount.forceRecountAll', () => {
                wordCountProvider.forceRecountAll();
                vscode.window.showInformationMessage('已强制重算所有字数缓存');
            }),
            vscode.commands.registerCommand('AndreaNovelHelper.wordCount.forceRecountHere', (node: any) => {
                const p = node?.resourceUri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;
                if (!p) { vscode.window.showWarningMessage('未找到目标路径'); return; }
                wordCountProvider.forceRecountPath(p);
                vscode.window.showInformationMessage('已强制重算: ' + p);
            }),
            vscode.window.onDidChangeActiveTextEditor(async (editor) => {
                if (!editor || !treeView.visible) return;
                const stub = { id: editor.document.uri.fsPath, resourceUri: editor.document.uri } as any;
                try {
                    await treeView.reveal(stub, { expand: true, select: true, focus: false });
                } catch {
                    // 忽略
                }
                // 有 Git 仓库情况下，对刚切换的文件做一次缓存校验（异步）
                if (editor?.document?.uri?.scheme === 'file') {
                    wordCountProvider.verifyFileCache(editor.document.uri.fsPath).catch(() => { });
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
            vscode.commands.registerCommand('AndreaNovelHelper.exportTrackingData', exportTrackingData),
            vscode.commands.registerCommand('AndreaNovelHelper.gcFileTracking', gcFileTracking)
        );

        // 启动后异步检查（避免阻塞激活）
        setTimeout(() => {
            if (projectInitWizardRunning) { return; }
            const wsRoot2 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (wsRoot2) { log('开始异步检查 Git 配置'); checkGitConfigAndGuide(wsRoot2, { silentIfConfigured: true }).catch(e => log('Git 配置向导执行异常', e)); }
        }, 800);
        log('激活流程结束');
    } catch (e) {
        const msg = 'Andrea Novel Helper 激活过程出现错误，部分功能可能不可用：' + (e instanceof Error ? e.message : String(e));
        vscode.window.showErrorMessage(msg, '查看日志').then(sel => { if (sel === '查看日志') { logChannel.show(true); } });
        log('激活致命错误', e);
        console.error('[AndreaNovelHelper][activate] Fatal init error:', e);
        // 兜底再次尝试注册 Git 命令（若前面失败）
        if (!gitCommandRegistered) {
            try { registerGitConfigCommand(context); gitCommandRegistered = true; log('兜底重新注册 Git 命令完成'); } catch (e2) { log('兜底注册 Git 命令仍失败', e2); }
        }
    }
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

    const createFile = async (baseDir: string, hintPathForIndex?: { before?: string; after?: string }) => {
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
        // 确保文件被文件追踪系统立刻追踪以生成稳定 UUID（避免使用 p: 路径键）
        try {
            const tracker = getFileTracker?.();
            if (tracker?.handleFileCreated) {
                await tracker.handleFileCreated(full);
            }
        } catch (e) { /* 静默，失败时后续仍会有迁移兜底 */ }
        // 兜底：稍后再尝试一次单文件键迁移（若当下仍是 p:）
        try {
            const om2 = (provider as any).getOrderManager?.();
            if (om2?.upgradeFileKey) {
                setTimeout(() => { try { om2.upgradeFileKey(full); } catch { } }, 500);
                setTimeout(() => { try { om2.migrateAllFileKeys?.(); } catch { } }, 1500);
            }
        } catch { /* ignore */ }
        // 分配索引
        const om = (provider as any).getOrderManager?.();
        if (om) {
            const parent = baseDir;
            if (om.isManual(parent)) {
                let idx: number;
                if (hintPathForIndex) {
                    const beforeIdx = hintPathForIndex.before ? om.getIndex(hintPathForIndex.before) : undefined;
                    const afterIdx = hintPathForIndex.after ? om.getIndex(hintPathForIndex.after) : undefined;
                    idx = om.allocateBetween(parent, beforeIdx, afterIdx);
                } else {
                    // 普通新增放在末尾
                    const siblings = fs.readdirSync(parent).map(n => path.join(parent, n));
                    idx = om.nextIndex(parent, siblings);
                }
                om.setIndex(full, idx);
            }
        }
        provider.refresh();
        const doc = await vscode.workspace.openTextDocument(full);
        await vscode.window.showTextDocument(doc);
    };

    const createFolder = async (baseDir: string, hintPathForIndex?: { before?: string; after?: string }) => {
        ensureDir(baseDir);
        const name = await vscode.window.showInputBox({ prompt: '输入文件夹名称', value: '新建文件夹' });
        if (!name) return;
        const full = path.join(baseDir, name);
        if (fs.existsSync(full)) {
            vscode.window.showErrorMessage('文件夹已存在');
            return;
        }
        fs.mkdirSync(full);
        // 分配索引
        const om = (provider as any).getOrderManager?.();
        if (om) {
            const parent = baseDir;
            if (om.isManual(parent)) {
                let idx: number;
                if (hintPathForIndex) {
                    const beforeIdx = hintPathForIndex.before ? om.getIndex(hintPathForIndex.before) : undefined;
                    const afterIdx = hintPathForIndex.after ? om.getIndex(hintPathForIndex.after) : undefined;
                    idx = om.allocateBetween(parent, beforeIdx, afterIdx);
                } else {
                    const siblings = fs.readdirSync(parent).map(n => path.join(parent, n));
                    idx = om.nextIndex(parent, siblings);
                }
                om.setIndex(full, idx);
            }
        }
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
            const om = (provider as any).getOrderManager?.();
            let before: string | undefined = undefined;
            if (om && om.isManual(dir)) {
                // 基于当前 provider 排序
                const parentItem = provider.getItemById?.(dir) || { resourceUri: vscode.Uri.file(dir) };
                const children = await provider.getChildren(parentItem as any) as any[];
                const linear = children.filter(c => !(c instanceof vscode.TreeItem && c.contextValue?.startsWith('wordCountNew')))
                    .filter(c => c.resourceUri && fs.existsSync(c.resourceUri.fsPath));
                const orderedPaths = linear.map(c => c.resourceUri.fsPath);
                const idx = orderedPaths.indexOf(node.resourceUri.fsPath);
                if (idx > 0) before = orderedPaths[idx - 1];
            }
            await createFile(dir, { before, after: node.resourceUri.fsPath });
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.wordCount.insertFileBelow', async (node: any) => {
            const dir = path.dirname(node.resourceUri.fsPath);
            const om = (provider as any).getOrderManager?.();
            let after: string | undefined = undefined;
            if (om && om.isManual(dir)) {
                const parentItem = provider.getItemById?.(dir) || { resourceUri: vscode.Uri.file(dir) };
                const children = await provider.getChildren(parentItem as any) as any[];
                const linear = children.filter(c => !(c instanceof vscode.TreeItem && c.contextValue?.startsWith('wordCountNew')))
                    .filter(c => c.resourceUri && fs.existsSync(c.resourceUri.fsPath));
                const orderedPaths = linear.map(c => c.resourceUri.fsPath);
                const idx = orderedPaths.indexOf(node.resourceUri.fsPath);
                if (idx >= 0 && idx < orderedPaths.length - 1) after = orderedPaths[idx + 1];
            }
            await createFile(dir, { before: node.resourceUri.fsPath, after });
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.wordCount.insertFolderAbove', async (node: any) => {
            const dir = path.dirname(node.resourceUri.fsPath);
            const om = (provider as any).getOrderManager?.();
            let before: string | undefined = undefined;
            if (om && om.isManual(dir)) {
                const parentItem = provider.getItemById?.(dir) || { resourceUri: vscode.Uri.file(dir) };
                const children = await provider.getChildren(parentItem as any) as any[];
                const linear = children.filter(c => !(c instanceof vscode.TreeItem && c.contextValue?.startsWith('wordCountNew')))
                    .filter(c => c.resourceUri && fs.existsSync(c.resourceUri.fsPath));
                const orderedPaths = linear.map(c => c.resourceUri.fsPath);
                const idx = orderedPaths.indexOf(node.resourceUri.fsPath);
                if (idx > 0) before = orderedPaths[idx - 1];
            }
            await createFolder(dir, { before, after: node.resourceUri.fsPath });
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.wordCount.insertFolderBelow', async (node: any) => {
            const dir = path.dirname(node.resourceUri.fsPath);
            const om = (provider as any).getOrderManager?.();
            let after: string | undefined = undefined;
            if (om && om.isManual(dir)) {
                const parentItem = provider.getItemById?.(dir) || { resourceUri: vscode.Uri.file(dir) };
                const children = await provider.getChildren(parentItem as any) as any[];
                const linear = children.filter(c => !(c instanceof vscode.TreeItem && c.contextValue?.startsWith('wordCountNew')))
                    .filter(c => c.resourceUri && fs.existsSync(c.resourceUri.fsPath));
                const orderedPaths = linear.map(c => c.resourceUri.fsPath);
                const idx = orderedPaths.indexOf(node.resourceUri.fsPath);
                if (idx >= 0 && idx < orderedPaths.length - 1) after = orderedPaths[idx + 1];
            }
            await createFolder(dir, { before: node.resourceUri.fsPath, after });
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
            // 迁移索引
            const om = (provider as any).getOrderManager?.();
            if (om) om.renamePath(p, newPath);
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
                const om = (provider as any).getOrderManager?.();
                if (om) om.removePath(p);
                provider.refresh();
            } catch (e) {
                vscode.window.showErrorMessage(`删除失败: ${e}`);
            }
        }),
        // 切换手动排序
        vscode.commands.registerCommand('AndreaNovelHelper.wordCount.toggleManualOrdering', async (node: any) => {
            const om = (provider as any).getOrderManager?.();
            if (!om) return;
            const folder = node.resourceUri.fsPath as string;
            const wasManual = om.isManual(folder);
            if (!wasManual) {
                // 准备启用：先获取当前“自动模式”下的可见顺序快照
                let snapshot: string[] = [];
                try {
                    const children = await provider.getChildren(node) as any[];
                    snapshot = children
                        .filter(c => c?.resourceUri && fs.existsSync(c.resourceUri.fsPath) && !c.contextValue?.startsWith('wordCountNew'))
                        .map(c => c.resourceUri.fsPath);
                } catch { /* ignore */ }
                const enabled = om.toggleManual(folder); // 现在切换到手动
                if (enabled) {
                    // 按自动排序时看到的顺序重新写全量索引（覆盖旧值，保证一致）
                    const step = om['options']?.step || 10;
                    let seq = step;
                    for (const p of snapshot) {
                        om.setIndex(p, seq);
                        seq += step;
                    }
                    // 延迟刷新以批量呈现
                    setTimeout(() => provider.refresh(), 150);
                    vscode.window.showInformationMessage(`手动排序已启用并按当前自动顺序生成索引: ${path.basename(folder)}`);
                    return;
                }
            } else {
                // 已是手动 -> 切换回自动
                const enabled = om.toggleManual(folder); // 关闭
                vscode.window.showInformationMessage(`手动排序已${enabled ? '启用' : '关闭'}: ${path.basename(folder)}`);
                provider.refresh();
            }
        }),
        // 根据文件名生成索引（提取数字）
        vscode.commands.registerCommand('AndreaNovelHelper.wordCount.generateIndexFromName', async (node: any) => {
            const om = (provider as any).getOrderManager?.();
            if (!om) return;
            const p = node.resourceUri.fsPath as string;
            const idx = om.generateIndexFromName(p);
            if (idx !== undefined) {
                vscode.window.showInformationMessage(`已为 ${path.basename(p)} 生成索引 ${idx}`);
            } else {
                vscode.window.showWarningMessage('未在名称中找到数字，未生成索引');
            }
            provider.refresh();
        }),
        // 清除索引
        vscode.commands.registerCommand('AndreaNovelHelper.wordCount.clearIndex', async (node: any) => {
            const om = (provider as any).getOrderManager?.();
            if (!om) return;
            const p = node.resourceUri.fsPath as string;
            om.clearIndex(p);
            vscode.window.showInformationMessage(`已清除索引: ${path.basename(p)}`);
            provider.refresh();
        }),
        // 手动输入索引
        vscode.commands.registerCommand('AndreaNovelHelper.wordCount.setIndexManual', async (node: any) => {
            const om = (provider as any).getOrderManager?.();
            if (!om) return;
            const p = node.resourceUri.fsPath as string;
            const old = om.getIndex(p);
            const input = await vscode.window.showInputBox({ prompt: '输入新的索引数字', value: old !== undefined ? String(old) : '' });
            if (!input) return;
            const num = Number(input);
            if (!Number.isFinite(num)) {
                vscode.window.showErrorMessage('请输入有效数字');
                return;
            }
            om.setIndex(p, num);
            provider.refresh();
        }),
        // 为文件夹内所有项目按当前名称顺序批量生成索引（重建）
        vscode.commands.registerCommand('AndreaNovelHelper.wordCount.bulkGenerateIndices', async (node: any) => {
            const om = (provider as any).getOrderManager?.();
            if (!om) return;
            const folder = node.resourceUri.fsPath as string;
            const manualEnabled = om.isManual(folder) || om.toggleManual(folder); // 确保开启
            const entries = fs.readdirSync(folder).map(n => path.join(folder, n));
            let idx = 10;
            for (const p of entries) {
                om.setIndex(p, idx);
                idx += 10;
            }
            vscode.window.showInformationMessage(`已为 ${path.basename(folder)} 重新生成索引`);
            provider.refresh();
        })
    );
}
