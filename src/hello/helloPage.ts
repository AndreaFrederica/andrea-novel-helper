import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { setWebviewPanelIcon } from '../Provider/utils/webviewPanelIcon';
import { getProjectInitStatus } from '../wizard/workspaceInitCheck';

interface RecommendedExtensionEntry {
    id: string;
    name: string;
    description?: string;
    reason?: string;
    publisher?: string;
    author?: string;
    category?: string;
    tags?: string[];
    marketplaceUrl?: string;
}

interface RecommendedExtensionState extends RecommendedExtensionEntry {
    installed: boolean;
    active: boolean;
}

interface RunGitResult {
    code: number;
    stdout: string;
    stderr: string;
    enoent?: boolean;
}

interface HelloGitState {
    installed: boolean;
    version: string;
    hasWorkspace: boolean;
    hasRepo: boolean;
    globalName: string;
    globalEmail: string;
    localName: string;
    localEmail: string;
}

interface HelloRecentWorkspace {
    name: string;
    path: string;
    lastOpened: number;
}

const HELLO_DISMISSED_KEY = 'andrea.hello.dismissed.v1';
const HELLO_FIRST_PROMPT_DONE_KEY = 'andrea.hello.firstPromptDone.v1';
const HELLO_RECENT_WORKSPACES_KEY = 'andrea.hello.recentWorkspaces.v1';
const HELLO_VIEW_TYPE = 'andrea.hello';
const RECOMMENDED_EXTENSIONS_FILE = 'recommended-extensions.json';
const RECENT_WORKSPACE_LIMIT = 8;

let currentPanel: vscode.WebviewPanel | undefined;
let extensionPath = '';
let openingHello = false;
const firstPromptSkippedPanels = new WeakSet<vscode.WebviewPanel>();

export function registerHelloPage(context: vscode.ExtensionContext): void {
    extensionPath = context.extensionPath;

    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.openHello', async () => {
            await showHelloPage(context, true);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.forceShowHelloFirstSetup', async () => {
            await context.globalState.update(HELLO_FIRST_PROMPT_DONE_KEY, false);
            if (currentPanel) {
                firstPromptSkippedPanels.delete(currentPanel);
            }
            await showHelloPage(context, true);
        })
    );

    if (vscode.window.registerWebviewPanelSerializer) {
        context.subscriptions.push(
            vscode.window.registerWebviewPanelSerializer(HELLO_VIEW_TYPE, {
                async deserializeWebviewPanel(panel: vscode.WebviewPanel) {
                    setupHelloPanel(panel, context);
                }
            })
        );
    }
}

export function isHelloPageEnabled(): boolean {
    return vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('hello.enabled', true);
}

export function shouldUseVsCodeManagedDisablingForHello(): boolean {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    return cfg.get<boolean>('hello.enabled', true) && cfg.get<boolean>('hello.forceVsCodeManagedDisabling', true);
}

/**
 * 检查是否有其他打开的文本编辑器（不是webview或其他自定义页面）
 */
function hasOtherEditors(): boolean {
    try {
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                const input = tab.input;
                // 检查是否是文本编辑器（TextTab）
                if (input instanceof vscode.TabInputText) {
                    return true;
                }
            }
        }
    } catch {
        return false;
    }
    return false;
}

export async function maybeShowHelloPage(context: vscode.ExtensionContext): Promise<void> {
    if (!isHelloPageEnabled()) {
        return;
    }
    if (context.globalState.get<boolean>(HELLO_DISMISSED_KEY, false)) {
        return;
    }
    // 如果已经有其他打开的文本编辑器，就不显示hello页面
    if (hasOtherEditors()) {
        return;
    }

    await showHelloPage(context, false);
}

async function showHelloPage(context: vscode.ExtensionContext, explicit: boolean): Promise<void> {
    // 如果已经有hello tab存在或正在打开，直接返回或显示已打开的提示
    if (hasExistingHelloTab()) {
        if (currentPanel) {
            currentPanel.reveal(vscode.ViewColumn.Active);
            await postState(currentPanel, context);
        } else if (explicit) {
            vscode.window.showInformationMessage('ANH Hello 首页已经打开。');
        }
        return;
    }

    if (openingHello) {
        return;
    }

    openingHello = true;
    try {
        const panel = vscode.window.createWebviewPanel(
            HELLO_VIEW_TYPE,
            'Andrea Novel Helper Hello',
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(path.join(extensionPath, 'media'))]
            }
        );
        setupHelloPanel(panel, context);
    } finally {
        openingHello = false;
    }
}

