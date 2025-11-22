/* eslint-disable curly */
import * as vscode from 'vscode';
import { loadRoles } from '../activate';
import * as path from 'path';
import * as fs from 'fs';
import JSON5 from 'json5';
import { updateDecorations } from '../events/updateDecorations';
import { generateExampleRoleList } from '../templates/templateGenerators';
import { selectOrCreateFile } from './addRoleFileSelector';

export const addRoleFromSelection = async () => {
    // 从配置获取默认文件名并处理路径前缀
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    let defaultFileName = cfg.get<string>('rolesFile') || '角色库.json5';
    
    // 如果配置路径包含novel-helper/前缀，移除它
    if (defaultFileName.startsWith('novel-helper/')) {
        defaultFileName = defaultFileName.substring('novel-helper/'.length);
    }
    
    // 选择或创建角色文件（不传入示例数据，创建空文件）
    const fullPath1 = await selectOrCreateFile(
        '角色',
        defaultFileName
    );
    
    if (!fullPath1) {
        return; // 用户取消或出错
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const sel = editor.selection;
    const name = editor.document.getText(sel).trim();
    if (!name) {
        vscode.window.showWarningMessage('请选择文本作为角色名称');
        return;
    }

    const type = await vscode.window.showQuickPick(
        ['主角', '配角', '联动角色'],
        { placeHolder: '选择角色类型' }
    );
    if (!type) return;

    const affiliation = await vscode.window.showInputBox({ placeHolder: '输入从属标签（可选）' });
    const description = await vscode.window.showInputBox({ placeHolder: '输入角色简介（可选）' });
    const color = await vscode.window.showInputBox({
        placeHolder: '输入十六进制颜色，如 #E60033（可选）',
        validateInput: v => v && !/^#([0-9A-Fa-f]{6})$/.test(v) ? '请输入合法的 #RRGGBB 形式' : null
    });

    // 使用已选择的文件路径
    const fullPath = fullPath1;

    let arr: any[];
    try {
        arr = JSON5.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch (e) {
        return vscode.window.showErrorMessage(`解析角色库失败: ${e}`);
    }

    const newRole: any = { name, type };
    if (affiliation) newRole.affiliation = affiliation;
    if (description) newRole.description = description;
    if (color) newRole.color = color;

    arr.push(newRole);
    fs.writeFileSync(fullPath, JSON5.stringify(arr, null, 2), 'utf8');
    const fileName = path.basename(fullPath);
    vscode.window.showInformationMessage(`已添加角色 "${name}" 到 ${fileName}`);

    // 刷新
    loadRoles();
    updateDecorations();
};