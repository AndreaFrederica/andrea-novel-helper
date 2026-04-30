import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { createCharacterGalleryFile, createSensitiveWordsFile, createVocabularyFile, createRegexPatternsFile, ensureDir } from './packageFileCreators';
import { generateMarkdownRoleTemplate } from '../templates/templateGenerators';
import { ProjectConfigManager } from '../projectConfig/projectConfigManager';
import { generateProjectKeywordConfigTemplate, PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME, clearAllProjectConfigCaches } from '../projectConfig/projectKeywordConfig';
import { setProjectInitWizardRunning } from './projectInitWizard';

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
}

let currentPanel: vscode.WebviewPanel | undefined;

export function registerGraphicalProjectInitWizard(context: vscode.ExtensionContext): vscode.Disposable {
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
    panel.webview.postMessage({
        command: 'state',
        data: {
            workspaceRoot,
            workspaceName: path.basename(workspaceRoot),
            configExists: fs.existsSync(path.join(workspaceRoot, 'anhproject.md')),
            keywordConfigExists: fs.existsSync(path.join(workspaceRoot, PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME)),
            novelHelperExists: fs.existsSync(path.join(workspaceRoot, 'novel-helper')),
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
        fs.writeFileSync(keywordPath, `${generateProjectKeywordConfigTemplate()}\n`, 'utf8');
    }
}

function createDefaultStructure(workspaceRoot: string): void {
    const root = path.join(workspaceRoot, 'novel-helper');
    ensureDir(root);
    createCharacterGalleryFile(root);
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

function nonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) {
        out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
}

function getWizardHtml(webview: vscode.Webview): string {
    const scriptNonce = nonce();
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${scriptNonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>项目初始化向导</title>
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
        header { position: sticky; top: 0; z-index: 2; padding: 14px 18px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); display: flex; justify-content: space-between; gap: 12px; align-items: center; }
        h1 { margin: 0; font-size: 18px; }
        .status { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 4px; }
        main { max-width: 1000px; padding: 18px; }
        section { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 16px; margin-bottom: 16px; }
        h2 { font-size: 15px; margin: 0 0 12px; }
        .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .field { display: flex; flex-direction: column; gap: 6px; }
        .full { grid-column: 1 / -1; }
        label { color: var(--vscode-descriptionForeground); font-size: 12px; }
        input, textarea, select { width: 100%; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; padding: 7px 8px; font: inherit; }
        textarea { min-height: 72px; resize: vertical; }
        .checks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        .check { display: flex; gap: 8px; align-items: flex-start; border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 10px; }
        .check input { width: auto; margin-top: 2px; }
        .hint, .log { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.5; }
        .toolbar { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
        button { border: 1px solid var(--vscode-panel-border); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border-radius: 4px; padding: 7px 10px; cursor: pointer; }
        button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }
        .notice { display: none; border-left: 3px solid var(--vscode-inputValidation-errorBorder); background: var(--vscode-inputValidation-errorBackground); padding: 9px 10px; margin-bottom: 14px; }
        .notice.show { display: block; }
        @media (max-width: 760px) { header { align-items: flex-start; flex-direction: column; } .grid, .checks { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <header>
        <div>
            <h1>项目初始化向导</h1>
            <div id="state" class="status">正在读取工作区...</div>
        </div>
        <div class="toolbar">
            <button id="reload">刷新检测</button>
            <button id="run" class="primary">执行初始化</button>
        </div>
    </header>
    <main>
        <div id="notice" class="notice"></div>
        <section>
            <h2>项目信息</h2>
            <div class="grid">
                <div class="field"><label>项目名称</label><input id="projectName"></div>
                <div class="field"><label>作者</label><input id="projectAuthor"></div>
                <div class="field full"><label>项目描述</label><input id="projectDescription" value="这是一个小说项目"></div>
                <div class="field full"><label>项目简介</label><textarea id="projectSummary">项目简介</textarea></div>
                <div class="field full"><label>项目标签</label><textarea id="projectTags">小说
创作</textarea><div class="hint">支持换行、逗号、顿号、分号分隔。</div></div>
            </div>
        </section>
        <section>
            <h2>项目文件</h2>
            <div class="checks">
                <label class="check"><input id="createStructure" type="checkbox" checked><span><strong>创建示例资源结构</strong><br><span class="hint">创建 novel-helper 目录及角色、敏感词、词汇、正则模板。</span></span></label>
                <label class="check"><input id="ignoreHistory" type="checkbox" checked><span><strong>忽略 .history</strong><br><span class="hint">写入 .gitignore。</span></span></label>
                <label class="check"><input id="wcIgnoreVscode" type="checkbox" checked><span><strong>字数统计忽略 .vscode</strong><br><span class="hint">写入 .wcignore。</span></span></label>
                <label class="check"><input id="wcIgnoreOutOfInsights" type="checkbox" checked><span><strong>字数统计忽略 .out-of-code-insights</strong><br><span class="hint">写入 .wcignore。</span></span></label>
            </div>
            <div class="field" style="margin-top:12px"><label>写作统计数据库</label><select id="writingStatsMode"><option value="ignore">不纳入版本控制（推荐）</option><option value="track">纳入版本控制</option></select></div>
        </section>
        <section>
            <h2>Git</h2>
            <div id="gitHint" class="hint"></div>
            <div class="checks" style="margin-top:12px">
                <label class="check"><input id="initGitRepo" type="checkbox"><span><strong>初始化 Git 仓库</strong><br><span class="hint">仅在当前工作区还不是仓库时执行。</span></span></label>
                <label class="check"><input id="configureGitUser" type="checkbox"><span><strong>配置 Git 用户信息</strong><br><span class="hint">可写入全局或当前仓库。</span></span></label>
                <label class="check"><input id="initialCommit" type="checkbox"><span><strong>创建初始提交</strong><br><span class="hint">会执行 git add . 和一次 commit。</span></span></label>
            </div>
            <div class="grid" style="margin-top:12px">
                <div class="field"><label>Git 用户名</label><input id="gitUserName"></div>
                <div class="field"><label>Git 邮箱</label><input id="gitUserEmail"></div>
                <div class="field"><label>写入位置</label><select id="gitUserScope"><option value="global">全局 global</option><option value="local">当前仓库 local</option></select></div>
            </div>
        </section>
        <section>
            <h2>执行结果</h2>
            <div id="log" class="log">尚未执行。</div>
        </section>
    </main>
    <script nonce="${scriptNonce}">
        const vscode = acquireVsCodeApi();
        const $ = id => document.getElementById(id);
        let gitInstalled = false;
        let hasRepo = false;
        function parseList(text) { return String(text || '').split(/[\\r\\n,，;；、\\t]+/).map(v => v.trim()).filter(Boolean); }
        function notice(text) { $('notice').textContent = text || ''; $('notice').classList.toggle('show', !!text); }
        function syncGitOptions() {
            $('initialCommit').disabled = !gitInstalled || (!hasRepo && !$('initGitRepo').checked);
        }
        function fill(data) {
            gitInstalled = !!data.git.installed;
            hasRepo = !!data.git.hasRepo;
            $('state').textContent = data.workspaceRoot + ' | ' + (data.configExists ? '已有 anhproject.md' : '未创建 anhproject.md') + '，' + (data.keywordConfigExists ? '已有 project-config.json5' : '未创建 project-config.json5');
            if (!$('projectName').value) { $('projectName').value = data.workspaceName || '未命名项目'; }
            if (!$('projectAuthor').value) { $('projectAuthor').value = data.git.localName || data.git.globalName || '作者'; }
            $('gitUserName').value = data.git.localName || data.git.globalName || $('gitUserName').value;
            $('gitUserEmail').value = data.git.localEmail || data.git.globalEmail || $('gitUserEmail').value;
            $('initGitRepo').disabled = !gitInstalled || hasRepo;
            $('configureGitUser').disabled = !gitInstalled;
            syncGitOptions();
            $('gitHint').textContent = gitInstalled ? (hasRepo ? '已检测到 Git 仓库。' : '已安装 Git，但当前工作区还不是仓库。') : '未检测到 Git；Git 相关选项不可用。';
            if (!gitInstalled) { notice('未检测到 Git。如需 Git 初始化，请先安装 Git。'); } else { notice(''); }
        }
        function collect() {
            return {
                projectName: $('projectName').value,
                projectDescription: $('projectDescription').value,
                projectAuthor: $('projectAuthor').value,
                projectSummary: $('projectSummary').value,
                projectTags: parseList($('projectTags').value),
                initGitRepo: $('initGitRepo').checked && !$('initGitRepo').disabled,
                configureGitUser: $('configureGitUser').checked && !$('configureGitUser').disabled,
                gitUserName: $('gitUserName').value,
                gitUserEmail: $('gitUserEmail').value,
                gitUserScope: $('gitUserScope').value,
                createStructure: $('createStructure').checked,
                writingStatsMode: $('writingStatsMode').value,
                ignoreHistory: $('ignoreHistory').checked,
                wcIgnoreVscode: $('wcIgnoreVscode').checked,
                wcIgnoreOutOfInsights: $('wcIgnoreOutOfInsights').checked,
                initialCommit: $('initialCommit').checked && !$('initialCommit').disabled
            };
        }
        window.addEventListener('message', event => {
            const msg = event.data || {};
            if (msg.command === 'state') { fill(msg.data); }
            if (msg.command === 'error') { notice(msg.message || '执行失败'); }
            if (msg.command === 'done') { $('log').innerHTML = (msg.log || []).map(line => '<div>' + line.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])) + '</div>').join('') || '已完成。'; }
        });
        $('reload').addEventListener('click', () => vscode.postMessage({ command: 'reload' }));
        $('initGitRepo').addEventListener('change', syncGitOptions);
        $('run').addEventListener('click', () => {
            const data = collect();
            if (!data.projectName.trim()) { notice('项目名称不能为空'); return; }
            if (data.configureGitUser && (!data.gitUserName.trim() || !/.+@.+/.test(data.gitUserEmail))) { notice('请填写有效的 Git 用户名和邮箱'); return; }
            $('log').textContent = '正在执行...';
            vscode.postMessage({ command: 'run', data });
        });
        vscode.postMessage({ command: 'ready' });
    </script>
</body>
</html>`;
}
