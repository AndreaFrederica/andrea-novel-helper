/* eslint-disable curly */
import * as vscode from 'vscode';
import { getSupportedLanguages, typeColorMap, rangesOverlap } from '../utils/utils';
import { roles, onDidChangeRoles } from '../activate';
import { ahoCorasickManager } from '../utils/ahoCorasickManager';
import { Role } from '../extension';
import { FIELD_ALIASES, getExtensionFields } from '../utils/markdownParser';

/**
 * 检查内容是否包含 Markdown 格式
 */
export function containsMarkdownFormatting(content: string): boolean {
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
export function formatContentForDisplay(content: string): string {
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
export function handlePlainTextContent(content: string): string {
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
export function convertToMarkdownList(content: string): string {
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

// 存储每个文档的 Hover 信息
interface HoverInfo {
    range: vscode.Range;
    role: Role;
}
export const hoverRangesMap = new Map<string, HoverInfo[]>();

/**
 * 扫描文档，生成 Hover 信息列表
 */
function scanDocumentForHover(doc: vscode.TextDocument): HoverInfo[] {
    const text = doc.getText();
    const rawHits = ahoCorasickManager.search(text);
    type Candidate = { role: Role; start: number; end: number };
    const candidates: Candidate[] = [];
    for (const [endIdx, patOrArr] of rawHits) {
        const patterns = Array.isArray(patOrArr) ? patOrArr : [patOrArr];
        for (const raw of patterns) {
            const pat = raw.trim().normalize('NFC');
            const role = ahoCorasickManager.getRole(pat);
            if (!role) continue;
            const start = endIdx - pat.length + 1;
            candidates.push({ role, start, end: endIdx + 1 });
        }
    }
    candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start));
    const selected: Candidate[] = [];
    for (const c of candidates) {
        if (selected.some(s => rangesOverlap(s.start, s.end, c.start, c.end))) continue;
        selected.push(c);
    }
    return selected.map(c => ({
        range: new vscode.Range(doc.positionAt(c.start), doc.positionAt(c.end)),
        role: c.role
    }));
}

/**
 * 比较两组 HoverInfo 是否完全一致
 */
function hoverInfoEqual(a: HoverInfo[], b: HoverInfo[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const ai = a[i], bi = b[i];
        if (!ai.range.isEqual(bi.range) || ai.role.name !== bi.role.name) return false;
    }
    return true;
}

/**
 * 增量刷新：仅在变更时更新 hoverRangesMap，并打印日志
 */
function refreshAll() {
    console.log('【HoverProvider】开始增量刷新 Hover 信息');
    const currentKeys = new Set<string>();
    for (const editor of vscode.window.visibleTextEditors) {
        const key = editor.document.uri.toString();
        currentKeys.add(key);
        const newInfos = scanDocumentForHover(editor.document);
        const oldInfos = hoverRangesMap.get(key) || [];
        // if (!hoverInfoEqual(oldInfos, newInfos))
        // if (!hoverInfoEqual(oldInfos, newInfos))
        // if (!hoverInfoEqual(oldInfos, newInfos)) {
        //TODO 这里的Diff有问题 以后修
        if (true) {
            hoverRangesMap.set(key, newInfos);
            console.log(
                `【HoverProvider】文档 ${key} Hover 信息更新：${oldInfos.length} → ${newInfos.length}`
            );
        }
    }
    for (const key of Array.from(hoverRangesMap.keys())) {
        if (!currentKeys.has(key)) {
            hoverRangesMap.delete(key);
            console.log(`【HoverProvider】文档 ${key} Hover 缓存已移除`);
        }
    }
}

export function buildRoleMarkdown(r: Role): vscode.MarkdownString {
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;
    md.appendMarkdown(`**${r.name}**\n\n`);
    if (r.description) {
        const descriptionMd = formatContentForDisplay(r.description);
        if (containsMarkdownFormatting(r.description)) {
            md.appendMarkdown(`**描述**:\n\n${descriptionMd}\n\n`);
        } else {
            md.appendMarkdown(`**描述**: ${descriptionMd}\n\n`);
        }
    }
    md.appendMarkdown(`**类型**: ${r.type}\n\n`);
    if (r.affiliation) md.appendMarkdown(`**从属**: ${r.affiliation}\n\n`);
    if (r.packagePath) md.appendMarkdown(`**包路径**: ${r.packagePath}\n\n`);
    if (r.sourcePath) {
        const fileName = r.sourcePath.split(/[/\\]/).pop() || r.sourcePath;
        md.appendMarkdown(`**源文件**: ${fileName}\n\n`);
    }
    const extensionFields = getExtensionFields(r);
    for (const [fieldName, value] of extensionFields) {
        const displayName = FIELD_ALIASES[fieldName] || fieldName;
        const formattedValue = formatContentForDisplay(String(value));
        if (containsMarkdownFormatting(String(value))) {
            md.appendMarkdown(`**${displayName}**:\n\n${formattedValue}\n\n`);
        } else {
            md.appendMarkdown(`**${displayName}**: ${formattedValue}\n\n`);
        }
    }
    const defaultColor = vscode.workspace.getConfiguration('AndreaNovelHelper').get<string>('defaultColor')!;
    const c = r.color || typeColorMap[r.type] || defaultColor;
    const svg = `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><rect width=\"16\" height=\"16\" fill=\"${c}\"/></svg>`;
    const b64 = Buffer.from(svg).toString('base64');
    const uri = `data:image/svg+xml;base64,${b64}`;
    md.appendMarkdown(`**颜色**: ![](${uri}) \`${c}\``);
    return md;
}

export function activateHover(context: vscode.ExtensionContext) {
    // 初始扫描
    refreshAll();

    // 监听各类事件触发增量刷新
    context.subscriptions.push(
        // 文档操作：会触发更新对应文档
        vscode.workspace.onDidOpenTextDocument(refreshAll),
        vscode.workspace.onDidChangeTextDocument(() => refreshAll()),
        vscode.workspace.onDidCloseTextDocument(refreshAll),
        // 切换/分屏：增量刷新可见编辑器
        vscode.window.onDidChangeVisibleTextEditors(refreshAll),
        // 角色库改变：触发全量重建 AhoCorasick 与重新扫描
        onDidChangeRoles(refreshAll)
    );

    // 注册 Hover 提供器
    const hoverProv = vscode.languages.registerHoverProvider(
        getSupportedLanguages(),
        {
            provideHover(doc, pos) {
                const key = doc.uri.toString();
                const ranges = hoverRangesMap.get(key) || [];
                const hit = ranges.find(h => h.range.contains(pos));
                if (!hit) return;
                const r = hit.role;
                const md = new vscode.MarkdownString('', true);
                md.isTrusted = true;
                
                md.appendMarkdown(`**${r.name}**\n\n`);
                if (r.description) {
                    // 如果描述包含 Markdown 格式，直接使用；否则作为普通文本
                    const descriptionMd = formatContentForDisplay(r.description);
                    // 检查是否包含 Markdown 格式，如果是则换行显示
                    if (containsMarkdownFormatting(r.description)) {
                        md.appendMarkdown(`**描述**:\n\n${descriptionMd}\n\n`);
                    } else {
                        md.appendMarkdown(`**描述**: ${descriptionMd}\n\n`);
                    }
                }
                md.appendMarkdown(`**类型**: ${r.type}\n\n`);
                if (r.affiliation) md.appendMarkdown(`**从属**: ${r.affiliation}\n\n`);
                
                // 显示路径信息
                if (r.packagePath || r.sourcePath) {
                    if (r.packagePath) {
                        md.appendMarkdown(`**包路径**: ${r.packagePath}\n\n`);
                    }
                    if (r.sourcePath) {
                        const fileName = r.sourcePath.split(/[/\\]/).pop() || r.sourcePath;
                        md.appendMarkdown(`**源文件**: ${fileName}\n\n`);
                    }
                }
                
                // 显示扩展字段
                const extensionFields = getExtensionFields(r);
                for (const [fieldName, value] of extensionFields) {
                    const displayName = FIELD_ALIASES[fieldName] || fieldName;
                    const formattedValue = formatContentForDisplay(String(value));
                    // 检查是否包含 Markdown 格式，如果是则换行显示
                    if (containsMarkdownFormatting(String(value))) {
                        md.appendMarkdown(`**${displayName}**:\n\n${formattedValue}\n\n`);
                    } else {
                        md.appendMarkdown(`**${displayName}**: ${formattedValue}\n\n`);
                    }
                }
                
                const defaultColor = vscode.workspace.getConfiguration('AndreaNovelHelper').get<string>('defaultColor')!;
                const c = r.color || typeColorMap[r.type] || defaultColor;
                const svg = `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><rect width=\"16\" height=\"16\" fill=\"${c}\"/></svg>`;
                const b64 = Buffer.from(svg).toString('base64');
                const uri = `data:image/svg+xml;base64,${b64}`;
                md.appendMarkdown(`**颜色**: ![](${uri}) \`${c}\``);
                return new vscode.Hover(md, hit.range);
            }
        }
    );
    context.subscriptions.push(hoverProv);
}
