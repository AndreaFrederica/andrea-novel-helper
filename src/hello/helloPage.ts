import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { spawn } from 'child_process';

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

const HELLO_DISMISSED_KEY = 'andrea.hello.dismissed.v1';
const HELLO_VIEW_TYPE = 'andrea.hello';
const RECOMMENDED_EXTENSIONS_FILE = 'recommended-extensions.json';

let currentPanel: vscode.WebviewPanel | undefined;
let extensionPath = '';
let openingHello = false;

export function registerHelloPage(context: vscode.ExtensionContext): void {
    extensionPath = context.extensionPath;

    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.openHello', async () => {
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

export async function maybeShowHelloPage(context: vscode.ExtensionContext): Promise<void> {
    if (!isHelloPageEnabled()) {
        return;
    }
    if (context.globalState.get<boolean>(HELLO_DISMISSED_KEY, false)) {
        return;
    }
    await showHelloPage(context, false);
}

async function showHelloPage(context: vscode.ExtensionContext, explicit: boolean): Promise<void> {
    if (currentPanel) {
        currentPanel.reveal(vscode.ViewColumn.Active);
        await postState(currentPanel, context);
        return;
    }

    if (openingHello) {
        return;
    }

    if (hasExistingHelloTab()) {
        if (explicit) {
            vscode.window.showInformationMessage('ANH Hello 首页已经打开。');
        }
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
    panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.file(path.join(extensionPath, 'media'))]
    };
    panel.webview.html = getHelloHtml(panel.webview);
    panel.onDidDispose(() => {
        if (currentPanel === panel) {
            currentPanel = undefined;
        }
    }, undefined, context.subscriptions);
    panel.webview.onDidReceiveMessage(async message => {
        try {
            switch (message?.command) {
                case 'ready':
                case 'refresh':
                    await postState(panel, context);
                    break;
                case 'dismiss':
                    await context.globalState.update(HELLO_DISMISSED_KEY, true);
                    panel.dispose();
                    break;
                case 'setConfig':
                    await updateHelloConfig(message.key, message.value);
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
                    await createWorkspace();
                    break;
                case 'openWorkspace':
                    await openWorkspace();
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
    await panel.webview.postMessage({
        command: 'state',
        data: {
            workspace: workspaceFolder ? {
                name: workspaceFolder.name || path.basename(workspaceFolder.uri.fsPath),
                path: workspaceFolder.uri.fsPath,
            } : undefined,
            config: {
                helloEnabled: cfg.get<boolean>('hello.enabled', true),
                forceVsCodeManagedDisabling: cfg.get<boolean>('hello.forceVsCodeManagedDisabling', true),
                originalVsCodeManagedDisabling: cfg.get<boolean>('useVsCodeManagedDisabling', false),
                effectiveVsCodeManagedDisabling: cfg.get<boolean>('useVsCodeManagedDisabling', false) || shouldUseVsCodeManagedDisablingForHello(),
                workspaceDisabled,
            },
            recommendations,
            git,
        }
    });
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

async function createWorkspace(): Promise<void> {
    const parent = await vscode.window.showOpenDialog({
        title: '选择新写作工作区所在位置',
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: '选择位置'
    });
    if (!parent?.[0]) {
        return;
    }

    const projectName = await vscode.window.showInputBox({
        title: '新建写作工作区',
        prompt: '输入新工作区文件夹名称',
        placeHolder: '我的小说项目',
        validateInput(value) {
            const trimmed = value.trim();
            if (!trimmed) {
                return '请输入文件夹名称';
            }
            if (/[\\/:*?"<>|]/.test(trimmed)) {
                return '文件夹名称不能包含 \\ / : * ? " < > |';
            }
            return undefined;
        }
    });
    if (!projectName) {
        return;
    }

    const projectPath = path.join(parent[0].fsPath, projectName.trim());
    if (fs.existsSync(projectPath)) {
        vscode.window.showWarningMessage('该文件夹已经存在，请换一个名称或直接打开它。');
        return;
    }

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(projectPath));
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath), false);
}

async function openWorkspace(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
        title: '打开小说写作工作区',
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: '打开工作区'
    });
    if (picked?.[0]) {
        await vscode.commands.executeCommand('vscode.openFolder', picked[0], false);
    }
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
        .replace(/__ICONS_URI__/g, iconsUri);
}

function generateNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) {
        out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
}
