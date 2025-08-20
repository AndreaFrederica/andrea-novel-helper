/* eslint-disable curly */
import * as vscode from 'vscode';
import { hoverRanges, roles, setHoverRanges } from '../activate';
import { Role } from '../extension';
import { getSupportedLanguages, getSupportedExtensions, rangesOverlap, typeColorMap, isHugeFile } from '../utils/utils';
// 不再读取文件内容进行敏感词库判断，使用加载阶段记录的集合
import { sensitiveSourceFiles } from '../activate';
import * as path from 'path';
import { ahoCorasickManager } from '../utils/AhoCorasick/ahoCorasickManager';
import { getRoleMatches } from '../context/roleAsyncShared';
import { updateDocumentRoleOccurrences, clearDocumentRoleOccurrences } from '../context/documentRolesCache';

// —— Diagnostics 集合 —— 
const diagnosticCollection = vscode.languages.createDiagnosticCollection('AndreaNovelHelper SensitiveWords');
// uri.fsPath -> 上次的 Diagnostic 数组
const prevDiagnostics = new Map<string, vscode.Diagnostic[]>();

// —— 装饰刷新完成事件 ——
export interface DecorationsUpdatedEvent { uri: vscode.Uri; rolesHighlighted: number; ranges: number; tookMs?: number; }
export const _onDidUpdateDecorations = new vscode.EventEmitter<DecorationsUpdatedEvent>();
export const onDidUpdateDecorations = _onDidUpdateDecorations.event;

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
    const rangeBehavior = vscode.DecorationRangeBehavior.ClosedClosed; // 两端关闭：避免尾部输入继续扩展已匹配角色着色
    for (const r of roles) {
        const color = r.color ?? typeColorMap[r.type] ?? defaultColor;
        // 将 rangeBehavior 纳入哈希，变更策略时强制重建 decorationType
        const props = JSON.stringify({ color, type: r.type, rb: 'ClosedClosed' });
        newHashMap.set(r.name, props);
    }

    // 2) 更新已有的 & 新增缺失的
    for (const [roleName, propsHash] of newHashMap) {
        const prev = decorationMeta.get(roleName);
        if (!prev || prev.propsHash !== propsHash) {
            prev?.deco.dispose();
            const color = JSON.parse(propsHash).color as string;
            const deco = vscode.window.createTextEditorDecorationType({
                color,
                rangeBehavior // 末尾不扩展，修复“新打字继承上一次角色颜色”问题
            });
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
let hugeWarnedFiles = new Set<string>();
export async function updateDecorations() {
    // 先确保 DecorationType 同步最新
    ensureDecorationTypes();

    // 每个可见编辑器单独处理
    for (const editor of vscode.window.visibleTextEditors) {
        const doc = editor.document;
    const bigCfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const hugeTh = bigCfg.get<number>('hugeFile.thresholdBytes', 50*1024)!;
    const suppress = bigCfg.get<boolean>('hugeFile.suppressWarning', false)!;
        if (isHugeFile(doc, hugeTh)) {
            // 跳过高成本标注
            if (!suppress && !hugeWarnedFiles.has(doc.uri.fsPath)) {
                hugeWarnedFiles.add(doc.uri.fsPath);
                vscode.window.showInformationMessage('该文件体积较大，已关闭自动机角色高亮与敏感词正则扫描，仅保留基础统计 (可在设置中修改 hugeFile.thresholdBytes)。');
            }
            continue;
        }
        // 过滤语言 & 词库文件（支持通过配置的语言 ID 或文件扩展名）
        const supportedLangs = getSupportedLanguages();
        const supportedExts = new Set(getSupportedExtensions().map(e=>e.toLowerCase()));
        const fileNameLower = doc.fileName.toLowerCase();
        const extMatch = fileNameLower.match(/\.([a-z0-9_\-]+)$/);
        const ext = extMatch ? extMatch[1] : '';
        if (!supportedLangs.includes(doc.languageId) && !supportedExts.has(ext)) {
            continue;
        }
        const folders = vscode.workspace.workspaceFolders;
        if (folders?.length) {
            const root = folders[0].uri.fsPath;
            const cfgAll = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const fileB = path.join(root, cfgAll.get<string>('sensitiveWordsFile')!);
            const fileV = path.join(root, cfgAll.get<string>('vocabularyFile')!);
            const txtB = fileB.replace(/\.[^/.]+$/, '.txt');
            const txtV = fileV.replace(/\.[^/.]+$/, '.txt');
            const docPathLower = doc.uri.fsPath.toLowerCase();
            if ([fileB, fileV, txtB, txtV].some(p => p.toLowerCase() === docPathLower)) continue;
        }

        // 重置 hoverRanges
        setHoverRanges([]);

        // 预先仅在需要时获取全文（延迟到 regex 或 fallback 使用）
        let fullText: string | undefined;
        const versionAtReq = doc.version;
        const startMs = Date.now();
        let hits: Array<[number, string[]]> = [];
        try {
            const matches = await getRoleMatches(doc); // 内部可能已 doc.getText()
            if (versionAtReq === doc.version) {
                hits = matches.map(m => [m.end, m.pats]);
            }
            if (hits.length === 0 && roles.length > 0) {
                // 可能是构建 race / 词数过少；同步 fallback
                console.log('[Decorations] 异步空结果 fallback 同步');
                fullText = doc.getText();
                const rawHits = ahoCorasickManager.search(fullText);
                hits = rawHits.map(([endIdx, pat]) => [ endIdx, Array.isArray(pat) ? pat : [pat] ]);
            }
        } catch (e) {
            console.warn('[Decorations] 异步匹配失败 fallback 同步', e);
            fullText = doc.getText();
            const rawHits = ahoCorasickManager.search(fullText);
            hits = rawHits.map(([endIdx, pat]) => [ endIdx, Array.isArray(pat) ? pat : [pat] ]);
        }
    const acCost = Date.now() - startMs;
    console.log('[Decorations] AC阶段耗时', acCost, 'ms hits', hits.length);
    console.log('[Decorations] 找到的匹配:', hits.slice(0, 5)); // 只显示前5个匹配，避免日志过长

        // 预构建 pattern -> role 映射（包含别名和fixes），避免依赖主线程 AC 的 patternMap 重建时序导致别名遗漏
        const patternRoleMap = new Map<string, Role>();
        for (const r of roles) {
            patternRoleMap.set(r.name.trim().normalize('NFC'), r);
            // 添加别名
            for (const al of r.aliases || []) {
                if (!al) continue;
                patternRoleMap.set(al.trim().normalize('NFC'), r);
            }
            // 处理 fixes/fixs 字段（修复候选词也应该被识别为该角色）
            for (const fix of r.fixes || []) {
                const f = fix.trim().normalize('NFC');
                if (f) { // 确保不是空字符串
                    patternRoleMap.set(f.trim().normalize('NFC'), r);
                }
            }
        }

        // 收集并去重普通角色 Candidate（AC / 异步 worker 返回的 pats 可能是主名也可能是别名）
        type Candidate = { role: Role; text: string; start: number; end: number; priority: number };
        const candidates: Candidate[] = [];
        // 添加普通角色匹配（普通角色优先级设为0-499，确保高于正则表达式）
        for (const [endIdx, arr] of hits) {
            for (const raw of arr) {
                const pat = raw.trim().normalize('NFC');
                // 先用预构建映射（含别名）获取角色；若失败再尝试 AC（理论上不应再缺失）
                let role = patternRoleMap.get(pat) || ahoCorasickManager.getRole(pat);
                if (!role) {
                    // 别名丢失兜底：线性扫描（极少发生，日志观测）
                    role = roles.find(r => r.name === pat || r.aliases?.includes(pat));
                }
                if (!role) {
                    // 调试日志（避免噪音，仅在开发者控制台）
                    console.log('[Decorations] 未解析到匹配角色(可能为过期缓存) pattern=', pat);
                    continue;
                }
                // 添加调试信息：显示找到的匹配
                const startPos = endIdx - pat.length + 1;
                console.log(`[Decorations] 找到匹配: "${pat}" (位置 ${startPos}-${endIdx+1}) -> 角色 "${role.name}"`);
                candidates.push({
                    role,
                    text: pat,
                    start: endIdx - pat.length + 1,
                    end: endIdx + 1,
                    // 优先级：数值越小越先处理；敏感词默认最高优先级，其次普通角色；regex 在后面单独加 500 偏移
                    priority: role.priority ?? (role.type === '敏感词' ? 0 : 100) // 敏感词默认0，其它普通默认100
                });
            }
        }

        // 2. 处理正则表达式角色（优先级低） — 分片执行，避免一次性长阻塞
        const regexRoles = roles.filter(r => r.type === '正则表达式' && r.regex);
        if (regexRoles.length) {
            if (!fullText) fullText = doc.getText();
            const regexStart = Date.now();
            const sliceBatch = async () => {
                const deadline = Date.now() + 12; // 每批最多占用 ~12ms
                while (regexRoles.length && Date.now() < deadline) {
                    const role = regexRoles.shift()!;
                    try {
                        const regex = new RegExp(role.regex!, role.regexFlags || 'g');
                        regex.lastIndex = 0;
                        let m: RegExpExecArray | null;
                        while ((m = regex.exec(fullText!)) !== null) {
                            const start = m.index;
                            const end = start + m[0].length;
                            candidates.push({
                                role,
                                text: m[0],
                                start,
                                end,
                                priority: (role.priority ?? 500) + 500
                            });
                            if (m[0].length === 0) regex.lastIndex++;
                        }
                    } catch (err) {
                        console.warn(`[Decorations] 正则角色 ${role.name} 无效`, err);
                    }
                }
                if (regexRoles.length) {
                    // 让出事件循环，下一帧继续
                    await new Promise(r => setTimeout(r, 0));
                    return sliceBatch();
                }
            };
            await sliceBatch();
            console.log('[Decorations] Regex阶段耗时', Date.now()-regexStart, 'ms');
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
                            text: (fullText || '').substring(segment.start, segment.end),
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

        // 生成 role → ranges （并做最小化 setDecorations：如果范围未变则跳过）
        const roleToRanges = new Map<Role, vscode.Range[]>();
        for (const c of selected) {
            const range = new vscode.Range(doc.positionAt(c.start), doc.positionAt(c.end));
            hoverRanges.push({ range, role: c.role });
            if (!roleToRanges.has(c.role)) roleToRanges.set(c.role, []);
            roleToRanges.get(c.role)!.push(range);
        }

        // 1) 给出现的角色 setRanges（若与上次相同则跳过）
        for (const [role, ranges] of roleToRanges) {
            const meta = decorationMeta.get(role.name)!;
            // VSCode 没有直接获取已设置 ranges，简单策略：存一份哈希
            const key = `${role.name}::hash`;
            const prev = (meta as any)[key] as string | undefined;
            const hash = ranges.map(r => `${r.start.line},${r.start.character}-${r.end.line},${r.end.character}`).join('|');
            if (prev !== hash) {
                editor.setDecorations(meta.deco, ranges);
                (meta as any)[key] = hash;
            }
        }
        // 2) 给没出现的角色 clear（按名称判定）
        const presentNames = new Set(Array.from(roleToRanges.keys()).map(r => r.name));
        for (const [roleName, { deco }] of decorationMeta) {
            if (!presentNames.has(roleName)) {
                editor.setDecorations(deco, []);
                (decorationMeta.get(roleName)! as any)[`${roleName}::hash`] = '';
            }
        }

    // 写入缓存供“当前文章角色”视图复用
    updateDocumentRoleOccurrences(doc, roleToRanges);

    // —— 敏感词诊断 —— 
        const diagnostics: vscode.Diagnostic[] = [];
        const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
        // 判断当前文件是否为任意敏感词库定义文件（支持多包多文件）
        let isSensitiveWordsDefFile = false;
        try {
            const docPathLower2 = doc.uri.fsPath.toLowerCase();
            if (sensitiveSourceFiles.has(docPathLower2)) {
                isSensitiveWordsDefFile = true;
            }
        } catch { /* ignore */ }
        for (const [role, ranges] of roleToRanges) {
            if (role.type !== '敏感词') continue;
            if (!folders?.length) continue;
            if (isSensitiveWordsDefFile) continue; // 自身文件跳过
            const root = folders![0].uri.fsPath;
            const cspellTxt = path.join(root, '.vscode', 'cspell-roles.txt');
            if (doc.uri.fsPath.toLowerCase() === cspellTxt.toLowerCase()) continue; // 词典文件跳过
            for (const range of ranges) {
                // 若当前匹配文本本身是任何角色的 fixes 值，则视作已修复，跳过敏感词诊断
                let matchedText: string | undefined;
                try { matchedText = doc.getText(range); } catch { /* ignore */ }
                // 检查是否是任何角色的 fixes 值（不仅仅是当前敏感词角色）
                let isFixesValue = false;
                if (matchedText) {
                    for (const anyRole of roles) {
                        const fixesArr: string[] | undefined = (anyRole as any).fixes || (anyRole as any).fixs;
                        if (Array.isArray(fixesArr) && fixesArr.includes(matchedText)) {
                            isFixesValue = true;
                            break;
                        }
                    }
                }
                if (isFixesValue) {
                    continue; // 是任何角色的 fixes 值，不触发敏感词警告
                }
                const base = `发现敏感词：${role.name}` + (role.description ? ` ${role.description}` : '');
                const lineNum = range.start.line + 1;
                const lineText = doc.lineAt(range.start.line).text.trim();
                const msg = `${base}\n第 ${lineNum} 行: ${lineText}`;
                const diag = new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Warning);
                diag.source = 'AndreaNovelHelper';
                // 添加修复选项元数据供 CodeAction 提供者使用
                const currentRoleFixesArr: string[] | undefined = (role as any).fixes || (role as any).fixs;
                if (Array.isArray(currentRoleFixesArr) && currentRoleFixesArr.length > 0) {
                    (diag as any).anhFixs = currentRoleFixesArr;
                    (diag as any).anhSensitiveWord = role.name;
                }
                diagnostics.push(diag);
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

        // 触发“该文档装饰完成”事件
        try {
            _onDidUpdateDecorations.fire({
                uri: doc.uri,
                rolesHighlighted: roleToRanges.size,
                ranges: Array.from(roleToRanges.values()).reduce((s, arr) => s + arr.length, 0),
                tookMs: Date.now() - startMs
            });
        } catch {}
    }
}
