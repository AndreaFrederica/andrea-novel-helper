/**
 * 原生模块加载器 - 处理 macOS 安全策略导致的加载失败
 * 用户可在 VS Code 终端执行修复命令，然后重启 Code
 */

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';

export interface NativeModuleLoadOptions {
    moduleName: string;
    displayName: string;
    context: vscode.ExtensionContext;
}

/**
 * 判断是否是 macOS 系统策略/隔离相关的加载错误
 */
export function isMacPolicyBlock(err: unknown): boolean {
    const msg = String(err ?? '');
    return (
        process.platform === 'darwin' &&
        (msg.includes('library load disallowed by system policy') ||
            msg.includes('not valid for use in process') ||
            msg.includes('code signature') ||
            msg.includes('dlopen(') ||
            msg.includes('EACCES') ||
            msg.includes('permission denied'))
    );
}

/**
 * 尝试加载原生模块，如果失败在 macOS 上弹窗引导用户修复
 */
export async function tryLoadNativeModuleWithFallback(
    loadFn: () => any,
    options: NativeModuleLoadOptions
): Promise<any> {
    try {
        return loadFn();
    } catch (e) {
        if (isMacPolicyBlock(e)) {
            // 在 macOS 上检测到策略阻止，弹窗询问
            await promptMacUnblockAndFix(options, e);
            return null; // 返回 null，调用方应检查
        }

        // 其他平台或其他类型的错误
        console.error(
            `[ANH] Failed to load native module "${options.moduleName}":`,
            e
        );

        // 非 macOS 的其他错误也弹窗
        if (process.platform !== 'darwin') {
            await vscode.window.showErrorMessage(
                `Andrea Novel Helper: Failed to load native module "${options.displayName}". Please check console for details.`,
                { modal: false }
            );
        }

        return null;
    }
}

/**
 * macOS 特定的弹窗引导和修复流程
 */
async function promptMacUnblockAndFix(
    options: NativeModuleLoadOptions,
    err: unknown
): Promise<void> {
    const { context, moduleName, displayName } = options;
    const extDir = context.extensionPath;

    // 生成修复命令
    // 1. 清除隔离属性
    const xattrCmd = `xattr -dr com.apple.quarantine "${extDir}"`;

    // 2. （可选）对 .node 文件 ad-hoc 签名（用于测试/开发）
    // 注意：这只是 dev 方案；生产应该用 Developer ID 签名
    const nodeFileInNodeModules = path.join(
        extDir,
        'node_modules',
        '@anh',
        'enigo-keyboard',
        'enigo_keyboard.node'
    );
    const codesignAdHocCmd = `codesign --force --sign - "${nodeFileInNodeModules}" 2>/dev/null || true`;

    // 完整命令：先清隔离，再 ad-hoc 签名
    const fixCmd = `${xattrCmd} && ${codesignAdHocCmd}`;

    const items = [
        { label: '在终端运行修复命令', action: 'runInTerminal' as const },
        { label: '复制修复命令', action: 'copyCommand' as const },
        { label: '查看帮助文档', action: 'openHelp' as const },
        { label: '打开扩展目录', action: 'revealFolder' as const },
    ];

    const choice = await vscode.window.showErrorMessage(
        [
            `Andrea Novel Helper: macOS 系统策略阻止了 ${displayName} 的加载。`,
            '',
            '通常这是因为：',
            '• 扩展目录被隔离（quarantine）',
            '• 原生二进制文件缺少代码签名',
            '',
            '解决方案：',
            '1. 在下面选择在终端运行修复命令',
            '2. 等待命令执行完成（会要求输入系统密码）',
            '3. 重启 VS Code',
        ].join('\n'),
        { modal: true },
        ...items.map((item) => item.label)
    );

    if (!choice) {
        return; // 用户取消
    }

    const selectedItem = items.find((item) => item.label === choice);
    if (!selectedItem) {
        return;
    }

    switch (selectedItem.action) {
        case 'runInTerminal': {
            await runFixCommandInTerminal(fixCmd);
            // 执行后弹窗提示重启
            await vscode.window.showInformationMessage(
                '✓ 修复命令已在终端中运行，请等待完成。完成后请重启 VS Code。',
                { modal: true },
                '重启 Code'
            ).then((result) => {
                if (result === '重启 Code') {
                    void vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
            break;
        }

        case 'copyCommand': {
            await vscode.env.clipboard.writeText(fixCmd);
            const result = await vscode.window.showInformationMessage(
                '✓ 修复命令已复制到剪贴板。\n\n请打开 VS Code 集成终端（Ctrl+`），粘贴并运行命令。\n完成后重启 Code。',
                { modal: true },
                '打开终端',
                '重启 Code'
            );

            if (result === '打开终端') {
                await vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal');
            } else if (result === '重启 Code') {
                void vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
            break;
        }

        case 'revealFolder': {
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(extDir));
            const result = await vscode.window.showInformationMessage(
                '已打开扩展目录。\n\n修复步骤：\n1. 在 VS Code 终端中运行修复命令\n2. 重启 Code',
                { modal: false },
                '复制命令'
            );
            if (result === '复制命令') {
                await vscode.env.clipboard.writeText(fixCmd);
                void vscode.window.showInformationMessage('命令已复制');
            }
            break;
        }

        case 'openHelp': {
            // 这里可以打开你自己的文档或 GitHub 讨论
            const docUrl = vscode.Uri.parse(
                'https://github.com/AndreaFrederica/andrea-novel-helper/issues'
            );
            await vscode.env.openExternal(docUrl);
            break;
        }
    }
}

/**
 * 在 VS Code 集成终端中运行修复命令
 */
async function runFixCommandInTerminal(fixCmd: string): Promise<void> {
    // 查找已有的终端或创建新的
    let terminal = vscode.window.terminals.find((t) => t.name.includes('ANH'));
    if (!terminal) {
        terminal = vscode.window.createTerminal({
            name: 'ANH Fix (macOS)',
            shellPath: process.platform === 'darwin' ? '/bin/zsh' : undefined,
        });
    }

    terminal.show(true);

    // 发送命令到终端
    // 注意：sendText 不会自动执行，需要加 true 参数或让用户手动按 Enter
    terminal.sendText(fixCmd, false); // false: 不自动按 Enter，用户确认后再执行

    // 可选：自动按 Enter（默认关闭，避免意外执行）
    // terminal.sendText('', true);
}

/**
 * 注册全局原生模块加载检查（在 activate 时调用）
 */
export function registerNativeModuleCheckup(context: vscode.ExtensionContext): void {
    // 这个函数会在扩展激活时尝试加载原生模块
    // 如果失败，会弹窗引导用户
    console.log('[ANH] Registering native module checkup...');

    // 我们会在具体加载原生模块时（如 autoPairs.ts）调用 tryLoadNativeModuleWithFallback
    // 此处只做日志记录
}
