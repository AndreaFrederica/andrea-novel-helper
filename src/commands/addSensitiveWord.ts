/* eslint-disable curly */
import * as vscode from 'vscode';
import { loadRoles } from '../activate';
import * as path from 'path';
import * as fs from 'fs';
import JSON5 from 'json5';
import { updateDecorations } from '../events/updateDecorations';
import { selectOrCreateFile } from './addRoleFileSelector';



export const addSensitiveCmd_obj = async () => {
    // 从配置获取默认文件名并处理路径前缀
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    let defaultFileName = cfg.get<string>('sensitiveWordsFile') || '敏感词库.json5';
    
    // 如果配置路径包含novel-helper/前缀，移除它
    if (defaultFileName.startsWith('novel-helper/')) {
        defaultFileName = defaultFileName.substring('novel-helper/'.length);
    }
    
    // 选择或创建敏感词文件（不传入示例数据，创建空文件）
    const fullPath = await selectOrCreateFile(
        '敏感词',
        defaultFileName
    );
    
    if (!fullPath) {
        return; // 用户取消或出错
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const sel = editor.selection;
    const name = editor.document.getText(sel).trim();
    if (!name) {
        vscode.window.showWarningMessage('请选择文本作为敏感词');
        return;
    }

    // 不询问类型，直接固定为 "敏感词"
    const description = await vscode.window.showInputBox({
        placeHolder: '输入敏感词简介（可选）'
    });
    const color = await vscode.window.showInputBox({
        placeHolder: '输入十六进制颜色，如 #FF0000（可选，默认为红色）',
        validateInput: v => {
            return v && !/^#([0-9A-Fa-f]{6})$/.test(v) ? '请输入合法的 #RRGGBB 形式' : null;
        }
    });

    let arr: any[];
    try {
        const text = fs.readFileSync(fullPath, 'utf8');
        arr = JSON5.parse(text) as any[];
    } catch (e) {
        vscode.window.showErrorMessage(`解析敏感词库失败: ${e}`);
        return;
    }

    // 若用户未输入颜色，则使用红色作为默认颜色
    const newSensitive: any = { name, type: "敏感词" };
    if (description) newSensitive.description = description;
    newSensitive.color = color || "#FF0000";

    arr.push(newSensitive);
    fs.writeFileSync(fullPath, JSON5.stringify(arr, null, 2), 'utf8');
    const fileName = path.basename(fullPath);
    vscode.window.showInformationMessage(`已添加敏感词 "${name}" 到 ${fileName}`, { modal: true }, '关闭');

    // 刷新全局角色列表（包括特殊角色）
    loadRoles();
    updateDecorations();
};
