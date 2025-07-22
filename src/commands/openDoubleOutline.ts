import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { outlineFS } from '../activate';

export async function openDoubleOutline() {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const outlineRootRel = cfg.get<string>('outlinePath', 'novel-helper/outline');
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders?.length) {
        return vscode.window.showErrorMessage('请先打开一个工作区');
    }
    const wsRoot = wsFolders[0].uri.fsPath;
    const outlineRoot = path.join(wsRoot, outlineRootRel);

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return vscode.window.showInformationMessage('请先打开一个文件');
    }

    // 1. 计算相对路径 & 目录层级
    const fileUri = editor.document.uri;
    const rel = path.relative(wsRoot, fileUri.fsPath);
    const parts = rel.split(path.sep);
    const dirParts = parts.slice(0, -1);
    const fileBase = path.basename(parts.pop()!, '.md');
    const folderKey = dirParts.length
        ? dirParts[dirParts.length - 1]
        : 'root';

    // 2. 构造两份 outline 的相对路径
    const outlineDirRel = dirParts.join('/');
    const folderOutlineRel = outlineDirRel
        ? `${outlineDirRel}/${folderKey}_dir_outline.md`
        : `root_dir_outline.md`;
    const fileOutlineRel = outlineDirRel
        ? `${outlineDirRel}/${fileBase}_outline.md`
        : `${fileBase}_outline.md`;

    // 3. 确保物理文件存在
    const physFolderPath = path.join(outlineRoot, folderOutlineRel);
    const physFilePath = path.join(outlineRoot, fileOutlineRel);
    fs.mkdirSync(path.dirname(physFolderPath), { recursive: true });
    if (!fs.existsSync(physFolderPath)) {
        fs.writeFileSync(physFolderPath, '# 文件夹大纲\n\n', 'utf8');
    }
    if (!fs.existsSync(physFilePath)) {
        fs.writeFileSync(physFilePath, '# 当前文件大纲\n\n', 'utf8');
    }

    // 4. 构造 andrea-outline:// URI
    const folderUri = vscode.Uri.parse(`${folderOutlineRel}`);
    const fileUri2 = vscode.Uri.parse(`${fileOutlineRel}`);
    if (!outlineFS) { return; }
    outlineFS.refreshByTraditionalRel(folderOutlineRel);
    outlineFS.refreshByTraditionalRel(fileOutlineRel);


    // 1) 在第二列打开“文件夹大纲”
    await vscode.commands.executeCommand(
        'vscode.open',
        vscode.Uri.parse('andrea-outline://outline/outline_dir'),
        { viewColumn: vscode.ViewColumn.Two, preview: false }
    );

    // 2) 聚焦到第二列
    await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');

    // 3) 在第二列里分屏（上下分）
    await vscode.commands.executeCommand('workbench.action.splitEditorDown');

    // 4) 把焦点移到下半屏
    await vscode.commands.executeCommand('workbench.action.focusBelowGroup');

    // 5) 打开“文件大纲”到下半屏（当前聚焦组）
    await vscode.commands.executeCommand(
        'vscode.open',
        vscode.Uri.parse('andrea-outline://outline/outline_file'),
        { preview: false }
    );
    // 6) 关闭下半屏中的文件夹大纲副本
    const tabs = vscode.window.tabGroups.activeTabGroup.tabs;
    const folderTab = tabs.find(tab =>
        tab.input instanceof vscode.TabInputText &&
        tab.input.uri.toString() === 'andrea-outline://outline/outline_dir'
    );

    if (folderTab) {
        await vscode.window.tabGroups.close(folderTab);
    }
    outlineFS.refreshDir();
    outlineFS.refreshFile();
}
