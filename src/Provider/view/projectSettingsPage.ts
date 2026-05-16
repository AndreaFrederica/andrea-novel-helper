import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import JSON5 from 'json5';
import { v4 as uuidv4 } from 'uuid';
import { ProjectConfig, ProjectConfigManager } from '../../projectConfig/projectConfigManager';
import { setWebviewPanelIcon } from '../utils/webviewPanelIcon';
import {
    PROJECT_KEYWORD_CONFIG_DEFINITIONS,
    PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME,
    PROJECT_CONFIG_MARKDOWN_FILE_NAME,
    clearAllProjectConfigCaches,
    normalizeKeywordList,
    type ProjectKeywordConfigKey,
} from '../../projectConfig/projectKeywordConfig';
import {
    PROJECT_LIBRARY_TARGET_DEFAULTS,
    type ProjectLibraryTargetKey,
} from '../../projectConfig/projectJson5Config';

type ProjectSettingsJson5 = Record<ProjectLibraryTargetKey, string> & {
    defaultRoleLookupKeys: string[];
    extendedLookupKeyPrefixes: string[];
} & Record<ProjectKeywordConfigKey, string[]>;

interface ProjectSettingsPayload {
    project: {
        name: string;
        description: string;
        author: string;
        uuid: string;
        cover: string;
        summary: string;
        tags: string[];
        createdAt: string;
        updatedAt: string;
    };
    json5: ProjectSettingsJson5;
}

interface ProjectSettingsData extends ProjectSettingsPayload {
    workspaceRoot: string;
    files: {
        markdownPath: string;
        json5Path: string;
        markdownExists: boolean;
        json5Exists: boolean;
    };
    json5ParseError?: string;
}

let currentPanel: vscode.WebviewPanel | undefined;

