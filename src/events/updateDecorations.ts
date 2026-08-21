/* eslint-disable curly */
import * as vscode from 'vscode';
import { decorationTypes, hoverRanges, roles, setHoverRanges } from '../activate';
import { Role } from '../extension';
import { getSupportedLanguages, getSupportedExtensions, rangesOverlap, typeColorMap, isHugeFile } from '../utils/utils';
// 不再读取文件内容进行敏感词库判断，使用加载阶段记录的集合
import { sensitiveSourceFiles } from '../activate';
import * as path from 'path';
import { ahoCorasickManager } from '../utils/AhoCorasick/ahoCorasickManager';
import { getRoleMatches } from '../context/roleAsyncShared';
import { updateDocumentRoleOccurrences, clearDocumentRoleOccurrences } from '../context/documentRolesCache';
import { updateRoleUsageFromDocument } from '../context/roleUsageStore';
import { collectRoleUsageRanges } from '../utils/roleUsageCollector';
import { isColorTag, normalizeColor } from '../language/obsidianIndex';
import { resolveTagRole } from '../language/tagRoleBridge';

// // 输出到扩展统一的 OutputChannel（替代 console.log）
// const _anh_log_channel = vscode.window.createOutputChannel('Andrea Novel Helper:Decorations');
// function console.log(...args: any[]) {
//     try {
//         const parts = args.map(a => typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })());
//         _anh_log_channel.appendLine('[Decorations] ' + parts.join(' '));
//     } catch { /* ignore */ }
// }

// —— 每文档每角色的 ranges 哈希：docUri -> (roleName -> hash) —— 
const appliedHashes = new Map<string, Map<string, string>>();

// —— 装饰缓存机制：按常用度缓存不可见文档的装饰数据 ——
type SimpleRange = [number, number, number, number]; // [sLine, sChar, eLine, eChar]
interface CacheEntry {
    lastSeen: number;
    openCount: number; // 打开次数，用于常用度排序
    hashes: Map<string, string>;
    rangesByRoleName?: Map<string, SimpleRange[]>; // 角色名 -> 范围快照
}
const decorationCache = new Map<string, CacheEntry>();
const documentOpenCounts = new Map<string, number>(); // 文档打开次数统计
const currentRangesByDoc = new Map<string, Map<string, vscode.Range[]>>(); // 文档当前应用的范围
const restoreCooldown = new Map<string, number>(); // 文档恢复冷却时间，用于避免反复恢复导致死循环

function getCacheSize(): number {
    return vscode.workspace.getConfiguration('AndreaNovelHelper.decorations').get<number>('cacheSize', 5);
}

function getPerDocHashes(docUri: string): Map<string, string> {
    let m = appliedHashes.get(docUri);
    if (!m) { 
        // 尝试从缓存恢复哈希
        const cached = decorationCache.get(docUri);
        if (cached) {
            m = new Map(cached.hashes);
            appliedHashes.set(docUri, m);
            // 更新打开次数
            cached.openCount++;
            cached.lastSeen = Date.now();
            documentOpenCounts.set(docUri, cached.openCount);
            decorationCache.delete(docUri); // 从缓存移回活跃状态
        } else {
            m = new Map(); 
            appliedHashes.set(docUri, m);
            // 记录新文档打开
            const openCount = (documentOpenCounts.get(docUri) || 0) + 1;
            documentOpenCounts.set(docUri, openCount);
        }
    }
    return m;
}

/**
 * 从缓存快速恢复：立即应用缓存中的装饰范围，并恢复哈希。
 * 返回是否命中并成功恢复。
 */
