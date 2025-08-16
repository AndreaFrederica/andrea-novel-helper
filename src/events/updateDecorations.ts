/* eslint-disable curly */
import * as vscode from 'vscode';
import { hoverRanges, roles, setHoverRanges } from '../activate';
import { Role } from '../extension';
import { getSupportedLanguages, rangesOverlap, typeColorMap } from '../utils/utils';
import * as path from 'path';
import { ahoCorasickManager } from '../utils/ahoCorasickManager';
import { updateDocumentRoleOccurrences, clearDocumentRoleOccurrences } from '../utils/documentRolesCache';

// —— Diagnostics 集合 —— 
const diagnosticCollection = vscode.languages.createDiagnosticCollection('AndreaNovelHelper SensitiveWords');
// uri.fsPath -> 上次的 Diagnostic 数组
const prevDiagnostics = new Map<string, vscode.Diagnostic[]>();

// —— 装饰器元数据：角色名 → { deco, propsHash } —— 
interface DecoMeta {
    deco: vscode.TextEditorDecorationType;
    propsHash: string;
}
const decorationMeta = new Map<string, DecoMeta>();

/** 初始化（或重建）自动机 & patternMap */
export function initAutomaton() {
    ahoCorasickManager.initAutomaton();
}

/** 比较两个 Range 数组是否相同 */
function rangesEqual(a: vscode.Range[], b: vscode.Range[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++)
        if (!a[i].isEqual(b[i])) return false;
    return true;
}

/** 仅在 color/type 变化时（或新增/删除角色时）更新所有 DecorationType */
function ensureDecorationTypes() {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const defaultColor = cfg.get<string>('defaultColor')!;
    // 1) 计算每个角色当前应有的 propsHash
    const newHashMap = new Map<string, string>();
    for (const r of roles) {
        const color = r.color ?? typeColorMap[r.type] ?? defaultColor;
        const props = JSON.stringify({ color, type: r.type });
        newHashMap.set(r.name, props);
    }

    // 2) 更新已有的 & 新增缺失的
    for (const [roleName, propsHash] of newHashMap) {
        const prev = decorationMeta.get(roleName);
        if (!prev || prev.propsHash !== propsHash) {
            prev?.deco.dispose();
            const color = JSON.parse(propsHash).color as string;
            const deco = vscode.window.createTextEditorDecorationType({ color });
            decorationMeta.set(roleName, { deco, propsHash });
        }
    }

    // 3) 删除多余的
    for (const oldName of Array.from(decorationMeta.keys())) {
        if (!newHashMap.has(oldName)) {
            decorationMeta.get(oldName)!.deco.dispose();
            decorationMeta.delete(oldName);
        }
    }
}

