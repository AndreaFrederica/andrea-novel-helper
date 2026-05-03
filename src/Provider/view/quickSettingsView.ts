import * as vscode from 'vscode';
import { buildHtml } from '../utils/html-builder';
import { SettingsWebviewProvider } from './settingView';

export class QuickSettingsPanel {
    private static _instance: QuickSettingsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _settingsProvider?: SettingsWebviewProvider;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

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
            secrets: {
                get: () => Promise.resolve(undefined),
                store: () => Promise.resolve(),
                delete: () => Promise.resolve(),
                onDidChange: () => ({ dispose: () => {} })
            } as any,
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

        this._settingsProvider = new SettingsWebviewProvider(mockContext);
        this._settingsProvider.setExternalWebview(this._panel.webview);

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                if (message.command === 'runCommand' && message.commandId) {
                    await vscode.commands.executeCommand(message.commandId);
                    return;
                }
                if (this._settingsProvider) {
                    await this._settingsProvider.processMessage(message);
                }
            },
            null,
            this._disposables
        );
    }

    private static getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewPanelOptions & vscode.WebviewOptions {
        return {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.joinPath(extensionUri, 'packages', 'webview', 'dist', 'spa'),
                vscode.Uri.joinPath(extensionUri, 'packages', 'webview', 'dist', 'spa', 'assets'),
                vscode.Uri.joinPath(extensionUri, 'media')
            ]
        };
    }

    public static createOrShow(extensionUri: vscode.Uri): QuickSettingsPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (QuickSettingsPanel._instance) {
            QuickSettingsPanel._instance._panel.reveal(column);
            return QuickSettingsPanel._instance;
        }

        const panel = vscode.window.createWebviewPanel(
            'quickSettings',
            '图形化快速设置',
            column || vscode.ViewColumn.One,
            QuickSettingsPanel.getWebviewOptions(extensionUri)
        );

        QuickSettingsPanel._instance = new QuickSettingsPanel(panel, extensionUri);
        return QuickSettingsPanel._instance;
    }

    public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): QuickSettingsPanel {
        panel.webview.options = QuickSettingsPanel.getWebviewOptions(extensionUri);
        panel.title = '图形化快速设置';
        QuickSettingsPanel._instance = new QuickSettingsPanel(panel, extensionUri);
        return QuickSettingsPanel._instance;
    }

    private _update() {
        const webview = this._panel.webview;

        let resourceMapperScriptUri: string | undefined;
        try {
            const mapperFile = vscode.Uri.joinPath(this._extensionUri, 'media', 'resource-mapper.js');
            resourceMapperScriptUri = webview.asWebviewUri(mapperFile).toString();
        } catch (_) { }

        this._panel.webview.html = buildHtml(webview, {
            spaRoot: vscode.Uri.joinPath(this._extensionUri, 'packages', 'webview', 'dist', 'spa'),
            connectSrc: ['https:', 'http:', 'ws:', 'wss:'],
            resourceMapperScriptUri,
            route: '/quick-settings',
            editorTitle: '图形化快速设置'
        });
    }

    public dispose() {
        QuickSettingsPanel._instance = undefined;

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

export function registerQuickSettingsPage(context: vscode.ExtensionContext): vscode.Disposable {
    const command = vscode.commands.registerCommand('andrea.openGraphicalQuickSettings', async () => {
        QuickSettingsPanel.createOrShow(context.extensionUri);
    });

    context.subscriptions.push(command);

    const serializer = vscode.window.registerWebviewPanelSerializer('quickSettings', {
        async deserializeWebviewPanel(panel: vscode.WebviewPanel, _state: unknown) {
            QuickSettingsPanel.revive(panel, context.extensionUri);
        }
    });
    context.subscriptions.push(serializer);

    return command;
}