function tryRestoreFromCache(editor: vscode.TextEditor, docUri: string): boolean {
    const entry = decorationCache.get(docUri);
    if (!entry || !entry.rangesByRoleName) return false;

    const doc = editor.document;
    // 反序列化范围并进行边界钳制
    const applyRanges = new Map<string, vscode.Range[]>();
    for (const [roleName, arr] of entry.rangesByRoleName) {
        const ranges: vscode.Range[] = [];
        for (const [sl, sc, el, ec] of arr) {
            const sLine = Math.max(0, Math.min(sl, Math.max(0, doc.lineCount - 1)));
            const eLine = Math.max(0, Math.min(el, Math.max(0, doc.lineCount - 1)));
            let sChar = sc, eChar = ec;
            try {
                const sText = doc.lineAt(sLine).text; const eText = doc.lineAt(eLine).text;
                sChar = Math.max(0, Math.min(sc, Math.max(0, sText.length)));
                eChar = Math.max(0, Math.min(ec, Math.max(0, eText.length)));
            } catch { /* ignore */ }
            ranges.push(new vscode.Range(new vscode.Position(sLine, sChar), new vscode.Position(eLine, eChar)));
        }
        applyRanges.set(roleName, ranges);
    }

    for (const key of applyRanges.keys()) {
        if (!getVisualDecorationMeta(key)) {
            return false;
        }
    }

    // 缓存保存的是非重叠的合成装饰范围，恢复时按组合键应用。
    for (const [roleName, meta] of decorationMeta) {
        editor.setDecorations(meta.textDeco, applyRanges.get(textDecorationKey(roleName)) || []);
    }
    for (const [key, meta] of compositeDecorationMeta) {
        editor.setDecorations(meta.deco, applyRanges.get(key) || []);
    }

    // 恢复哈希
    appliedHashes.set(docUri, new Map(entry.hashes));

    // 更新统计并从缓存移除，设置恢复冷却，避免立即再次恢复
    entry.openCount++; entry.lastSeen = Date.now();
    documentOpenCounts.set(docUri, entry.openCount);
    decorationCache.delete(docUri);
    restoreCooldown.set(docUri, Date.now() + 200); // 200ms 内不再尝试缓存恢复

    return true;
}


// —— Diagnostics 集合 —— 
const diagnosticCollection = vscode.languages.createDiagnosticCollection('AndreaNovelHelper SensitiveWords');
// [ANCHOR C-1] 记录已应用过装饰的 editor 实例，避免“新实例但哈希相同”的漏刷
const seenEditors = new WeakSet<vscode.TextEditor>();

// uri.fsPath -> 上次的 Diagnostic 数组
const prevDiagnostics = new Map<string, vscode.Diagnostic[]>();

// —— 装饰刷新完成事件 ——
export interface DecorationsUpdatedEvent { uri: vscode.Uri; rolesHighlighted: number; ranges: number; tookMs?: number; }
export const _onDidUpdateDecorations = new vscode.EventEmitter<DecorationsUpdatedEvent>();
export const onDidUpdateDecorations = _onDidUpdateDecorations.event;

const TEXT_DECORATION_PREFIX = 'text:';
const COMPOSITE_DECORATION_PREFIX = 'composite:';

function textDecorationKey(roleName: string): string {
    return `${TEXT_DECORATION_PREFIX}${roleName}`;
}

function compositeDecorationKey(foregroundRoleName?: string, backgroundRoleName?: string): string {
    return `${COMPOSITE_DECORATION_PREFIX}${JSON.stringify([
        foregroundRoleName || null,
        backgroundRoleName || null,
    ])}`;
}

// —— 装饰器元数据：无背景文字样式 + 前景/背景合成样式 ——
interface DecoMeta {
    textDeco: vscode.TextEditorDecorationType;
    propsHash: string;
}
const decorationMeta = new Map<string, DecoMeta>();

interface CompositeDecoMeta {
    deco: vscode.TextEditorDecorationType;
    propsHash: string;
    foregroundRoleName?: string;
    backgroundRoleName?: string;
}
const compositeDecorationMeta = new Map<string, CompositeDecoMeta>();