/** 遍历所有可见编辑器，更新装饰 & 诊断 */
export function updateDecorations() {
    // 先确保 DecorationType 同步最新
    ensureDecorationTypes();

    // 每个可见编辑器单独处理
    for (const editor of vscode.window.visibleTextEditors) {
        const doc = editor.document;
        // 过滤语言 & 词库文件
        if (!getSupportedLanguages().includes(doc.languageId)) continue;
        const folders = vscode.workspace.workspaceFolders;
        if (folders?.length) {
            const root = folders[0].uri.fsPath;
            const fileB = path.join(root, vscode.workspace
                .getConfiguration('AndreaNovelHelper')
                .get<string>('sensitiveWordsFile')!);
            const fileV = path.join(root, vscode.workspace
                .getConfiguration('AndreaNovelHelper')
                .get<string>('vocabularyFile')!);
            const txtB = fileB.replace(/\.[^/.]+$/, '.txt');
            const txtV = fileV.replace(/\.[^/.]+$/, '.txt');
            if ([fileB, fileV, txtB, txtV].includes(doc.uri.fsPath)) continue;
        }

        // 重置 hoverRanges
        setHoverRanges([]);

        // 1. 处理普通角色（AC自动机）
        initAutomaton();
        const text = doc.getText();
        const rawHits = ahoCorasickManager.search(text);
        const hits: Array<[number, string[]]> = rawHits.map(([endIdx, pat]) => [
            endIdx, Array.isArray(pat) ? pat : [pat]
        ]);

        // 收集并去重普通角色 Candidate
        type Candidate = { role: Role; text: string; start: number; end: number; priority: number };
        const candidates: Candidate[] = [];
        
        // 添加普通角色匹配（普通角色优先级设为0-499，确保高于正则表达式）
        for (const [endIdx, arr] of hits) {
            for (const raw of arr) {
                const pat = raw.trim().normalize('NFC');
                const role = ahoCorasickManager.getRole(pat);
                if (!role) continue;
                candidates.push({ 
                    role, 
                    text: pat, 
                    start: endIdx - pat.length + 1, 
                    end: endIdx + 1,
                    priority: role.priority ?? 100 // 普通角色默认优先级为100
                });
            }
        }

        // 2. 处理正则表达式角色（正则表达式优先级设为500+，确保低于普通角色）
        for (const role of roles) {
            if (role.type === '正则表达式' && role.regex) {
                try {
                    const regex = new RegExp(role.regex, role.regexFlags || 'g');
                    let match;
                    
                    // 重置正则表达式的lastIndex（防止全局匹配状态影响）
                    regex.lastIndex = 0;
                    
                    while ((match = regex.exec(text)) !== null) {
                        const start = match.index;
                        const end = start + match[0].length;
                        
                        candidates.push({
                            role,
                            text: match[0],
                            start,
                            end,
                            priority: (role.priority ?? 500) + 500 // 正则表达式角色优先级+500，确保低于普通角色
                        });
                        
                        // 防止无限循环（如果正则表达式匹配空字符串）
                        if (match[0].length === 0) {
                            regex.lastIndex++;
                        }
                    }
                } catch (error) {
                    console.warn(`正则表达式角色 "${role.name}" 的模式无效:`, error);
                }
            }
        }

        // 按优先级和长度排序：优先级高的先处理，同优先级按长度倒序
        candidates.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return b.text.length - a.text.length;
        });

        // 智能去重：高优先级的覆盖低优先级的，但允许正则表达式被分割
        const selected: Candidate[] = [];
        const occupiedRanges: Array<{start: number, end: number}> = [];
        
        for (const c of candidates) {
            if (c.role.type === '正则表达式') {
                // 对于正则表达式，计算未被占用的片段
                const freeSegments = calculateFreeSegments(c.start, c.end, occupiedRanges);
                
                // 为每个自由片段创建一个候选项
                for (const segment of freeSegments) {
                    if (segment.end > segment.start) { // 确保片段有效
                        selected.push({
                            role: c.role,
                            text: text.substring(segment.start, segment.end),
                            start: segment.start,
                            end: segment.end,
                            priority: c.priority
                        });
                    }
                }
            } else {
                // 对于普通角色，检查是否与已占用范围重叠
                const hasOverlap = occupiedRanges.some(range => rangesOverlap(range.start, range.end, c.start, c.end));
                if (!hasOverlap) {
                    selected.push(c);
                    occupiedRanges.push({start: c.start, end: c.end});
                }
            }
        }

        // 计算未被占用的片段
        function calculateFreeSegments(start: number, end: number, occupied: Array<{start: number, end: number}>): Array<{start: number, end: number}> {
            // 找到与当前范围重叠的已占用范围
            const overlapping = occupied.filter(range => rangesOverlap(range.start, range.end, start, end))
                .sort((a, b) => a.start - b.start);
            
            if (overlapping.length === 0) {
                return [{start, end}];
            }
            
            const segments: Array<{start: number, end: number}> = [];
            let currentPos = start;
            
            for (const range of overlapping) {
                // 添加当前位置到重叠范围开始之间的片段
                if (currentPos < range.start) {
                    segments.push({start: currentPos, end: Math.min(range.start, end)});
                }
                // 移动到重叠范围结束后
                currentPos = Math.max(currentPos, range.end);
                if (currentPos >= end) break;
            }
            
            // 添加最后一个片段
            if (currentPos < end) {
                segments.push({start: currentPos, end});
            }
            
            return segments;
        }

        // 生成 role → ranges
        const roleToRanges = new Map<Role, vscode.Range[]>();
        for (const c of selected) {
            const range = new vscode.Range(doc.positionAt(c.start), doc.positionAt(c.end));
            hoverRanges.push({ range, role: c.role });
            if (!roleToRanges.has(c.role)) roleToRanges.set(c.role, []);
            roleToRanges.get(c.role)!.push(range);
        }

    // 1) 给出现的角色 setRanges
        for (const [role, ranges] of roleToRanges) {
            const meta = decorationMeta.get(role.name)!;
            editor.setDecorations(meta.deco, ranges);
        }
        // 2) 给没出现的角色 clear
        for (const [roleName, { deco }] of decorationMeta) {
            const appeared = [...roleToRanges.keys()].some(r => r.name === roleName);
            if (!appeared) editor.setDecorations(deco, []);
        }

    // 写入缓存供“当前文章角色”视图复用
    updateDocumentRoleOccurrences(doc, roleToRanges);

    // —— 敏感词诊断 —— 
        const diagnostics: vscode.Diagnostic[] = [];
        const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
        for (const [role, ranges] of roleToRanges) {
            if (role.type === '敏感词' && folders?.length) {
                const root = folders![0].uri.fsPath;
                const cspellTxt = path.join(root, '.vscode', 'cspell-roles.txt');
                if (doc.uri.fsPath !== cspellTxt) {
                    for (const range of ranges) {
                        const base = `发现敏感词：${role.name}` +
                            (role.description ? ` ${role.description}` : '');
                        const lineNum = range.start.line + 1;
                        const lineText = doc.lineAt(range.start.line).text.trim();
                        const msg = `${base}\n第 ${lineNum} 行: ${lineText}`;
                        const diag = new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Warning);
                        diag.source = 'AndreaNovelHelper';
                        diagnostics.push(diag);
                    }
                }
            }
        }
        const key = doc.uri.fsPath;
        const old = prevDiagnostics.get(key) || [];
        const equal = old.length === diagnostics.length
            && old.every((d, i) =>
                d.message === diagnostics[i].message
                && d.range.isEqual(diagnostics[i].range)
                && d.severity === diagnostics[i].severity
            );
        if (!equal) {
            diagnostics.length
                ? diagnosticCollection.set(doc.uri, diagnostics)
                : diagnosticCollection.delete(doc.uri);
            prevDiagnostics.set(key, diagnostics.map(d => d));
        }
    }
}
