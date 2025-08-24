import * as vscode from 'vscode';
import { Role } from '../extension';
import {hoverRangesMap} from '../Provider/hoverProvider';

/**
 * 注册并导出打开文件并定位的命令：andrea.openFileAt
 * 支持三种参数格式：
 *  - Array: [fsPath, line, char]
 *  - (fsPath, line, char)
 *  - Object: { fsPath, line, character }
 */
export async function ensureRegisterOpenFileAt(context: vscode.ExtensionContext) {
    const cmds = await vscode.commands.getCommands(true);
    if (cmds.includes('andrea.openFileAt')) { return; }

    context.subscriptions.push(
        vscode.commands.registerCommand('andrea.openFileAt', async (...args: any[]) => {
            console.log('[andrea.openFileAt] raw args:', args?.[0]); // 调试可留

            let fsPath: string | undefined;
            let line = 0, ch = 0;

            // 1) 优先吃标准三元组：[fsPath, line, char]
            if (Array.isArray(args[0]) && typeof args[0][0] === 'string') {
                fsPath = args[0][0];
                line = Number(args[0][1] ?? 0);
                ch = Number(args[0][2] ?? 0);
            }
            // 2) 单个对象 { fsPath,line,character } 或 { path, line, char }
            else if (args[0] && typeof args[0] === 'object') {
                const a0 = args[0] as any;
                fsPath = a0.fsPath ?? a0.path;
                line = Number(a0.line ?? a0.ln ?? 0);
                ch = Number(a0.character ?? a0.char ?? a0.ch ?? 0);
            }
            // 3) 字符串化 JSON
            else if (typeof args[0] === 'string') {
                try {
                    const a0 = JSON.parse(args[0]);
                    if (Array.isArray(a0)) {
                        fsPath = a0[0]; line = Number(a0[1] ?? 0); ch = Number(a0[2] ?? 0);
                    } else if (a0 && typeof a0 === 'object') {
                        fsPath = a0.fsPath ?? a0.path;
                        line = Number(a0.line ?? a0.ln ?? 0);
                        ch = Number(a0.character ?? a0.char ?? a0.ch ?? 0);
                    }
                } catch { /* ignore */ }
            }

            // 4) ✅ 零参数兜底：从当前光标位置查命中角色，再打开其源位置
            if (!fsPath) {
                const ed = vscode.window.activeTextEditor;
                if (ed) {
                    const pos = ed.selection.active;
                    const key = ed.document.uri.toString();

                    // 这里直接复用你的 hoverRangesMap（需要在此文件可 import）
                    // 如果不方便 import，可提供一个查询函数
                    try {
                        const hit = (hoverRangesMap.get(key) || []).find((h: any) => h.range.contains(pos));
                        const role = hit?.role as Role | undefined;
                        if (role?.sourcePath) {
                            fsPath = vscode.Uri.file(role.sourcePath).fsPath;
                            line = 0; ch = 0; // 需要更精确可在 JSON5 里查 name 位置
                        }
                    } catch { /* ignore */ }
                }
            }

            if (!fsPath) {
                vscode.window.showErrorMessage('[andrea.openFileAt] 缺少 fsPath');
                return;
            }

            const target = vscode.Uri.file(fsPath);
            const doc = await vscode.workspace.openTextDocument(target);
            const editor = await vscode.window.showTextDocument(doc, { preview: false });
            const pos = new vscode.Position(line, ch);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        })
    );
}

export default ensureRegisterOpenFileAt;