export function registerProjectSettingsPage(context: vscode.ExtensionContext): vscode.Disposable {
    const command = vscode.commands.registerCommand('andrea.openProjectSettings', async () => {
        if (currentPanel) {
            currentPanel.reveal(vscode.ViewColumn.Active);
            await postProjectSettingsData(currentPanel);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'andrea.projectSettings',
            '项目设置',
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        currentPanel = panel;
        setWebviewPanelIcon(panel, context.extensionPath, 'settings');
        panel.webview.html = getProjectSettingsHtml(panel.webview);
        panel.onDidDispose(() => { currentPanel = undefined; }, undefined, context.subscriptions);
        panel.webview.onDidReceiveMessage(async message => {
            try {
                switch (message?.command) {
                    case 'ready':
                    case 'reload':
                        await postProjectSettingsData(panel);
                        break;
                    case 'save':
                        await saveProjectSettings(message.data);
                        vscode.window.showInformationMessage('项目设置已保存');
                        await postProjectSettingsData(panel);
                        break;
                    case 'openFile':
                        await openProjectConfigFile(message.file);
                        break;
                }
            } catch (error) {
                const text = error instanceof Error ? error.message : String(error);
                panel.webview.postMessage({ command: 'error', message: text });
                vscode.window.showErrorMessage(`项目设置操作失败: ${text}`);
            }
        }, undefined, context.subscriptions);
    });

    context.subscriptions.push(command);
    return command;
}

async function postProjectSettingsData(panel: vscode.WebviewPanel): Promise<void> {
    const data = await loadProjectSettings();
    await panel.webview.postMessage({ command: 'data', data });
}

async function loadProjectSettings(): Promise<ProjectSettingsData> {
    const workspaceRoot = getWorkspaceRoot();
    const manager = new ProjectConfigManager(workspaceRoot);
    const markdownPath = manager.getConfigPath();
    const json5Path = path.join(workspaceRoot, PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME);
    const existingProjectConfig = await manager.readConfig();
    const project = existingProjectConfig || createDefaultProjectConfig(workspaceRoot);
    const json5Result = readProjectJson5(json5Path);
    for (const definition of PROJECT_KEYWORD_CONFIG_DEFINITIONS) {
        json5Result.config[definition.key] = normalizeStringArray([
            project[definition.key],
            json5Result.config[definition.key],
        ]);
    }

    return {
        workspaceRoot,
        files: {
            markdownPath,
            json5Path,
            markdownExists: fs.existsSync(markdownPath),
            json5Exists: fs.existsSync(json5Path),
        },
        project: serializeProjectConfig(project),
        json5: json5Result.config,
        json5ParseError: json5Result.error,
    };
}

async function saveProjectSettings(data: unknown): Promise<void> {
    const workspaceRoot = getWorkspaceRoot();
    const payload = normalizePayload(data);
    const manager = new ProjectConfigManager(workspaceRoot);

    const wroteMarkdown = await manager.writeConfig({
        name: payload.project.name || path.basename(workspaceRoot) || '未命名项目',
        description: payload.project.description || '',
        author: payload.project.author || '',
        uuid: payload.project.uuid || uuidv4(),
        cover: payload.project.cover || '',
        summary: payload.project.summary || '',
        tags: normalizeStringArray(payload.project.tags),
        characterFileKeywords: payload.json5.characterFileKeywords,
        sensitiveWordsFileKeywords: payload.json5.sensitiveWordsFileKeywords,
        vocabularyFileKeywords: payload.json5.vocabularyFileKeywords,
        regexFileKeywords: payload.json5.regexFileKeywords,
        createdAt: parseDateOrNow(payload.project.createdAt),
        updatedAt: new Date(),
    });
    if (!wroteMarkdown) {
        throw new Error('写入 anhproject.md 失败');
    }

    const json5Path = path.join(workspaceRoot, PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME);
    await fs.promises.writeFile(json5Path, renderProjectJson5(payload.json5), 'utf8');
    clearAllProjectConfigCaches(workspaceRoot);
    try { await vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles'); } catch { /* optional command */ }
}

function normalizePayload(data: unknown): ProjectSettingsPayload {
    const record = isRecord(data) ? data : {};
    const project = isRecord(record.project) ? record.project : {};
    const json5 = isRecord(record.json5) ? record.json5 : {};
    return {
        project: {
            name: normalizeString(project.name),
            description: normalizeString(project.description),
            author: normalizeString(project.author),
            uuid: normalizeString(project.uuid),
            cover: normalizeString(project.cover),
            summary: normalizeString(project.summary),
            tags: normalizeStringArray(project.tags),
            createdAt: normalizeString(project.createdAt),
            updatedAt: normalizeString(project.updatedAt),
        },
        json5: normalizeJson5Payload(json5),
    };
}

function normalizeJson5Payload(value: Record<string, unknown>): ProjectSettingsJson5 {
    const config = createDefaultProjectJson5();
    for (const key of Object.keys(PROJECT_LIBRARY_TARGET_DEFAULTS) as ProjectLibraryTargetKey[]) {
        config[key] = normalizeString(value[key]) || PROJECT_LIBRARY_TARGET_DEFAULTS[key];
    }
    config.defaultRoleLookupKeys = normalizeStringArray(value.defaultRoleLookupKeys);
    config.extendedLookupKeyPrefixes = normalizeStringArray(value.extendedLookupKeyPrefixes);
    for (const definition of PROJECT_KEYWORD_CONFIG_DEFINITIONS) {
        config[definition.key] = normalizeKeywordList(value[definition.key]);
    }
    return config;
}

function createDefaultProjectConfig(workspaceRoot: string): ProjectConfig {
    const now = new Date();
    return {
        name: path.basename(workspaceRoot) || '未命名项目',
        description: '',
        author: '',
        uuid: uuidv4(),
        cover: '',
        summary: '',
        tags: [],
        characterFileKeywords: [],
        sensitiveWordsFileKeywords: [],
        vocabularyFileKeywords: [],
        regexFileKeywords: [],
        createdAt: now,
        updatedAt: now,
    };
}

function createDefaultProjectJson5(): ProjectSettingsJson5 {
    return {
        rolesFile: PROJECT_LIBRARY_TARGET_DEFAULTS.rolesFile,
        sensitiveWordsFile: PROJECT_LIBRARY_TARGET_DEFAULTS.sensitiveWordsFile,
        vocabularyFile: PROJECT_LIBRARY_TARGET_DEFAULTS.vocabularyFile,
        regexPatternsFile: PROJECT_LIBRARY_TARGET_DEFAULTS.regexPatternsFile,
        defaultRoleLookupKeys: [],
        extendedLookupKeyPrefixes: [],
        characterFileKeywords: [],
        sensitiveWordsFileKeywords: [],
        vocabularyFileKeywords: [],
        regexFileKeywords: [],
    };
}

function readProjectJson5(filePath: string): { config: ProjectSettingsJson5; error?: string } {
    const config = createDefaultProjectJson5();
    if (!fs.existsSync(filePath)) {
        return { config };
    }

    try {
        const parsed = JSON5.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
        if (!isRecord(parsed)) {
            return { config, error: 'project-config.json5 顶层必须是对象' };
        }

        for (const key of Object.keys(PROJECT_LIBRARY_TARGET_DEFAULTS) as ProjectLibraryTargetKey[]) {
            config[key] = normalizeString(parsed[key]) || config[key];
        }
        config.defaultRoleLookupKeys = normalizeStringArray(parsed.defaultRoleLookupKeys);
        config.extendedLookupKeyPrefixes = normalizeStringArray(parsed.extendedLookupKeyPrefixes);
        for (const definition of PROJECT_KEYWORD_CONFIG_DEFINITIONS) {
            config[definition.key] = normalizeKeywordList(parsed[definition.key]);
        }
        return { config };
    } catch (error) {
        return { config, error: error instanceof Error ? error.message : String(error) };
    }
}

function serializeProjectConfig(config: ProjectConfig): ProjectSettingsPayload['project'] {
    return {
        name: config.name || '',
        description: config.description || '',
        author: config.author || '',
        uuid: config.uuid || '',
        cover: config.cover || '',
        summary: config.summary || '',
        tags: normalizeStringArray(config.tags),
        createdAt: dateToIso(config.createdAt),
        updatedAt: dateToIso(config.updatedAt),
    };
}

function renderProjectJson5(config: ProjectSettingsJson5): string {
    return [
        '{',
        '  // 新增条目时的默认写入目标（相对于工作区根目录）。这不是项目资源文件清单。',
        `  rolesFile: ${jsonString(config.rolesFile)},`,
        `  sensitiveWordsFile: ${jsonString(config.sensitiveWordsFile)},`,
        `  vocabularyFile: ${jsonString(config.vocabularyFile)},`,
        `  regexPatternsFile: ${jsonString(config.regexPatternsFile)},`,
        '',
        '  // 新建角色时默认补齐的索引键字段（在全局默认基础上扩充，可写后缀或完整字段名）',
        `  defaultRoleLookupKeys: ${formatArray(config.defaultRoleLookupKeys)},`,
        '',
        '  // 扩展索引键家族前缀（使系统将这些前缀开头的字段也识别为索引键）',
        `  extendedLookupKeyPrefixes: ${formatArray(config.extendedLookupKeyPrefixes)},`,
        '',
        ...PROJECT_KEYWORD_CONFIG_DEFINITIONS.flatMap(definition => [
            `  // ${definition.detail}`,
            `  ${definition.key}: ${formatArray(config[definition.key])},`,
            '',
        ]),
        '}',
        '',
    ].join('\n');
}

function formatArray(values: string[]): string {
    const normalized = normalizeStringArray(values);
    if (normalized.length === 0) {
        return '[]';
    }
    return `[\n${normalized.map(value => `    ${jsonString(value)},`).join('\n')}\n  ]`;
}

function jsonString(value: string): string {
    return JSON.stringify(value);
}

function getWorkspaceRoot(): string {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        throw new Error('请先打开一个工作区');
    }
    return folder.uri.fsPath;
}

async function openProjectConfigFile(file: unknown): Promise<void> {
    const workspaceRoot = getWorkspaceRoot();
    const target = file === 'json5'
        ? path.join(workspaceRoot, PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME)
        : path.join(workspaceRoot, PROJECT_CONFIG_MARKDOWN_FILE_NAME);
    if (!fs.existsSync(target)) {
        vscode.window.showWarningMessage(`文件不存在，请先在项目设置页保存: ${path.basename(target)}`);
        return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
    await vscode.window.showTextDocument(doc, { preview: false });
}

function parseDateOrNow(value: string): Date {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : new Date();
}

function dateToIso(value: Date): string {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
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
    return Array.from(new Set(
        value
            .split(/[\r\n,，;；、\t]+/)
            .map(item => item.trim())
            .filter(Boolean)
    ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let value = '';
    for (let i = 0; i < 32; i++) {
        value += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return value;
}

function getProjectSettingsHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>项目设置</title>
    <style>
        :root {
            color-scheme: light dark;
            --bg: var(--vscode-editor-background);
            --fg: var(--vscode-editor-foreground);
            --muted: var(--vscode-descriptionForeground);
            --border: var(--vscode-panel-border);
            --input-bg: var(--vscode-input-background);
            --input-fg: var(--vscode-input-foreground);
            --accent: var(--vscode-button-background);
            --accent-fg: var(--vscode-button-foreground);
            --danger: var(--vscode-inputValidation-errorBorder);
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            background: var(--bg);
            color: var(--fg);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
        }
        header {
            position: sticky;
            top: 0;
            z-index: 2;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 12px 18px;
            border-bottom: 1px solid var(--border);
            background: var(--bg);
        }
        h1 { margin: 0; font-size: 18px; font-weight: 600; }
        .toolbar { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
        button {
            border: 1px solid var(--border);
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            padding: 6px 10px;
            border-radius: 4px;
            cursor: pointer;
        }
        button.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
        button:hover { filter: brightness(1.08); }
        main {
            display: grid;
            grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
            min-height: calc(100vh - 57px);
        }
        nav {
            border-right: 1px solid var(--border);
            padding: 14px;
        }
        nav a {
            display: block;
            color: var(--fg);
            text-decoration: none;
            padding: 7px 8px;
            border-radius: 4px;
            margin-bottom: 4px;
        }
        nav a:hover { background: var(--vscode-list-hoverBackground); }
        .content { padding: 18px; max-width: 980px; }
        section {
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 16px;
            margin-bottom: 16px;
        }
        h2 { margin: 0 0 14px; font-size: 15px; font-weight: 600; }
        .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .field { display: flex; flex-direction: column; gap: 6px; }
        .field.full { grid-column: 1 / -1; }
        label { font-size: 12px; color: var(--muted); }
        input, textarea {
            width: 100%;
            border: 1px solid var(--vscode-input-border, var(--border));
            background: var(--input-bg);
            color: var(--input-fg);
            border-radius: 4px;
            padding: 7px 8px;
            font: inherit;
        }
        textarea { min-height: 82px; resize: vertical; line-height: 1.45; }
        .hint { color: var(--muted); font-size: 12px; margin-top: 4px; }
        .status {
            color: var(--muted);
            font-size: 12px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .notice {
            border-left: 3px solid var(--danger);
            padding: 8px 10px;
            margin-bottom: 14px;
            background: var(--vscode-inputValidation-errorBackground);
            display: none;
        }
        .notice.show { display: block; }
        @media (max-width: 760px) {
            main { display: block; }
            nav { border-right: 0; border-bottom: 1px solid var(--border); }
            .grid { grid-template-columns: 1fr; }
            header { align-items: flex-start; flex-direction: column; }
        }
    </style>
</head>
<body>
    <header>
        <div>
            <h1>项目设置</h1>
            <div class="status" id="workspace">正在读取工作区...</div>
        </div>
        <div class="toolbar">
            <button id="openMd">打开 anhproject.md</button>
            <button id="openJson5">打开 project-config.json5</button>
            <button id="reload">刷新</button>
            <button id="save" class="primary">保存</button>
        </div>
    </header>
    <main>
        <nav>
            <a href="#basic">项目资料</a>
            <a href="#lookup">角色索引键</a>
            <a href="#keywords">文件识别关键词</a>
            <a href="#targets">默认写入目标</a>
        </nav>
        <div class="content">
            <div class="notice" id="notice"></div>
            <section id="basic">
                <h2>项目资料</h2>
                <div class="grid">
                    <div class="field"><label>项目名称</label><input id="name"></div>
                    <div class="field"><label>作者</label><input id="author"></div>
                    <div class="field full"><label>项目描述</label><input id="description"></div>
                    <div class="field full"><label>项目 UUID</label><input id="uuid"></div>
                    <div class="field full"><label>封面路径</label><input id="cover"></div>
                    <div class="field full"><label>项目简介</label><textarea id="summary"></textarea></div>
                    <div class="field full"><label>标签</label><textarea id="tags"></textarea><div class="hint">支持换行、逗号、顿号、分号分隔。</div></div>
                </div>
            </section>
            <section id="lookup">
                <h2>角色索引键</h2>
                <div class="grid">
                    <div class="field full"><label>默认角色索引键</label><textarea id="defaultRoleLookupKeys"></textarea></div>
                    <div class="field full"><label>扩展索引键前缀</label><textarea id="extendedLookupKeyPrefixes"></textarea></div>
                </div>
            </section>
            <section id="keywords">
                <h2>文件识别关键词</h2>
                <div class="grid">
                    <div class="field"><label>角色文件关键词</label><textarea id="characterFileKeywords"></textarea></div>
                    <div class="field"><label>敏感词文件关键词</label><textarea id="sensitiveWordsFileKeywords"></textarea></div>
                    <div class="field"><label>词汇文件关键词</label><textarea id="vocabularyFileKeywords"></textarea></div>
                    <div class="field"><label>正则文件关键词</label><textarea id="regexFileKeywords"></textarea></div>
                </div>
            </section>
            <section id="targets">
                <h2>默认写入目标（可选）</h2>
                <div class="hint">这里不是项目资源清单。项目资源仍按包管理器、外部资源目录和关键词扫描识别；这些路径只影响“新增角色/词汇/敏感词/正则”一类命令默认写入到哪个文件。</div>
                <div class="grid" style="margin-top:12px">
                    <div class="field"><label>新增角色默认写入</label><input id="rolesFile"></div>
                    <div class="field"><label>新增敏感词默认写入</label><input id="sensitiveWordsFile"></div>
                    <div class="field"><label>新增词汇默认写入</label><input id="vocabularyFile"></div>
                    <div class="field"><label>新增正则默认写入</label><input id="regexPatternsFile"></div>
                </div>
            </section>
        </div>
    </main>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const ids = [
            'name', 'author', 'description', 'uuid', 'cover', 'summary', 'tags',
            'rolesFile', 'sensitiveWordsFile', 'vocabularyFile', 'regexPatternsFile',
            'defaultRoleLookupKeys', 'extendedLookupKeyPrefixes',
            'characterFileKeywords', 'sensitiveWordsFileKeywords', 'vocabularyFileKeywords', 'regexFileKeywords'
        ];
        const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
        let createdAt = '';
        let updatedAt = '';

        function listText(values) {
            return Array.isArray(values) ? values.join('\\n') : '';
        }

        function parseList(value) {
            return String(value || '').split(/[\\r\\n,，;；、\\t]+/).map(v => v.trim()).filter(Boolean);
        }

        function setNotice(text) {
            const notice = document.getElementById('notice');
            notice.textContent = text || '';
            notice.classList.toggle('show', !!text);
        }

        function fill(data) {
            setNotice(data.json5ParseError ? 'project-config.json5 解析失败，页面已显示默认值。保存会重写该文件。' + data.json5ParseError : '');
            document.getElementById('workspace').textContent = data.workspaceRoot + '  |  anhproject.md: ' + (data.files.markdownExists ? '存在' : '未创建') + '，project-config.json5: ' + (data.files.json5Exists ? '存在' : '未创建');
            const project = data.project || {};
            const json5 = data.json5 || {};
            el.name.value = project.name || '';
            el.author.value = project.author || '';
            el.description.value = project.description || '';
            el.uuid.value = project.uuid || '';
            el.cover.value = project.cover || '';
            el.summary.value = project.summary || '';
            el.tags.value = listText(project.tags);
            createdAt = project.createdAt || '';
            updatedAt = project.updatedAt || '';
            ['rolesFile', 'sensitiveWordsFile', 'vocabularyFile', 'regexPatternsFile'].forEach(id => { el[id].value = json5[id] || ''; });
            ['defaultRoleLookupKeys', 'extendedLookupKeyPrefixes', 'characterFileKeywords', 'sensitiveWordsFileKeywords', 'vocabularyFileKeywords', 'regexFileKeywords'].forEach(id => { el[id].value = listText(json5[id]); });
        }

        function collect() {
            return {
                project: {
                    name: el.name.value,
                    author: el.author.value,
                    description: el.description.value,
                    uuid: el.uuid.value,
                    cover: el.cover.value,
                    summary: el.summary.value,
                    tags: parseList(el.tags.value),
                    createdAt,
                    updatedAt
                },
                json5: {
                    rolesFile: el.rolesFile.value,
                    sensitiveWordsFile: el.sensitiveWordsFile.value,
                    vocabularyFile: el.vocabularyFile.value,
                    regexPatternsFile: el.regexPatternsFile.value,
                    defaultRoleLookupKeys: parseList(el.defaultRoleLookupKeys.value),
                    extendedLookupKeyPrefixes: parseList(el.extendedLookupKeyPrefixes.value),
                    characterFileKeywords: parseList(el.characterFileKeywords.value),
                    sensitiveWordsFileKeywords: parseList(el.sensitiveWordsFileKeywords.value),
                    vocabularyFileKeywords: parseList(el.vocabularyFileKeywords.value),
                    regexFileKeywords: parseList(el.regexFileKeywords.value)
                }
            };
        }

        window.addEventListener('message', event => {
            const message = event.data || {};
            if (message.command === 'data') { fill(message.data); }
            if (message.command === 'error') { setNotice(message.message || '操作失败'); }
        });
        document.getElementById('save').addEventListener('click', () => vscode.postMessage({ command: 'save', data: collect() }));
        document.getElementById('reload').addEventListener('click', () => vscode.postMessage({ command: 'reload' }));
        document.getElementById('openMd').addEventListener('click', () => vscode.postMessage({ command: 'openFile', file: 'markdown' }));
        document.getElementById('openJson5').addEventListener('click', () => vscode.postMessage({ command: 'openFile', file: 'json5' }));
        vscode.postMessage({ command: 'ready' });
    </script>
</body>
</html>`;
}
