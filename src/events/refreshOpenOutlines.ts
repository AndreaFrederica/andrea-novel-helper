import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function refreshOpenOutlines() {
    const active = vscode.window.activeTextEditor;
    if (!active || active.document.uri.scheme !== 'file') {
        return;
    }

    // —— 1) 复用 openDoubleOutline 逻辑，计算当前文件对应的两条 outline 相对路径 —— 
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const outlineRootRel = cfg.get<string>('outlinePath', 'novel-helper/outline');
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders?.length) { return; }
    const wsRoot = wsFolders[0].uri.fsPath;
    const outlineRoot = path.join(wsRoot, outlineRootRel);

    const rel = path.relative(wsRoot, active.document.uri.fsPath);
    const parts = rel.split(path.sep);
    const dirParts = parts.slice(0, -1);
    const baseName = path.basename(parts.pop()!, '.md');
    const folderKey = dirParts.length ? dirParts[dirParts.length - 1] : 'root';
    const outlineDirRel = dirParts.join('/');
    const folderOutlineRel = outlineDirRel
        ? `${outlineDirRel}/${folderKey}_dir_outline.md`
        : `root_dir_outline.md`;
    const fileOutlineRel = outlineDirRel
        ? `${outlineDirRel}/${baseName}_outline.md`
        : `${baseName}_outline.md`;

    // —— 2) 确保物理目录和文件存在 —— 
    const physFolderPath = path.join(outlineRoot, folderOutlineRel);
    const physFilePath = path.join(outlineRoot, fileOutlineRel);
    fs.mkdirSync(path.dirname(physFolderPath), { recursive: true });
    if (!fs.existsSync(physFolderPath)) {
        fs.writeFileSync(physFolderPath, '# 文件夹大纲\n\n', 'utf8');
    }
    if (!fs.existsSync(physFilePath)) {
        fs.writeFileSync(physFilePath, '# 当前文件大纲\n\n', 'utf8');
    }

    // —— 3) 构造 andrea-outline:// URI —— 
    const folderUri = vscode.Uri.parse(`andrea-outline://outline/${folderOutlineRel}`);
    const fileUri = vscode.Uri.parse(`andrea-outline://outline/${fileOutlineRel}`);

    // —— 4) 在已打开的 outline 编辑器里分别刷新 —— 
    let folderEditor: vscode.TextEditor | undefined;
    let fileEditor: vscode.TextEditor | undefined;

    for (const ed of vscode.window.visibleTextEditors) {
        if (ed.document.uri.scheme !== 'andrea-outline') {
            continue;
        }
        const p = ed.document.uri.path;
        if (p.endsWith('_dir_outline.md')) {
            folderEditor = ed;
        } else if (p.endsWith('_outline.md')) {
            fileEditor = ed;
        }
    }

    if (folderEditor) {
        vscode.commands.executeCommand(
            'vscode.open',
            folderUri,
            { viewColumn: folderEditor.viewColumn, preview: false }
        );
    }
    if (fileEditor) {
        vscode.commands.executeCommand(
            'vscode.open',
            fileUri,
            { viewColumn: fileEditor.viewColumn, preview: false }
        );
    }
}