function setupHelloPanel(panel: vscode.WebviewPanel, context: vscode.ExtensionContext): void {
    if (currentPanel && currentPanel !== panel) {
        currentPanel.dispose();
    }
    currentPanel = panel;
    openingHello = false;
    panel.title = 'Andrea Novel Helper Hello';
    setWebviewPanelIcon(panel, extensionPath, 'hello');
    panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.file(path.join(extensionPath, 'media'))]
    };
    panel.webview.html = getHelloHtml(panel.webview);
    panel.onDidDispose(() => {
        if (currentPanel === panel) {
            currentPanel = undefined;
        }
        themeWatcher.dispose();
    }, undefined, context.subscriptions);

    const themeWatcher = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('workbench.colorTheme') || e.affectsConfiguration('editor.tokenColorCustomizations')) {
            sendThemeColors(panel);
        }
    });
    context.subscriptions.push(themeWatcher);
    panel.webview.onDidReceiveMessage(async message => {
        try {
            switch (message?.command) {
                case 'ready':
                case 'refresh':
                    await postState(panel, context);
                    break;
                case 'requestThemeColors':
                    sendThemeColors(panel);
                    break;
                case 'dismiss':
                    await context.globalState.update(HELLO_DISMISSED_KEY, true);
                    panel.dispose();
                    break;
                case 'setConfig':
                    await updateHelloConfig(message.key, message.value);
                    await postState(panel, context);
                    break;
                case 'submitFirstHelloPrompt':
                    if (await applyFirstHelloPrompt(context, message.data, panel)) {
                        await postState(panel, context);
                    }
                    break;
                case 'skipFirstHelloPrompt':
                    firstPromptSkippedPanels.add(panel);
                    await postState(panel, context);
                    break;
                case 'enableWorkspace':
                    await enableWorkspace();
                    await postState(panel, context);
                    break;
                case 'enableManagedMode':
                    await enableManagedHelloMode();
                    await postState(panel, context);
                    break;
                case 'configureGitUser':
                    await configureGitUser(message.data);
                    await postState(panel, context);
                    break;
                case 'initGitRepo':
                    await initGitRepo();
                    await postState(panel, context);
                    break;
                case 'openGitDownload':
                    await vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/downloads'));
                    break;
                case 'createWorkspace':
                    await createWorkspace(context);
                    break;
                case 'openWorkspace':
                    await openWorkspace(context);
                    break;
                case 'openAnhSettings':
                    await openAnhSettingsPicker();
                    break;
                case 'openRecentWorkspace':
                    if (typeof message.path === 'string') {
                        await openWorkspacePath(context, message.path);
                    }
                    break;
                case 'openRecentList':
                    await vscode.commands.executeCommand('workbench.action.openRecent');
                    break;
                case 'runCommand':
                    if (typeof message.id === 'string') {
                        await vscode.commands.executeCommand(message.id, message.arg);
                    }
                    break;
                case 'openDoc':
                    if (typeof message.docId === 'string') {
                        await vscode.commands.executeCommand('AndreaNovelHelper.showGuideDoc', message.docId);
                    }
                    break;
                case 'openExtension':
                    if (typeof message.extensionId === 'string') {
                        await openExtensionPage(message.extensionId, message.marketplaceUrl);
                    }
                    break;
                case 'openUrl':
                    if (typeof message.url === 'string') {
                        await vscode.env.openExternal(vscode.Uri.parse(message.url));
                    }
                    break;
            }
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            panel.webview.postMessage({ command: 'error', message: text });
            vscode.window.showErrorMessage(`Hello 页面操作失败: ${text}`);
        }
    }, undefined, context.subscriptions);
}

function hasExistingHelloTab(): boolean {
    try {
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                const input = tab.input;
                if (input instanceof vscode.TabInputWebview && input.viewType === HELLO_VIEW_TYPE) {
                    return true;
                }
            }
        }
    } catch {
        return false;
    }
    return false;
}

async function postState(panel: vscode.WebviewPanel, context: vscode.ExtensionContext): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const workspaceDisabled = getEffectiveWorkspaceDisabled(cfg);
    const recommendations = loadRecommendedExtensions(context).map(toRecommendationState);
    const git = await getGitState();
    const projectInit = getProjectInitStatus(workspaceFolder?.uri.fsPath);
    if (workspaceFolder) {
        await updateRecentWorkspaces(context, workspaceFolder.uri.fsPath);
    }
    const themeKind = getThemeKindName();
    await panel.webview.postMessage({
        command: 'state',
        data: {
            i18n: getHelloI18n(),
            workspace: workspaceFolder ? {
                name: workspaceFolder.name || path.basename(workspaceFolder.uri.fsPath),
                path: workspaceFolder.uri.fsPath,
            } : undefined,
            projectInit,
            recentWorkspaces: getRecentWorkspaces(context, workspaceFolder?.uri.fsPath),
            config: {
                helloEnabled: cfg.get<boolean>('hello.enabled', true),
                forceVsCodeManagedDisabling: cfg.get<boolean>('hello.forceVsCodeManagedDisabling', true),
                originalVsCodeManagedDisabling: cfg.get<boolean>('useVsCodeManagedDisabling', false),
                effectiveVsCodeManagedDisabling: cfg.get<boolean>('useVsCodeManagedDisabling', false) || shouldUseVsCodeManagedDisablingForHello(),
                workspaceDisabled,
                firstHelloPromptNeeded: !context.globalState.get<boolean>(HELLO_FIRST_PROMPT_DONE_KEY, false) && !firstPromptSkippedPanels.has(panel),
            },
            recommendations,
            git,
            themeKind,
        }
    });
}

