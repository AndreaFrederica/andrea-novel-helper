import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { setWebviewPanelIcon } from '../Provider/utils/webviewPanelIcon';

let currentPanel: vscode.WebviewPanel | undefined;
let extensionPath: string = '';

// ── 打开配置按钮逻辑 ──────────────────────────────

interface ConfigTypeInfo {
    defaultNames: string[];      // 默认文件名（不含扩展名）
    nameKeywords: string[];      // 文件名关键词
    extensions: string[];        // 有效扩展名
    templateGenerator: (format: 'json5' | 'md') => string;  // 创建模板用
    displayName: string;         // 显示名称
}

const CONFIG_TYPES: Record<string, ConfigTypeInfo> = {
    role: {
        defaultNames: ['character-gallery'],
        nameKeywords: ['character-gallery', 'character', 'role', 'roles'],
        extensions: ['.json5', '.ojson5', '.md', '.csv', '.txt'],
        templateGenerator: () => `[\n  {\n    name: "示例角色",\n    type: "配角",\n    description: "这是一个示例角色"\n  }\n]\n`,
        displayName: '角色管理',
    },
    sensitive: {
        defaultNames: ['sensitive-words'],
        nameKeywords: ['sensitive-words', 'sensitive', '敏感词'],
        extensions: ['.json5', '.md', '.txt'],
        templateGenerator: () => `[\n  {\n    name: "示例敏感词",\n    type: "敏感词",\n    color: "#FF4D4F",\n    description: "需要避免使用的词汇"\n  }\n]\n`,
        displayName: '敏感词检测',
    },
    vocab: {
        defaultNames: ['vocabulary'],
        nameKeywords: ['vocabulary', 'vocab', '词汇', '术语'],
        extensions: ['.json5', '.md', '.txt'],
        templateGenerator: () => `[\n  {\n    name: "示例词汇",\n    type: "词汇",\n    description: "世界观术语"\n  }\n]\n`,
        displayName: '词汇表',
    },
    regex: {
        defaultNames: ['regex-patterns'],
        nameKeywords: ['regex-patterns', 'regex', '正则'],
        extensions: ['.json5', '.md'],
        templateGenerator: () => `[\n  {\n    name: "示例规则",\n    type: "正则表达式",\n    regex: "「[^」]*」",\n    regexFlags: "g",\n    color: "#98FB98"\n  }\n]\n`,
        displayName: '正则着色',
    },
};

function findConfigFiles(novelHelperDir: string, info: ConfigTypeInfo): string[] {
    if (!fs.existsSync(novelHelperDir)) return [];
    const entries = fs.readdirSync(novelHelperDir, { withFileTypes: true });
    return entries
        .filter(e => {
            if (!e.isFile()) return false;
            const lower = e.name.toLowerCase();
            const ext = path.extname(lower);
            if (!info.extensions.includes(ext)) return false;
            const base = path.basename(lower, ext);
            return info.nameKeywords.some(kw => base.toLowerCase().includes(kw.toLowerCase()));
        })
        .map(e => path.join(novelHelperDir, e.name));
}

async function openFileForType(filePath: string, _typeKey: string) {
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(filePath), 'default');
}

async function openOrCreateConfig(typeKey: string) {
    const info = CONFIG_TYPES[typeKey];
    if (!info) return;

    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
        vscode.window.showErrorMessage('请先打开一个项目文件夹。');
        return;
    }

    const novelHelperDir = path.join(folders[0].uri.fsPath, 'novel-helper');
    const files = findConfigFiles(novelHelperDir, info);

    if (files.length === 0) {
        // 没有配置文件 → 引导创建
        const format = await vscode.window.showQuickPick(['json5', 'md'], {
            placeHolder: `${info.displayName}: 未找到配置文件。选择格式创建`,
            title: '创建配置文件'
        });
        if (!format) return;
        const ext = format === 'json5' ? '.json5' : '.md';
        const fileName = `${info.defaultNames[0]}${ext}`;
        fs.mkdirSync(novelHelperDir, { recursive: true });
        const filePath = path.join(novelHelperDir, fileName);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, info.templateGenerator(format as 'json5' | 'md'), 'utf8');
        }
        await openFileForType(filePath, typeKey);
    } else if (files.length === 1) {
        // 只有一个 → 直接打开
        await openFileForType(files[0], typeKey);
    } else {
        // 多个 → 让用户选择
        const items = files.map(f => ({
            label: path.relative(novelHelperDir, f),
            filePath: f,
        }));
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `${info.displayName}: 找到 ${files.length} 个配置文件，选择要打开的`,
            title: '打开配置文件',
        });
        if (selected) {
            await openFileForType(selected.filePath, typeKey);
        }
    }
}

