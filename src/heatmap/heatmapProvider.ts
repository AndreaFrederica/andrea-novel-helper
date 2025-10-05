import * as vscode from 'vscode';
import { buildHtml } from '../Provider/utils/html-builder';

// 导入 Circle Packing 数据提供器类型
import type { CirclePackingDataProvider } from '../data/circlePackingDataProvider';

// 使用内联数据来避免模块系统不匹配的问题
const defaultRoleDocumentAppearances = [
  {
    roleId: 'role-1',
    roleName: '主角',
    roleType: '主角',
    documentAppearances: [
      { documentId: 'file-1', documentName: '序章：黎明之前', count: 15 },
      { documentId: 'file-2', documentName: '第一章：初遇', count: 42 },
      { documentId: 'file-3', documentName: '第二章：谜团', count: 38 },
      { documentId: 'file-4', documentName: '第三章：转折', count: 35 },
      { documentId: 'file-5', documentName: '第四章：危机', count: 48 },
      { documentId: 'file-6', documentName: '第五章：联盟', count: 52 },
      { documentId: 'file-7', documentName: '第六章：真相', count: 45 },
      { documentId: 'file-8', documentName: '第七章：决战', count: 58 },
      { documentId: 'file-9', documentName: '第八章：结局', count: 40 },
      { documentId: 'file-10', documentName: '尾声：新的开始', count: 25 }
    ]
  },
  {
    roleId: 'role-2',
    roleName: '配角A',
    roleType: '配角',
    documentAppearances: [
      { documentId: 'file-1', documentName: '序章：黎明之前', count: 5 },
      { documentId: 'file-2', documentName: '第一章：初遇', count: 12 },
      { documentId: 'file-3', documentName: '第二章：谜团', count: 18 },
      { documentId: 'file-4', documentName: '第三章：转折', count: 15 },
      { documentId: 'file-5', documentName: '第四章：危机', count: 22 },
      { documentId: 'file-6', documentName: '第五章：联盟', count: 20 },
      { documentId: 'file-7', documentName: '第六章：真相', count: 25 },
      { documentId: 'file-8', documentName: '第七章：决战', count: 30 },
      { documentId: 'file-9', documentName: '第八章：结局', count: 18 },
      { documentId: 'file-10', documentName: '尾声：新的开始', count: 8 }
    ]
  },
  {
    roleId: 'role-3',
    roleName: '反派',
    roleType: '反派',
    documentAppearances: [
      { documentId: 'file-1', documentName: '序章：黎明之前', count: 3 },
      { documentId: 'file-2', documentName: '第一章：初遇', count: 0 },
      { documentId: 'file-3', documentName: '第二章：谜团', count: 8 },
      { documentId: 'file-4', documentName: '第三章：转折', count: 12 },
      { documentId: 'file-5', documentName: '第四章：危机', count: 18 },
      { documentId: 'file-6', documentName: '第五章：联盟', count: 15 },
      { documentId: 'file-7', documentName: '第六章：真相', count: 22 },
      { documentId: 'file-8', documentName: '第七章：决战', count: 35 },
      { documentId: 'file-9', documentName: '第八章：结局', count: 10 },
      { documentId: 'file-10', documentName: '尾声：新的开始', count: 0 }
    ]
  }
];

export class HeatmapProvider {
    private panels: Map<string, vscode.WebviewPanel> = new Map();
    private circlePackingDataProvider?: CirclePackingDataProvider;

    constructor(private readonly context: vscode.ExtensionContext) {}

    // 设置 Circle Packing 数据提供器
    public setCirclePackingDataProvider(provider: CirclePackingDataProvider) {
        this.circlePackingDataProvider = provider;
    }

