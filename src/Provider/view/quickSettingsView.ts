import * as vscode from 'vscode';
import { buildHtml } from '../utils/html-builder';
import { SettingsWebviewProvider } from './settingView';

type SettingsWizardScope = 'workspace' | 'global';

interface QuickSettingsPanelOptions {
    openWizardScope?: SettingsWizardScope;
    suppressVersionPrompt?: boolean;
}

const FIRST_USE_WIZARD_PROMPT_KEY = 'andrea.settingsWizard.firstUsePrompted';

export class QuickSettingsPanel {
    private static _instance: QuickSettingsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _context: vscode.ExtensionContext;
    private _disposables: vscode.Disposable[] = [];
    private _settingsProvider?: SettingsWebviewProvider;
    private _wizardPromptInFlight = false;
    private _settingsReady = false;
    private _pendingWizardScope?: SettingsWizardScope;
    private _suppressVersionPrompt = false;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext, options: QuickSettingsPanelOptions = {}) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._context = context;
        this._pendingWizardScope = options.openWizardScope;
        this._suppressVersionPrompt = options.suppressVersionPrompt === true;

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
                    this._settingsReady = true;
                    if (this._pendingWizardScope) {
                        void this._postOpenSettingsWizard(this._pendingWizardScope);
                    } else if (!this._suppressVersionPrompt) {
                        void this._maybePromptSettingsWizard();
                    }
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

    public static createOrShow(context: vscode.ExtensionContext, options: QuickSettingsPanelOptions = {}): QuickSettingsPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (QuickSettingsPanel._instance) {
            QuickSettingsPanel._instance._panel.reveal(column);
            QuickSettingsPanel._instance.applyOptions(options);
            return QuickSettingsPanel._instance;
        }

        const panel = vscode.window.createWebviewPanel(
            'quickSettings',
            '图形化快速设置',
            column || vscode.ViewColumn.One,
            QuickSettingsPanel.getWebviewOptions(context.extensionUri)
        );

        QuickSettingsPanel._instance = new QuickSettingsPanel(panel, context.extensionUri, context, options);
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

    public applyOptions(options: QuickSettingsPanelOptions) {
        if (options.suppressVersionPrompt === true) {
            this._suppressVersionPrompt = true;
        }
        if (options.openWizardScope) {
            this._pendingWizardScope = options.openWizardScope;
            if (this._settingsReady) {
                void this._postOpenSettingsWizard(options.openWizardScope);
            }
        }
    }

    private async _maybePromptSettingsWizard() {
        if (this._wizardPromptInFlight) {
            return;
        }

        if (this._context.globalState.get<boolean>(getVersionPromptKey(this._context)) === true) {
            return;
        }

        this._wizardPromptInFlight = true;
        await markSettingsWizardPrompted(this._context);

        try {
            const scope = await pickSettingsWizardScope('首次打开本版本的图形化快速设置。设置向导要先调整哪一类设置？');
            if (!scope) {
                return;
            }

            const wizardChoice = await vscode.window.showInformationMessage(
                '是否现在打开设置向导？向导第一页即可取消退出，不会自动保存任何设置。',
                { modal: true },
                '打开向导',
                '暂不使用'
            );
            if (wizardChoice === '打开向导') {
                await this._postOpenSettingsWizard(scope);
            }
        } finally {
            this._wizardPromptInFlight = false;
        }
    }

    private async _postOpenSettingsWizard(scope: SettingsWizardScope) {
        this._pendingWizardScope = undefined;
        await this._panel.webview.postMessage({
            command: 'openSettingsWizard',
            scope
        });
    }
}

function getVersionPromptKey(context: vscode.ExtensionContext): string {
    const version = String(context.extension.packageJSON?.version ?? 'unknown');
    return `andrea.quickSettings.settingsWizardPrompted.${version}`;
}

async function markSettingsWizardPrompted(context: vscode.ExtensionContext) {
    await context.globalState.update(getVersionPromptKey(context), true);
}

async function pickSettingsWizardScope(message: string): Promise<SettingsWizardScope | undefined> {
    const hasWorkspace = Boolean(vscode.workspace.workspaceFolders?.length);
    if (!hasWorkspace) {
        const choice = await vscode.window.showInformationMessage(
            `${message}当前没有打开工作区，只能写入全局设置。`,
            { modal: true },
            '全局设置',
            '暂不使用'
        );
        return choice === '全局设置' ? 'global' : undefined;
    }

    const choice = await vscode.window.showInformationMessage(
        message,
        { modal: true },
        '项目设置',
        '全局设置',
        '暂不使用'
    );
    if (choice === '项目设置') {
        return 'workspace';
    }
    if (choice === '全局设置') {
        return 'global';
    }
    return undefined;
}

export async function maybePromptFirstUseSettingsWizard(context: vscode.ExtensionContext): Promise<void> {
    if (context.globalState.get<boolean>(FIRST_USE_WIZARD_PROMPT_KEY) === true) {
        return;
    }

    await context.globalState.update(FIRST_USE_WIZARD_PROMPT_KEY, true);
    await markSettingsWizardPrompted(context);

    const scope = await pickSettingsWizardScope('首次使用 Andrea Novel Helper。设置向导要先调整哪一类设置？');
    if (!scope) {
        return;
    }

    const wizardChoice = await vscode.window.showInformationMessage(
        '是否现在打开设置向导？向导第一页即可取消退出，不会自动保存任何设置。',
        { modal: true },
        '打开向导',
        '暂不使用'
    );
    if (wizardChoice !== '打开向导') {
        return;
    }

    QuickSettingsPanel.createOrShow(context, {
        openWizardScope: scope,
        suppressVersionPrompt: true
    });
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