function getVisualDecorationMeta(key: string): { deco: vscode.TextEditorDecorationType; propsHash: string } | undefined {
    if (key.startsWith(TEXT_DECORATION_PREFIX)) {
        const roleName = key.slice(TEXT_DECORATION_PREFIX.length);
        const meta = decorationMeta.get(roleName);
        return meta ? { deco: meta.textDeco, propsHash: meta.propsHash } : undefined;
    }
    return compositeDecorationMeta.get(key);
}

const TAG_IN_TEXT_RE = /(^|[\s([{>])(#(?:[A-Fa-f0-9]{3}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})\b|#(?:[A-Za-z0-9_\-\u4e00-\u9fff]+)(?:\/[A-Za-z0-9_\-\u4e00-\u9fff]+)*)/g;
const UNBOUND_TAG_DECORATION_KEY = '__anh_unbound_tag_default__';
const COLOR_TAG_DECORATION_PREFIX = '__anh_unbound_color_tag__:';
const colorTagDecorationMeta = new Map<string, vscode.TextEditorDecorationType>();

/** 文本样式配置接口 */
interface TextStyleOptions {
    color?: string;
    backgroundColor?: string;
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
}

/** 从角色获取文本样式配置（兼容旧格式） */
function getTextStyleFromRole(role: any): TextStyleOptions {
    // 如果有新的 style 字段，直接使用
    if (role.style && typeof role.style === 'object') {
        return role.style as TextStyleOptions;
    }

    // 兼容旧格式：从顶层字段读取
    const style: TextStyleOptions = {};
    if (role.color) style.color = role.color;
    if (role.backgroundColor) style.backgroundColor = role.backgroundColor;
    if (role.bold) style.bold = true;
    if (role.italic) style.italic = true;
    if (role.strikethrough) style.strikethrough = true;
    if (role.underline) style.underline = true;

    return style;
}

/** 构建 textDecoration 字符串 */
function buildTextDecoration(style: TextStyleOptions): string | undefined {
    const parts: string[] = [];
    if (style.underline) parts.push('underline');
    if (style.strikethrough) parts.push('line-through');
    // 斜体/粗体不走 textDecoration
    return parts.length > 0 ? parts.join(' ') : undefined;
}

/** 构建 fontStyle 字符串（仅处理斜体） */
function buildFontStyle(style: TextStyleOptions): string | undefined {
    if (style.italic) return 'italic';
    return undefined;
}

/** 构建 fontWeight 字符串（仅处理粗体） */
function buildFontWeight(style: TextStyleOptions): string | undefined {
    if (style.bold) return 'bold';
    return undefined;
}

function ensureUnboundTagDecoration(): vscode.TextEditorDecorationType {
    let deco = decorationTypes.get(UNBOUND_TAG_DECORATION_KEY);
    if (!deco) {
        deco = vscode.window.createTextEditorDecorationType({
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            color: new vscode.ThemeColor('textLink.foreground'),
            backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
            border: '1px solid',
            borderColor: new vscode.ThemeColor('editor.wordHighlightBorder'),
        });
        decorationTypes.set(UNBOUND_TAG_DECORATION_KEY, deco);
    }
    return deco;
}

function ensureColorTagDecoration(tag: string): vscode.TextEditorDecorationType {
    const color = normalizeColor(tag).toUpperCase();
    const key = `${COLOR_TAG_DECORATION_PREFIX}${color}`;
    let deco = colorTagDecorationMeta.get(key);
    if (!deco) {
        deco = vscode.window.createTextEditorDecorationType({
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            backgroundColor: withAlpha(color, 0.22),
            border: `1px solid ${withAlpha(color, 0.85)}`,
        });
        colorTagDecorationMeta.set(key, deco);
        decorationTypes.set(key, deco);
    }
    return deco;
}

function updateUnboundTagDecorations(editor: vscode.TextEditor, fullText?: string): void {
    const text = fullText ?? editor.document.getText();
    const normalRanges: vscode.Range[] = [];
    const colorRangesByKey = new Map<string, vscode.Range[]>();

    TAG_IN_TEXT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TAG_IN_TEXT_RE.exec(text))) {
        const tag = match[2];
        const resolvedRole = resolveTagRole(tag, roles);
        if (resolvedRole.binding && resolvedRole.role) continue;

        const startOffset = match.index + match[1].length;
        const start = editor.document.positionAt(startOffset);
        const end = editor.document.positionAt(startOffset + tag.length);
        const range = new vscode.Range(start, end);

        if (isColorTag(tag)) {
            const color = normalizeColor(tag).toUpperCase();
            const key = `${COLOR_TAG_DECORATION_PREFIX}${color}`;
            const ranges = colorRangesByKey.get(key) || [];
            ranges.push(range);
            colorRangesByKey.set(key, ranges);
        } else {
            normalRanges.push(range);
        }
    }

    editor.setDecorations(ensureUnboundTagDecoration(), normalRanges);

    const activeColorKeys = new Set(colorRangesByKey.keys());
    for (const [key, ranges] of colorRangesByKey) {
        const tagColor = key.slice(COLOR_TAG_DECORATION_PREFIX.length);
        editor.setDecorations(ensureColorTagDecoration(tagColor), ranges);
    }
    for (const [key, deco] of colorTagDecorationMeta) {
        if (!activeColorKeys.has(key)) editor.setDecorations(deco, []);
    }
}

function clearUnboundTagDecorations(editor: vscode.TextEditor): void {
    const normalDeco = decorationTypes.get(UNBOUND_TAG_DECORATION_KEY);
    if (normalDeco) editor.setDecorations(normalDeco, []);
    for (const deco of colorTagDecorationMeta.values()) {
        editor.setDecorations(deco, []);
    }
}

function withAlpha(color: string, alpha: number): string {
    const expanded = color.replace(/^#([A-Fa-f0-9])([A-Fa-f0-9])([A-Fa-f0-9])$/, '#$1$1$2$2$3$3');
    const match = /^#([A-Fa-f0-9]{6})$/.exec(expanded);
    if (!match) return color;
    const value = match[1];
    const red = parseInt(value.slice(0, 2), 16);
    const green = parseInt(value.slice(2, 4), 16);
    const blue = parseInt(value.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(alpha, 1))})`;
}

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
function ensureDecorationTypes(): Set<string> {
    const changedRoles = new Set<string>(); // [ANCHOR A-1] 新增：记录本轮变化的角色名

    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const defaultColor = cfg.get<string>('defaultColor')!;
    const rangeBehavior = vscode.DecorationRangeBehavior.ClosedClosed; // 两端关闭

    // 1) 计算每个角色当前应有的 propsHash
    const newHashMap = new Map<string, string>();
    for (const r of roles) {
        const textStyle = getTextStyleFromRole(r);
        // 兼容旧格式：如果没有 style.color，使用顶层 color
        const color = textStyle.color ?? r.color ?? typeColorMap[r.type] ?? defaultColor;

        // 构建样式哈希，包含所有样式属性
        const props: any = {
            color,
            type: r.type,
            rb: 'ClosedClosed',
            backgroundColor: textStyle.backgroundColor || null,  // 使用 null 而不是 undefined
            bold: textStyle.bold || false,
            italic: textStyle.italic || false,
            strikethrough: textStyle.strikethrough || false,
            underline: textStyle.underline || false
        };
        const propsHash = JSON.stringify(props);
        newHashMap.set(r.name, propsHash);

        // 调试：输出每个角色的样式信息
    }

    // 2) 更新已有的 & 新增缺失的
    for (const [roleName, propsHash] of newHashMap) {
        const prev = decorationMeta.get(roleName);
        if (!prev || prev.propsHash !== propsHash) {
            prev?.textDeco.dispose();

            // 直接从 roles 数组获取角色对象
            const role = roles.find(r => r.name === roleName);
            const textStyle = getTextStyleFromRole(role);
            const props = JSON.parse(propsHash);

            // 文字层不设置背景色，允许背景层跨过其它角色连续绘制。
            const textDecoOptions: vscode.DecorationRenderOptions = {
                rangeBehavior
            };

            // 设置颜色
            textDecoOptions.color = props.color;

            // 设置字体样式（斜体）
            const fontStyle = buildFontStyle(textStyle);
            if (fontStyle) {
                textDecoOptions.fontStyle = fontStyle;
            }

            // 设置字体粗细（粗体）
            const fontWeight = buildFontWeight(textStyle);
            if (fontWeight) {
                textDecoOptions.fontWeight = fontWeight;
            }

            // 设置文本装饰（下划线/删除线）
            const textDecoration = buildTextDecoration(textStyle);
            if (textDecoration) {
                textDecoOptions.textDecoration = textDecoration;
            }

            const textDeco = vscode.window.createTextEditorDecorationType(textDecoOptions);
            decorationMeta.set(roleName, { textDeco, propsHash });
            changedRoles.add(roleName); // [ANCHOR A-1] 记录变化
        }
    }

    // 3) 删除多余的
    for (const oldName of Array.from(decorationMeta.keys())) {
        if (!newHashMap.has(oldName)) {
            const meta = decorationMeta.get(oldName)!;
            meta.textDeco.dispose();
            decorationMeta.delete(oldName);
            changedRoles.add(oldName); // [ANCHOR A-1] 删除也算变化
        }
    }

    // 任一组成角色的样式变化后，旧的合成 DecorationType 必须失效。
    for (const [key, meta] of compositeDecorationMeta) {
        if (
            (meta.foregroundRoleName && changedRoles.has(meta.foregroundRoleName))
            || (meta.backgroundRoleName && changedRoles.has(meta.backgroundRoleName))
        ) {
            meta.deco.dispose();
            compositeDecorationMeta.delete(key);
        }
    }

    return changedRoles; // [ANCHOR A-1]
}

function ensureCompositeDecoration(
    foregroundRole?: Role,
    backgroundRole?: Role
): { key: string; meta: CompositeDecoMeta } | undefined {
    if (!foregroundRole && !backgroundRole) {
        return undefined;
    }

    const foregroundMeta = foregroundRole ? decorationMeta.get(foregroundRole.name) : undefined;
    const backgroundMeta = backgroundRole ? decorationMeta.get(backgroundRole.name) : undefined;
    if ((foregroundRole && !foregroundMeta) || (backgroundRole && !backgroundMeta)) {
        return undefined;
    }

    const key = compositeDecorationKey(foregroundRole?.name, backgroundRole?.name);
    const propsHash = JSON.stringify({
        foreground: foregroundMeta?.propsHash || null,
        background: backgroundMeta?.propsHash || null,
    });
    const existing = compositeDecorationMeta.get(key);
    if (existing?.propsHash === propsHash) {
        return { key, meta: existing };
    }
    existing?.deco.dispose();

    const options: vscode.DecorationRenderOptions = {
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    };
    if (foregroundRole && foregroundMeta) {
        const foregroundProps = JSON.parse(foregroundMeta.propsHash);
        const foregroundStyle = getTextStyleFromRole(foregroundRole);
        options.color = foregroundProps.color;

        const fontStyle = buildFontStyle(foregroundStyle);
        if (fontStyle) {
            options.fontStyle = fontStyle;
        }
        const fontWeight = buildFontWeight(foregroundStyle);
        if (fontWeight) {
            options.fontWeight = fontWeight;
        }
        const textDecoration = buildTextDecoration(foregroundStyle);
        if (textDecoration) {
            options.textDecoration = textDecoration;
        }
    }
    if (backgroundMeta) {
        const backgroundProps = JSON.parse(backgroundMeta.propsHash);
        if (backgroundProps.backgroundColor) {
            options.backgroundColor = backgroundProps.backgroundColor;
        }
    }

    const meta: CompositeDecoMeta = {
        deco: vscode.window.createTextEditorDecorationType(options),
        propsHash,
        foregroundRoleName: foregroundRole?.name,
        backgroundRoleName: backgroundRole?.name,
    };
    compositeDecorationMeta.set(key, meta);
    return { key, meta };
}


/** 遍历所有可见编辑器，更新装饰 & 诊断 */
let hugeWarnedFiles = new Set<string>();
export async function updateDecorations() {
    // 先确保 DecorationType 同步最新
    const changedRoles = ensureDecorationTypes(); // [ANCHOR A-2]


    // 每个可见编辑器单独处理
    for (const editor of vscode.window.visibleTextEditors) {
        // [ANCHOR C-2] 本次这个 TextEditor 是否是新实例（第一次见到）
        const forceApplyForNewEditor = !seenEditors.has(editor);
        if (forceApplyForNewEditor) seenEditors.add(editor);

        const doc = editor.document;
        
        // 跳过输出面板、调试控制台等非文件类型的文档
        if (doc.uri.scheme === 'output' || doc.uri.scheme === 'debug' || doc.uri.scheme === 'vscode') {
            clearUnboundTagDecorations(editor);
            continue;
        }
        const bigCfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
        const hugeTh = bigCfg.get<number>('hugeFile.thresholdBytes', 50 * 1024)!;
        const suppress = bigCfg.get<boolean>('hugeFile.suppressWarning', false)!;
        if (isHugeFile(doc, hugeTh)) {
            // 跳过高成本标注
            clearUnboundTagDecorations(editor);
            if (!suppress && !hugeWarnedFiles.has(doc.uri.fsPath)) {
                hugeWarnedFiles.add(doc.uri.fsPath);
                vscode.window.showInformationMessage('该文件体积较大，已关闭自动机角色高亮与敏感词正则扫描，仅保留基础统计 (可在设置中修改 hugeFile.thresholdBytes)。');
            }
            continue;
        }
        // 过滤语言 & 词库文件（支持通过配置的语言 ID 或文件扩展名）
        const supportedLangs = getSupportedLanguages();
        const supportedExts = new Set(getSupportedExtensions().map(e => e.toLowerCase()));
        const fileNameLower = doc.fileName.toLowerCase();
        const extMatch = fileNameLower.match(/\.([a-z0-9_\-]+)$/);
        const ext = extMatch ? extMatch[1] : '';
        if (!supportedLangs.includes(doc.languageId) && !supportedExts.has(ext)) {
            clearUnboundTagDecorations(editor);
            continue;
        }
        const folders = vscode.workspace.workspaceFolders;

        // 重置 hoverRanges
        setHoverRanges([]);

        // 命中缓存则先应用装饰，再延迟一次完整验证
        const docKeyEarly = doc.uri.toString();
        const cooldownUntil = restoreCooldown.get(docKeyEarly) || 0;
        if (Date.now() >= cooldownUntil && tryRestoreFromCache(editor, docKeyEarly)) {
            updateUnboundTagDecorations(editor);
            setTimeout(() => {
                // 冷却后触发一次标准更新，确保与文件内容一致
                updateDecorations();
            }, 150);
            continue;
        }

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
                fullText = doc.getText();
                const rawHits = ahoCorasickManager.search(fullText);
                hits = rawHits.map(([endIdx, pat]) => [endIdx, Array.isArray(pat) ? pat : [pat]]);
            }
        } catch (e) {
            console.warn('[Decorations] 异步匹配失败 fallback 同步', e);
            fullText = doc.getText();
            const rawHits = ahoCorasickManager.search(fullText);
            hits = rawHits.map(([endIdx, pat]) => [endIdx, Array.isArray(pat) ? pat : [pat]]);
        }
        const acCost = Date.now() - startMs;
    

        // 预构建 pattern -> role 映射（包含别名和fixes），避免依赖主线程 AC 的 patternMap 重建时序导致别名遗漏
        const {
            roleToRanges,
            hoverEntries,
            visualSegments,
            fullText: resolvedText,
            hits: resolvedHits,
        } = await collectRoleUsageRanges(doc, { hits, fullText });
        hits = resolvedHits;
        fullText = resolvedText;

        for (const entry of hoverEntries) {
            hoverRanges.push(entry);
        }

        updateUnboundTagDecorations(editor, fullText);

        const visualDecorations = new Map<string, {
            deco: vscode.TextEditorDecorationType;
            propsHash: string;
            ranges: vscode.Range[];
        }>();
        for (const segment of visualSegments) {
            const foregroundRole = segment.foreground?.role;
            const backgroundRole = segment.background?.role;
            let key: string;
            let deco: vscode.TextEditorDecorationType;
            let propsHash: string;

            if (backgroundRole) {
                const composite = ensureCompositeDecoration(foregroundRole, backgroundRole);
                if (!composite) {
                    continue;
                }
                key = composite.key;
                deco = composite.meta.deco;
                propsHash = composite.meta.propsHash;
            } else if (foregroundRole) {
                const meta = decorationMeta.get(foregroundRole.name);
                if (!meta) {
                    continue;
                }
                key = textDecorationKey(foregroundRole.name);
                deco = meta.textDeco;
                propsHash = meta.propsHash;
            } else {
                continue;
            }

            const existing = visualDecorations.get(key);
            if (existing) {
                existing.ranges.push(segment.range);
            } else {
                visualDecorations.set(key, { deco, propsHash, ranges: [segment.range] });
            }
        }

        const visualSnapshot = new Map<string, vscode.Range[]>();
        for (const [key, visual] of visualDecorations) {
            visualSnapshot.set(key, visual.ranges);
        }
        currentRangesByDoc.set(doc.uri.toString(), visualSnapshot);

        // —— 按“文档×角色”做哈希比对，避免跨编辑器串扰 —— //
        const docKey = doc.uri.toString();               // 也可用 toString(true)
        const perDoc = getPerDocHashes(docKey);
        // 任一角色样式变化都可能影响多个合成组合，保守地强制当前文档重绘。
        if (changedRoles.size) {
            perDoc.clear();
        }

        const applyDecorationRanges = (
            ranges: vscode.Range[],
            key: string,
            deco: vscode.TextEditorDecorationType,
            propsHash: string
        ) => {
            const rangesHash = ranges
                .map(r => `${r.start.line},${r.start.character}-${r.end.line},${r.end.character}`)
                .join('|');
            const appliedKey = `${propsHash}@${rangesHash}`;
            const prevKey = perDoc.get(key) || '';
            if (forceApplyForNewEditor || prevKey !== appliedKey) {
                editor.setDecorations(deco, ranges);
                perDoc.set(key, appliedKey);
            }
        };

        // 每个区间只应用一个已经合成前景与背景属性的 DecorationType。
        for (const [key, visual] of visualDecorations) {
            applyDecorationRanges(visual.ranges, key, visual.deco, visual.propsHash);
        }

        // 清空当前文档中本轮未出现的文字与合成装饰。
        for (const [roleName, meta] of decorationMeta) {
            const textKey = textDecorationKey(roleName);
            if (!visualDecorations.has(textKey)) {
                editor.setDecorations(meta.textDeco, []);
                perDoc.set(textKey, `${meta.propsHash}@`);
            }
        }
        for (const [key, meta] of compositeDecorationMeta) {
            if (!visualDecorations.has(key)) {
                editor.setDecorations(meta.deco, []);
                perDoc.set(key, `${meta.propsHash}@`);
            }
        }



        // 写入缓存供“当前文章角色”视图复用
        updateDocumentRoleOccurrences(doc, roleToRanges);
        try {
            updateRoleUsageFromDocument(doc, roleToRanges);
        } catch (err) {
            console.warn('[Decorations] updateRoleUsageFromDocument failed', err);
        }

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
                
                // 读取敏感词警告级别配置
                const config = vscode.workspace.getConfiguration('AndreaNovelHelper');
                const sensitiveWordsWarningLevel = config.get<string>('sensitiveWords.warningLevel', 'warning');
                
                // 转换警告级别
                let severity: vscode.DiagnosticSeverity;
                switch (sensitiveWordsWarningLevel.toLowerCase()) {
                    case 'error':
                        severity = vscode.DiagnosticSeverity.Error;
                        break;
                    case 'warning':
                        severity = vscode.DiagnosticSeverity.Warning;
                        break;
                    case 'information':
                        severity = vscode.DiagnosticSeverity.Information;
                        break;
                    case 'hint':
                        severity = vscode.DiagnosticSeverity.Hint;
                        break;
                    default:
                        severity = vscode.DiagnosticSeverity.Warning;
                }
                
                const diag = new vscode.Diagnostic(range, msg, severity);
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

        // —— 清理不再可见的文档缓存，改为智能缓存而不是直接删除 —— 
        const visibleKeys = new Set(vscode.window.visibleTextEditors.map(e => e.document.uri.toString()));
        const maxCache = getCacheSize();
        
        for (const key of Array.from(appliedHashes.keys())) {
            if (!visibleKeys.has(key)) {
                const hashes = appliedHashes.get(key);
                if (hashes && hashes.size > 0 && maxCache > 0) {
                    // 移入缓存而不是删除（包含范围快照）
                    const openCount = documentOpenCounts.get(key) || 1;
                    const rangesSnap = currentRangesByDoc.get(key);
                    let rangesByRoleName: Map<string, SimpleRange[]> | undefined;
                    if (rangesSnap) {
                        rangesByRoleName = new Map<string, SimpleRange[]>();
                        for (const [roleName, ranges] of rangesSnap) {
                            rangesByRoleName.set(roleName, ranges.map(r => [r.start.line, r.start.character, r.end.line, r.end.character]));
                        }
                    }
                    decorationCache.set(key, {
                        lastSeen: Date.now(),
                        openCount: openCount,
                        hashes: new Map(hashes),
                        rangesByRoleName
                    });
                }
                appliedHashes.delete(key);
                currentRangesByDoc.delete(key);
            }
        }
        
        // 清理过期缓存，按常用度（打开次数）排序，保持缓存大小限制
        if (decorationCache.size > maxCache && maxCache > 0) {
            const entries = Array.from(decorationCache.entries())
                .sort((a, b) => {
                    // 优先按打开次数排序，次数相同则按最近使用时间排序
                    if (a[1].openCount !== b[1].openCount) {
                        return a[1].openCount - b[1].openCount; // 少用的优先删除
                    }
                    return a[1].lastSeen - b[1].lastSeen; // 老的优先删除
                });
            
            const toDelete = entries.slice(0, decorationCache.size - maxCache);
            for (const [key] of toDelete) {
                decorationCache.delete(key);
            }
        }

        // 触发“该文档装饰完成”事件
        try {
            _onDidUpdateDecorations.fire({
                uri: doc.uri,
                rolesHighlighted: roleToRanges.size,
                ranges: Array.from(roleToRanges.values()).reduce((s, arr) => s + arr.length, 0),
                tookMs: Date.now() - startMs
            });
        } catch { }
    }
}


// [ANCHOR B-1] 主题与配置变化监听（在 extension activate 时调用）
export function registerDecorationWatchers(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            // [ANCHOR B-3] 切换激活编辑器时也刷新，覆盖“可见集未变化”的情况
            updateDecorations();
        }),
        vscode.window.onDidChangeActiveColorTheme(() => {
            // 主题改变可能影响颜色映射 → 触发一次重绘
            updateDecorations();
        }),
        vscode.workspace.onDidChangeConfiguration(e => {
            // 插件配置变更（默认色、hugeFile 阈值、受支持语言/后缀等）
            if (
                e.affectsConfiguration('AndreaNovelHelper') ||
                e.affectsConfiguration('workbench.colorTheme')
            ) {
                updateDecorations();
            }
        })
    );
}