    public showHeatmap() {
        const panel = vscode.window.createWebviewPanel(
            'roleHeatmap',
            '角色引用热力图',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, 'packages', 'webview', 'dist', 'spa'),
                    vscode.Uri.joinPath(this.context.extensionUri, 'media')
                ]
            }
        );

        // 设置 resourceMapperScriptUri
        let resourceMapperScriptUri: string | undefined;
        try {
            const mapperFile = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'resource-mapper.js');
            resourceMapperScriptUri = panel.webview.asWebviewUri(mapperFile).toString();
        } catch (_) { }

        // 使用 buildHtml 函数构建 HTML，指定路由到气泡图页面
        panel.webview.html = buildHtml(panel.webview, {
            spaRoot: vscode.Uri.joinPath(this.context.extensionUri, 'packages', 'webview', 'dist', 'spa'),
            connectSrc: ['https:', 'http:', 'ws:', 'wss:'],
            resourceMapperScriptUri,
            route: '/circle-packing', // 路由到气泡图页面
            editorTitle: '角色引用热力图'
        });

        panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'requestData':
                        this.sendData(panel);
                        break;
                    case 'executeCommand':
                        // 处理前端通过 vscode API 发送的命令执行请求
                        if (message.args && Array.isArray(message.args) && message.args.length > 0) {
                            const commandName = message.args[0];
                            console.log('[HeatmapProvider] Executing command:', commandName);
                            
                            try {
                                // 处理 Circle Packing 相关命令
                                if (commandName.startsWith('AndreaNovelHelper.circlePacking.')) {
                                    await this.handleCirclePackingCommand(commandName, panel);
                                } else {
                                    // 执行其他命令
                                    await vscode.commands.executeCommand(commandName);
                                }
                            } catch (error) {
                                console.error('[HeatmapProvider] Command execution failed:', error);
                                panel.webview.postMessage({
                                    command: 'commandError',
                                    error: error instanceof Error ? error.message : String(error)
                                });
                            }
                        }
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );

        panel.onDidDispose(() => {
            this.panels.delete('roleHeatmap');
        });

        this.panels.set('roleHeatmap', panel);
    }

    private sendData(panel: vscode.WebviewPanel) {
        // 发送角色引用数据到前端
        panel.webview.postMessage({
            command: 'updateData',
            data: defaultRoleDocumentAppearances
        });
    }

    private async handleCirclePackingCommand(commandName: string, panel: vscode.WebviewPanel) {
        if (!this.circlePackingDataProvider) {
            console.error('[HeatmapProvider] Circle Packing data provider not set');
            panel.webview.postMessage({
                command: 'commandError',
                error: 'Circle Packing data provider not initialized'
            });
            return;
        }

        try {
            switch (commandName) {
                case 'AndreaNovelHelper.circlePacking.getCompleteDataset': {
                    // 使用进度提示避免用户误以为卡死
                    const provider = this.circlePackingDataProvider;
                    const completeData = await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: '正在加载角色引用数据...',
                        cancellable: false
                    }, async (progress) => {
                        progress.report({ increment: 0, message: '获取文件列表...' });
                        const data = await provider!.getCompleteDataset();
                        progress.report({ increment: 100, message: '完成' });
                        return data;
                    });
                    
                    panel.webview.postMessage({
                        command: 'circlePackingData',
                        data: completeData
                    });
                    console.log('[HeatmapProvider] Sent complete dataset to webview');
                    break;
                }
                case 'AndreaNovelHelper.circlePacking.getRoleReferenceData': {
                    const dataset = await this.circlePackingDataProvider.getRoleReferenceDataset();
                    panel.webview.postMessage({
                        command: 'roleReferenceData',
                        data: dataset
                    });
                    break;
                }
                case 'AndreaNovelHelper.circlePacking.getFileTimelineData': {
                    const timeline = await this.circlePackingDataProvider.getFileTimelineData();
                    panel.webview.postMessage({
                        command: 'fileTimelineData',
                        data: timeline
                    });
                    break;
                }
                case 'AndreaNovelHelper.circlePacking.exportToJson': {
                    const json = await this.circlePackingDataProvider.exportToJson();
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const fileName = `circle-packing-data-${timestamp}.json`;
                    
                    const uri = await vscode.window.showSaveDialog({
                        defaultUri: vscode.Uri.file(fileName),
                        filters: {
                            'JSON Files': ['json']
                        }
                    });
                    
                    if (uri) {
                        await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf8'));
                        vscode.window.showInformationMessage(`数据已导出到: ${uri.fsPath}`);
                    }
                    break;
                }
                default:
                    console.warn('[HeatmapProvider] Unknown Circle Packing command:', commandName);
            }
        } catch (error) {
            console.error('[HeatmapProvider] Circle Packing command failed:', error);
            panel.webview.postMessage({
                command: 'commandError',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
}

// -------------------- 打开热力图面板 --------------------
let heatmapProvider: HeatmapProvider | undefined;

async function openHeatmapPanel(context: vscode.ExtensionContext, circlePackingDataProvider?: CirclePackingDataProvider) {
    // 如果已存在 provider，尝试复用现有面板
    if (heatmapProvider) {
        // 更新数据提供器
        if (circlePackingDataProvider) {
            heatmapProvider.setCirclePackingDataProvider(circlePackingDataProvider);
        }
        
        const existingPanel = heatmapProvider['panels'].get('roleHeatmap');
        if (existingPanel) {
            try {
                existingPanel.reveal(vscode.ViewColumn.Beside, true);
                return;
            } catch (error) {
                // 面板已被销毁，清理引用
                heatmapProvider['panels'].delete('roleHeatmap');
            }
        }
    }

    // 创建新的 provider 和面板
    if (!heatmapProvider) {
        heatmapProvider = new HeatmapProvider(context);
        if (circlePackingDataProvider) {
            heatmapProvider.setCirclePackingDataProvider(circlePackingDataProvider);
        }
    }
    heatmapProvider.showHeatmap();
}

// -------------------- 激活/反激活 --------------------
export function activateHeatmap(context: vscode.ExtensionContext, circlePackingDataProvider?: CirclePackingDataProvider) {
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.openRoleHeatmap', async () => {
            try {
                await openHeatmapPanel(context, circlePackingDataProvider);
            } catch (error) {
                console.error('打开角色引用热力图失败:', error);
                vscode.window.showErrorMessage('无法打开角色引用热力图');
            }
        })
    );

    // 注册反序列化器：支持VS Code重启后恢复面板
    if (vscode.window.registerWebviewPanelSerializer) {
        const serializer = {
            async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: any) {
                panel.title = '角色引用热力图';
                
                // 重新创建 provider 并关联面板
                if (!heatmapProvider) {
                    heatmapProvider = new HeatmapProvider(context);
                    if (circlePackingDataProvider) {
                        heatmapProvider.setCirclePackingDataProvider(circlePackingDataProvider);
                    }
                } else if (circlePackingDataProvider) {
                    heatmapProvider.setCirclePackingDataProvider(circlePackingDataProvider);
                }
                
                // 设置面板的webview内容
                panel.webview.options = {
                    enableScripts: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(context.extensionUri, 'packages', 'webview', 'dist', 'spa'),
                        vscode.Uri.joinPath(context.extensionUri, 'media')
                    ]
                };
                
                // 设置 resourceMapperScriptUri
                let resourceMapperScriptUri: string | undefined;
                try {
                    const mapperFile = vscode.Uri.joinPath(context.extensionUri, 'media', 'resource-mapper.js');
                    resourceMapperScriptUri = panel.webview.asWebviewUri(mapperFile).toString();
                } catch (_) { }

                // 使用 buildHtml 函数构建 HTML
                panel.webview.html = buildHtml(panel.webview, {
                    spaRoot: vscode.Uri.joinPath(context.extensionUri, 'packages', 'webview', 'dist', 'spa'),
                    connectSrc: ['https:', 'http:', 'ws:', 'wss:'],
                    resourceMapperScriptUri,
                    route: '/circle-packing',
                    editorTitle: '角色引用热力图'
                });
                
                // 注册面板事件
                panel.onDidDispose(() => {
                    heatmapProvider?.['panels'].delete('roleHeatmap');
                });
                
                // 将面板添加到 provider
                heatmapProvider['panels'].set('roleHeatmap', panel);
                
                // 发送数据
                heatmapProvider['sendData'](panel);
            }
        } as vscode.WebviewPanelSerializer;
        
        context.subscriptions.push(
            vscode.window.registerWebviewPanelSerializer('roleHeatmap', serializer)
        );
    }
}

export function deactivateHeatmap() {
    if (heatmapProvider) {
        const panel = heatmapProvider['panels'].get('roleHeatmap');
        if (panel) {
            panel.dispose();
        }
        heatmapProvider = undefined;
    }
}