import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';

function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number; timedOut?: boolean }> {
    return new Promise(resolve => {
        // 为避免在没有 git 或其它异常情况下长时间挂起，设置超时（ms）
        const TIMEOUT_MS = 5000;
        const cmd = `git ${args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`;
        const p = exec(cmd, { cwd, timeout: TIMEOUT_MS, windowsHide: true }, (err, stdout, stderr) => {
            const out = (stdout || '').trim();
            const errout = (stderr || '').trim();
            // 当 exec 因超时被终止时，err.killed 或 err.signal 会存在
            if (err) {
                const anyErr = err as any;
                // 特殊处理 ENOENT（命令不存在）和超时杀死的情况，返回非零 code
                const isTimeout = anyErr.killed === true || anyErr.signal === 'SIGTERM' || anyErr.signal === 'SIGKILL';
                if (isTimeout) {
                    resolve({ stdout: out, stderr: errout || 'git command timed out', code: 124, timedOut: true });
                    return;
                }
                // 如果没有可用数字 code（如 ENOENT），归一化为 1
                const numericCode = typeof anyErr.code === 'number' ? anyErr.code : 1;
                resolve({ stdout: out, stderr: errout, code: numericCode });
                return;
            }
            resolve({ stdout: out, stderr: errout, code: 0 });
        });
    });
}

async function promptGitNotInstalled(): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
        '未检测到 Git（命令 git 不可用）。是否前往下载页面？安装完成后请重启 VS Code 再次检测。',
        '打开下载页面', '取消'
    );
    if (choice === '打开下载页面') {
        void vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/downloads'));
        vscode.window.showInformationMessage('请在安装 Git 完成后重启 VS Code，以便本扩展正确检测 Git。');
    }
}

interface GitConfigGuideOptions { silentIfConfigured?: boolean; }

