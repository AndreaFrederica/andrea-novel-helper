import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { setWebviewPanelIcon } from '../Provider/utils/webviewPanelIcon';
import { LEGACY_RESOURCE_KEYWORDS } from '../projectConfig/resourceFileNaming';

let currentPanel: vscode.WebviewPanel | undefined;
let extensionPath: string = '';

interface DocData {
    title: string;
    category: string;
    categoryId: string;
    html: string;
}

const DOC_CATEGORIES: Record<string, { title: string; docs: Record<string, string> }> = {
    start: {
        title: '入门',
        docs: {
            'hello-world': 'Hello World',
            'init-wizard': '项目初始化向导',
            'workspace-init-files': '工作区初始化文件',
            'project-settings': '项目设置',
            'plugin-settings': '插件设置',
            'quick-settings': '快速设置',
            'status-bar': '状态栏功能',
            'vscode-settings': 'VS Code 基础',
            'writing-preview': '写作预览',
            'patchouli-preview': 'Patchouli 新预览',
        }
    },
    concepts: {
        title: '核心概念',
        docs: {
            'everything-is-role': '一切皆角色',
            'package-manager': '包管理器',
            'package-mechanism': '包机制与外部包详解',
            'markdown-format-guide': '文件格式指南',
            'version-control-basics': '版本管理是什么',
            'git-basics': 'Git 本体详解',
        }
    },
    projectFiles: {
        title: '项目文件',
        docs: {
            'anhproject-file': 'anhproject.md',
            'project-config-file': 'project-config.json5',
            'gitignore-file': '.gitignore',
            'wcignore-file': '.wcignore',
            'character-gallery-file': `${LEGACY_RESOURCE_KEYWORDS.character}.*`,
            'sensitive-words-file': `${LEGACY_RESOURCE_KEYWORDS.sensitive}.*`,
            'vocabulary-file': `${LEGACY_RESOURCE_KEYWORDS.vocabulary}.*`,
            'regex-patterns-file': 'regex-patterns.*',
            'roles-markdown-file': 'roles.md',
            'mcp-config-file': 'mcp.json',
        }
    },
    roles: {
        title: '角色与资源',
        docs: {
            'role-management': '角色管理',
            'sensitive-words': '敏感词检测',
            'vocabulary': '词汇表',
            'regex-coloring': '正则着色',
            'regex-tutorial': '正则表达式入门',
        }
    },
    writing: {
        title: '写作辅助',
        docs: {
            'role-completion': '角色补全',
            'word-count': '字数统计',
            'time-stats': '写作时间统计',
            'writing-dashboard': '创作工作台',
            'comments-manager': '批注管理器',
            'typo-check': '校对与纠错',
            'translate': '翻译',
            'typeset': '排版辅助',
            'outline': '大纲',
            'export': '导出与复制',
            'writing-explorer': '写作资源管理器',
        }
    },
    advanced: {
        title: '高级功能',
        docs: {
            'external-resource': '外部资源目录',
            'reference-heatmap': '引用维护与热力图',
            'git-integration': 'Git 与 VS Code 集成',
            'git-hosting-platforms': 'Git 托管平台比较',
            'git-remote-sync': '云仓库同步与备份',
            'data-import-migration': '从旧项目迁入数据',
            'relationship': '角色关系图',
            'role-relationship-graph': '角色关系图谱',
            'timeline': '时间线',
            'script-runtime': '脚本运行时',
            'ai-mcp': 'AI 与 MCP 集成',
            'webdav': 'WebDAV 同步',
        }
    }
};

export function registerDocViewerPage(context: vscode.ExtensionContext): void {
    extensionPath = context.extensionPath;

    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.showGuideDoc', async (docId?: string) => {
            await showDocViewer(docId);
        })
    );

    if (vscode.window.registerWebviewPanelSerializer) {
        context.subscriptions.push(
            vscode.window.registerWebviewPanelSerializer('andrea.guideDoc', {
                async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: any) {
                    currentPanel = panel;
                    setupDocViewerPanel(panel, state?.currentDocId);
                }
            })
        );
    }
}