async function applyFirstHelloPrompt(
    context: vscode.ExtensionContext,
    data: unknown,
    panel: vscode.WebviewPanel
): Promise<boolean> {
    const payload = data as { openHello?: boolean; startupHello?: boolean } | undefined;
    const openHello = payload?.openHello !== false;
    const startupHello = payload?.startupHello !== false;

    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    await cfg.update('hello.enabled', startupHello, vscode.ConfigurationTarget.Global);
    await context.globalState.update(HELLO_DISMISSED_KEY, !startupHello);
    await context.globalState.update(HELLO_FIRST_PROMPT_DONE_KEY, true);

    if (!openHello) {
        panel.dispose();
        return false;
    }

    return true;
}

function runGit(args: string[], cwd?: string): Promise<RunGitResult> {
    return new Promise(resolve => {
        try {
            const proc = spawn('git', args, { cwd: cwd || getSafeCwd(), shell: false });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', data => { stdout += data.toString(); });
            proc.stderr.on('data', data => { stderr += data.toString(); });
            proc.on('error', error => {
                resolve({
                    code: 127,
                    stdout: stdout.trim(),
                    stderr: (stderr + '\n' + (error.message || '')).trim(),
                    enoent: (error as NodeJS.ErrnoException).code === 'ENOENT'
                });
            });
            proc.on('close', code => {
                resolve({ code: code ?? 0, stdout: stdout.trim(), stderr: stderr.trim() });
            });
        } catch (error) {
            resolve({ code: 127, stdout: '', stderr: String(error), enoent: true });
        }
    });
}

function getSafeCwd(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
}

async function getGitState(): Promise<HelloGitState> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const cwd = workspaceRoot || os.homedir();
    const version = await runGit(['--version'], cwd);
    const installed = version.code === 0 && !version.enoent;
    if (!installed) {
        return {
            installed: false,
            version: '',
            hasWorkspace: !!workspaceRoot,
            hasRepo: false,
            globalName: '',
            globalEmail: '',
            localName: '',
            localEmail: '',
        };
    }

    const [repo, globalName, globalEmail, localName, localEmail] = await Promise.all([
        workspaceRoot ? runGit(['rev-parse', '--is-inside-work-tree'], workspaceRoot) : Promise.resolve({ code: 1, stdout: '', stderr: '' }),
        runGit(['config', '--global', 'user.name'], cwd),
        runGit(['config', '--global', 'user.email'], cwd),
        workspaceRoot ? runGit(['config', '--local', 'user.name'], workspaceRoot) : Promise.resolve({ code: 1, stdout: '', stderr: '' }),
        workspaceRoot ? runGit(['config', '--local', 'user.email'], workspaceRoot) : Promise.resolve({ code: 1, stdout: '', stderr: '' }),
    ]);

    return {
        installed: true,
        version: version.stdout,
        hasWorkspace: !!workspaceRoot,
        hasRepo: repo.code === 0 && repo.stdout.toLowerCase() === 'true',
        globalName: globalName.stdout,
        globalEmail: globalEmail.stdout,
        localName: localName.stdout,
        localEmail: localEmail.stdout,
    };
}

