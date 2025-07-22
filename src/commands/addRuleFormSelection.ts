/* eslint-disable curly */
import * as vscode from 'vscode';
import { loadRoles } from '../activate';
import * as path from 'path';
import * as fs from 'fs';
import JSON5 from 'json5';
import { updateDecorations } from '../events/updateDecorations';

export const addRoleFromSelection = async () => {
    // 确保角色库存在
    const cfg1 = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const rolesFile = cfg1.get<string>('rolesFile')!;
    const root1 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root1) return;
    const fullPath1 = path.join(root1, rolesFile);
    if (!fs.existsSync(fullPath1)) {
        await vscode.window.showInformationMessage(
            `角色库 "${rolesFile}" 不存在，先创建一个示例再继续…`
        );
        // 复用示例创建逻辑
        const example = [{
            name: "示例角色",
            type: "配角",
            affiliation: "示例阵营",
            aliases: ["示例"],
            description: "这是一个示例角色，用于说明角色库格式。",
            color: "#FFA500"
        }];
        const txtPath = fullPath1.replace(/\.[^/.]+$/, ".txt");
        if (!fs.existsSync(txtPath)) {
            fs.writeFileSync(txtPath, example.map(i => i.name).join('\n'), 'utf8');
        }
        fs.mkdirSync(path.dirname(fullPath1), { recursive: true });
        fs.writeFileSync(fullPath1, JSON5.stringify(example, null, 2), 'utf8');
        vscode.window.showInformationMessage(`已初始化示例角色库：${rolesFile}`);
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

    // 读写 JSON5
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const file = cfg.get<string>('rolesFile')!;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return vscode.window.showErrorMessage('未找到工作区根目录');
    const fullPath = path.join(root, file);
    if (!fs.existsSync(fullPath)) {
        return vscode.window.showErrorMessage(`角色库文件不存在: ${file}`);
    }

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
    vscode.window.showInformationMessage(`已添加角色 "${name}" 到 ${file}`);

    // 刷新
    loadRoles();
    updateDecorations();
};