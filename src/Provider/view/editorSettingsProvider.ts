import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { buildHtml } from '../utils/html-builder';
import { log } from 'console';
import { getTranslation } from '../../utils/i18n';

export class EditorSettingsWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'andrea.editorSettingsView';

    private _view?: vscode.WebviewView;
    private _context: vscode.ExtensionContext;
    private _scope: 'workspace' | 'global' = 'workspace';
    private _externalWebview?: vscode.Webview;

    private _logChannel = vscode.window.createOutputChannel('Andrea Novel Helper:EditorSettings');

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._context.extensionUri, 'packages', 'webview', 'dist', 'spa'),
                vscode.Uri.joinPath(this._context.extensionUri, 'packages', 'webview', 'dist', 'spa', 'assets'),
                vscode.Uri.joinPath(this._context.extensionUri, 'media')
            ]
        };

        // 设置 resourceMapperScriptUri
        let resourceMapperScriptUri: string | undefined;
        try {
            const mapperFile = vscode.Uri.joinPath(this._context.extensionUri, 'media', 'resource-mapper.js');
            resourceMapperScriptUri = webviewView.webview.asWebviewUri(mapperFile).toString();
        } catch (_) { }

        // 使用 buildHtml 函数构建 HTML，指定路由到编辑器设置页面
        webviewView.webview.html = buildHtml(webviewView.webview, {
            spaRoot: vscode.Uri.joinPath(this._context.extensionUri, 'packages', 'webview', 'dist', 'spa'),
            connectSrc: ['https:', 'http:', 'ws:', 'wss:'],
            resourceMapperScriptUri,
            route: '/editor-settings-enhanced',
            editorTitle: '编辑器设置'
        });

        // 处理来自webview的消息
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'getSettings':
                    this._handleGetSettings();
                    break;
                case 'updateSetting':
                    this._handleUpdateSetting(message.key, message.value);
                    break;
                case 'saveSettings':
                    this._handleSaveSettings(message.settings);
                    break;
                case 'jumpToSettings':
                    this._handleJumpToSettings(message.key);
                    break;
                case 'setScope':
                    this._handleSetScope(message.scope);
                    break;
                case 'searchSettings':
                    this._handleSearchSettings(message.query);
                    break;
            }
        });
    }

    private _handleGetSettings() {
        // 使用新的buildSettings方法动态生成配置
        const settingsData = this.buildSettings();

        this._postMessage({
            command: 'settingsData',
            data: settingsData
        });
    }

    private async _handleUpdateSetting(key: string, value: any) {
        try {
            const config = vscode.workspace.getConfiguration();
            const target = this._scope === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
            await config.update(key, value, target);

            // 发送消息给 webview 以保持兼容性
            this._postMessage({
                command: 'settingUpdated',
                key: key,
                value: value
            });
        } catch (error) {
            console.error('Failed to update setting:', error);

            // 使用 VS Code 原生通知显示更新失败
            vscode.window.showErrorMessage(`更新设置失败: ${key} - ${error}`, '重试', '忽略').then(selection => {
                if (selection === '重试') {
                    // 用户选择重试，重新调用更新方法
                    this._handleUpdateSetting(key, value);
                }
            });

            // 仍然发送错误消息以保持兼容性
            this._postMessage({
                command: 'error',
                message: `Failed to update setting: ${error}`
            });
        }
    }

    private async _handleSaveSettings(settings: any) {
        try {
            const config = vscode.workspace.getConfiguration();
            const target = this._scope === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;

            // 验证并保存每个设置项
            for (const [key, value] of Object.entries(settings)) {
                // 验证键名是否有效（以AndreaNovelHelper开头） 或者以andrea开头
                if (!key.startsWith('AndreaNovelHelper') && !key.startsWith('andrea') && !key.startsWith('editor.')) {
                    console.warn(`跳过无效的配置键: ${key}`);
                    continue;
                }

                // 获取配置检查信息以验证值类型
                const inspection = config.inspect(key);
                if (inspection) {
                    // 这里可以添加类型验证逻辑
                    await config.update(key, value, target);
                } else {
                    console.warn(`配置键不存在，跳过: ${key}`);
                }
            }

            // 使用 VS Code 原生通知显示保存成功
            vscode.window.showInformationMessage('设置已保存', '确定').then(selection => {
                // 用户点击确定按钮的处理（可选）
                if (selection === '确定') {
                    console.log('用户确认保存成功');
                }
            });

            // 仍然发送消息以保持兼容性
            this._postMessage({
                command: 'settingsSaved',
                message: '设置已保存'
            });
        } catch (error) {
            console.error('Failed to save settings:', error);

            // 使用 VS Code 原生通知显示保存失败
            vscode.window.showErrorMessage(`保存设置失败: ${error}`, '重试', '忽略').then(selection => {
                if (selection === '重试') {
                    // 用户选择重试，重新调用保存方法
                    this._handleSaveSettings(settings);
                }
                // 忽略选项不做任何处理
            });

            // 仍然发送错误消息以保持兼容性
            this._postMessage({
                command: 'error',
                message: `Failed to save settings: ${error}`
            });
        }
    }

    private async _handleJumpToSettings(key: string) {
        try {
            // 使用 VS Code 的命令来打开设置 UI 并搜索特定配置
            await vscode.commands.executeCommand('workbench.action.openSettings', key);

            // 显示成功消息
            vscode.window.showInformationMessage(`已跳转到设置: ${key}`, '确定').then(selection => {
                if (selection === '确定') {
                    console.log(`用户确认跳转成功: ${key}`);
                }
            });
        } catch (error) {
            console.error('Failed to jump to settings:', error);

            // 显示错误消息
            vscode.window.showErrorMessage(`跳转到设置失败: ${key} - ${error}`, '重试', '忽略').then(selection => {
                if (selection === '重试') {
                    // 用户选择重试，重新调用跳转方法
                    this._handleJumpToSettings(key);
                }
            });

            // 仍然发送错误消息以保持兼容性
            this._postMessage({
                command: 'error',
                message: `Failed to jump to settings: ${error}`
            });
        }
    }

    private _handleSetScope(scope: 'workspace' | 'global') {
        this._scope = scope;
        // 重新获取设置以应用新作用域
        this._handleGetSettings();
    }

    private _handleSearchSettings(query: string) {
        // 在当前实现中，搜索功能在前端处理
        // 如果需要后端搜索支持，可以在这里实现
        console.log('Search query:', query);
    }

    private buildSettings() {
        // 获取所有配置属性及其schema
        const allConfigs = this.getAllContributionConfigurations();
        const config = vscode.workspace.getConfiguration();
        // 按section分组的配置项
        const sectionMap = new Map<string, any[]>();
        const configItems: any[] = [];

        // 根据当前作用域获取配置值
        const getConfigValue = (key: string) => {
            const inspection = config.inspect(key);
            if (this._scope === 'workspace') {
                return inspection?.workspaceValue !== undefined ? inspection.workspaceValue : inspection?.defaultValue;
            } else {
                return inspection?.globalValue !== undefined ? inspection.globalValue : inspection?.defaultValue;
            }
        };

        // 处理每个配置项
        allConfigs.forEach(configData => {
            const { key, schema } = configData;

            // 计算点的数量
            const dotCount = (key.match(/\./g) || []).length;
            let section: string;
            let name: string;

            if (key.startsWith('editor.')) {
                section = 'editor';
                name = key.substring('editor.'.length);
            } else if (dotCount >= 2) {
                // 两个或两个以上.的情况：保留xxx.xxxx为section名称
                const firstDotIndex = key.indexOf('.');
                const secondDotIndex = key.indexOf('.', firstDotIndex + 1);
                section = key.substring(0, secondDotIndex);
                name = key.substring(secondDotIndex + 1);
            } else if (dotCount === 1) {
                // 只有一个.的情况：分为other section
                const dotIndex = key.indexOf('.');
                section = 'other';
                name = key.substring(dotIndex + 1);
            } else {
                // 没有.的情况：分为other section
                section = 'other';
                name = key;
            }

            // 获取配置值和元数据
            const value = getConfigValue(key);

            // 从schema中获取约束信息
            const type = schema.type ;
            const description = this.getConfigl10n(schema.markdownDescription?schema.markdownDescription: schema.description);
            const minimum = schema.minimum ;
            const maximum = schema.maximum ;
            const enumValues = schema.enum ;
            const enumDescriptions = schema.enumDescriptions ;

            // 构建配置项
            const configItem = {
                id: key,
                type: type,
                section: section,
                quickSetting: this.isQuickSetting(key),
                name: this.getConfigl10n(schema.anhName || name) , // 如果name为空，使用整个key作为name
                description: description,
                value: value,
                defaultValue: schema.default,
                minimum: minimum,
                maximum: maximum,
                enum: enumValues,
                enumDescriptions: enumDescriptions
            };

            configItems.push(configItem);

            // 按section分组
            if (!sectionMap.has(section)) {
                sectionMap.set(section, []);
            }
            sectionMap.get(section)!.push(configItem);
        });

        // 构建sections
        const sections = Array.from(sectionMap.keys()).map(sectionId => ({
            id: sectionId,
            name: this.formatSectionName(sectionId)
        }));
        return {
            configItems,
            sections,
            currentScope: this._scope
        };
    }

    private isQuickSetting(key: string): boolean {
        // 定义快速设置项的键列表
        const quickSettingKeys = [
            // 1. 排版相关配置
            'andrea.typeset.blankLinesBetweenParas',
            'andrea.typeset.indentFirstTwoSpaces',
            'andrea.typeset.trimTrailingSpaces',
            'andrea.typeset.enableAutoPairs',
            'andrea.typeset.enableSmartEnter',
            'andrea.typeset.enableSmartExit',
            'andrea.typeset.statusBar.compact',

            // 2. VS Code 编辑器配置
            'editor.wordWrap',
            'editor.wrappingIndent',
            'editor.minimap.enabled',
            'editor.mouseWheelZoom',
            'editor.insertSpaces',
            'editor.tabSize',
            'editor.detectIndentation',
            'editor.fontSize',
            'editor.fontFamily',

            // 3. 字数统计配置
            'AndreaNovelHelper.wordCount.primaryUnit',
            'AndreaNovelHelper.wordCount.statusBar.speedUnit',
            'AndreaNovelHelper.wordCount.statusBar.mode',
            'AndreaNovelHelper.wordCount.statusBar.compact',

            // 4. 时间统计配置
            'AndreaNovelHelper.timeStats.includePaste',
            'AndreaNovelHelper.timeStats.milestone.enabled',
            'AndreaNovelHelper.timeStats.milestone.targets',
            'AndreaNovelHelper.timeStats.milestone.notificationType',

            // 5. 角色显示配置 - 当前文章角色（docRoles）
            'AndreaNovelHelper.docRoles.groupBy',
            'AndreaNovelHelper.docRoles.respectAffiliation',
            'AndreaNovelHelper.docRoles.respectType',
            'AndreaNovelHelper.docRoles.primaryGroup',
            'AndreaNovelHelper.docRoles.useCustomGroups',
            'AndreaNovelHelper.docRoles.display.useRoleSvgIfPresent',
            'AndreaNovelHelper.docRoles.display.colorizeRoleName',
            'AndreaNovelHelper.docRoles.customGroups',

            // 5. 角色显示配置 - 全部角色（allRoles）
            'AndreaNovelHelper.allRoles.syncWithDocRoles',
            'AndreaNovelHelper.allRoles.groupBy',
            'AndreaNovelHelper.allRoles.respectAffiliation',
            'AndreaNovelHelper.allRoles.respectType',
            'AndreaNovelHelper.allRoles.primaryGroup',
            'AndreaNovelHelper.allRoles.useCustomGroups',
            'AndreaNovelHelper.allRoles.display.colorizeRoleName',
            'AndreaNovelHelper.allRoles.customGroups',

            // 5. 角色显示配置 - 角色详情显示
            'roles.details.wrapColumn',
            'roles.details.enableRoleExpansion',

            // 6. 其他功能配置
            'AndreaNovelHelper.smartTabGroupLock.enabled',
            'AndreaNovelHelper.autoGit.compactStatus',

            // 7. 按键绑定相关 - 智能回车按键绑定配置
            'markdown.extension.onEnterKey',
            'andrea.smartEnter'
        ];

        return quickSettingKeys.includes(key);
    }

    private getAllContributionConfigurations(): Array<{key: string, schema: any}> {
        const extension = vscode.extensions.getExtension('andreafrederica.andrea-novel-helper');
        if (!extension) {
            this._logChannel.appendLine('无法找到扩展 andreafrederica.andrea-novel-helper');
            return [];
        }

        try {
            const packageJsonPath = path.join(extension.extensionPath, 'package.json');
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

            const configurations = packageJson?.contributes?.configuration;
            if (!configurations) {
                this._logChannel.appendLine('在 package.json 中未找到配置定义');
                return [];
            }

            // 处理单个配置对象或配置对象数组
            const configList = Array.isArray(configurations) ? configurations : [configurations];
            const properties: Array<{key: string, schema: any}> = [];

            for (const config of configList) {
                if (config.properties) {
                    for (const [key, schema] of Object.entries(config.properties)) {
                        properties.push({
                            key,
                            schema: schema as any
                        });
                    }
                }
            }

            const existingKeys = new Set(properties.map(item => item.key));
            for (const item of this.getBuiltInEditorConfigurations()) {
                if (!existingKeys.has(item.key)) {
                    properties.push(item);
                }
            }

            return properties;
        } catch (error) {
            this._logChannel.appendLine('读取配置定义时出错:'+error);
            return [];
        }
    }

    private getBuiltInEditorConfigurations(): Array<{key: string, schema: any}> {
        return [
            {
                key: 'editor.wordWrap',
                schema: {
                    type: 'string',
                    default: 'off',
                    enum: ['off', 'on', 'wordWrapColumn', 'bounded'],
                    enumDescriptions: [
                        '不自动换行',
                        '按编辑器窗口宽度换行',
                        '按 editor.wordWrapColumn 换行',
                        '在窗口宽度和 editor.wordWrapColumn 之间取较小值换行'
                    ],
                    anhName: '自动换行模式',
                    markdownDescription: '控制长行是否在编辑器中自动折到下一行。写长段落时通常建议使用 on。'
                }
            },
            {
                key: 'editor.wrappingIndent',
                schema: {
                    type: 'string',
                    default: 'same',
                    enum: ['none', 'same', 'indent', 'deepIndent'],
                    enumDescriptions: [
                        '折行不额外缩进',
                        '折行与原行同列',
                        '折行增加一层缩进',
                        '折行增加两层缩进'
                    ],
                    anhName: '折行缩进',
                    markdownDescription: '控制自动换行后的视觉缩进。它只影响屏幕显示，不会向文件写入空格；写小说时推荐 none，符合常见写作软件的习惯。'
                }
            },
            {
                key: 'editor.minimap.enabled',
                schema: {
                    type: 'boolean',
                    default: true,
                    anhName: '显示 Minimap 小地图',
                    markdownDescription: '控制编辑器右侧的小地图。长篇写作时可关闭以腾出横向空间。'
                }
            },
            {
                key: 'editor.mouseWheelZoom',
                schema: {
                    type: 'boolean',
                    default: false,
                    anhName: 'Ctrl+滚轮缩放字体',
                    markdownDescription: '开启后可按住 Ctrl 并滚动鼠标滚轮快速调整编辑器字号。'
                }
            },
            {
                key: 'editor.insertSpaces',
                schema: {
                    type: 'boolean',
                    default: true,
                    anhName: '缩进使用空格',
                    markdownDescription: '开启后按 Tab 会插入空格；关闭后插入制表符。'
                }
            },
            {
                key: 'editor.tabSize',
                schema: {
                    type: 'number',
                    default: 4,
                    minimum: 1,
                    maximum: 8,
                    anhName: '缩进宽度',
                    markdownDescription: '控制一个 Tab 或一个缩进层级显示为几列。'
                }
            },
            {
                key: 'editor.detectIndentation',
                schema: {
                    type: 'boolean',
                    default: true,
                    anhName: '从文件内容检测缩进',
                    markdownDescription: '开启后 VS Code 会根据当前文件内容猜测缩进设置；需要固定写作格式时可关闭。'
                }
            },
            {
                key: 'editor.fontSize',
                schema: {
                    type: 'number',
                    default: 14,
                    minimum: 6,
                    maximum: 80,
                    anhName: '编辑器字体大小',
                    markdownDescription: '控制编辑器正文的字号。'
                }
            },
            {
                key: 'editor.fontFamily',
                schema: {
                    type: 'string',
                    default: "Consolas, 'Courier New', monospace",
                    anhName: '编辑器字体家族',
                    markdownDescription: '控制编辑器正文使用的字体列表。建议优先通过快速设置里的图形化字体管理器调整。'
                }
            }
        ];
    }

    private getConfigl10n(key: string): string {
        // 使用自定义的 i18n 实现获取国际化描述
        try {
            // 参数验证
            if (!key || typeof key !== 'string') {
                return '';
            }

            // 处理传入的 key 格式，移除百分号并直接使用
            // 传入的格式是：%config.typeset.trimTrailingSpaces.description%
            // l10n 文件中的 key 是：config.typeset.trimTrailingSpaces.description
            let l10nKey = key;
            if (key.startsWith('%') && key.endsWith('%')) {
                l10nKey = key.slice(1, -1); // 移除首尾的百分号
            } else {
                // 如果首尾没有%，则原模原样返回
                return key;
            }

            // 使用自定义的 getTranslation 函数替代 vscode.l10n.t
            const localizedDescription = getTranslation(l10nKey, l10nKey);

            return localizedDescription;
        } catch (error) {
            // 如果 i18n 系统不可用，使用配置项的最后一个部分作为描述
            return key
        }
    }

    private formatSectionName(sectionId: string): string {
        // 将sectionId转换为中文名称
        const sectionNames: { [key: string]: string } = {
            'AndreaNovelHelper': '基础设置',
            'AndreaNovelHelper.docRoles': '文档角色',
            'AndreaNovelHelper.typo': '拼写检查',
            'AndreaNovelHelper.translate': '翻译设置',
            'AndreaNovelHelper.comments': '批注设置',
            'AndreaNovelHelper.allRoles': '全部角色',
            'AndreaNovelHelper.wordCount': '字数统计',
            'AndreaNovelHelper.roles': '角色设置',
            'andrea.typeset': '排版设置',
            'AndreaNovelHelper.wordSegment': '分词设置',
            'andrea.roleJson5': '角色JSON5',
            'AndreaNovelHelper.outline': '大纲设置',
            'AndreaNovelHelper.timeStats': '时间统计',
            'AndreaNovelHelper.hugeFile': '大文件处理',
            'AndreaNovelHelper.fileTracker': '文件追踪',
            'AndreaNovelHelper.debug': '调试设置',
            'AndreaNovelHelper.completion': '自动补全',
            'AndreaNovelHelper.decorations': '装饰设置',
            'AndreaNovelHelper.externalFolder': '外部文件夹',
            'AndreaNovelHelper.sensitiveWords': '敏感词设置',
            'AndreaNovelHelper.webdav': 'WebDAV',
            'AndreaNovelHelper.autoGit': '自动Git',
            'AndreaNovelHelper.smartTabGroupLock': '智能标签组锁定',
            'AndreaNovelHelper.database': '数据库设置',
            'AndreaNovelHelper.startupSnapshot': '启动快照',
            'andrea.typst': 'Typst设置',
            'AndreaNovelHelper.scripts': '脚本设置',
            'editor': 'VS Code 编辑器',
            'other': '其它设置'
        };

        return sectionNames[sectionId] || sectionId;
    }

    public setExternalWebview(webview: vscode.Webview) {
        this._externalWebview = webview;
    }

    public async processMessage(message: any) {
        switch (message.command) {
            case 'getSettings':
                this._handleGetSettings();
                break;
            case 'updateSetting':
                await this._handleUpdateSetting(message.key, message.value);
                break;
            case 'saveSettings':
                await this._handleSaveSettings(message.settings);
                break;
            case 'jumpToSettings':
                await this._handleJumpToSettings(message.key);
                break;
            case 'setScope':
                this._handleSetScope(message.scope);
                break;
            case 'searchSettings':
                this._handleSearchSettings(message.query);
                break;
        }
    }

    private _postMessage(message: any) {
        if (this._view) {
            this._view.webview.postMessage(message);
        } else if (this._externalWebview) {
            this._externalWebview.postMessage(message);
        }
    }

    public refresh() {
        this._handleGetSettings();
    }
}

export function registerEditorSettingsView(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new EditorSettingsWebviewProvider(context);

    return vscode.window.registerWebviewViewProvider(
        EditorSettingsWebviewProvider.viewType,
        provider,
        {
            webviewOptions: {
                // 关键配置：隐藏时保留 Webview 的上下文（不会销毁 iframe）
                retainContextWhenHidden: true,
            },
        },
    );
}