export async function checkGitConfigAndGuide(workspaceRoot: string, options?: GitConfigGuideOptions) {
    // 若未安装 git，直接返回
    const gitCheck = await runGit(workspaceRoot, ['--version']);
    if (gitCheck.code !== 0) {
        await promptGitNotInstalled();
        return; // 没有 git，结束
    }
    // 读取全局与本地（如果本地仓库）
    const globalName = (await runGit(workspaceRoot, ['config', '--global', 'user.name'])).stdout;
    const globalEmail = (await runGit(workspaceRoot, ['config', '--global', 'user.email'])).stdout;
    const localName = (await runGit(workspaceRoot, ['config', '--local', 'user.name'])).stdout;
    const localEmail = (await runGit(workspaceRoot, ['config', '--local', 'user.email'])).stdout;

    const hasLocalPair = !!(localName && localEmail);
    const hasGlobalPair = !!(globalName && globalEmail);
    const effectiveName = hasLocalPair ? localName : globalName;
    const effectiveEmail = hasLocalPair ? localEmail : globalEmail;

    let needConfigure = false;
    if (effectiveName && effectiveEmail) {
        if (options?.silentIfConfigured) {
            return; // 静默退出
        }
        const detailLines = [
            `当前生效: ${effectiveName} <${effectiveEmail}> (${hasLocalPair ? '本仓库(local)' : '全局(global)'})`,
            `本仓库(local): ${hasLocalPair ? localName + ' <' + localEmail + '>' : '未设置'}`,
            `全局(global): ${hasGlobalPair ? globalName + ' <' + globalEmail + '>' : '未设置'}`
        ];
        const pick = await vscode.window.showQuickPick([
            { label: '重新配置 (选择作用域)', value: 'reconf', description: '修改用户名/邮箱' },
            { label: '仅查看 (保持现状)', value: 'keep' },
            { label: '取消', value: 'cancel' }
        ], { placeHolder: detailLines.join(' | ') });
        if (!pick || pick.value === 'cancel' || pick.value === 'keep') {
            if (pick?.value === 'keep') {
                vscode.window.showInformationMessage('已保持现有 Git 用户配置');
            }
            return;
        }
        // 选择重新配置
        needConfigure = true;
    } else {
        // 缺失任一字段 -> 需要配置
        const pick2 = await vscode.window.showInformationMessage('检测到尚未配置 Git 用户名/邮箱，是否现在配置？', '立即配置', '跳过');
        if (pick2 !== '立即配置') { return; }
        needConfigure = true;
    }

    if (!needConfigure) { return; }

    // 准备进入配置/重新配置流程；预填默认值（若存在）
    let userName = effectiveName || '';
    let userEmail = effectiveEmail || '';

    // 逐步向导
    const nameInput = await vscode.window.showInputBox({ prompt: '输入 Git 用户名 (user.name)', ignoreFocusOut: true, value: userName, validateInput: v => v.trim() ? undefined : '不能为空' });
    if (!nameInput) { return; }
    const emailInput = await vscode.window.showInputBox({ prompt: '输入 Git 邮箱 (user.email)', ignoreFocusOut: true, value: userEmail, validateInput: v => /.+@.+/.test(v) ? undefined : '请输入有效邮箱' });
    if (!emailInput) { return; }
    const name = nameInput.trim();
    const email = emailInput.trim();
    const scopePick = await vscode.window.showQuickPick([
        { label: '全局 (global)', description: '影响所有仓库', target: '--global' },
        { label: '仅当前仓库 (local)', description: '只写入当前项目 .git/config', target: '--local' }
    ], { placeHolder: '选择配置作用域' });
    if (!scopePick) { return; }

    const scope = scopePick.target as '--global' | '--local';
    if (scope === '--local') {
        // 确保在 git 仓库中
        const revParse = await runGit(workspaceRoot, ['rev-parse', '--is-inside-work-tree']);
        if (revParse.code !== 0) {
            const initPick = await vscode.window.showInformationMessage('当前目录还不是 git 仓库，是否初始化 git 仓库并继续？', '初始化', '取消');
            if (initPick !== '初始化') { return; }
            const initRes = await runGit(workspaceRoot, ['init']);
            if (initRes.code !== 0) {
                vscode.window.showErrorMessage('Git 初始化失败: ' + initRes.stderr);
                return;
            }
        }
    }

    const setName = await runGit(workspaceRoot, ['config', scope, 'user.name', name]);
    if (setName.code !== 0) {
        vscode.window.showErrorMessage('设置 user.name 失败: ' + setName.stderr);
        return;
    }
    const setEmail = await runGit(workspaceRoot, ['config', scope, 'user.email', email]);
    if (setEmail.code !== 0) {
        vscode.window.showErrorMessage('设置 user.email 失败: ' + setEmail.stderr);
        return;
    }

    vscode.window.showInformationMessage(`Git 用户信息已配置: ${name} <${email}> (${scope === '--global' ? '全局' : '本仓库'})`);
}

export function registerGitConfigCommand(context: vscode.ExtensionContext) {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) { return; }
    const cmd = vscode.commands.registerCommand('AndreaNovelHelper.setupGitIdentity', () => {
    checkGitConfigAndGuide(ws);
    });
    context.subscriptions.push(cmd);
}

// 供测试：直接打开 Git 下载链接（不依赖实际 git 检测）
export function registerGitDownloadTestCommand(context: vscode.ExtensionContext) {
    const cmd = vscode.commands.registerCommand('AndreaNovelHelper.testGitDownloadLink', () => {
        vscode.window.showInformationMessage('将打开 Git 官方下载页面。', '打开', '取消').then(choice => {
            if (choice === '打开') {
                void vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/downloads'));
            }
        });
    });
    context.subscriptions.push(cmd);
}

// 模拟未安装 Git 测试命令
export function registerGitSimulateNoGitCommand(context: vscode.ExtensionContext) {
    const cmd = vscode.commands.registerCommand('AndreaNovelHelper.simulateNoGit', () => {
        void promptGitNotInstalled();
    });
    context.subscriptions.push(cmd);
}
