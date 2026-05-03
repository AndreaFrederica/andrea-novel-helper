import * as vscode from 'vscode';
import { buildHtml } from '../Provider/utils/html-builder';
import { getWhatsNewData, getAllWhatsNewVersions } from './whatsnew-data';
import type { WhatsNewData, WhatsNewVersionInfo } from './whatsnew-data';

export class WhatsNewPanel {
    private static _instance: WhatsNewPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _extensionPath: string;
    private _disposables: vscode.Disposable[] = [];
    private _currentVersion: string;
    private _allVersions: WhatsNewVersionInfo[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, extensionPath: string, currentVersion: string) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._extensionPath = extensionPath;
        this._currentVersion = currentVersion;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                if (message.command === 'whatsnewReady') {
                    // 前端已准备好，发送版本列表和当前版本数据
                    this._allVersions = getAllWhatsNewVersions(this._extensionPath);
                    const data = getWhatsNewData(this._extensionPath, this._currentVersion);
                    this._panel.webview.postMessage({
                        command: 'initData',
                        currentVersion: this._currentVersion,
                        versions: this._allVersions,
                        data
                    });
                    return;
                }
                if (message.command === 'loadVersion') {
                    const version = message.version as string;
                    const data = getWhatsNewData(this._extensionPath, version);
                    this._panel.webview.postMessage({
                        command: 'setChangelog',
                        data
                    });
                    return;
                }
                if (message.command === 'openSettings') {
                    await vscode.commands.executeCommand('workbench.action.openSettings', 'AndreaNovelHelper.whatsNew.autoShow');
                    return;
                }
                if (message.command === 'closePanel') {
                    this._panel.dispose();
                    return;
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

    public static createOrShow(extensionUri: vscode.Uri, currentVersion: string, extensionPath: string): WhatsNewPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (WhatsNewPanel._instance) {
            WhatsNewPanel._instance._panel.reveal(column);
            WhatsNewPanel._instance._currentVersion = currentVersion;
            // 重新发送数据
            WhatsNewPanel._instance._allVersions = getAllWhatsNewVersions(extensionPath);
            const data = getWhatsNewData(extensionPath, currentVersion);
            WhatsNewPanel._instance._panel.webview.postMessage({
                command: 'initData',
                currentVersion,
                versions: WhatsNewPanel._instance._allVersions,
                data
            });
            return WhatsNewPanel._instance;
        }

        const panel = vscode.window.createWebviewPanel(
            'whatsNew',
            "What's New",
            column || vscode.ViewColumn.One,
            WhatsNewPanel.getWebviewOptions(extensionUri)
        );

        WhatsNewPanel._instance = new WhatsNewPanel(panel, extensionUri, extensionPath, currentVersion);
        return WhatsNewPanel._instance;
    }

    public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, extensionPath: string): WhatsNewPanel {
        panel.webview.options = WhatsNewPanel.getWebviewOptions(extensionUri);
        panel.title = "What's New";
        const currentVersion = 'unknown';
        WhatsNewPanel._instance = new WhatsNewPanel(panel, extensionUri, extensionPath, currentVersion);
        return WhatsNewPanel._instance;
    }

    private _update() {
        const webview = this._panel.webview;

        let resourceMapperScriptUri: string | undefined;
        try {
            const mapperFile = vscode.Uri.joinPath(this._extensionUri, 'media', 'resource-mapper.js');
            resourceMapperScriptUri = webview.asWebviewUri(mapperFile).toString();
        } catch (_) { /* empty */ }

        this._panel.webview.html = buildHtml(webview, {
            spaRoot: vscode.Uri.joinPath(this._extensionUri, 'packages', 'webview', 'dist', 'spa'),
            connectSrc: ['https:', 'http:', 'ws:', 'wss:'],
            resourceMapperScriptUri,
            route: '/whats-new',
            editorTitle: "What's New"
        });
    }

    public dispose() {
        WhatsNewPanel._instance = undefined;
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
        this._panel.dispose();
    }
}

export function registerWhatsNewPage(context: vscode.ExtensionContext): vscode.Disposable {
    const command = vscode.commands.registerCommand('andrea.openWhatsNew', async () => {
        const { getWhatsNewData } = await import('./whatsnew-data.js');
        const { getExtensionVersion } = await import('./version-check.js');
        const version = getExtensionVersion(context);
        const data = getWhatsNewData(context.extensionPath, version);
        if (data) {
            WhatsNewPanel.createOrShow(context.extensionUri, version, context.extensionPath);
        } else {
            vscode.window.showInformationMessage('未找到当前版本的更新日志。');
        }
    });
    context.subscriptions.push(command);

    const serializer = vscode.window.registerWebviewPanelSerializer('whatsNew', {
        async deserializeWebviewPanel(panel: vscode.WebviewPanel, _state: unknown) {
            WhatsNewPanel.revive(panel, context.extensionUri, context.extensionPath);
        }
    });
    context.subscriptions.push(serializer);

    return command;
}