async function configureGitUser(data: unknown): Promise<void> {
    const payload = data as { scope?: string; name?: string; email?: string } | undefined;
    const scope = payload?.scope === 'local' ? 'local' : 'global';
    const name = (payload?.name || '').trim();
    const email = (payload?.email || '').trim();
    if (!name) {
        throw new Error('请填写 Git 用户名');
    }
    if (!/.+@.+\..+/.test(email)) {
        throw new Error('请填写有效的 Git 邮箱');
    }

    const state = await getGitState();
    if (!state.installed) {
        throw new Error('未检测到 Git，请先安装 Git');
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (scope === 'local' && !workspaceRoot) {
        throw new Error('当前没有打开工作区，不能写入仓库配置');
    }
    if (scope === 'local' && !state.hasRepo) {
        throw new Error('当前工作区还不是 Git 仓库，请先初始化仓库');
    }

    const cwd = scope === 'local' ? workspaceRoot! : getSafeCwd();
    const scopeArg = scope === 'local' ? '--local' : '--global';
    const setName = await runGit(['config', scopeArg, 'user.name', name], cwd);
    if (setName.code !== 0) {
        throw new Error(`设置 Git user.name 失败: ${setName.stderr || setName.stdout}`);
    }
    const setEmail = await runGit(['config', scopeArg, 'user.email', email], cwd);
    if (setEmail.code !== 0) {
        throw new Error(`设置 Git user.email 失败: ${setEmail.stderr || setEmail.stdout}`);
    }
    vscode.window.showInformationMessage(`已保存 Git ${scope === 'local' ? '当前仓库' : '全局'}身份。`);
}

async function initGitRepo(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        throw new Error('请先创建或打开一个写作工作区');
    }
    const state = await getGitState();
    if (!state.installed) {
        throw new Error('未检测到 Git，请先安装 Git');
    }
    if (state.hasRepo) {
        vscode.window.showInformationMessage('当前工作区已经是 Git 仓库。');
        return;
    }
    const result = await runGit(['init'], workspaceRoot);
    if (result.code !== 0) {
        throw new Error(`Git 仓库初始化失败: ${result.stderr || result.stdout}`);
    }
    vscode.window.showInformationMessage('已初始化当前工作区的 Git 仓库。');
}

function getEffectiveWorkspaceDisabled(cfg: vscode.WorkspaceConfiguration): boolean {
    const inspected = cfg.inspect<boolean>('workspaceDisabled');
    if (inspected?.workspaceFolderValue !== undefined) {
        return inspected.workspaceFolderValue;
    }
    if (inspected?.workspaceValue !== undefined) {
        return inspected.workspaceValue;
    }
    if (inspected?.globalValue !== undefined) {
        return inspected.globalValue;
    }
    return cfg.get<boolean>('workspaceDisabled', false);
}

async function updateHelloConfig(key: unknown, value: unknown): Promise<void> {
    if (key !== 'hello.enabled' && key !== 'hello.forceVsCodeManagedDisabling') {
        throw new Error('不支持的 Hello 配置项');
    }
    await vscode.workspace.getConfiguration('AndreaNovelHelper').update(key, Boolean(value), vscode.ConfigurationTarget.Global);
    if (key === 'hello.enabled' && value === true) {
        await vscode.commands.executeCommand('setContext', 'andrea.anh.enabled', true);
    }
}

async function enableWorkspace(): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) {
        vscode.window.showInformationMessage('请先创建或打开一个写作工作区。');
        return;
    }
    await vscode.workspace.getConfiguration('AndreaNovelHelper').update('workspaceDisabled', false, vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('setContext', 'andrea.anh.enabled', true);
    vscode.window.showInformationMessage('已启用当前工作区的 Andrea Novel Helper。');
}

async function enableManagedHelloMode(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    await cfg.update('hello.enabled', true, vscode.ConfigurationTarget.Global);
    await cfg.update('hello.forceVsCodeManagedDisabling', true, vscode.ConfigurationTarget.Global);
    if (vscode.workspace.workspaceFolders?.length) {
        await cfg.update('workspaceDisabled', false, vscode.ConfigurationTarget.Workspace);
    }
    await vscode.commands.executeCommand('setContext', 'andrea.anh.enabled', true);
    vscode.window.showInformationMessage('已启用 Hello 首页模式，并由 VS Code 扩展开关控制运行状态。');
}

const AUTO_OPEN_PROJECT_INIT_KEY = 'andrea.projectInit.autoOpenAfterCreate';

async function createWorkspace(context: vscode.ExtensionContext): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
        title: '选择新写作工作区文件夹（可在对话框内新建文件夹后选中）',
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: '创建工作区'
    });
    if (!picked?.[0]) {
        return;
    }

    const projectPath = picked[0].fsPath;

    // 如果文件夹已存在且里面有内容，提示确认
    if (fs.existsSync(projectPath)) {
        const entries = fs.readdirSync(projectPath);
        if (entries.length > 0) {
            const choice = await vscode.window.showWarningMessage(
                '所选文件夹已有内容，是否仍作为写作工作区打开？',
                { modal: true },
                '打开',
                '取消'
            );
            if (choice !== '打开') {
                return;
            }
        }
    } else {
        // 理论上 showOpenDialog 不会返回不存在的路径，兜底创建
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(projectPath));
    }

    await updateRecentWorkspaces(context, projectPath);
    // 设置标记：打开新工作区后自动弹出项目初始化向导（不询问）
    await context.globalState.update(AUTO_OPEN_PROJECT_INIT_KEY, path.resolve(projectPath));
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath), false);
}

async function openWorkspace(context: vscode.ExtensionContext): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
        title: '打开小说写作工作区',
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: '打开工作区'
    });
    if (picked?.[0]) {
        await updateRecentWorkspaces(context, picked[0].fsPath);
        await vscode.commands.executeCommand('vscode.openFolder', picked[0], false);
    }
}

