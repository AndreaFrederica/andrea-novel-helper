import * as vscode from 'vscode';
import { SmartTabGroupLockManager } from './smartTabGroupLock';

/**
 * 智能标签组锁定激活器
 * 提供给外部使用的激活函数
 */
export function activateSmartTabGroupLock(context: vscode.ExtensionContext): SmartTabGroupLockManager {
    return new SmartTabGroupLockManager(context);
}

/**
 * 检查智能标签组锁定功能是否启用
 */
export function isSmartTabGroupLockEnabled(): boolean {
    return vscode.workspace.getConfiguration('AndreaNovelHelper.smartTabGroupLock').get('enabled', false);
}