// ── 注册 ─────────────────────────────────────────

export function registerGuidePage(context: vscode.ExtensionContext): void {
    extensionPath = context.extensionPath;

    // 注册 4 个打开配置命令
    const typeKeys = ['role', 'sensitive', 'vocab', 'regex'];
    for (const key of typeKeys) {
        context.subscriptions.push(
            vscode.commands.registerCommand(`andrea.open${key.charAt(0).toUpperCase() + key.slice(1)}Config`, async () => {
                await openOrCreateConfig(key);
            })
        );
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.showGuide', async () => {
            if (currentPanel) {
                currentPanel.reveal(vscode.ViewColumn.Active);
                return;
            }

            const panel = vscode.window.createWebviewPanel(
                'andrea.guide',
                '功能引导',
                vscode.ViewColumn.Active,
                { enableScripts: true, retainContextWhenHidden: true }
            );
            setupGuidePanel(panel, context);
        })
    );

    if (vscode.window.registerWebviewPanelSerializer) {
        context.subscriptions.push(
            vscode.window.registerWebviewPanelSerializer('andrea.guide', {
                async deserializeWebviewPanel(panel: vscode.WebviewPanel) {
                    setupGuidePanel(panel, context);
                }
            })
        );
    }
}

function setupGuidePanel(panel: vscode.WebviewPanel, context: vscode.ExtensionContext): void {
    currentPanel = panel;
    panel.title = '功能引导';
    setWebviewPanelIcon(panel, extensionPath, 'guide');
    panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [
            vscode.Uri.file(path.join(extensionPath, 'media')),
            vscode.Uri.file(path.join(extensionPath, 'images'))
        ]
    };
    panel.webview.html = getGuideHtml(panel.webview);
    panel.onDidDispose(() => { currentPanel = undefined; }, undefined, context.subscriptions);
    panel.webview.onDidReceiveMessage(async message => {
        if (message?.command === 'executeCommand' && message.id) {
            try {
                await vscode.commands.executeCommand(message.id);
            } catch (err) {
                const text = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`执行命令失败: ${text}`);
            }
        } else if (message?.command === 'openAnhSettings') {
            await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:AndreaFrederica.andrea-novel-helper');
        } else if (message?.command === 'openVSCodeSettings') {
            await vscode.commands.executeCommand('workbench.action.openSettings');
        } else if (message?.command === 'showGuideDoc' && message.docId) {
            await vscode.commands.executeCommand('AndreaNovelHelper.showGuideDoc', message.docId);
        } else if (message?.command === 'openExternal' && message.url) {
            await vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
    }, undefined, context.subscriptions);
}

function getGuideHtml(webview: vscode.Webview): string {
    const nonce = generateNonce();
    const mediaDir = vscode.Uri.file(path.join(extensionPath, 'media'));
    const imagesDir = vscode.Uri.file(path.join(extensionPath, 'images'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, 'guide.js'));
    const imagesUri = webview.asWebviewUri(imagesDir).toString();
    const htmlPath = path.join(extensionPath, 'media', 'guide.html');
    const template = fs.readFileSync(htmlPath, 'utf8');
    return template
        .replace(/__CSP_SOURCE__/g, webview.cspSource)
        .replace(/__NONCE__/g, nonce)
        .replace(/__SCRIPT_URI__/g, scriptUri.toString())
        .replace(/__IMAGES_URI__/g, imagesUri);
}

function generateNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) {
        out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
}