async function openWorkspacePath(context: vscode.ExtensionContext, workspacePath: string): Promise<void> {
    const normalized = path.resolve(workspacePath);
    if (!fs.existsSync(normalized)) {
        vscode.window.showWarningMessage('该最近项目路径不存在或无法访问。');
        return;
    }
    await updateRecentWorkspaces(context, normalized);
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(normalized), false);
}

async function openAnhSettingsPicker(): Promise<void> {
    const choice = await vscode.window.showQuickPick([
        {
            label: '完整扩展设置编辑器',
            description: 'ANH 自定义设置编辑器窗口',
            command: 'andrea.openEditorSettingsEnhanced'
        },
        {
            label: '图形化快速设置',
            description: '常用设置、排版与写作体验快速入口',
            command: 'andrea.openGraphicalQuickSettings'
        },
        {
            label: 'VS Code 设置页',
            description: '使用 @ext 过滤显示 ANH 配置项',
            command: 'workbench.action.openSettings',
            arg: '@ext:AndreaFrederica.andrea-novel-helper'
        }
    ], {
        title: '选择打开 ANH 设置的方式',
        placeHolder: '选择一个设置界面'
    });
    if (!choice) return;
    await vscode.commands.executeCommand(choice.command, choice.arg);
}

async function updateRecentWorkspaces(context: vscode.ExtensionContext, workspacePath: string): Promise<void> {
    const normalized = path.resolve(workspacePath);
    const existing = getRecentWorkspaces(context).filter(item => path.resolve(item.path) !== normalized);
    const next: HelloRecentWorkspace[] = [
        { name: path.basename(normalized), path: normalized, lastOpened: Date.now() },
        ...existing
    ].slice(0, RECENT_WORKSPACE_LIMIT);
    await context.globalState.update(HELLO_RECENT_WORKSPACES_KEY, next);
}

function getRecentWorkspaces(context: vscode.ExtensionContext, currentPath?: string): HelloRecentWorkspace[] {
    const current = currentPath ? path.resolve(currentPath) : '';
    const raw = context.globalState.get<HelloRecentWorkspace[]>(HELLO_RECENT_WORKSPACES_KEY, []);
    return (Array.isArray(raw) ? raw : [])
        .filter(item => item && typeof item.path === 'string' && (!current || path.resolve(item.path) !== current))
        .slice(0, RECENT_WORKSPACE_LIMIT);
}

async function openExtensionPage(extensionId: string, marketplaceUrl?: string): Promise<void> {
    try {
        await vscode.commands.executeCommand('extension.open', extensionId);
        return;
    } catch {
        const url = marketplaceUrl || `https://marketplace.visualstudio.com/items?itemName=${encodeURIComponent(extensionId)}`;
        await vscode.env.openExternal(vscode.Uri.parse(url));
    }
}

function loadRecommendedExtensions(context: vscode.ExtensionContext): RecommendedExtensionEntry[] {
    const filePath = path.join(context.extensionPath, 'media', RECOMMENDED_EXTENSIONS_FILE);
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter(isRecommendedExtensionEntry);
    } catch {
        return [];
    }
}

function isRecommendedExtensionEntry(value: unknown): value is RecommendedExtensionEntry {
    const entry = value as Partial<RecommendedExtensionEntry> | undefined;
    return !!entry && typeof entry.id === 'string' && typeof entry.name === 'string';
}

function toRecommendationState(entry: RecommendedExtensionEntry): RecommendedExtensionState {
    const extension = vscode.extensions.getExtension(entry.id);
    return {
        ...entry,
        installed: !!extension,
        active: !!extension?.isActive,
    };
}

function getHelloHtml(webview: vscode.Webview): string {
    const nonce = generateNonce();
    const mediaDir = vscode.Uri.file(path.join(extensionPath, 'media'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, 'hello.js'));
    const iconsUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, 'hello-icons')).toString();
    const htmlPath = path.join(extensionPath, 'media', 'hello.html');
    const template = fs.readFileSync(htmlPath, 'utf8');
    return template
        .replace(/__CSP_SOURCE__/g, webview.cspSource)
        .replace(/__NONCE__/g, nonce)
        .replace(/__SCRIPT_URI__/g, scriptUri.toString())
        .replace(/__ICONS_URI__/g, iconsUri)
        .replace('__I18N_JSON__', JSON.stringify(getHelloI18n()));
}

function getHelloI18n(): Record<string, string> {
    const language = vscode.env.language.toLowerCase();
    if (language.startsWith('zh')) {
        return HELLO_I18N_ZH_CN;
    }
    if (language.startsWith('ja')) {
        return HELLO_I18N_JA;
    }
    return HELLO_I18N_EN;
}

