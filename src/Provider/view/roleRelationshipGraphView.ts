import * as vscode from 'vscode';
import { roles } from '../../activate';
import { createRoleRelationshipGraphDataProvider } from '../../data/roleRelationshipGraphDataProvider';
import { buildHtml } from '../utils/html-builder';
import { setWebviewPanelIcon } from '../utils/webviewPanelIcon';

const viewType = 'andrea.roleRelationshipGraph';

export class RoleRelationshipGraphPanel {
    private static instance: RoleRelationshipGraphPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private readonly disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.extensionUri = extensionUri;

        this.update();

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            async message => {
                switch (message?.command) {
                    case 'roleRelationshipGraph.ready':
                    case 'roleRelationshipGraph.refresh':
                        await this.postGraphData();
                        break;
                    case 'roleRelationshipGraph.openSource':
                        await this.openSource(message.sourcePath);
                        break;
                }
            },
            null,
            this.disposables,
        );
    }

    public static createOrShow(extensionUri: vscode.Uri): RoleRelationshipGraphPanel {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Beside;
        if (RoleRelationshipGraphPanel.instance) {
            RoleRelationshipGraphPanel.instance.panel.reveal(column);
            void RoleRelationshipGraphPanel.instance.postGraphData();
            return RoleRelationshipGraphPanel.instance;
        }

        const panel = vscode.window.createWebviewPanel(
            viewType,
            '角色关系图谱',
            column,
            RoleRelationshipGraphPanel.getWebviewOptions(extensionUri),
        );
        setWebviewPanelIcon(panel, extensionUri.fsPath, 'graph');

        RoleRelationshipGraphPanel.instance = new RoleRelationshipGraphPanel(panel, extensionUri);
        return RoleRelationshipGraphPanel.instance;
    }

    public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): RoleRelationshipGraphPanel {
        panel.webview.options = RoleRelationshipGraphPanel.getWebviewOptions(extensionUri);
        panel.title = '角色关系图谱';
        setWebviewPanelIcon(panel, extensionUri.fsPath, 'graph');
        RoleRelationshipGraphPanel.instance = new RoleRelationshipGraphPanel(panel, extensionUri);
        return RoleRelationshipGraphPanel.instance;
    }

    private static getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewPanelOptions & vscode.WebviewOptions {
        const workspaceRoots = vscode.workspace.workspaceFolders?.map(folder => folder.uri) ?? [];
        return {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.joinPath(extensionUri, 'packages', 'webview', 'dist', 'spa'),
                vscode.Uri.joinPath(extensionUri, 'packages', 'webview', 'dist', 'spa', 'assets'),
                vscode.Uri.joinPath(extensionUri, 'media'),
                ...workspaceRoots,
            ],
        };
    }

    private update(): void {
        let resourceMapperScriptUri: string | undefined;
        try {
            const mapperFile = vscode.Uri.joinPath(this.extensionUri, 'media', 'resource-mapper.js');
            resourceMapperScriptUri = this.panel.webview.asWebviewUri(mapperFile).toString();
        } catch (_) { }

        this.panel.webview.html = buildHtml(this.panel.webview, {
            spaRoot: vscode.Uri.joinPath(this.extensionUri, 'packages', 'webview', 'dist', 'spa'),
            connectSrc: ['https:', 'http:', 'ws:', 'wss:'],
            resourceMapperScriptUri,
            route: '/role-relationship-graph',
            editorTitle: '角色关系图谱',
        });
    }

    private async postGraphData(): Promise<void> {
        try {
            const provider = createRoleRelationshipGraphDataProvider(roles);
            await this.panel.webview.postMessage({
                command: 'roleRelationshipGraph.data',
                data: provider.getGraphData(),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.panel.webview.postMessage({
                command: 'roleRelationshipGraph.error',
                message,
            });
            vscode.window.showErrorMessage(`角色关系图谱加载失败: ${message}`);
        }
    }

    private async openSource(sourcePath: unknown): Promise<void> {
        if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
            return;
        }
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
        await vscode.window.showTextDocument(doc, { preview: false });
    }

    public dispose(): void {
        RoleRelationshipGraphPanel.instance = undefined;
        while (this.disposables.length) {
            this.disposables.pop()?.dispose();
        }
    }
}

export function registerRoleRelationshipGraphView(context: vscode.ExtensionContext): vscode.Disposable {
    const command = vscode.commands.registerCommand('andrea.openRoleRelationshipGraph', async () => {
        RoleRelationshipGraphPanel.createOrShow(context.extensionUri);
    });

    const serializer = vscode.window.registerWebviewPanelSerializer(viewType, {
        async deserializeWebviewPanel(panel: vscode.WebviewPanel, _state: unknown) {
            RoleRelationshipGraphPanel.revive(panel, context.extensionUri);
        },
    });

    context.subscriptions.push(command, serializer);
    return command;
}
