import * as vscode from 'vscode';
import { buildHtml } from '../utils/html-builder';
import { SettingsWebviewProvider } from './settingView';

export class QuickSettingsPanel {
    private static _instance: QuickSettingsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _context: vscode.ExtensionContext;
    private _disposables: vscode.Disposable[] = [];
    private _settingsProvider?: SettingsWebviewProvider;
    private _wizardPromptInFlight = false;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._context = context;

        this._settingsProvider = new SettingsWebviewProvider(context);
        this._settingsProvider.setExternalWebview(this._panel.webview);

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                if (message.command === 'openFullSettings') {
                    try {
                        await vscode.commands.executeCommand('workbench.view.extension.AndreaSettingsSidebar');
                        await vscode.commands.executeCommand('andrea.settingsView.focus');
                    } catch (_) {
                        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:AndreaFrederica.andrea-novel-helper');
                    }
                    return;
                }
                if (message.command === 'runCommand' && message.commandId) {
                    await vscode.commands.executeCommand(message.commandId);
                    return;
                }
                if (message.command === 'getSettings' && this._settingsProvider) {
                    await this._settingsProvider.processMessage(message);
                    void this._maybePromptSettingsWizard();
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

    public static createOrShow(context: vscode.ExtensionContext): QuickSettingsPanel {
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
            QuickSettingsPanel.getWebviewOptions(context.extensionUri)
        );

        QuickSettingsPanel._instance = new QuickSettingsPanel(panel, context.extensionUri, context);
        return QuickSettingsPanel._instance;
    }

    public static revive(panel: vscode.WebviewPanel, context: vscode.ExtensionContext): QuickSettingsPanel {
        panel.webview.options = QuickSettingsPanel.getWebviewOptions(context.extensionUri);
        panel.title = '图形化快速设置';
        QuickSettingsPanel._instance = new QuickSettingsPanel(panel, context.extensionUri, context);
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

    private async _maybePromptSettingsWizard() {
        if (this._wizardPromptInFlight) {
            return;
        }

        const version = String(this._context.extension.packageJSON?.version ?? 'unknown');
        const storageKey = `andrea.quickSettings.settingsWizardPrompted.${version}`;
        if (this._context.globalState.get<boolean>(storageKey) === true) {
            return;
        }

        this._wizardPromptInFlight = true;
        await this._context.globalState.update(storageKey, true);

        try {
            const hasWorkspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
            const scopeItems = hasWorkspace
                ? ['项目设置', '全局设置', '暂不使用'] as const
                : ['全局设置', '暂不使用'] as const;
            const scopeChoice = await vscode.window.showInformationMessage(
                '首次打开本版本的图形化快速设置。设置向导要先调整哪一类设置？',
                ...scopeItems
            );

            if (!scopeChoice || scopeChoice === '暂不使用') {
                return;
            }

            const wizardChoice = await vscode.window.showInformationMessage(
                `${scopeChoice}已选择。是否现在打开设置向导？`,
                '打开向导',
                '不使用'
            );

            if (wizardChoice !== '打开向导') {
                return;
            }

            const scope = scopeChoice === '全局设置' ? 'global' : 'workspace';
            await this._panel.webview.postMessage({
                command: 'openSettingsWizard',
                scope
            });
        } finally {
            this._wizardPromptInFlight = false;
        }
    }
}

export function registerQuickSettingsPage(context: vscode.ExtensionContext): vscode.Disposable {
    const command = vscode.commands.registerCommand('andrea.openGraphicalQuickSettings', async () => {
        QuickSettingsPanel.createOrShow(context);
    });

    context.subscriptions.push(command);

    const serializer = vscode.window.registerWebviewPanelSerializer('quickSettings', {
        async deserializeWebviewPanel(panel: vscode.WebviewPanel, _state: unknown) {
            QuickSettingsPanel.revive(panel, context);
        }
    });
    context.subscriptions.push(serializer);

    return command;
}
