/* eslint-disable curly */
import * as vscode from 'vscode';
import { loadRoles } from '../activate';
import * as path from 'path';
import * as fs from 'fs';
import JSON5 from 'json5';
import { updateDecorations } from '../events/updateDecorations';
import { selectOrCreateFile } from './addRoleFileSelector';

export const addVocabulary = async () => {
    // 从配置获取默认文件名并处理路径前缀
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    let defaultFileName = cfg.get<string>('vocabularyFile') || '词汇库.json5';
    
    // 如果配置路径包含novel-helper/前缀，移除它
    if (defaultFileName.startsWith('novel-helper/')) {
        defaultFileName = defaultFileName.substring('novel-helper/'.length);
    }
    
    // 选择或创建词汇文件（创建空文件）
    const fullPath = await selectOrCreateFile(
        '词汇',
        defaultFileName
    );
    
    if (!fullPath) {
        return; // 用户取消或出错
    }

    // 文件已存在，直接使用（选择或创建函数已经处理了文件创建）

    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const sel = editor.selection;
    const name = editor.document.getText(sel).trim();
    if (!name) {
        vscode.window.showWarningMessage('请选择文本作为词汇');
        return;
    }

    const description = await vscode.window.showInputBox({
        placeHolder: '输入词汇简介（可选）'
    });
    const color = await vscode.window.showInputBox({
        placeHolder: '输入十六进制颜色，如 #00AAFF（可选）',
        validateInput: v => {
            return v && !/^#([0-9A-Fa-f]{6})$/.test(v) ? '请输入合法的 #RRGGBB 形式' : null;
        }
    });

    let arr: any[];
    try {
        const text = fs.readFileSync(fullPath, 'utf8');
        arr = JSON5.parse(text) as any[];
    } catch (e) {
        vscode.window.showErrorMessage(`解析词汇库失败: ${e}`);
        return;
    }

    const newVocab: any = { name, type: "词汇" };
    if (description) newVocab.description = description;
    if (color) newVocab.color = color;

    arr.push(newVocab);
    fs.writeFileSync(fullPath, JSON5.stringify(arr, null, 2), 'utf8');
    const fileName = path.basename(fullPath);
    vscode.window.showInformationMessage(`已添加词汇 "${name}" 到 ${fileName}`, { modal: true }, '关闭');

    loadRoles();
    updateDecorations();
};