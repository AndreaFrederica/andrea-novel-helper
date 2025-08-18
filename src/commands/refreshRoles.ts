import { updateDecorations } from "../events/updateDecorations";
import { loadRoles } from "../utils/utils";
import { roles } from "../activate";
import * as vscode from 'vscode';

export const refreshRoles = () => {
    // 强制刷新所有角色库文件
    loadRoles(true);
    
    // 调试：检查加载的角色数据
    console.log('[RefreshRoles] 当前角色数量:', roles.length);
    const rolesWithFixes = roles.filter(r => (r as any).fixes || (r as any).fixs);
    console.log('[RefreshRoles] 具有 fixes 的角色数量:', rolesWithFixes.length);
    if (rolesWithFixes.length > 0) {
        console.log('[RefreshRoles] 具有 fixes 的角色示例:', rolesWithFixes.slice(0, 3).map(r => ({
            name: r.name,
            fixes: (r as any).fixes || (r as any).fixs
        })));
    }
    
    updateDecorations();
    // 简洁通知（非阻塞）
    vscode.window.setStatusBarMessage('$(sync) 角色/词汇/敏感词库已刷新', 3000);
};