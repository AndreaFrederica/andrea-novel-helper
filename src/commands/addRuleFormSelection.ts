/* eslint-disable curly */
import * as vscode from 'vscode';
import { loadRoles } from '../activate';
import * as path from 'path';
import { updateDecorations } from '../events/updateDecorations';
import { selectOrCreateFile } from './addRoleFileSelector';
import { addRoleToFile } from '../utils/roleFileHandler';
import { generateRoleNameHash } from '../utils/uuidUtils';

export const addRoleFromSelection = async () => {
    // 从配置获取默认文件名并处理路径前缀
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    let defaultFileName = cfg.get<string>('rolesFile') || '角色库.json5';
    
    // 如果配置路径包含novel-helper/前缀，移除它
    if (defaultFileName.startsWith('novel-helper/')) {
        defaultFileName = defaultFileName.substring('novel-helper/'.length);
    }
    
    // 选择或创建角色文件（支持多种格式，只显示角色文件）
    const fullPath1 = await selectOrCreateFile(
        '角色',
        defaultFileName,
        {
            includeMd: true,      // 支持 Markdown 格式
            includeOjson5: true,   // 支持 OJSON5 格式
            includeCsv: true,      // 支持 CSV 格式
            // 添加角色特定过滤：排除词汇相关文件
            customFilter: (fileName: string) => {
                const lowerFileName = fileName.toLowerCase();
                // 排除词汇相关文件 - 如果包含词汇关键词就过滤掉
                const vocabKeywords = ['vocabulary', 'vocab', 'term', '词汇', '术语'];
                return !vocabKeywords.some(keyword => lowerFileName.includes(keyword));
            }
        }
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

    // 创建新角色对象
    const newRole: any = {
        name,
        type,
        uuid: generateRoleNameHash(name)
    };
    if (affiliation) newRole.affiliation = affiliation;
    if (description) newRole.description = description;
    if (color) newRole.color = color;

    // 使用统一的文件处理函数添加角色
    const success = addRoleToFile(fullPath, newRole);

    if (success) {
        const fileName = path.basename(fullPath);
        vscode.window.showInformationMessage(`已添加角色 "${name}" 到 ${fileName}`);
    } else {
        vscode.window.showErrorMessage(`添加角色失败`);
        return;
    }

    // 刷新刚写入的角色文件，避免全量重扫导致高亮短暂丢失
    loadRoles(false, [fullPath]);
    updateDecorations();
};