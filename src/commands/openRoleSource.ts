/* src/commands/openRoleSource.ts */
import * as vscode from 'vscode';
import { findDefinitionInFile } from '../Provider/defProv';   // ← 路径按你的项目结构调整
import { Role } from '../extension';                          // ← 仅用到 name / sourcePath

export const OpenRoleSourceCommandId = 'andrea.openRoleSource';

type ArgsTuple = [string, string]; // [roleName, fsPath]

/** 解析命令入参，兼容多种形态 */
function parseArgs(args: any[]): { name?: string; fsPath?: string } {
    let name: string | undefined;
    let fsPath: string | undefined;

    const a0 = args[0];

    // 1) 常见：数组作为第一个入参  [name, fsPath]
    if (Array.isArray(a0) && typeof a0[0] === 'string') {
        [name, fsPath] = a0 as ArgsTuple;
    }
    // 2) 也可能被还原成两个独立参数
    else if (typeof args[0] === 'string' && typeof args[1] === 'string') {
        [name, fsPath] = args as unknown as ArgsTuple;
    }
    // 3) JSON 字符串
    else if (typeof a0 === 'string') {
        try {
            const parsed = JSON.parse(a0);
            if (Array.isArray(parsed)) {[name, fsPath] = parsed as ArgsTuple;}
            else if (parsed && typeof parsed === 'object') {
                name = parsed.name ?? parsed.roleName;
                fsPath = parsed.fsPath ?? parsed.path;
            }
        } catch { /* ignore */ }
    }
    // 4) 单对象
    else if (a0 && typeof a0 === 'object') {
        name = a0.name ?? a0.roleName;
        fsPath = a0.fsPath ?? a0.path;
    }

    return { name, fsPath };
}

/** 注册 andrea.openRoleSource 命令 */
export function registerOpenRoleSource(context: vscode.ExtensionContext) {
    const disp = vscode.commands.registerCommand(OpenRoleSourceCommandId, async (...args: any[]) => {
        // 调试日志（可按需关闭）
        try { console.log('[andrea.openRoleSource] raw args:', JSON.stringify(args)); }
        catch { console.log('[andrea.openRoleSource] raw args (non-serializable):', args); }

        try {
            let { name, fsPath } = parseArgs(args);

            if (!name || !fsPath) {
                vscode.window.showErrorMessage('[andrea.openRoleSource] 参数缺失：需要 [name, fsPath]');
                return;
            }

            // 统一本地文件路径（Windows 分隔符更稳）
            fsPath = vscode.Uri.file(fsPath).fsPath;

            // 用最小 Role 信息计算定义位置
            const roleStub = { name, sourcePath: fsPath } as unknown as Role;
            const loc =
                findDefinitionInFile(roleStub, fsPath) ??
                new vscode.Location(vscode.Uri.file(fsPath), new vscode.Position(0, 0));

            // 打开并定位
            const doc = await vscode.workspace.openTextDocument(loc.uri);
            const editor = await vscode.window.showTextDocument(doc, { preview: false });
            const p = loc.range?.start ?? new vscode.Position(0, 0);
            editor.selection = new vscode.Selection(p, p);
            editor.revealRange(new vscode.Range(p, p), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        } catch (err) {
            console.error('[andrea.openRoleSource] failed:', err);
            vscode.window.showErrorMessage('[andrea.openRoleSource] 打开/定位失败，详见控制台日志。');
        }
    });

    context.subscriptions.push(disp);
}