function getThemeKindName(): string {
    const kind = vscode.window.activeColorTheme.kind;
    if (kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast) {
        return kind === vscode.ColorThemeKind.HighContrast ? 'hc' : 'dark';
    }
    return kind === vscode.ColorThemeKind.HighContrastLight ? 'hc-light' : 'light';
}

function sendThemeColors(panel: vscode.WebviewPanel): void {
    panel.webview.postMessage({ command: 'themeColors', themeKind: getThemeKindName() });
}

const HELLO_I18N_ZH_CN: Record<string, string> = {
    subtitle: '小说写作工作台',
    withVsCode: 'With VS Code',
    start: '启动',
    createWorkspace: '新建写作工作区...',
    openWorkspace: '打开工作区...',
    openSettings: '打开 ANH 设置...',
    openGuide: '打开完整功能引导',
    current: '当前',
    noWorkspace: '尚未打开工作区',
    noWorkspaceDesc: '可以先创建一个新项目文件夹，或打开已有小说项目。',
    recent: '最近',
    noRecent: '暂无最近项目。',
    moreRecent: '更多...',
    enableWorkspace: '启用当前工作区',
    enableManagedMode: '启用首页推荐模式',
    gitIdentity: 'Git 身份',
    detectingGit: '正在检测 Git...',
    gitScope: '保存位置',
    gitGlobal: '全局 Git 配置',
    gitLocal: '当前工作区仓库',
    gitName: '用户名',
    gitEmail: '邮箱',
    gitNamePlaceholder: '例如 Andrea Frederica',
    gitEmailPlaceholder: 'name@example.com',
    saveGit: '保存 Git 身份',
    initRepo: '初始化仓库',
    installGit: '安装 Git',
    docs: '文档',
    quickStart: '5 分钟快速上手',
    vscodeBasics: 'VS Code 基础',
    roleConcept: '一切皆角色',
    packageManager: '包管理器',
    formatGuide: '文件格式指南',
    aiMcp: 'AI 与 MCP',
    onlineWiki: '在线 Wiki',
    homeSettings: '首页设置',
    showHello: '启动时显示 ANH Hello',
    showHelloDesc: '也可以从命令面板手动打开。',
    firstSetupTitle: '首次设置',
    firstSetupDesc: '请先确认 Hello 页面与启动自动显示偏好。',
    firstSetupOpenHello: '保持 Hello 页面可用',
    firstSetupOpenHelloDesc: '当前会立即应用；如取消将关闭本页。',
    firstSetupStartupHello: '启动时自动显示 Hello',
    firstSetupStartupHelloDesc: '适合初次使用，后续可在首页设置中修改。',
    firstSetupSave: '保存并继续',
    firstSetupSkip: '暂不设置',
    followVsCode: '只跟随 VS Code 扩展开关',
    followVsCodeDesc: '运行时绕过旧工作区禁用判断，不改写原托管设置。',
    dismiss: '下次不自动显示',
    walkthrough: '演练',
    initProject: '初始化小说项目',
    initProjectDesc: '生成项目配置、角色库、敏感词、词汇、正则和基础目录。',
    startButton: '开始',
    doneButton: '已完成',
    partialButton: '待补全',
    notInitializedButton: '未初始化',
    needsWorkspace: '需工作区',
    missingItems: '缺少',
    projectInitializedDesc: '当前工作区已完成小说项目初始化。',
    projectNotInitializedDesc: '当前工作区尚未完成小说项目初始化。',
    manageResources: '管理角色和资料',
    manageResourcesDesc: '进入 ANH 资源视图，创建角色、词汇、敏感词和外部资源包。',
    dashboard: '打开创作工作台',
    dashboardDesc: '查看字数、写作时间、计划、热力图和当前创作状态。',
    comments: '批注与校对',
    commentsDesc: '添加批注，管理修改意见，并进入错别字和翻译相关功能。',
    graph: '关系图和时间线',
    graphDesc: '查看角色关系图谱、关系文件和事件时间线。',
    export: '导出与发布',
    exportDesc: '使用 Typst 模板导出 PDF、图片或整理后的文本。',
    globalRolePanel: '全局角色面板',
    globalRolePanelDesc: '搜索、浏览和查看所有角色的完整数据，支持类型与包过滤。',
    recommendedExtensions: '推荐扩展',
    noExtensions: '推荐目录暂时为空。',
    faqTitle: '常见疑问',
    faqCommandPalette: '命令面板是什么？',
    faqCommandPaletteDesc: '它是 VS Code 的总入口，可以搜索并执行所有命令；不会写代码也能用。',
    faqExplorer: '左侧资源管理器是干什么的？',
    faqExplorerDesc: '这里显示项目文件夹、章节文件和资料文件，像普通文件管理器一样打开和整理。',
    faqSettings: '设置在哪里改？',
    faqSettingsDesc: 'VS Code 和 ANH 的选项都在设置页，搜索关键词就能找到对应开关。',
    faqWorkspace: '工作区和文件夹有什么区别？',
    faqWorkspaceDesc: '工作区就是当前打开的项目根目录，ANH 会围绕它管理章节、设定和统计。',
    faqWordWrap: '为什么自动换行看起来和 Word 不一样？',
    faqWordWrapDesc: 'VS Code 默认按屏幕宽度或固定字符数换行，不像 Word 按纸张排版。可在 ANH 图形化快速设置里调整。',
    faqFont: '字体太小/太大，怎么改？',
    faqFontDesc: '按 Ctrl+Shift+P 打开命令面板，输入"ANH 图形化快速设置"，找到"字体与排版"即可调整字体和字号。',
    faqTheme: '界面颜色太亮/太暗，怎么改主题？',
    faqThemeDesc: '点击此卡片可直接打开颜色主题选择器。也可以在 ANH 图形化快速设置里找到"切换颜色主题"按钮。',
    faqLanguage: '界面是英文的，怎么改成中文？',
    faqLanguageDesc: '点击此卡片打开语言配置，选择"中文(简体)"后，VS Code 会提示你安装中文语言包扩展，安装完成并重启后即可显示中文界面。',
    workspaceEnabled: '工作区启用',
    workspaceDisabled: '工作区禁用',
    followsVsCode: '跟随 VS Code 扩展开关',
    usesAnhSwitch: '使用 ANH 工作区开关',
    helloManagedTemporary: '托管模式由 Hello 临时生效',
    gitNotInstalled: '未检测到 Git。仍可创建和打开工作区；需要版本备份时请先安装 Git。',
    gitNoWorkspace: '未打开工作区，只能配置全局身份。',
    gitRepoReady: '当前工作区已是 Git 仓库，可配置全局或本仓库身份。',
    gitRepoMissing: '当前工作区还不是 Git 仓库，可先初始化仓库或只配置全局身份。',
    globalIdentityMissing: '全局身份未配置',
    localIdentityMissing: '本仓库身份未配置',
    globalIdentity: '全局',
    localIdentity: '本仓库',
    extensionInstalledActive: '已安装并启用',
    extensionInstalled: '已安装',
    extensionMissing: '未安装',
    unknownAuthor: '未知作者',
    recommendation: '推荐',
    recommendedReason: '推荐原因',
    defaultReason: '适合 ANH 写作工作流。',
    viewExtension: '查看扩展',
    openMarketplace: '打开商店',
    operationFailed: '操作失败'
};

