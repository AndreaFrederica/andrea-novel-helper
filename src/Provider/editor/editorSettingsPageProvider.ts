import * as vscode from 'vscode';
import { buildHtml } from '../utils/html-builder';
import { EditorSettingsWebviewProvider } from '../view/editorSettingsProvider';

// Mock SecretStorage 实现
class MockSecretStorage implements vscode.SecretStorage {
    async get(key: string): Promise<string | undefined> {
        return undefined;
    }

    async store(key: string, value: string): Promise<void> {
    }

    async delete(key: string): Promise<void> {
    }

    onDidChange: vscode.Event<vscode.SecretStorageChangeEvent> = () => ({
        dispose: () => {}
    }) as any;

    async keys(): Promise<string[]> {
        return [];
    }
}

export class EditorSettingsPanel {
    private static _instance: EditorSettingsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _editorSettingsProvider?: EditorSettingsWebviewProvider;

    // 持久化状态键
    private static readonly STATE_KEY = 'editorSettingsPanelState';

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // 初始化EditorSettingsProvider
        // 创建一个最小化的ExtensionContext对象
        const mockContext: vscode.ExtensionContext = {
            extensionUri,
            subscriptions: [],
            globalState: {
                get: () => undefined,
                update: () => Promise.resolve(),
                keys: () => []
            } as any,
            workspaceState: {
                get: () => undefined,
                update: () => Promise.resolve(),
                keys: () => []
            } as any,
            secrets: new MockSecretStorage(),
            extensionPath: '',
            storageUri: vscode.Uri.file(''),
            globalStorageUri: vscode.Uri.file(''),
            storagePath: '',
            globalStoragePath: '',
            logUri: vscode.Uri.file(''),
            logPath: '',
            environmentVariableCollection: {
                persistent: true,
                description: '',
                replace: () => undefined,
                append: () => undefined,
                get: () => undefined,
                getScoped: () => undefined,
                prepend: () => undefined,
                delete: () => undefined,
                forEach: () => undefined,
                clear: () => undefined,
                [Symbol.iterator]: function*() {}
            } as any,
            extensionMode: vscode.ExtensionMode.Production,
            extension: {
                id: '',
                extensionUri: vscode.Uri.file(''),
                extensionPath: '',
                isActive: true,
                packageJSON: {},
                extensionKind: vscode.ExtensionKind.UI,
                exports: undefined,
                activate: undefined as any
            } as any,
            asAbsolutePath: (relativePath: string) => relativePath,
            languageModelAccessInformation: undefined as any
        };

        this._editorSettingsProvider = new EditorSettingsWebviewProvider(mockContext);

        // 设置外部webview
        this._editorSettingsProvider.setExternalWebview(this._panel.webview);

        // 设置webview
        this._update();

        // 监听webview关闭
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // 监听webview消息
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                if (this._editorSettingsProvider) {
                    // 使用EditorSettingsWebviewProvider处理消息
                    await this._editorSettingsProvider['processMessage'](message);
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri): EditorSettingsPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // 如果面板已存在，显示它
        if (EditorSettingsPanel._instance) {
            EditorSettingsPanel._instance._panel.reveal(column);
            return EditorSettingsPanel._instance;
        }

        // 设置 resourceMapperScriptUri
        let resourceMapperScriptUri: string | undefined;
        try {
            const mapperFile = vscode.Uri.joinPath(extensionUri, 'media', 'resource-mapper.js');
            resourceMapperScriptUri = vscode.Uri.joinPath(extensionUri, 'media', 'resource-mapper.js').toString();
        } catch (_) { }

        // 创建新面板
        const panel = vscode.window.createWebviewPanel(
            'editorSettingsEnhanced',
            '编辑器设置',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'packages', 'webview', 'dist', 'spa'),
                    vscode.Uri.joinPath(extensionUri, 'packages', 'webview', 'dist', 'spa', 'assets'),
                    vscode.Uri.joinPath(extensionUri, 'media')
                ],
                // 启用状态持久化
                enableFindWidget: true
            }
        );

        EditorSettingsPanel._instance = new EditorSettingsPanel(panel, extensionUri);
        return EditorSettingsPanel._instance;
    }

    private _update() {
        const webview = this._panel.webview;

        // 设置 resourceMapperScriptUri
        let resourceMapperScriptUri: string | undefined;
        try {
            const mapperFile = vscode.Uri.joinPath(this._extensionUri, 'media', 'resource-mapper.js');
            resourceMapperScriptUri = webview.asWebviewUri(mapperFile).toString();
        } catch (_) { }

        // 使用buildHtml函数构建HTML
        this._panel.webview.html = buildHtml(webview, {
            spaRoot: vscode.Uri.joinPath(this._extensionUri, 'packages', 'webview', 'dist', 'spa'),
            connectSrc: ['https:', 'http:', 'ws:', 'wss:'],
            resourceMapperScriptUri,
            route: '/editor-settings-enhanced',
            editorTitle: '编辑器设置'
        });
    }

    public dispose() {
        EditorSettingsPanel._instance = undefined;

        // 清理资源
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }

        this._panel.dispose();
    }

    public postMessage(message: any) {
        this._panel.webview.postMessage(message);
    }
}

export function registerEditorSettingsPage(context: vscode.ExtensionContext): vscode.Disposable {
    // 注册打开编辑器设置的命令
    const command = vscode.commands.registerCommand('andrea.openEditorSettingsEnhanced', async () => {
        EditorSettingsPanel.createOrShow(context.extensionUri);

        // 保存状态表示编辑器设置页面被打开
        await context.globalState.update('editorSettingsPanelOpen', true);
    });

    context.subscriptions.push(command);

    // 在扩展激活时检查是否需要重新打开编辑器设置页面
    const wasOpen = context.globalState.get('editorSettingsPanelOpen', false);
    if (wasOpen) {
        // 延迟一点时间再打开，确保其他组件已加载
        setTimeout(() => {
            EditorSettingsPanel.createOrShow(context.extensionUri);
        }, 1000);
    }

    // 注册关闭时的清理
    context.subscriptions.push({
        dispose: () => {
            // 扩展停用时清除状态
            context.globalState.update('editorSettingsPanelOpen', false);
        }
    });

    return command;
}