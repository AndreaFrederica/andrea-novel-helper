import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { createCharacterGalleryFile, createCharacterGalleryCsvFile, createSensitiveWordsFile, createVocabularyFile, createRegexPatternsFile, ensureDir } from './packageFileCreators';
import { generateMarkdownRoleTemplate } from '../templates/templateGenerators';
import { ProjectConfigManager } from '../projectConfig/projectConfigManager';
import { PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME, clearAllProjectConfigCaches } from '../projectConfig/projectKeywordConfig';
import { setProjectInitWizardRunning } from './projectInitWizard';
import { setWebviewPanelIcon } from '../Provider/utils/webviewPanelIcon';
import { getProjectInitStatus } from './workspaceInitCheck';

interface GitState {
    installed: boolean;
    hasRepo: boolean;
    globalName: string;
    globalEmail: string;
    localName: string;
    localEmail: string;
}

interface InitPayload {
    projectName: string;
    projectDescription: string;
    projectAuthor: string;
    projectSummary: string;
    projectTags: string[];
    rolesFile: string;
    sensitiveWordsFile: string;
    vocabularyFile: string;
    regexPatternsFile: string;
    defaultRoleLookupKeys: string[];
    extendedLookupKeyPrefixes: string[];
    characterFileKeywords: string[];
    sensitiveWordsFileKeywords: string[];
    vocabularyFileKeywords: string[];
    regexFileKeywords: string[];
    initGitRepo: boolean;
    configureGitUser: boolean;
    gitUserName: string;
    gitUserEmail: string;
    gitUserScope: 'global' | 'local';
    createStructure: boolean;
    writingStatsMode: 'ignore' | 'track';
    ignoreHistory: boolean;
    wcIgnoreVscode: boolean;
    wcIgnoreOutOfInsights: boolean;
    initialCommit: boolean;
    openWithRoleManager: boolean;
}

let currentPanel: vscode.WebviewPanel | undefined;
let extensionPath: string = '';

