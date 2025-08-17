import { updateDecorations } from "../events/updateDecorations";
import { loadRoles } from "../utils/utils";
import * as vscode from 'vscode';

export const refreshRoles = () => {
    // 强制刷新所有角色库文件
    loadRoles(true);
    updateDecorations();
    // 简洁通知（非阻塞）
    vscode.window.setStatusBarMessage('$(sync) 角色/词汇/敏感词库已刷新', 3000);
};