const HELLO_I18N_EN: Record<string, string> = {
    ...HELLO_I18N_ZH_CN,
    subtitle: 'Novel writing workbench',
    start: 'Start',
    createWorkspace: 'New writing workspace...',
    openWorkspace: 'Open workspace...',
    openSettings: 'Open ANH settings...',
    openGuide: 'Open full feature guide',
    current: 'Current',
    noWorkspace: 'No workspace open',
    noWorkspaceDesc: 'Create a new project folder or open an existing novel project.',
    recent: 'Recent',
    noRecent: 'No recent projects yet.',
    moreRecent: 'More...',
    enableWorkspace: 'Enable current workspace',
    enableManagedMode: 'Enable welcome recommended mode',
    gitIdentity: 'Git Identity',
    detectingGit: 'Checking Git...',
    gitScope: 'Save to',
    gitGlobal: 'Global Git config',
    gitLocal: 'Current repository',
    gitName: 'User name',
    gitNamePlaceholder: 'For example Andrea Frederica',
    saveGit: 'Save Git identity',
    initRepo: 'Initialize repository',
    installGit: 'Install Git',
    docs: 'Docs',
    quickStart: '5-minute quick start',
    vscodeBasics: 'VS Code basics',
    roleConcept: 'Everything is a role',
    packageManager: 'Package manager',
    formatGuide: 'File format guide',
    aiMcp: 'AI and MCP',
    onlineWiki: 'Online Wiki',
    homeSettings: 'Welcome Settings',
    showHello: 'Show ANH Hello on startup',
    showHelloDesc: 'You can also open it manually from the command palette.',
    firstSetupTitle: 'First-time setup',
    firstSetupDesc: 'Please confirm your Hello page and startup preferences.',
    firstSetupOpenHello: 'Keep Hello page available',
    firstSetupOpenHelloDesc: 'This applies immediately. Unchecking will close this page.',
    firstSetupStartupHello: 'Show Hello automatically on startup',
    firstSetupStartupHelloDesc: 'Recommended for first-time users; can be changed later in Hello settings.',
    firstSetupSave: 'Save and continue',
    firstSetupSkip: 'Skip for now',
    followVsCode: 'Follow VS Code extension state only',
    followVsCodeDesc: 'Bypass legacy workspace-disable checks without rewriting the original managed setting.',
    dismiss: 'Do not show automatically again',
    walkthrough: 'Walkthroughs',
    initProject: 'Initialize Novel Project',
    initProjectDesc: 'Generate project config, role library, sensitive words, vocabulary, regex rules, and base folders.',
    startButton: 'Start',
    doneButton: 'Done',
    partialButton: 'Incomplete',
    notInitializedButton: 'Not initialized',
    needsWorkspace: 'Needs workspace',
    missingItems: 'Missing',
    projectInitializedDesc: 'The current workspace is initialized as a novel project.',
    projectNotInitializedDesc: 'The current workspace has not been initialized as a novel project.',
    manageResources: 'Manage Roles and Resources',
    manageResourcesDesc: 'Open ANH resources to create roles, vocabulary, sensitive words, and external resource packs.',
    dashboard: 'Open Writing Workbench',
    dashboardDesc: 'Review word count, writing time, plans, heatmaps, and current writing status.',
    comments: 'Comments and Proofing',
    commentsDesc: 'Add comments, manage revision notes, and open typo or translation tools.',
    graph: 'Relationship Graph and Timeline',
    graphDesc: 'View role relationship graphs, relationship files, and event timelines.',
    export: 'Export and Publish',
    exportDesc: 'Export PDFs, images, or cleaned text with Typst templates.',
    globalRolePanel: 'Global Role Panel',
    globalRolePanelDesc: 'Search, browse, and view complete data for all roles with type and package filters.',
    recommendedExtensions: 'Recommended Extensions',
    noExtensions: 'No recommendations yet.',
    faqTitle: 'FAQ',
    faqCommandPalette: 'What is the Command Palette?',
    faqCommandPaletteDesc: 'It is the main VS Code launcher for searching and running commands, even if you do not write code.',
    faqExplorer: 'What is the left Explorer for?',
    faqExplorerDesc: 'It shows project folders, chapter files, and reference files, like a regular file manager.',
    faqSettings: 'Where do I change settings?',
    faqSettingsDesc: 'VS Code and ANH options are both in Settings. Search by keyword to find the switch you need.',
    faqWorkspace: 'What is a workspace?',
    faqWorkspaceDesc: 'A workspace is the project folder currently open. ANH manages chapters, lore, and stats around it.',
    faqWordWrap: 'Why does word wrapping look different from Word?',
    faqWordWrapDesc: 'VS Code wraps text by screen width or fixed character count by default, unlike Word which wraps by paper page. You can change this in ANH Graphical Quick Settings.',
    faqFont: 'How do I change the font size?',
    faqFontDesc: 'Press Ctrl+Shift+P, type "ANH Graphical Quick Settings", and find "Font & Typesetting" to adjust the font and size.',
    faqTheme: 'How do I change the color theme?',
    faqThemeDesc: 'Click this card to open the color theme picker directly. You can also find the "Switch Color Theme" button in ANH Graphical Quick Settings.',
    faqLanguage: 'How do I switch the interface language to my own?',
    faqLanguageDesc: 'Click this card to open the language configuration, select your preferred language, and VS Code will prompt you to install the language pack extension. Restart after installation to apply the language.',
    workspaceEnabled: 'Workspace enabled',
    workspaceDisabled: 'Workspace disabled',
    followsVsCode: 'Following VS Code extension state',
    usesAnhSwitch: 'Using ANH workspace switch',
    helloManagedTemporary: 'Managed mode temporarily enabled by Hello',
    gitNotInstalled: 'Git was not detected. You can still create and open workspaces; install Git when you need version backups.',
    gitNoWorkspace: 'No workspace is open; only global identity can be configured.',
    gitRepoReady: 'Current workspace is a Git repository; global or local identity can be configured.',
    gitRepoMissing: 'Current workspace is not a Git repository yet; initialize it or configure global identity only.',
    globalIdentityMissing: 'Global identity not configured',
    localIdentityMissing: 'Repository identity not configured',
    globalIdentity: 'Global',
    localIdentity: 'Repository',
    extensionInstalledActive: 'Installed and enabled',
    extensionInstalled: 'Installed',
    extensionMissing: 'Not installed',
    unknownAuthor: 'Unknown author',
    recommendation: 'Recommended',
    recommendedReason: 'Reason',
    defaultReason: 'Fits the ANH writing workflow.',
    viewExtension: 'View extension',
    openMarketplace: 'Open marketplace',
    operationFailed: 'Operation failed'
};

const HELLO_I18N_JA: Record<string, string> = {
    ...HELLO_I18N_EN,
    subtitle: '小説執筆ワークベンチ',
    start: '開始',
    current: '現在',
    recent: '最近',
    walkthrough: 'チュートリアル',
    docs: 'ドキュメント',
    recommendedExtensions: 'おすすめ拡張機能',
    faqTitle: 'よくある質問'
};

function generateNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) {
        out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
}
