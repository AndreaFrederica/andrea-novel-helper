/* eslint-disable curly */
// src/completionProvider.ts
import * as vscode from 'vscode';
import { Role } from './extension';
import { getPrefix, getSupportedLanguages, typeColorMap } from './utils';

export function createCompletionProvider(roles: Role[]): vscode.Disposable {
    return vscode.languages.registerCompletionItemProvider(
        getSupportedLanguages(),
        {
            provideCompletionItems(document, position) {
                const line = document.lineAt(position).text.slice(0, position.character);
                const prefix = getPrefix(line);
                if (!prefix) return;

                const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
                const min = cfg.get<number>('minChars')!;
                if (prefix.length < min) return;
                const defaultColor = cfg.get<string>('defaultColor')!;

                // 1. 先筛角色
                const matchedRoles = roles.filter(role => {
                    const names = [role.name, ...(role.aliases || [])];
                    return names.some(n => n.includes(prefix));
                });
                if (!matchedRoles.length) return;

                // 2. 生成所有名称的 CompletionItem
                const items: vscode.CompletionItem[] = [];
                let roleIdx = 0;
                for (const role of matchedRoles) {
                    const allNames = [role.name, ...(role.aliases || [])];
                    // 内部排序：开头匹配→包含匹配
                    allNames.sort((a, b) => {
                        const ak = a.startsWith(prefix) ? 0 : a.includes(prefix) ? 1 : 2;
                        const bk = b.startsWith(prefix) ? 0 : b.includes(prefix) ? 1 : 2;
                        if (ak !== bk) return ak - bk;
                        return a.localeCompare(b, 'zh');
                    });

                    let nameIdx = 0;
                    for (const nameItem of allNames) {
                        const item = new vscode.CompletionItem(nameItem, vscode.CompletionItemKind.Text);
                        item.insertText = nameItem;
                        item.range = new vscode.Range(
                            position.line,
                            position.character - prefix.length,
                            position.line,
                            position.character
                        );
                        // 让 filterText = prefix + 名称，既能保留包含匹配，也能让 VSCode 不丢
                        item.filterText = prefix + nameItem;

                        // detail
                        const details: string[] = [];
                        if (role.description) details.push(role.description);
                        details.push(`类型: ${role.type}`);
                        if (role.affiliation) details.push(`从属: ${role.affiliation}`);
                        item.detail = details.join(' | ');

                        // documentation
                        const md = new vscode.MarkdownString();
                        const color = role.color || typeColorMap[role.type] || defaultColor;
                        md.appendMarkdown(`**颜色**: <span style="color:${color}">■</span> \`${color}\``);
                        md.appendMarkdown(`\n\n**类型**: ${role.type}`);
                        if (role.affiliation) md.appendMarkdown(`\n\n**从属**: ${role.affiliation}`);
                        md.isTrusted = true;
                        item.documentation = md;

                        // sortText 保证整体有序
                        const nameKind = nameItem.startsWith(prefix) ? 0 : 1;
                        item.sortText =
                            `${roleIdx.toString().padStart(3, '0')}_` +
                            `${nameKind}_` +
                            `${nameIdx.toString().padStart(3, '0')}`;

                        items.push(item);
                        nameIdx++;
                    }
                    roleIdx++;
                }

                return items;
            }
        }
    );
}
