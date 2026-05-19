/* eslint-disable curly */
import * as vscode from 'vscode';
import { loadRoles } from '../activate';
import * as path from 'path';
import { updateDecorations } from '../events/updateDecorations';
import { selectOrCreateFile } from './addRoleFileSelector';
import { addRoleToFile } from '../utils/roleFileHandler';
import { generateRoleNameHash } from '../utils/uuidUtils';



export const addSensitiveCmd_obj = async () => {
    // 从配置获取默认文件名并处理路径前缀
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    let defaultFileName = cfg.get<string>('sensitiveWordsFile') || '敏感词库.json5';
    
    // 如果配置路径包含novel-helper/前缀，移除它
    if (defaultFileName.startsWith('novel-helper/')) {
        defaultFileName = defaultFileName.substring('novel-helper/'.length);
    }
    
    // 选择或创建敏感词文件（支持多种格式）
    const fullPath = await selectOrCreateFile(
        '敏感词',
        defaultFileName,
        {
            includeMd: true,      // 支持 Markdown 格式
            includeOjson5: true,   // 支持 OJSON5 格式
            includeCsv: true,      // 支持 CSV 格式
            includeToml: true,     // 支持 TOML 格式
            // 添加敏感词特定过滤：排除角色和词汇相关文件
            customFilter: (fileName: string) => {
                const lowerFileName = fileName.toLowerCase();
                // 排除角色相关文件
                const roleKeywords = ['character', 'role', 'gallery', '角色', '人物'];
                // 排除词汇相关文件
                const vocabKeywords = ['vocabulary', 'vocab', 'term', '词汇', '术语'];
                return !roleKeywords.some(keyword => lowerFileName.includes(keyword)) &&
                       !vocabKeywords.some(keyword => lowerFileName.includes(keyword));
            }
        }
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

    // 创建新敏感词对象
    const newSensitive: any = {
        name,
        type: "敏感词",
        uuid: generateRoleNameHash(name),
        color: color || "#FF0000"
    };
    if (description) newSensitive.description = description;

    // 使用统一的文件处理函数添加敏感词
    const success = addRoleToFile(fullPath, newSensitive);

    if (success) {
        const fileName = path.basename(fullPath);
        vscode.window.showInformationMessage(`已添加敏感词 "${name}" 到 ${fileName}`, { modal: true }, '关闭');
    } else {
        vscode.window.showErrorMessage(`添加敏感词失败`);
        return;
    }

    // 刷新刚写入的敏感词文件，避免全量重扫导致高亮短暂丢失
    loadRoles(false, [fullPath]);
    updateDecorations();
};
