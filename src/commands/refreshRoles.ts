import { updateDecorations } from "../events/updateDecorations";
import { loadRoles } from "../utils/utils";
import * as vscode from 'vscode';

export const refreshRoles = () => {
    // 强制刷新所有角色库文件
    loadRoles(true);
    updateDecorations();
    vscode.window.showInformationMessage('所有库已手动刷新');
};