async function showDocViewer(docId?: string): Promise<void> {
    if (currentPanel) {
        currentPanel.reveal(vscode.ViewColumn.Active);
        if (docId) {
            currentPanel.webview.postMessage({ command: 'loadDoc', docId });
        }
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        'andrea.guideDoc',
        'ANH 文档',
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(extensionPath, 'media')),
                vscode.Uri.file(path.join(extensionPath, 'images'))
            ]
        }
    );
    setupDocViewerPanel(panel, docId);
}

function setupDocViewerPanel(panel: vscode.WebviewPanel, docId?: string): void {
    currentPanel = panel;
    panel.title = 'ANH 文档';
    setWebviewPanelIcon(panel, extensionPath, 'docs');
    panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [
            vscode.Uri.file(path.join(extensionPath, 'media')),
            vscode.Uri.file(path.join(extensionPath, 'images'))
        ]
    };

    const docsData = buildDocsData();
    panel.webview.html = getDocViewerHtml(panel.webview, docsData, docId);

    sendThemeColors(panel);

    const themeWatcher = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('workbench.colorTheme') || e.affectsConfiguration('editor.tokenColorCustomizations')) {
            sendThemeColors(panel);
        }
    });

    panel.onDidDispose(() => {
        currentPanel = undefined;
        themeWatcher.dispose();
    });

    panel.webview.onDidReceiveMessage(async message => {
        if (message?.command === 'openGuide') {
            await vscode.commands.executeCommand('AndreaNovelHelper.showGuide');
        } else if (message?.command === 'releaseDocs' && message.docId) {
            await releaseDocsToWorkspace(message.docId);
        } else if (message?.command === 'requestThemeColors') {
            sendThemeColors(panel);
        }
    });
}

function sendThemeColors(panel: vscode.WebviewPanel): void {
    const merged: Record<string, string> = {
        keyword: 'var(--vscode-symbolIcon-keywordForeground, #569cd6)',
        string: 'var(--vscode-symbolIcon-stringForeground, #ce9178)',
        number: 'var(--vscode-symbolIcon-numberForeground, #b5cea8)',
        comment: 'var(--vscode-descriptionForeground, #6a9955)',
        type: 'var(--vscode-symbolIcon-classForeground, #4ec9b0)',
        'function': 'var(--vscode-symbolIcon-functionForeground, #dcdcaa)',
        variable: 'var(--vscode-symbolIcon-variableForeground, #9cdcfe)',
        constant: 'var(--vscode-symbolIcon-constantForeground, #4fc1ff)',
        punctuation: 'var(--vscode-editor-foreground, #d4d4d4)',
        bracket: 'var(--vscode-symbolIcon-operatorForeground, #ffd700)',
        separator: 'var(--vscode-descriptionForeground, #808080)',
        tag: 'var(--vscode-symbolIcon-keywordForeground, #569cd6)',
        attribute: 'var(--vscode-symbolIcon-propertyForeground, #9cdcfe)',
        operator: 'var(--vscode-symbolIcon-operatorForeground, #d4d4d4)',
        regexp: 'var(--vscode-symbolIcon-colorForeground, #d16969)',
        'md-heading': 'var(--vscode-textLink-foreground, #569cd6)',
        'md-heading2': 'var(--vscode-textLink-foreground, #569cd6)',
        'md-heading3': 'var(--vscode-textLink-foreground, #569cd6)',
        'md-heading4': 'var(--vscode-textLink-foreground, #569cd6)',
        'md-bold': 'var(--vscode-editor-foreground, #d4d4d4)',
        'md-italic': 'var(--vscode-editor-foreground, #d4d4d4)',
        'md-strike': 'var(--vscode-descriptionForeground, #808080)',
        'md-list': 'var(--vscode-descriptionForeground, #808080)',
        'md-link': 'var(--vscode-textLink-foreground, #4ec9b0)',
        'md-code': 'var(--vscode-textPreformat-foreground, #ce9178)',
        'md-sep': 'var(--vscode-descriptionForeground, #808080)',
        'role-field': 'var(--vscode-symbolIcon-keyForeground, #c586c0)',
        'role-value': 'var(--vscode-textPreformat-foreground, var(--vscode-editor-foreground, #d4d4d4))',
        'prose-dialogue-double': 'var(--vscode-terminal-ansiYellow, #fbdc98ff)',
        'prose-dialogue-corner': 'var(--vscode-terminal-ansiYellow, #fbdc98ff)',
        'prose-thought-single': 'var(--vscode-terminal-ansiBlue, #98bbfbff)',
        'prose-book-title': 'var(--vscode-terminal-ansiMagenta, #fbbc98ff)'
    };

    // Merge user tokenColorCustomizations if present
    const customizations = vscode.workspace.getConfiguration('editor').get<Record<string, any>>('tokenColorCustomizations');

    if (customizations) {
        const scopeMap: Record<string, string> = {
            comments: 'comment', strings: 'string', keywords: 'keyword',
            numbers: 'number', types: 'type', functions: 'function',
            variables: 'variable', constants: 'constant', operators: 'operator',
            regexp: 'regexp'
        };
        for (const [key, tokenKey] of Object.entries(scopeMap)) {
            const val = customizations[key];
            if (typeof val === 'string') { merged[tokenKey] = val; }
        }
    }

    panel.webview.postMessage({ command: 'themeColors', colors: merged });
}

