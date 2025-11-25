/* eslint-disable curly */
import * as vscode from 'vscode';
import { loadRoles } from '../activate';
import * as path from 'path';
import { updateDecorations } from '../events/updateDecorations';
import { selectOrCreateFile } from './addRoleFileSelector';
import { addRoleToFile } from '../utils/roleFileHandler';
import { generateRoleNameHash } from '../utils/uuidUtils';

export const addVocabulary = async () => {
    // 从配置获取默认文件名并处理路径前缀
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    let defaultFileName = cfg.get<string>('vocabularyFile') || '词汇库.json5';
    
    // 如果配置路径包含novel-helper/前缀，移除它
    if (defaultFileName.startsWith('novel-helper/')) {
        defaultFileName = defaultFileName.substring('novel-helper/'.length);
    }
    
    // 选择或创建词汇文件（支持多种格式，只显示词汇文件）
    const fullPath = await selectOrCreateFile(
        '词汇',
        defaultFileName,
        {
            includeMd: true,      // 支持 Markdown 格式
            includeOjson5: true,   // 支持 OJSON5 格式
            // 添加词汇特定过滤：排除角色和敏感词相关文件
            customFilter: (fileName: string) => {
                const lowerFileName = fileName.toLowerCase();
                // 排除角色相关文件
                const roleKeywords = ['character', 'role', 'gallery', '角色', '人物'];
                // 敏感词文件已在基本过滤中处理
                return !roleKeywords.some(keyword => lowerFileName.includes(keyword));
            }
        }
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

    // 创建新词汇对象
    const newVocab: any = {
        name,
        type: "词汇",
        uuid: generateRoleNameHash(name)
    };
    if (description) newVocab.description = description;
    if (color) newVocab.color = color;

    // 使用统一的文件处理函数添加词汇
    const success = addRoleToFile(fullPath, newVocab);

    if (success) {
        const fileName = path.basename(fullPath);
        vscode.window.showInformationMessage(`已添加词汇 "${name}" 到 ${fileName}`, { modal: true }, '关闭');
    } else {
        vscode.window.showErrorMessage(`添加词汇失败`);
        return;
    }

    loadRoles();
    updateDecorations();
};