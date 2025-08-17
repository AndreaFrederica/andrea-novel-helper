/* eslint-disable curly */
// src/completionProvider.ts
import * as vscode from 'vscode';
import { Role } from '../extension';
import { getPrefix, typeColorMap } from '../utils/utils';
// 直接使用 activate.ts 中导出的全局 roles（通过就地清空+push 异步增量保持引用最新）
import { roles } from '../activate';
import { FIELD_ALIASES, getExtensionFields } from '../utils/markdownParser';

/**
 * 检查内容是否包含 Markdown 格式
 */
function containsMarkdownFormatting(content: string): boolean {
    if (!content) return false;
    
    // 检查内容是否已经包含 Markdown 格式或列表符号
    const hasMarkdownFormatting = /(\*\*|__|\*|_|`|#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|^>\s)/m.test(content);
    const hasUnicodeList = /^[\s]*[•◦▪▫‣⁃∙▸▹▻►⋆★☆♦♧♠♣♡♢]\s/m.test(content);
    const hasChineseList = /^[\s]*([一二三四五六七八九十]+[、．]|\d+[、．]|[（(]\d+[）)]|[（(][一二三四五六七八九十]+[）)])\s/m.test(content);
    
    return hasMarkdownFormatting || hasUnicodeList || hasChineseList;
}

/**
 * 格式化内容以在 Markdown 中正确显示
 */
function formatContentForDisplay(content: string): string {
    if (!content) return '';
    
    // 检查内容是否已经包含 Markdown 格式或列表符号
    const hasMarkdownFormatting = /(\*\*|__|\*|_|`|#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|^>\s)/m.test(content);
    const hasUnicodeList = /^[\s]*[•◦▪▫‣⁃∙▸▹▻►⋆★☆♦♧♠♣♡♢]\s/m.test(content);
    const hasChineseList = /^[\s]*([一二三四五六七八九十]+[、．]|\d+[、．]|[（(]\d+[）)]|[（(][一二三四五六七八九十]+[）)])\s/m.test(content);
    
    if (hasMarkdownFormatting || hasUnicodeList || hasChineseList) {
        // 内容已经包含格式，需要转换为 Markdown 兼容格式
        return convertToMarkdownList(content);
    } else {
        // 纯文本内容，智能处理换行
        return handlePlainTextContent(content);
    }
}

/**
 * 处理纯文本内容的换行
 */
function handlePlainTextContent(content: string): string {
    const lines = content.split('\n');
    
    // 如果只有一行或两行，直接用硬换行
    if (lines.length <= 2) {
        return content.replace(/\n/g, '  \n');
    }
    
    // 对于多行内容，检查是否是段落格式
    const processedLines = lines.map((line, index) => {
        const trimmedLine = line.trim();
        
        // 空行保持空行
        if (trimmedLine === '') {
            return '';
        }
        
        // 检查当前行是否可能是段落的开始（较长的行）
        const isLongLine = trimmedLine.length > 20;
        const nextLine = index < lines.length - 1 ? lines[index + 1].trim() : '';
        const prevLine = index > 0 ? lines[index - 1].trim() : '';
        
        // 如果当前行很长，且下一行也很长（可能是连续的段落），则不添加硬换行
        if (isLongLine && nextLine.length > 20 && nextLine !== '') {
            return line;
        }
        
        // 如果当前行较短，或者是最后一行，或者下一行是空行，则添加硬换行
        if (!isLongLine || index === lines.length - 1 || nextLine === '') {
            return line + '  ';
        }
        
        return line;
    });
    
    return processedLines.join('\n');
}

/**
 * 将各种列表格式转换为 Markdown 兼容格式
 */
function convertToMarkdownList(content: string): string {
    let result = content
        // 将 Unicode 列表符号转换为 Markdown 格式
        .replace(/^([\s]*)[•◦▪▫‣⁃∙▸▹▻►⋆★☆♦♧♠♣♡♢]\s*/gm, '$1- ')
        // 将中文编号转换为 Markdown 格式
        .replace(/^([\s]*)([一二三四五六七八九十]+[、．]|\d+[、．])\s*/gm, '$1- ')
        .replace(/^([\s]*)[（(](\d+|[一二三四五六七八九十]+)[）)]\s*/gm, '$1- ');
    
    // 智能处理换行：只在非列表行之间添加硬换行
    const lines = result.split('\n');
    const processedLines = lines.map((line, index) => {
        const isCurrentLineList = /^[\s]*[-*+]\s/.test(line);
        const isNextLineList = index < lines.length - 1 && /^[\s]*[-*+]\s/.test(lines[index + 1]);
        const isPreviousLineList = index > 0 && /^[\s]*[-*+]\s/.test(lines[index - 1]);
        
        // 如果当前行是列表项，或者下一行是列表项，或者这是个空行在列表之间，则不添加硬换行
        if (isCurrentLineList || isNextLineList || (line.trim() === '' && (isPreviousLineList || isNextLineList))) {
            return line;
        }
        
        // 其他情况添加硬换行标记
        return line + '  ';
    });
    
    return processedLines.join('\n');
}

// 导出一个纯净的 CompletionItemProvider，调用方传入 roles 引用
export function createRoleCompletionProvider(): vscode.CompletionItemProvider {
    return {
        provideCompletionItems(document, position) {
                const line = document.lineAt(position).text.slice(0, position.character);
                const prefix = getPrefix(line);
                if (!prefix) return;

                const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
                const min = cfg.get<number>('minChars')!;
                const debug = cfg.get<boolean>('debug.completionLog', false);
                if (prefix.length < min) return;
                const defaultColor = cfg.get<string>('defaultColor')!;

                if (debug) {
                    try {
                        const totalRoles = roles.length;
                        console.log(`[ANH][Completion] invoke prefix='${prefix}' len=${prefix.length} min=${min} rolesTotal=${totalRoles}`);
                    } catch {}
                }

                // 1. 先筛角色，过滤掉类型为 "敏感词" 的（多重保障：后面还会再二次剔除）
                const skippedSensitive: string[] = [];
                const matchedRoles = roles.filter(role => {
                    if (role.type === '敏感词') { skippedSensitive.push(role.name); return false; }
                    const names = [role.name, ...(role.aliases || [])];
                    return names.some(n => n.includes(prefix));
                });
                if (!matchedRoles.length) {
                    if (debug) console.log(`[ANH][Completion] no matched roles for prefix='${prefix}'`);
                    return;
                }

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

                        // detail - 只显示简要信息，避免过长
                        const details: string[] = [];
                        if (role.description) {
                            // 对于 detail，只显示描述的第一行
                            const firstLine = role.description.split('\n')[0].trim();
                            if (firstLine) {
                                details.push(firstLine.substring(0, 50) + (firstLine.length > 50 ? '...' : ''));
                            }
                        }
                        details.push(`类型: ${role.type}`);
                        if (role.affiliation) details.push(`从属: ${role.affiliation}`);
                        item.detail = details.join(' | ');

                        // documentation - 显示完整信息
                        const md = new vscode.MarkdownString();
                        
                        // 颜色显示与 Hover 保持一致：使用内联 SVG 小方块，确保在不同主题下可见
                        const color = role.color || typeColorMap[role.type] || defaultColor;
                        try {
                            const svg = `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><rect width=\"16\" height=\"16\" fill=\"${color}\"/></svg>`;
                            const b64 = Buffer.from(svg).toString('base64');
                            const uri = `data:image/svg+xml;base64,${b64}`;
                            md.appendMarkdown(`**颜色**: ![](${uri}) \`${color}\``);
                        } catch {
                            md.appendMarkdown(`**颜色**: \`${color}\``);
                        }
                        md.appendMarkdown(`\n\n**类型**: ${role.type}`);
                        if (role.affiliation) md.appendMarkdown(`\n\n**从属**: ${role.affiliation}`);
                        
                        // 显示描述
                        if (role.description) {
                            const formattedDescription = formatContentForDisplay(role.description);
                            // 检查是否包含 Markdown 格式，如果是则换行显示
                            if (containsMarkdownFormatting(role.description)) {
                                md.appendMarkdown(`\n\n**描述**:\n\n${formattedDescription}`);
                            } else {
                                md.appendMarkdown(`\n\n**描述**: ${formattedDescription}`);
                            }
                        }
                        
                        // 显示路径信息
                        if (role.packagePath || role.sourcePath) {
                            if (role.packagePath) {
                                md.appendMarkdown(`\n\n**包路径**: ${role.packagePath}`);
                            }
                            if (role.sourcePath) {
                                const fileName = role.sourcePath.split(/[/\\]/).pop() || role.sourcePath;
                                md.appendMarkdown(`\n\n**源文件**: ${fileName}`);
                            }
                        }
                        
                        // 显示扩展字段
                        const extensionFields = getExtensionFields(role);
                        for (const [fieldName, value] of extensionFields) {
                            const displayName = FIELD_ALIASES[fieldName] || fieldName;
                            const formattedValue = formatContentForDisplay(String(value));
                            // 检查是否包含 Markdown 格式，如果是则换行显示
                            if (containsMarkdownFormatting(String(value))) {
                                md.appendMarkdown(`\n\n**${displayName}**:\n\n${formattedValue}`);
                            } else {
                                md.appendMarkdown(`\n\n**${displayName}**: ${formattedValue}`);
                            }
                        }
                        
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

                // 3. 终极保险：再次剔除敏感词（若异步期间类型刚写入导致 race）
                const finalItems = items.filter(it => !/类型: .*敏感词/.test(it.detail || ''));
                if (debug) {
                    const removed = items.length - finalItems.length;
                    console.log(`[ANH][Completion] emit items count=${finalItems.length} distinctRoles=${matchedRoles.length} removedSensitive=${removed} initiallySkippedSensitive=${skippedSensitive.length}`);
                    if (removed || skippedSensitive.length) {
                        console.log('[ANH][Completion] sensitiveSkippedList=', skippedSensitive.slice(0,20));
                    }
                }
                return new vscode.CompletionList(finalItems, /* isIncomplete */ true);
        }
    };
}
