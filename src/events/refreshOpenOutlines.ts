import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { outlineFS } from '../activate';
import { ensureOutlineFileExists } from '../utils/outline';

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
    const temp =parts.pop()!;
    const baseName = path.basename(temp, '.md');
    const folderKey = dirParts.length ? dirParts[dirParts.length - 1] : 'root';
    const outlineDirRel = dirParts.join('/');
    const folderOutlineRel = outlineDirRel
        ? `${outlineDirRel}/${folderKey}_dir_outline.md`
        : `root_dir_outline.md`;
    const fileOutlineRel = outlineDirRel
        ? `${outlineDirRel}/${baseName}_outline.md`
        : `${baseName}_outline.md`;
    const fullFileName = path.basename(temp);


    // 3. 确保物理文件存在
    const physFolderPath = path.join(outlineRoot, folderOutlineRel);
    const physFilePath = path.join(outlineRoot, fileOutlineRel);
    fs.mkdirSync(path.dirname(physFolderPath), { recursive: true });
    ensureOutlineFileExists(
        physFolderPath,
        '📁目录大纲',
        `目录：${folderKey}`
    );

    ensureOutlineFileExists(
        physFilePath,
        '📄文件大纲',
        `文件：${fullFileName}`
    );

    if (outlineFS !== undefined) {
        console.log(`[RefreshOutlines] 刷新大纲：${folderOutlineRel} & ${fileOutlineRel}`);
        outlineFS.refreshByTraditionalRel(folderOutlineRel);
        outlineFS.refreshByTraditionalRel(fileOutlineRel);
    }else {
        console.warn('[RefreshOutlines] outlineFS 未定义，无法刷新大纲');
    }
}