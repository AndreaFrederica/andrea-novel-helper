import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { detectTxtRoleFilesAll, type TxtRoleFileCandidate } from '../utils/txtRoleDetector';
import { parseTxtRoleFile, toJson5, toMarkdown } from '../utils/txtRoleParser';

let statusBarItem: vscode.StatusBarItem | undefined;

/** 注册检测与迁移命令 */
export function registerTxtMigrationCommands(context: vscode.ExtensionContext) {
    // 命令：检测 TXT 角色文件
    context.subscriptions.push(
        vscode.commands.registerCommand('andrea.detectTxtRoleFiles', async () => {
            await detectAndShowResults();
        })
    );

    // 命令：迁移选中的 TXT 文件
    context.subscriptions.push(
        vscode.commands.registerCommand('andrea.migrateTxtRoleFile', async (candidate: TxtRoleFileCandidate) => {
            await migrateSingleFile(candidate);
        })
    );

    // 状态栏：显示检测提示
    updateStatusBar();
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => updateStatusBar())
    );
}

async function updateStatusBar() {
    const candidates = detectTxtRoleFilesAll();
    if (candidates.length > 0) {
        if (!statusBarItem) {
            statusBarItem = vscode.window.createStatusBarItem('andrea.txtRoleDetector', vscode.StatusBarAlignment.Right, 100);
            statusBarItem.command = 'andrea.detectTxtRoleFiles';
        }
        statusBarItem.text = `$(search) ${candidates.length} 个 TXT 角色档案`;
        statusBarItem.tooltip = '检测到可迁移为 JSON5 的角色档案文件，点击查看';
        statusBarItem.show();

        // 自动提示：如果没有 character-gallery.json5，弹窗提醒
        const folders = vscode.workspace.workspaceFolders;
        if (folders?.length) {
            const json5Path = path.join(folders[0].uri.fsPath, 'novel-helper', 'character-gallery.json5');
            if (!fs.existsSync(json5Path)) {
                const action = await vscode.window.showInformationMessage(
                    `检测到 ${candidates.length} 个 TXT 角色档案，可转换为标准 JSON5 格式`,
                    '开始转换',
                    '稍后'
                );
                if (action === '开始转换') {
                    await vscode.commands.executeCommand('andrea.detectTxtRoleFiles');
                }
            }
        }
    } else {
        statusBarItem?.hide();
    }
}

async function detectAndShowResults() {
    const candidates = detectTxtRoleFilesAll();

    if (candidates.length === 0) {
        vscode.window.showInformationMessage('未检测到可迁移的 TXT 角色档案文件。');
        return;
    }

    // 构建 QuickPick 列表
    const items: (vscode.QuickPickItem & { candidate: TxtRoleFileCandidate })[] = candidates.map(c => ({
        label: `$(file-text) ${c.fileName}`,
        description: `评分 ${c.score}/100 · ${c.lineCount} 行`,
        detail: c.summary,
        candidate: c,
    }));

    items.unshift({
        label: '$(arrow-swap) 迁移全部（一键转换）',
        description: `共 ${candidates.length} 个文件`,
        detail: '将自动检测到的所有 TXT 角色档案转换为 JSON5 格式（原文件保留 .bak 备份）',
        candidate: null as any,
    } as any);

    const selected = await vscode.window.showQuickPick(items, {
        matchOnDescription: true,
        matchOnDetail: true,
        placeHolder: `发现 ${candidates.length} 个候选 TXT 角色档案，选择要迁移的文件`,
        title: 'TXT 角色档案迁移',
    });

    if (!selected) return;

    // "迁移全部"
    if ((selected as any).label.startsWith('$(arrow-swap)')) {
        for (const c of candidates) {
            await migrateSingleFile(c);
        }
        return;
    }

    // 单个文件：先预览再确认
    if ((selected as any).candidate) {
        const c = (selected as any).candidate as TxtRoleFileCandidate;
        const confirmed = await previewMigration(c);
        if (confirmed) {
            await migrateSingleFile(c);
        }
    }
}

async function previewMigration(candidate: TxtRoleFileCandidate): Promise<boolean> {
    let content: string;
    try {
        content = fs.readFileSync(candidate.filePath, 'utf8');
    } catch {
        vscode.window.showErrorMessage(`无法读取文件: ${candidate.fileName}`);
        return false;
    }

    const result = parseTxtRoleFile(content, candidate.filePath);

    if (result.totalRoles === 0) {
        vscode.window.showWarningMessage(`未能从 ${candidate.fileName} 解析出角色。该文件可能不是角色档案格式。`);
        return false;
    }

    // Pop up a confirmation dialog with details
    const sectionSummary = result.sections
        .map(s => `  ${s.sectionTitle}: ${s.roles.length} 个角色`)
        .join('\n');

    const choice = await vscode.window.showInformationMessage(
        `"${candidate.fileName}"\n共解析出 ${result.totalRoles} 个角色:\n${sectionSummary}\n\n转换格式？`,
        { modal: true },
        '转为 JSON5 (推荐)',
        '转为 Markdown',
        '取消'
    );

    if (!choice || choice === '取消') return false;

    // Store the choice for migration
    (candidate as any)._format = choice.includes('JSON5') ? 'json5' : 'md';
    return true;
}

async function migrateSingleFile(candidate: TxtRoleFileCandidate) {
    const format: 'json5' | 'md' = (candidate as any)._format || 'json5';

    let content: string;
    try {
        content = fs.readFileSync(candidate.filePath, 'utf8');
    } catch {
        vscode.window.showErrorMessage(`无法读取文件: ${candidate.fileName}`);
        return;
    }

    const result = parseTxtRoleFile(content, candidate.filePath);
    if (result.totalRoles === 0) {
        vscode.window.showWarningMessage(`未能从 ${candidate.fileName} 解析出角色。`);
        return;
    }

    // 备份原文件
    const bakPath = candidate.filePath + '.bak';
    try {
        fs.copyFileSync(candidate.filePath, bakPath);
    } catch {
        vscode.window.showErrorMessage(`备份失败: ${bakPath}`);
        return;
    }

    // 生成目标内容
    const outputContent = format === 'json5' ? toJson5(result) : toMarkdown(result);
    const outputExt = format === 'json5' ? '.json5' : '.md';

    // 输出到 novel-helper 目录
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return;
    const novelHelperDir = path.join(folders[0].uri.fsPath, 'novel-helper');
    fs.mkdirSync(novelHelperDir, { recursive: true });

    // 使用标准默认文件名
    const defaultName = format === 'json5' ? 'character-gallery.json5' : 'character-gallery.md';
    let outputPath = path.join(novelHelperDir, defaultName);

    // 如果已存在，问用户是覆盖还是取消
    if (fs.existsSync(outputPath)) {
        const action = await vscode.window.showWarningMessage(
            `${defaultName} 已存在。覆盖会丢失手动修改的内容。`,
            { modal: true },
            '覆盖',
            '取消'
        );
        if (action !== '覆盖') return;
    }

    fs.writeFileSync(outputPath, outputContent, 'utf8');

    const relativeOutput = path.relative(folders[0].uri.fsPath, outputPath);

    vscode.window.showInformationMessage(
        `已迁移: ${candidate.fileName} → ${relativeOutput} (${result.totalRoles} 个角色)`,
        '打开文件',
        '刷新角色'
    ).then(choice => {
        if (choice === '打开文件') {
            vscode.commands.executeCommand('vscode.open', vscode.Uri.file(outputPath));
        } else if (choice === '刷新角色') {
            vscode.commands.executeCommand('AndreaNovelHelper.refreshRole');
        }
    });
}
