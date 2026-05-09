import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

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
            'project-settings': '项目设置',
            'plugin-settings': '插件设置',
            'quick-settings': '快速设置',
            'status-bar': '状态栏功能',
            'vscode-settings': 'VS Code 基础',
            'writing-preview': '写作预览',
        }
    },
    concepts: {
        title: '核心概念',
        docs: {
            'everything-is-role': '一切皆角色',
            'package-manager': '包管理器',
            'markdown-format-guide': '文件格式指南',
        }
    },
    roles: {
        title: '角色与资源',
        docs: {
            'role-management': '角色管理',
            'sensitive-words': '敏感词检测',
            'vocabulary': '词汇表',
            'regex-coloring': '正则着色',
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
            'git-integration': 'Git 集成',
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
    panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [
            vscode.Uri.file(path.join(extensionPath, 'media')),
            vscode.Uri.file(path.join(extensionPath, 'images'))
        ]
    };

    const docsData = buildDocsData();
    panel.webview.html = getDocViewerHtml(panel.webview, docsData, docId);

    panel.onDidDispose(() => { currentPanel = undefined; });

    panel.webview.onDidReceiveMessage(async message => {
        if (message?.command === 'openGuide') {
            await vscode.commands.executeCommand('AndreaNovelHelper.showGuide');
        } else if (message?.command === 'releaseDocs' && message.docId) {
            await releaseDocsToWorkspace(message.docId);
        }
    });
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
    const docsDataScript = `<script nonce="${nonce}">window.__DOCS_DATA__ = ${JSON.stringify(docsData)}; window.__INITIAL_DOC_ID__ = ${JSON.stringify(initialDocId || null)};</script>`;

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
