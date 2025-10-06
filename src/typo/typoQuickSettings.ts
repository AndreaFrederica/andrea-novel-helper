import * as vscode from 'vscode';
import { cleanupAllData } from './typoStorage';

export function registerTypoQuickSettings(context: vscode.ExtensionContext) {
    const toggle = async (key: string) => {
        const cfg = vscode.workspace.getConfiguration();
        const cur = cfg.get<boolean>(key, false);
        await cfg.update(key, !cur, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`${getConfigDisplayName(key)}已${!cur ? '启用' : '禁用'}`);
    };

    const getConfigDisplayName = (key: string): string => {
        const names: { [key: string]: string } = {
            'AndreaNovelHelper.typo.enabled': '错别字识别',
            'AndreaNovelHelper.typo.autoIdentifyOnOpen': '打开文档自动识别',
            'AndreaNovelHelper.typo.clientLLM.enabled': '客户端直连大模型',
            'AndreaNovelHelper.typo.persistence.enabled': '数据持久化',
            'AndreaNovelHelper.typo.persistence.autoCleanup': '自动清理过期数据',
            'AndreaNovelHelper.typo.debug.llmTrace': 'LLM调试输出',
            'AndreaNovelHelper.typo.debug.serverTrace': '服务端调试输出',
            'AndreaNovelHelper.typo.debug.compactTrace': '压缩调试输出'
        };
        return names[key] || key;
    };

    // 设置识别模式
    async function changeTypoMode() {
        const cfg = vscode.workspace.getConfiguration();
        const current = cfg.get<string>('AndreaNovelHelper.typo.mode', 'macro');
        
        const items = [
            {
                label: `${current === 'macro' ? '$(check) ' : ''}macro —— 规则识别`,
                description: '使用 /correct 规则进行错别字识别',
                value: 'macro'
            },
            {
                label: `${current === 'llm' ? '$(check) ' : ''}llm —— 大语言模型`,
                description: '使用 /correct/llm 大语言模型进行识别（需注意数据安全）',
                value: 'llm'
            },
            {
                label: '$(arrow-left) 返回主设置',
                value: 'back'
            }
        ];

        const pick = await vscode.window.showQuickPick(items, {
            placeHolder: '选择错别字识别模式'
        });

        if (!pick) { return; }

        if (pick.value === 'back') {
            await typoQuickSettings();
            return;
        }

        await cfg.update('AndreaNovelHelper.typo.mode', pick.value, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`错别字识别模式已设置为：${pick.value}`);
    }

    // 配置客户端LLM设置
    async function configureClientLLM() {
        while (true) {
            const cfg = vscode.workspace.getConfiguration();
            const enabled = cfg.get<boolean>('AndreaNovelHelper.typo.clientLLM.enabled', false);
            const apiBase = cfg.get<string>('AndreaNovelHelper.typo.clientLLM.apiBase', 'https://api.deepseek.com/v1');
            const model = cfg.get<string>('AndreaNovelHelper.typo.clientLLM.model', 'deepseek-v3');
            const temperature = cfg.get<number>('AndreaNovelHelper.typo.clientLLM.temperature', 0);
            const hasApiKey = !!cfg.get<string>('AndreaNovelHelper.typo.clientLLM.apiKey', '');

            const choices = [
                {
                    label: `${enabled ? '$(check)' : '$(circle-slash)'} 启用客户端直连大模型`,
                    description: enabled ? '当前已启用' : '当前已禁用',
                    action: 'toggle'
                },
                {
                    label: '$(globe) 配置 API Base',
                    description: `当前：${apiBase}`,
                    action: 'apiBase'
                },
                {
                    label: '$(key) 配置 API Key',
                    description: hasApiKey ? '已配置（隐藏显示）' : '未配置',
                    action: 'apiKey'
                },
                {
                    label: '$(robot) 配置模型名称',
                    description: `当前：${model}`,
                    action: 'model'
                },
                {
                    label: '$(thermometer) 配置 Temperature',
                    description: `当前：${temperature}`,
                    action: 'temperature'
                },
                {
                    label: '$(arrow-left) 返回主设置',
                    action: 'back'
                }
            ];

            const pick = await vscode.window.showQuickPick(choices, {
                placeHolder: '配置客户端直连大模型设置'
            });

            if (!pick || pick.action === 'back') {
                if (pick?.action === 'back') {
                    await typoQuickSettings();
                }
                return;
            }

            try {
                switch (pick.action) {
                    case 'toggle':
                        await toggle('AndreaNovelHelper.typo.clientLLM.enabled');
                        break;
                    
                    case 'apiBase': {
                        const input = await vscode.window.showInputBox({
                            prompt: '输入 API Base URL',
                            value: apiBase,
                            placeHolder: '例如：https://api.openai.com/v1'
                        });
                        if (input !== undefined) {
                            await cfg.update('AndreaNovelHelper.typo.clientLLM.apiBase', input, vscode.ConfigurationTarget.Workspace);
                            vscode.window.showInformationMessage('API Base 已更新');
                        }
                        break;
                    }
                    
                    case 'apiKey': {
                        const input = await vscode.window.showInputBox({
                            prompt: '输入 API Key（请注意安全）',
                            password: true,
                            placeHolder: '输入您的 API Key'
                        });
                        if (input !== undefined) {
                            await cfg.update('AndreaNovelHelper.typo.clientLLM.apiKey', input, vscode.ConfigurationTarget.Workspace);
                            vscode.window.showInformationMessage('API Key 已更新');
                        }
                        break;
                    }
                    
                    case 'model': {
                        const input = await vscode.window.showInputBox({
                            prompt: '输入模型名称',
                            value: model,
                            placeHolder: '例如：deepseek-v3, gpt-4o-mini'
                        });
                        if (input !== undefined) {
                            await cfg.update('AndreaNovelHelper.typo.clientLLM.model', input, vscode.ConfigurationTarget.Workspace);
                            vscode.window.showInformationMessage('模型名称已更新');
                        }
                        break;
                    }
                    
                    case 'temperature': {
                        const input = await vscode.window.showInputBox({
                            prompt: '输入 Temperature 值（0-2）',
                            value: temperature.toString(),
                            placeHolder: '0 = 确定性，2 = 随机性'
                        });
                        if (input !== undefined) {
                            const temp = parseFloat(input);
                            if (!isNaN(temp) && temp >= 0 && temp <= 2) {
                                await cfg.update('AndreaNovelHelper.typo.clientLLM.temperature', temp, vscode.ConfigurationTarget.Workspace);
                                vscode.window.showInformationMessage(`Temperature 已设置为：${temp}`);
                            } else {
                                vscode.window.showErrorMessage('Temperature 必须是 0-2 之间的数字');
                            }
                        }
                        break;
                    }
                }
            } catch (error) {
                vscode.window.showErrorMessage(`配置更新失败：${error}`);
            }
        }
    }

    // 配置数据持久化设置
    async function configurePersistence() {
        while (true) {
            const cfg = vscode.workspace.getConfiguration();
            const enabled = cfg.get<boolean>('AndreaNovelHelper.typo.persistence.enabled', false);
            const autoCleanup = cfg.get<boolean>('AndreaNovelHelper.typo.persistence.autoCleanup', true);
            const maxAgeDays = cfg.get<number>('AndreaNovelHelper.typo.persistence.maxAgeDays', 30);

            const choices = [
                {
                    label: `${enabled ? '$(check)' : '$(circle-slash)'} 启用数据持久化`,
                    description: enabled ? '错别字结果将保存到本地文件' : '错别字结果仅保存在内存中',
                    action: 'toggle'
                },
                {
                    label: `${autoCleanup ? '$(check)' : '$(circle-slash)'} 自动清理过期数据`,
                    description: autoCleanup ? '自动删除过期的数据文件' : '不自动清理数据文件',
                    action: 'autoCleanup'
                },
                {
                    label: '$(calendar) 配置数据保存天数',
                    description: `当前：${maxAgeDays} 天`,
                    action: 'maxAge'
                },
                {
                    label: '$(trash) 清理所有持久化数据',
                    description: '删除所有已保存的错别字数据文件',
                    action: 'cleanup'
                },
                {
                    label: '$(arrow-left) 返回主设置',
                    action: 'back'
                }
            ];

            const pick = await vscode.window.showQuickPick(choices, {
                placeHolder: '配置错别字数据持久化设置'
            });

            if (!pick || pick.action === 'back') {
                if (pick?.action === 'back') {
                    await typoQuickSettings();
                }
                return;
            }

            try {
                switch (pick.action) {
                    case 'toggle':
                        await toggle('AndreaNovelHelper.typo.persistence.enabled');
                        break;
                    
                    case 'autoCleanup':
                        await toggle('AndreaNovelHelper.typo.persistence.autoCleanup');
                        break;
                    
                    case 'maxAge': {
                        const input = await vscode.window.showInputBox({
                            prompt: '输入数据保存天数（1-365）',
                            value: maxAgeDays.toString(),
                            placeHolder: '例如：30'
                        });
                        if (input !== undefined) {
                            const days = parseInt(input);
                            if (!isNaN(days) && days >= 1 && days <= 365) {
                                await cfg.update('AndreaNovelHelper.typo.persistence.maxAgeDays', days, vscode.ConfigurationTarget.Workspace);
                                vscode.window.showInformationMessage(`数据保存天数已设置为：${days} 天`);
                            } else {
                                vscode.window.showErrorMessage('保存天数必须是 1-365 之间的整数');
                            }
                        }
                        break;
                    }
                    
                    case 'cleanup': {
                        const confirm = await vscode.window.showWarningMessage(
                            '确定要清理所有错别字持久化数据吗？此操作不可撤销。',
                            { modal: true },
                            '确定清理'
                        );
                        if (confirm === '确定清理') {
                            try {
                                // 调用清理函数
                                await cleanupAllData();
                                vscode.window.showInformationMessage('所有错别字数据已清理完成');
                            } catch (error) {
                                vscode.window.showErrorMessage(`清理数据失败：${error}`);
                            }
                        }
                        break;
                    }
                }
            } catch (error) {
                vscode.window.showErrorMessage(`配置更新失败：${error}`);
            }
        }
    }

    // 配置调试设置
    async function configureDebug() {
        while (true) {
            const cfg = vscode.workspace.getConfiguration();
            const llmTrace = cfg.get<boolean>('AndreaNovelHelper.typo.debug.llmTrace', false);
            const serverTrace = cfg.get<boolean>('AndreaNovelHelper.typo.debug.serverTrace', false);
            const compactTrace = cfg.get<boolean>('AndreaNovelHelper.typo.debug.compactTrace', false);

            const choices = [
                {
                    label: `${llmTrace ? '$(check)' : '$(circle-slash)'} LLM 调试输出`,
                    description: llmTrace ? '输出客户端直连大模型的请求与响应' : '不输出 LLM 调试信息',
                    action: 'llmTrace'
                },
                {
                    label: `${serverTrace ? '$(check)' : '$(circle-slash)'} 服务端调试输出`,
                    description: serverTrace ? '输出服务端 HTTP 请求/响应概要' : '不输出服务端调试信息',
                    action: 'serverTrace'
                },
                {
                    label: `${compactTrace ? '$(check)' : '$(circle-slash)'} 压缩调试输出`,
                    description: compactTrace ? '调试输出压缩为单行' : '调试输出保持原格式',
                    action: 'compactTrace'
                },
                {
                    label: '$(arrow-left) 返回主设置',
                    action: 'back'
                }
            ];

            const pick = await vscode.window.showQuickPick(choices, {
                placeHolder: '配置错别字调试设置'
            });

            if (!pick || pick.action === 'back') {
                if (pick?.action === 'back') {
                    await typoQuickSettings();
                }
                return;
            }

            try {
                switch (pick.action) {
                    case 'llmTrace':
                        await toggle('AndreaNovelHelper.typo.debug.llmTrace');
                        break;
                    case 'serverTrace':
                        await toggle('AndreaNovelHelper.typo.debug.serverTrace');
                        break;
                    case 'compactTrace':
                        await toggle('AndreaNovelHelper.typo.debug.compactTrace');
                        break;
                }
            } catch (error) {
                vscode.window.showErrorMessage(`配置更新失败：${error}`);
            }
        }
    }

    // 主面板
    async function typoQuickSettings() {
        const cfg = vscode.workspace.getConfiguration();
        const enabled = cfg.get<boolean>('AndreaNovelHelper.typo.enabled', false);
        const autoIdentifyOnOpen = cfg.get<boolean>('AndreaNovelHelper.typo.autoIdentifyOnOpen', true);
        const mode = cfg.get<string>('AndreaNovelHelper.typo.mode', 'macro');
        const clientLLMEnabled = cfg.get<boolean>('AndreaNovelHelper.typo.clientLLM.enabled', false);
        const persistenceEnabled = cfg.get<boolean>('AndreaNovelHelper.typo.persistence.enabled', false);
        const llmTrace = cfg.get<boolean>('AndreaNovelHelper.typo.debug.llmTrace', false);
        const serverTrace = cfg.get<boolean>('AndreaNovelHelper.typo.debug.serverTrace', false);

        const choices = [
            {
                label: `${enabled ? '$(check)' : '$(circle-slash)'} 启用错别字识别`,
                description: enabled ? '当前已启用错别字识别功能' : '当前已禁用错别字识别功能',
                cmd: 'andrea.typo.toggle'
            },
            {
                label: `${autoIdentifyOnOpen ? '$(check)' : '$(circle-slash)'} 打开文档自动识别`,
                description: autoIdentifyOnOpen ? '打开文档时自动进行错别字识别' : '需要手动点击重新识别按钮',
                cmd: 'andrea.typo.toggleAutoIdentifyOnOpen'
            },
            {
                label: `$(settings) 识别模式（当前：${mode}）`,
                description: mode === 'macro' ? '使用规则识别' : '使用大语言模型识别',
                cmd: 'andrea.typo.changeMode'
            },
            {
                label: `$(robot) 客户端直连大模型${clientLLMEnabled ? '（已启用）' : ''}`,
                description: '配置本地客户端直连大模型设置',
                cmd: 'andrea.typo.configureClientLLM'
            },
            {
                label: `$(database) 数据持久化${persistenceEnabled ? '（已启用）' : ''}`,
                description: '配置错别字数据的本地存储设置',
                cmd: 'andrea.typo.configurePersistence'
            },
            {
                label: `$(bug) 调试设置${(llmTrace || serverTrace) ? '（有启用项）' : ''}`,
                description: '配置错别字识别的调试输出选项',
                cmd: 'andrea.typo.configureDebug'
            }
        ];

        const pick = await vscode.window.showQuickPick(choices, {
            placeHolder: '错别字识别快速设置'
        });

        if (pick?.cmd) {
            await vscode.commands.executeCommand(pick.cmd);
        }
    }

    // 注册命令
    context.subscriptions.push(
        vscode.commands.registerCommand('andrea.typo.quickSettings', typoQuickSettings),
        vscode.commands.registerCommand('andrea.typo.toggle', () => toggle('AndreaNovelHelper.typo.enabled')),
        vscode.commands.registerCommand('andrea.typo.toggleAutoIdentifyOnOpen', () => toggle('AndreaNovelHelper.typo.autoIdentifyOnOpen')),
        vscode.commands.registerCommand('andrea.typo.changeMode', changeTypoMode),
        vscode.commands.registerCommand('andrea.typo.configureClientLLM', configureClientLLM),
        vscode.commands.registerCommand('andrea.typo.configurePersistence', configurePersistence),
        vscode.commands.registerCommand('andrea.typo.configureDebug', configureDebug)
    );
}