/* eslint-disable curly */
import * as vscode from 'vscode';
import { loadRoles } from '../activate';
import * as path from 'path';
import * as fs from 'fs';
import JSON5 from 'json5';
import { updateDecorations } from '../events/updateDecorations';

export const addVocabulary = async () => {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const vocabFile = cfg.get<string>('vocabularyFile')!;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;
    const fullPath = path.join(root, vocabFile);

    if (!fs.existsSync(fullPath)) {
        await vscode.window.showInformationMessage(
            `词汇库文件 "${vocabFile}" 不存在，先创建一个示例再继续…`,
            { modal: true },
            '关闭'
        );
        const example = [
            {
                name: "示例词汇",
                type: "词汇",
                description: "这是一个示例词汇。",
                color: "#00AAFF"
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
    vscode.window.showInformationMessage(`已初始化示例词汇库：${vocabFile}`, { modal: true }, '关闭');
    }

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
    vscode.window.showInformationMessage(`已添加词汇 "${name}" 到 ${vocabFile}`, { modal: true }, '关闭');

    loadRoles();
    updateDecorations();
};