export function registerGraphicalProjectInitWizard(context: vscode.ExtensionContext): vscode.Disposable {
    extensionPath = context.extensionPath;

    const command = vscode.commands.registerCommand('AndreaNovelHelper.projectInitWizard.graphical', async () => {
        if (currentPanel) {
            currentPanel.reveal(vscode.ViewColumn.Active);
            await postState(currentPanel);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'andrea.projectInitWizard',
            '项目初始化向导',
            vscode.ViewColumn.Active,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        currentPanel = panel;
        setWebviewPanelIcon(panel, extensionPath, 'wizard');
        panel.webview.html = getWizardHtml(panel.webview);
        panel.onDidDispose(() => { currentPanel = undefined; }, undefined, context.subscriptions);
        panel.webview.onDidReceiveMessage(async message => {
            try {
                switch (message?.command) {
                    case 'ready':
                    case 'reload':
                        await postState(panel);
                        break;
                    case 'run':
                        await runGraphicalInit(message.data);
                        await postState(panel);
                        break;
                    case 'openGitDownload':
                        await vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/downloads'));
                        break;
                    case 'warnGitMissing': {
                        const action = await vscode.window.showWarningMessage('未检测到 Git。你可以先安装 Git，再继续配置 Git 仓库和提交。', '打开 Git 下载页');
                        if (action === '打开 Git 下载页') {
                            await vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/downloads'));
                        }
                        break;
                    }
                    case 'openGuide':
                        await vscode.commands.executeCommand('AndreaNovelHelper.showGuide');
                        break;
                    case 'close':
                        panel.dispose();
                        break;
                }
            } catch (error) {
                const text = error instanceof Error ? error.message : String(error);
                panel.webview.postMessage({ command: 'error', message: text });
                vscode.window.showErrorMessage(`项目初始化失败: ${text}`);
            }
        }, undefined, context.subscriptions);
    });

    context.subscriptions.push(command);
    return command;
}

async function postState(panel: vscode.WebviewPanel): Promise<void> {
    const workspaceRoot = getWorkspaceRoot();
    const git = await getGitState(workspaceRoot);
    const projectInit = getProjectInitStatus(workspaceRoot);
    panel.webview.postMessage({
        command: 'state',
        data: {
            workspaceRoot,
            workspaceName: path.basename(workspaceRoot),
            configExists: projectInit.configExists,
            keywordConfigExists: projectInit.keywordConfigExists,
            novelHelperExists: projectInit.novelHelperExists,
            projectInit,
            git,
        },
    });
}

async function runGraphicalInit(data: unknown): Promise<void> {
    const workspaceRoot = getWorkspaceRoot();
    const payload = normalizePayload(data, workspaceRoot);
    const git = await getGitState(workspaceRoot);
    const log: string[] = [];

    setProjectInitWizardRunning(true);
    try {
        if (!git.installed && (payload.initGitRepo || payload.configureGitUser || payload.initialCommit)) {
            throw new Error('未检测到 Git，无法执行 Git 相关初始化');
        }
        if (payload.configureGitUser && (!payload.gitUserName || !/.+@.+/.test(payload.gitUserEmail))) {
            throw new Error('请填写有效的 Git 用户名和邮箱');
        }

        let hasRepo = git.hasRepo;
        if (git.installed && payload.initGitRepo && !hasRepo) {
            const result = await runGit(['init'], workspaceRoot);
            if (result.code !== 0) {
                throw new Error(`Git 仓库初始化失败: ${result.stderr || result.stdout}`);
            }
            hasRepo = true;
            log.push('已初始化 Git 仓库');
        }

        if (git.installed && payload.configureGitUser) {
            const requestedScope = payload.gitUserScope === 'local' && hasRepo ? '--local' : '--global';
            const setName = await runGit(['config', requestedScope, 'user.name', payload.gitUserName], workspaceRoot);
            if (setName.code !== 0) {
                throw new Error(`设置 Git user.name 失败: ${setName.stderr || setName.stdout}`);
            }
            const setEmail = await runGit(['config', requestedScope, 'user.email', payload.gitUserEmail], workspaceRoot);
            if (setEmail.code !== 0) {
                throw new Error(`设置 Git user.email 失败: ${setEmail.stderr || setEmail.stdout}`);
            }
            log.push(`已配置 Git 用户信息 (${requestedScope === '--local' ? 'local' : 'global'})`);
        }

        await writeProjectConfig(workspaceRoot, payload);
        log.push('已写入项目配置文件');

        if (payload.createStructure) {
            createDefaultStructure(workspaceRoot);
            log.push('已创建 novel-helper 示例资源结构');
        }

        updateIgnoreFiles(workspaceRoot, payload);
        log.push('已更新忽略规则');

        await vscode.workspace.getConfiguration().update('AndreaNovelHelper.workspaceDisabled', false, vscode.ConfigurationTarget.Workspace);
        await vscode.workspace.getConfiguration().update('andrea.roleJson5.openWithRoleManager', payload.openWithRoleManager, vscode.ConfigurationTarget.Workspace);
        clearAllProjectConfigCaches(workspaceRoot);

        if (git.installed && payload.initialCommit && (hasRepo || payload.initGitRepo)) {
            const add = await runGit(['add', '.'], workspaceRoot);
            if (add.code !== 0) {
                throw new Error(`git add 失败: ${add.stderr || add.stdout}`);
            }
            const commit = await runGit(['commit', '-m', 'chore: initialize novel helper project'], workspaceRoot);
            if (commit.code !== 0) {
                throw new Error(`初始提交失败: ${commit.stderr || commit.stdout}`);
            }
            log.push('已创建初始提交');
        }

        try { await vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles'); } catch { /* optional command */ }
        currentPanel?.webview.postMessage({ command: 'done', log });
        vscode.window.showInformationMessage('图形化项目初始化向导已完成');
    } finally {
        setProjectInitWizardRunning(false);
    }
}

async function writeProjectConfig(workspaceRoot: string, payload: InitPayload): Promise<void> {
    const manager = new ProjectConfigManager(workspaceRoot);
    const existing = await manager.readConfig();
    const now = new Date();
    const ok = await manager.writeConfig({
        name: payload.projectName,
        description: payload.projectDescription,
        author: payload.projectAuthor,
        uuid: existing?.uuid || uuidv4(),
        cover: existing?.cover || '',
        summary: payload.projectSummary,
        tags: payload.projectTags,
        characterFileKeywords: existing?.characterFileKeywords || [],
        sensitiveWordsFileKeywords: existing?.sensitiveWordsFileKeywords || [],
        vocabularyFileKeywords: existing?.vocabularyFileKeywords || [],
        regexFileKeywords: existing?.regexFileKeywords || [],
        createdAt: existing?.createdAt || now,
        updatedAt: now,
    });
    if (!ok) {
        throw new Error('写入 anhproject.md 失败');
    }

    const keywordPath = path.join(workspaceRoot, PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME);
    if (!fs.existsSync(keywordPath)) {
        fs.writeFileSync(keywordPath, `${buildJson5Config(payload)}\n`, 'utf8');
    }
}

function createDefaultStructure(workspaceRoot: string): void {
    const root = path.join(workspaceRoot, 'novel-helper');
    ensureDir(root);
    createCharacterGalleryFile(root);
    createCharacterGalleryCsvFile(root);
    createSensitiveWordsFile(root);
    createVocabularyFile(root);
    createRegexPatternsFile(root);

    try {
        const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
        const rolesFileCfg = cfg.get<string>('rolesFile') || 'novel-helper/roles.json5';
        const absFromCfg = path.isAbsolute(rolesFileCfg) ? rolesFileCfg : path.join(workspaceRoot, rolesFileCfg);
        const dir = path.dirname(absFromCfg);
        const stem = path.basename(absFromCfg).replace(/\.[^.]+$/, '');
        const mdPath = path.join(dir, `${stem}.md`);
        if (!fs.existsSync(mdPath)) {
            fs.mkdirSync(path.dirname(mdPath), { recursive: true });
            fs.writeFileSync(mdPath, generateMarkdownRoleTemplate(), 'utf8');
        }
    } catch {
        // 示例 Markdown 创建失败不影响主初始化。
    }
}

function updateIgnoreFiles(workspaceRoot: string, payload: InitPayload): void {
    const gitignorePath = path.join(workspaceRoot, '.gitignore');
    let gitignore = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
    gitignore = setIgnoreLine(gitignore, 'novel-helper/.anh-fsdb/', payload.writingStatsMode === 'ignore');
    gitignore = setIgnoreLine(gitignore, '.history/', payload.ignoreHistory);
    fs.writeFileSync(gitignorePath, gitignore, 'utf8');

    const wcignorePath = path.join(workspaceRoot, '.wcignore');
    let wcignore = fs.existsSync(wcignorePath) ? fs.readFileSync(wcignorePath, 'utf8') : '';
    wcignore = setIgnoreLine(wcignore, '.vscode/', payload.wcIgnoreVscode);
    wcignore = setIgnoreLine(wcignore, '.out-of-code-insights/', payload.wcIgnoreOutOfInsights);
    if (wcignore.trim() || payload.wcIgnoreVscode || payload.wcIgnoreOutOfInsights) {
        fs.writeFileSync(wcignorePath, wcignore, 'utf8');
    }
}

function setIgnoreLine(content: string, line: string, enabled: boolean): string {
    const lines = content.split(/\r?\n/).filter(existing => existing.trim() !== line);
    if (enabled) {
        lines.push(line);
    }
    return lines.filter((value, index, array) => value.trim() || index < array.length - 1).join('\n').replace(/\s*$/, '\n');
}

function normalizePayload(data: unknown, workspaceRoot: string): InitPayload {
    const record = isRecord(data) ? data : {};
    const tags = normalizeStringArray(record.projectTags);
    return {
        projectName: normalizeString(record.projectName) || path.basename(workspaceRoot) || '未命名项目',
        projectDescription: normalizeString(record.projectDescription) || '这是一个小说项目',
        projectAuthor: normalizeString(record.projectAuthor) || '作者',
        projectSummary: normalizeString(record.projectSummary) || '项目简介',
        projectTags: tags.length ? tags : ['小说', '创作'],
        rolesFile: normalizeString(record.rolesFile),
        sensitiveWordsFile: normalizeString(record.sensitiveWordsFile),
        vocabularyFile: normalizeString(record.vocabularyFile),
        regexPatternsFile: normalizeString(record.regexPatternsFile),
        defaultRoleLookupKeys: normalizeStringArray(record.defaultRoleLookupKeys),
        extendedLookupKeyPrefixes: normalizeStringArray(record.extendedLookupKeyPrefixes),
        characterFileKeywords: normalizeStringArray(record.characterFileKeywords),
        sensitiveWordsFileKeywords: normalizeStringArray(record.sensitiveWordsFileKeywords),
        vocabularyFileKeywords: normalizeStringArray(record.vocabularyFileKeywords),
        regexFileKeywords: normalizeStringArray(record.regexFileKeywords),
        initGitRepo: Boolean(record.initGitRepo),
        configureGitUser: Boolean(record.configureGitUser),
        gitUserName: normalizeString(record.gitUserName),
        gitUserEmail: normalizeString(record.gitUserEmail),
        gitUserScope: record.gitUserScope === 'local' ? 'local' : 'global',
        createStructure: Boolean(record.createStructure),
        writingStatsMode: record.writingStatsMode === 'track' ? 'track' : 'ignore',
        ignoreHistory: record.ignoreHistory !== false,
        wcIgnoreVscode: record.wcIgnoreVscode !== false,
        wcIgnoreOutOfInsights: record.wcIgnoreOutOfInsights !== false,
        initialCommit: Boolean(record.initialCommit),
        openWithRoleManager: record.openWithRoleManager !== false,
    };
}

async function getGitState(cwd: string): Promise<GitState> {
    const version = await runGit(['--version'], cwd);
    const installed = version.code === 0;
    const hasRepo = fs.existsSync(path.join(cwd, '.git'));
    if (!installed) {
        return { installed, hasRepo, globalName: '', globalEmail: '', localName: '', localEmail: '' };
    }
    return {
        installed,
        hasRepo,
        globalName: (await runGit(['config', '--global', 'user.name'], cwd)).stdout,
        globalEmail: (await runGit(['config', '--global', 'user.email'], cwd)).stdout,
        localName: (await runGit(['config', '--local', 'user.name'], cwd)).stdout,
        localEmail: (await runGit(['config', '--local', 'user.email'], cwd)).stdout,
    };
}

function runGit(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
    const quoted = args.map(arg => /^[A-Za-z0-9._:/@=-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`);
    const cmd = `git ${quoted.join(' ')}`;
    return new Promise(resolve => {
        exec(cmd, { cwd }, (err, stdout, stderr) => {
            resolve({ code: err ? ((err as any).code || 1) : 0, stdout: stdout.trim(), stderr: stderr.trim() });
        });
    });
}

function getWorkspaceRoot(): string {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        throw new Error('请先打开一个工作区');
    }
    return folder.uri.fsPath;
}

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return Array.from(new Set(value.flatMap(item => normalizeStringArray(item))));
    }
    if (typeof value !== 'string') {
        return [];
    }
    return Array.from(new Set(value.split(/[\r\n,，;；、\t]+/).map(item => item.trim()).filter(Boolean)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatJson5Array(values: string[]): string {
    if (values.length === 0) { return '[]'; }
    return `[\n${values.map(v => `    '${v.replace(/\\/g, '/').replace(/'/g, "\\'")}',`).join('\n')}\n  ]`;
}

function buildJson5Config(payload: InitPayload): string {
    const lib = (v: string, d: string) => `'${(v || d).replace(/\\/g, '/')}'`;
    return [
        '{',
        '  // 项目级资源文件目标路径（相对于工作区根目录）',
        `  rolesFile: ${lib(payload.rolesFile, 'novel-helper/character-gallery.json5')},`,
        `  sensitiveWordsFile: ${lib(payload.sensitiveWordsFile, 'novel-helper/sensitive-words.json5')},`,
        `  vocabularyFile: ${lib(payload.vocabularyFile, 'novel-helper/vocabulary.json5')},`,
        `  regexPatternsFile: ${lib(payload.regexPatternsFile, 'novel-helper/regex-patterns.json5')},`,
        '',
        '  // 新建角色时默认补齐的索引键字段',
        `  defaultRoleLookupKeys: ${formatJson5Array(payload.defaultRoleLookupKeys)},`,
        '',
        '  // 扩展索引键家族前缀',
        `  extendedLookupKeyPrefixes: ${formatJson5Array(payload.extendedLookupKeyPrefixes)},`,
        '',
        `  characterFileKeywords: ${formatJson5Array(payload.characterFileKeywords)},`,
        `  sensitiveWordsFileKeywords: ${formatJson5Array(payload.sensitiveWordsFileKeywords)},`,
        `  vocabularyFileKeywords: ${formatJson5Array(payload.vocabularyFileKeywords)},`,
        `  regexFileKeywords: ${formatJson5Array(payload.regexFileKeywords)},`,
        '}',
    ].join('\n');
}

function getWizardHtml(webview: vscode.Webview): string {
    const scriptNonce = generateNonce();
    const mediaDir = vscode.Uri.file(path.join(extensionPath, 'media'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, 'wizard.js'));
    const htmlPath = path.join(extensionPath, 'media', 'wizard.html');
    const template = fs.readFileSync(htmlPath, 'utf8');
    return template
        .replace(/__CSP_SOURCE__/g, webview.cspSource)
        .replace(/__NONCE__/g, scriptNonce)
        .replace(/__SCRIPT_URI__/g, scriptUri.toString());
}

function generateNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) {
        out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
}
