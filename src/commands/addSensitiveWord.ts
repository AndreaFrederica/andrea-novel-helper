/* eslint-disable curly */
import * as vscode from 'vscode';
import { loadRoles } from '../activate';
import * as path from 'path';
import * as fs from 'fs';
import JSON5 from 'json5';
import { updateDecorations } from '../events/updateDecorations';



export const addSensitiveCmd_obj = async () => {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const sensitiveFile = cfg.get<string>('sensitiveWordsFile')!;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;
    const fullPath = path.join(root, sensitiveFile);

    // 当敏感词库文件不存在时，初始化示例
    if (!fs.existsSync(fullPath)) {
        await vscode.window.showInformationMessage(
            `敏感词库文件 "${sensitiveFile}" 不存在，先创建一个示例再继续…`
        );
        const example = [
            {
                name: "示例敏感词",
                type: "敏感词",
                description: "这是一个示例敏感词。",
                color: "#FF0000"
            }
        ];
        // txt库
        const txtPath = fullPath.replace(/\.[^/.]+$/, ".txt");
        if (!fs.existsSync(txtPath)) {
            const txtContent = example.map(item => item.name).join('\n');
            fs.writeFileSync(txtPath, txtContent, 'utf8');
        }
        // json5库
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, JSON5.stringify(example, null, 2), 'utf8');
        vscode.window.showInformationMessage(`已初始化示例敏感词库：${sensitiveFile}`);
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
    vscode.window.showInformationMessage(`已添加敏感词 "${name}" 到 ${sensitiveFile}`);

    // 刷新全局角色列表（包括特殊角色）
    loadRoles();
    updateDecorations();
};
