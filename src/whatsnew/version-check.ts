import * as vscode from 'vscode';
import { getWhatsNewData } from './whatsnew-data';
import { WhatsNewPanel } from './whatsnew-panel';

const LAST_SEEN_VERSION_KEY = 'anh.whatsnew.lastSeenVersion';

/**
 * 获取当前扩展版本号（来自 package.json）
 */
export function getExtensionVersion(context: vscode.ExtensionContext): string {
    return context.extension.packageJSON.version as string;
}

/**
 * 比较两个版本号（a > b 返回 true）
 * 支持 x.y.z 格式
 */
export function isVersionGreater(a: string, b: string): boolean {
    const normalize = (v: string) => v.replace(/^v/, '').replace(/\s*\(.+\)/, '').trim().split('.').map(Number);
    const aParts = normalize(a);
    const bParts = normalize(b);
    const maxLen = Math.max(aParts.length, bParts.length);

    for (let i = 0; i < maxLen; i++) {
        const aNum = aParts[i] || 0;
        const bNum = bParts[i] || 0;
        if (aNum > bNum) { return true; }
        if (aNum < bNum) { return false; }
    }
    return false;
}

/**
 * 检查并显示 What's New 页面
 * 仅在首次更新到新版本时自动弹出
 */
export async function checkAndShowWhatsNew(context: vscode.ExtensionContext): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const autoShow = cfg.get<boolean>('whatsNew.autoShow', true);
    if (!autoShow) {
        return;
    }

    const currentVersion = getExtensionVersion(context);
    const lastSeenVersion = context.globalState.get<string>(LAST_SEEN_VERSION_KEY);

    // 首次安装（没有 lastSeenVersion）或版本升级
    const shouldShow = !lastSeenVersion || isVersionGreater(currentVersion, lastSeenVersion);

    if (shouldShow) {
        const data = getWhatsNewData(context.extensionPath, currentVersion);
        if (data) {
            WhatsNewPanel.createOrShow(context.extensionUri, currentVersion, context.extensionPath);
        }
        // 无论是否成功获取内容，都更新版本号，避免反复尝试
        await context.globalState.update(LAST_SEEN_VERSION_KEY, currentVersion);
    }
}
