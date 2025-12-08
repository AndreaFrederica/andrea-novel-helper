import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { buildHtml } from '../utils/html-builder';
import { log } from 'console';

export class SettingsWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'andrea.settingsView';
    
    private _view?: vscode.WebviewView;
    private _context: vscode.ExtensionContext;

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
                vscode.Uri.joinPath(this._context.extensionUri, 'media')
            ]
        };

        // 设置 resourceMapperScriptUri
        let resourceMapperScriptUri: string | undefined;
        try {
            const mapperFile = vscode.Uri.joinPath(this._context.extensionUri, 'media', 'resource-mapper.js');
            resourceMapperScriptUri = webviewView.webview.asWebviewUri(mapperFile).toString();
        } catch (_) { }

        // 使用 buildHtml 函数构建 HTML，指定路由到设置页面
        webviewView.webview.html = buildHtml(webviewView.webview, {
            spaRoot: vscode.Uri.joinPath(this._context.extensionUri, 'packages', 'webview', 'dist', 'spa'),
            connectSrc: ['https:', 'http:', 'ws:', 'wss:'],
            resourceMapperScriptUri,
            route: '/settings',
            editorTitle: '设置'
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
                case 'resetSettings':
                    this._handleResetSettings();
                    break;
                case 'saveSettings':
                    this._handleSaveSettings(message.settings);
                    break;
            }
        });
    }

    private _handleGetSettings() {
        if (!this._view) {
            return;
        }

        // 使用新的buildSettings方法动态生成配置
        const settingsData = this.buildSettings();

        this._view.webview.postMessage({
            command: 'settingsData',
            data: settingsData
        });
    }

    private async _handleUpdateSetting(key: string, value: any) {
        try {
            const config = vscode.workspace.getConfiguration();
            await config.update(key, value, vscode.ConfigurationTarget.Global);
            
            // 使用 VS Code 原生通知显示更新成功
            // vscode.window.showInformationMessage(`设置已更新: ${key}`, '确定').then(selection => {
            //     if (selection === '确定') {
            //         console.log(`用户确认更新成功: ${key}`);
            //     }
            // });
            
            // 仍然发送消息给 webview 以保持兼容性
            if (this._view) {
                this._view.webview.postMessage({
                    command: 'settingUpdated',
                    key: key,
                    value: value
                });
            }
        } catch (error) {
            console.error('Failed to update setting:', error);
            
            // 使用 VS Code 原生通知显示更新失败
            vscode.window.showErrorMessage(`更新设置失败: ${key} - ${error}`, '重试', '忽略').then(selection => {
                if (selection === '重试') {
                    // 用户选择重试，重新调用更新方法
                    this._handleUpdateSetting(key, value);
                }
            });

            // 仍然发送错误消息给 webview 以保持兼容性
            if (this._view) {
                this._view.webview.postMessage({
                    command: 'error',
                    message: `Failed to update setting: ${error}`
                });
            }
        }
    }

    private async _handleResetSettings() {
        try {
            const config = vscode.workspace.getConfiguration();
            
            // 获取所有配置键并动态重置为默认值
            const allConfigs = this.getAllContributionConfigurations();
            
            for (const configData of allConfigs) {
                const key = configData.key;
                const inspection = config.inspect(key);
                if (inspection && inspection.defaultValue !== undefined) {
                    await config.update(key, inspection.defaultValue, vscode.ConfigurationTarget.Global);
                }
            }

            // 使用 VS Code 原生通知显示重置成功
            vscode.window.showInformationMessage('设置已重置为默认值', '确定').then(selection => {
                if (selection === '确定') {
                    console.log('用户确认重置成功');
                }
            });

            this._handleGetSettings();
        } catch (error) {
            console.error('Failed to reset settings:', error);
            
            // 使用 VS Code 原生通知显示重置失败
            vscode.window.showErrorMessage(`重置设置失败: ${error}`, '重试', '忽略').then(selection => {
                if (selection === '重试') {
                    // 用户选择重试，重新调用重置方法
                    this._handleResetSettings();
                }
            });

            // 仍然发送错误消息给 webview 以保持兼容性
            if (this._view) {
                this._view.webview.postMessage({
                    command: 'error',
                    message: `Failed to reset settings: ${error}`
                });
            }
        }
    }

    private async _handleSaveSettings(settings: any) {
        try {
            const config = vscode.workspace.getConfiguration();
            
            // 验证并保存每个设置项
            for (const [key, value] of Object.entries(settings)) {
                // 验证键名是否有效（以AndreaNovelHelper开头） 或者以andrea开头
                if (!key.startsWith('AndreaNovelHelper') && !key.startsWith('andrea')) {
                    console.warn(`跳过无效的配置键: ${key}`);
                    continue;
                }
                
                // 获取配置检查信息以验证值类型
                const inspection = config.inspect(key);
                if (inspection) {
                    // 这里可以添加类型验证逻辑
                    await config.update(key, value, vscode.ConfigurationTarget.Global);
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

            // 仍然发送消息给 webview 以保持兼容性
            if (this._view) {
                this._view.webview.postMessage({
                    command: 'settingsSaved',
                    message: '设置已保存'
                });
            }
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

            // 仍然发送错误消息给 webview 以保持兼容性
            if (this._view) {
                this._view.webview.postMessage({
                    command: 'error',
                    message: `Failed to save settings: ${error}`
                });
            }
        }
    }

    private buildSettings() {
        // 获取所有配置属性及其schema
        const logChannel = vscode.window.createOutputChannel('Andrea Novel Helper:buildSettings');
        const allConfigs = this.getAllContributionConfigurations();
        const config = vscode.workspace.getConfiguration();
        // logChannel.appendLine('config'+JSON.stringify(config));

        
        // const config1 = vscode.workspace.getConfiguration('andrea');
        // logChannel.appendLine('config1'+JSON.stringify(config1));
        // const config2 = vscode.workspace.getConfiguration('');
        // logChannel.appendLine('config2'+JSON.stringify(config2));
        // console.log('[settingView] buildSettings: ',config);
        // console.log('[settingView] buildSettings: ',allKeys);
        
        // 按section分组的配置项
        const sectionMap = new Map<string, any[]>();
        const configItems: any[] = [];
        
        // 处理每个配置项
        allConfigs.forEach(configData => {
            const { key, schema } = configData;
            
            // 按最后一个.进行切割
            const lastDotIndex = key.lastIndexOf('.');
            let section: string;
            let name: string;
            
            if (lastDotIndex === -1) {
                // 没有.的情况，整个作为section，name为空
                section = key;
                name = '';
            } else {
                // 有.的情况，最后一个.之前作为section，之后作为name
                section = key.substring(0, lastDotIndex);
                name = key.substring(lastDotIndex + 1);
            }
            
            // 获取配置值和元数据
            const value = config.get(key);
            // const value = config.get(name);
            const inspection = config.inspect(key);
            
            // 从schema中获取约束信息
            const type = schema.type || this.inferType(value);
            const markdownDescription = schema.markdownDescription || this.getConfigDescription(key);
            const minimum = schema.minimum || this.getNumericConstraint(inspection, 'minimum');
            const maximum = schema.maximum || this.getNumericConstraint(inspection, 'maximum');
            const enumValues = schema.enum || this.getEnumValues(inspection);
            const enumDescriptions = schema.enumDescriptions || this.getEnumDescriptions(inspection);
            
            // 构建配置项
            const configItem = {
                id: key,
                type: type,
                section: section,
                name: name || key, // 如果name为空，使用整个key作为name
                markdownDescription: markdownDescription,
                value: value,
                defaultValue: inspection?.defaultValue,
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
            sections
        };
    }

    private getAllContributionConfigurations(): Array<{key: string, schema: any}> {
        const extension = vscode.extensions.getExtension('andreafrederica.andrea-novel-helper');
        if (!extension) {
            console.warn('无法找到扩展 andreafrederica.andrea-novel-helper');
            return [];
        }

        try {
            const packageJsonPath = path.join(extension.extensionPath, 'package.json');
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

            const configurations = packageJson?.contributes?.configuration;
            if (!configurations) {
                console.warn('在 package.json 中未找到配置定义');
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

            return properties;
        } catch (error) {
            console.error('读取配置定义时出错:', error);
            return [];
        }
    }
    
    private inferType(value: any): string {
        if (value === null || value === undefined) {
            return 'string';
        }
        
        if (typeof value === 'boolean') {
            return 'boolean';
        }
        
        if (typeof value === 'number') {
            return Number.isInteger(value) ? 'integer' : 'number';
        }
        
        if (Array.isArray(value)) {
            return 'array';
        }
        
        return 'string';
    }
    
    private getNumericConstraint(inspection: any, constraint: string): number | undefined {
        if (!inspection) return undefined;
        
        // 尝试从配置定义中获取约束
        const configDef = this.getConfigDefinition(inspection.key);
        if (configDef && configDef[constraint] !== undefined) {
            return configDef[constraint];
        }
        
        return undefined;
    }
    
    private getEnumValues(inspection: any): string[] | undefined {
        if (!inspection) return undefined;
        
        const configDef = this.getConfigDefinition(inspection.key);
        if (configDef && configDef.enum) {
            return configDef.enum;
        }
        
        return undefined;
    }
    
    private getEnumDescriptions(inspection: any): string[] | undefined {
        if (!inspection) return undefined;
        
        const configDef = this.getConfigDefinition(inspection.key);
        if (configDef && configDef.enumDescriptions) {
            return configDef.enumDescriptions;
        }
        
        return undefined;
    }
    
    private getConfigDefinition(key: string): any {
        // 这里可以扩展为从package.json或其他配置定义文件中读取
        // 目前返回一些常见的配置定义
        const configDefs: { [key: string]: any } = {
            'AndreaNovelHelper.profile': {
                enum: ['default', 'work', 'personal'],
                enumDescriptions: ['默认配置', '工作配置', '个人配置']
            },
            'AndreaNovelHelper.provider': {
                enum: ['OpenAI', 'Anthropic', 'Google'],
                enumDescriptions: ['OpenAI GPT系列', 'Anthropic Claude系列', 'Google Gemini系列']
            },
            'AndreaNovelHelper.defaultMode': {
                enum: ['chat', 'code', 'analysis'],
                enumDescriptions: ['聊天模式', '代码模式', '分析模式']
            },
            'AndreaNovelHelper.notificationSound': {
                enum: ['default', 'chime', 'alert', 'silent'],
                enumDescriptions: ['默认音效', '铃声', '警报声', '静音']
            },
            'AndreaNovelHelper.theme': {
                enum: ['light', 'dark', 'system'],
                enumDescriptions: ['浅色主题', '深色主题', '跟随系统']
            },
            'AndreaNovelHelper.fontSize': {
                enum: ['small', 'medium', 'large'],
                enumDescriptions: ['小字体', '中等字体', '大字体']
            },
            'AndreaNovelHelper.language': {
                enum: ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'],
                enumDescriptions: ['简体中文', 'English', '日本語', '한국어']
            }
        };
        
        return configDefs[key];
    }
    
    private getConfigDescription(key: string): string {
        // 这里可以扩展为从配置文件或国际化文件中读取描述
        const descriptions: { [key: string]: string } = {
            'AndreaNovelHelper.profile': '保存多组API配置便于快速切换',
            'AndreaNovelHelper.provider': '选择要使用的API服务提供商',
            'AndreaNovelHelper.baseUrl': '用于连接API服务的URL',
            'AndreaNovelHelper.enableCache': '启用API响应缓存以提高性能',
            'AndreaNovelHelper.defaultMode': '选择应用的默认运行模式',
            'AndreaNovelHelper.autoModeSwitch': '根据上下文自动切换工作模式',
            'AndreaNovelHelper.desktopNotifications': '启用桌面通知提醒',
            'AndreaNovelHelper.emailNotifications': '接收重要事件的邮件提醒',
            'AndreaNovelHelper.notificationSound': '选择通知提醒的音效',
            'AndreaNovelHelper.theme': '选择应用的显示主题',
            'AndreaNovelHelper.fontSize': '调整应用内文字大小',
            'AndreaNovelHelper.compactView': '启用紧凑布局以显示更多信息',
            'AndreaNovelHelper.language': '选择应用的显示语言',
            'AndreaNovelHelper.useTranslation': '自动将内容翻译为首选语言'
        };
        
        return descriptions[key] || key;
    }
    
    private formatSectionName(sectionId: string): string {
        // 将sectionId转换为中文名称
        const sectionNames: { [key: string]: string } = {
            'AndreaNovelHelper': '基础设置',
            'AndreaNovelHelper.docRoles': '文档角色',
            'AndreaNovelHelper.typo': '拼写检查',
            'AndreaNovelHelper.webdav': 'WebDAV',
            'provider': '提供商',
            'mode': '模式',
            'notifications': '通知',
            'ui': '界面',
            'language': '语言'
        };
        
        return sectionNames[sectionId] || sectionId;
    }

    public refresh() {
        if (this._view) {
            this._handleGetSettings();
        }
    }
}

export function registerSettingsView(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new SettingsWebviewProvider(context);
    
    return vscode.window.registerWebviewViewProvider(
        SettingsWebviewProvider.viewType,
        provider
    );
}