async function releaseDocsToWorkspace(_docId: string): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
        '是否将文档释放到项目的 novel-helper/docs/ 文件夹？此操作会覆盖已有文件。',
        '释放', '取消'
    );
    if (choice !== '释放') { return; }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('没有打开的工作区，请先打开一个项目文件夹。');
        return;
    }

    const targetDir = path.join(workspaceFolders[0].uri.fsPath, 'novel-helper', 'docs');
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    const docsDir = path.join(extensionPath, 'media', 'docs');
    const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.html'));
    for (const file of files) {
        fs.copyFileSync(path.join(docsDir, file), path.join(targetDir, file));
    }

    await vscode.window.showInformationMessage(
        `已释放 ${files.length} 个文档到 novel-helper/docs/ 文件夹。`
    );
}

function buildDocsData(): Record<string, DocData> {
    const docsDir = path.join(extensionPath, 'media', 'docs');
    const result: Record<string, DocData> = {};

    for (const [categoryId, category] of Object.entries(DOC_CATEGORIES)) {
        for (const [docId, title] of Object.entries(category.docs)) {
            const filePath = path.join(docsDir, `${docId}.html`);
            let html = '';
            try {
                if (fs.existsSync(filePath)) {
                    html = fs.readFileSync(filePath, 'utf8');
                } else {
                    html = `<p>文档内容缺失: <code>${docId}.html</code></p>`;
                }
            } catch {
                html = `<p>读取文档失败: <code>${docId}.html</code></p>`;
            }

            result[docId] = {
                title,
                category: category.title,
                categoryId,
                html
            };
        }
    }

    return result;
}

function getDocViewerHtml(webview: vscode.Webview, docsData: Record<string, DocData>, initialDocId?: string): string {
    const nonce = generateNonce();
    const mediaDir = vscode.Uri.file(path.join(extensionPath, 'media'));
    const imagesDir = vscode.Uri.file(path.join(extensionPath, 'images'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, 'doc-viewer.js'));
    const htmlPath = path.join(extensionPath, 'media', 'doc-viewer.html');

    let template = fs.readFileSync(htmlPath, 'utf8');

    // Convert image paths in doc HTML to webview URIs
    const imagesUri = webview.asWebviewUri(imagesDir).toString();
    for (const doc of Object.values(docsData)) {
        doc.html = doc.html.replace(/src=["'](?:\.\.\/)?images\/([^"']+)["']/g, `src="${imagesUri}/$1"`);
    }

    // Inject docs data
    const settings = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const triggerMode = settings.get<string>('completion.triggerMode', 'loose');
    const docsDataScript = `<script nonce="${nonce}">window.__DOCS_DATA__ = ${JSON.stringify(docsData)}; window.__INITIAL_DOC_ID__ = ${JSON.stringify(initialDocId || null)}; window.__SETTINGS__ = ${JSON.stringify({ triggerMode })};</script>`;

    return template
        .replace(/__CSP_SOURCE__/g, webview.cspSource)
        .replace(/__NONCE__/g, nonce)
        .replace(/__SCRIPT_URI__/g, scriptUri.toString())
        .replace('</head>', `${docsDataScript}\n</head>`);
}

function generateNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) {
        out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
}
