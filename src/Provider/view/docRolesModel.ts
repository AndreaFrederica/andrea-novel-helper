import * as vscode from 'vscode';
import { isHugeFile, getSupportedLanguages, getSupportedExtensions } from '../../utils/utils';
import { getEffectiveDocumentSync } from '../../context/previewRedirect';
import { getDocumentRoleOccurrences } from '../../context/documentRolesCache';
import { onDidUpdateDecorations } from '../../events/updateDecorations';
import { Role } from '../../extension';


const UNGROUPED = '(未分组)';

export interface RoleHierarchyTypeGroup { type: string; roles: Role[]; }
export interface RoleHierarchyAffiliationGroup { affiliation: string; types: RoleHierarchyTypeGroup[]; }

// 允许扫描的 scheme
const ALLOWED_SCHEMES = new Set(['file', 'untitled', 'andrea-outline']);

// 统一取扩展名（优先 fileName，退回 uri.path）
function getDocExtension(doc: vscode.TextDocument): string {
    const s = (doc.fileName || doc.uri.path || '').toLowerCase();
    const m = s.match(/\.([a-z0-9_\-]+)$/);
    return m ? m[1] : '';
}

// 与 Hover 一致：仅在允许的 scheme 且语言/扩展受支持时参与构建
function isDocSupportedForRoles(doc: vscode.TextDocument): boolean {
    if (!ALLOWED_SCHEMES.has(doc.uri.scheme)) {return false;}

    const langs = getSupportedLanguages();
    if (langs.includes(doc.languageId)) {return true;}

    const exts = new Set(getSupportedExtensions().map(e => e.toLowerCase()));
    const ext = getDocExtension(doc);
    return exts.has(ext);
}



class DocumentRolesModel {
    private static _instance: DocumentRolesModel | undefined;
    static get instance(): DocumentRolesModel { return this._instance ??= new DocumentRolesModel(); }

    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    private lastDocUri: string | undefined;
    private lastVersion: number | undefined;
    private cachedHierarchy: RoleHierarchyAffiliationGroup[] = [];
    private rebuildScheduled = false; // 保留兜底机制（极端情况下）
    private pendingAsync = new Set<string>(); // 异步匹配中的文档

    private constructor() {
        // 监听装饰刷新完成事件：表示最新的角色命中缓存已写入，可直接重建模型
        onDidUpdateDecorations(e => {
            const active = vscode.window.activeTextEditor?.document;
            if (!active) { return; }
            if (e.uri.toString() === active.uri.toString()) {
                const changed = this.rebuild(true);
                if (changed) { this._onDidChange.fire(); }
            }
        });
        // 仍监听主动切换（避免尚未触发装饰的第一次进入）
        vscode.window.onDidChangeActiveTextEditor(() => this.scheduleRebuild());
        
        // 监听角色显示配置变化
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('AndreaNovelHelper.docRoles')) {
                const changed = this.rebuild(true);
                if (changed) { this._onDidChange.fire(); }
            }
        });
    }

    private scheduleRebuild() {
    if (this.rebuildScheduled) { return; }
        this.rebuildScheduled = true;
        setTimeout(() => {
            this.rebuildScheduled = false;
            const changed = this.rebuild();
            if (changed) { this._onDidChange.fire(); }
        }, 120); // debounce
    }

    forceRefresh() {
        const changed = this.rebuild(true);
        if (changed) { this._onDidChange.fire(); }
    }

    getHierarchy(): RoleHierarchyAffiliationGroup[] {
    const active = getEffectiveDocumentSync() ?? vscode.window.activeTextEditor?.document;
        if (!active) { return []; }
        if (active.uri.toString() !== this.lastDocUri || active.version !== this.lastVersion) {
            this.rebuild();
        }
        return this.cachedHierarchy;
    }

    private rebuild(force = false): boolean {
    const active = getEffectiveDocumentSync() ?? vscode.window.activeTextEditor?.document;
        if (!active) {
            if (this.cachedHierarchy.length) {
                this.cachedHierarchy = [];
                this.lastDocUri = undefined; this.lastVersion = undefined;
                return true;
            }
            return false;
        }
        const uriStr = active.uri.toString();
        if (!force && uriStr === this.lastDocUri && active.version === this.lastVersion) {
            return false;
        }
        this.lastDocUri = uriStr;
        this.lastVersion = active.version;
        this.cachedHierarchy = this.buildFromDocument(active);
        return true;
    }

    private buildFromDocument(doc: vscode.TextDocument): RoleHierarchyAffiliationGroup[] {
        // 使用用户设置的 supportedFileTypes，而不是硬编码 markdown/plaintext
        const supported = getSupportedLanguages();
        if (!isDocSupportedForRoles(doc)) {return [];}
        if (!supported.includes(doc.languageId)) {
            // 兜底：某些 JSON5 插件语言 id 可能不是 json5，但扩展名为 .json5，且用户已允许 json5
            const lower = doc.fileName.toLowerCase();
            if (!(lower.endsWith('.json5') && supported.includes('json5'))) {
                return [];
            }
        }
        try {
            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const hugeTh = cfg.get<number>('hugeFile.thresholdBytes', 50*1024)!;
            if (isHugeFile(doc, hugeTh)) {
                console.warn('[DocRolesModel] skip huge file', doc.uri.fsPath, 'sizeApprox>', hugeTh);
                return [];
            }
        } catch {/* ignore */}
        const occ = getDocumentRoleOccurrences(doc);
        const seen = new Set<Role>();
        if (occ) {
            for (const r of occ.keys()) { seen.add(r); }
        }
        // 同步阶段仅使用已知（缓存）结果构建层级（若无则为空）
        if (seen.size === 0) { return []; }
        return this.hierarchyFromSeen(seen);
    }

    private hierarchyFromSeen(seen: Set<Role>): RoleHierarchyAffiliationGroup[] {
        const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
        const groupBy = cfg.get<string>('docRoles.groupBy', 'affiliation');
        const respectAffiliation = cfg.get<boolean>('docRoles.respectAffiliation', true);
        const respectType = cfg.get<boolean>('docRoles.respectType', true);
        const primaryGroup = cfg.get<string>('docRoles.primaryGroup', 'affiliation');
    const useCustomGroups = cfg.get<boolean>('docRoles.useCustomGroups', false);
    const customGroups = cfg.get<any[]>('docRoles.customGroups', []);

        if (groupBy === 'none') {
            // 不分组：所有角色平铺显示
            const roles = Array.from(seen);
            roles.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans', { numeric: true, sensitivity: 'base' }));
            return [{
                affiliation: '全部角色',
                types: [{ type: '', roles }]
            }];
        }

        // 如果启用自定义分组
        if (useCustomGroups && customGroups.length > 0) {
            return this.buildCustomGroups(seen, customGroups, respectAffiliation, respectType);
        }

        const affMap = new Map<string, Map<string, Role[]>>();
        
        for (const r of seen) {
            let firstKey: string = '';
            let secondKey: string = '';
            
            if (groupBy === 'type') {
                // 按类型分组
                firstKey = r.type || 'unknown';
                secondKey = respectAffiliation ? (r.affiliation?.trim() || UNGROUPED) : '';
            } else if (groupBy === 'affiliation') {
                // 按归属分组（默认）
                if (respectAffiliation) {
                    // 遵循归属时，使用 primaryGroup 决定第一级分组
                    if (primaryGroup === 'type') {
                        firstKey = r.type || 'unknown';
                        secondKey = respectType ? (r.affiliation?.trim() || UNGROUPED) : '';
                    } else {
                        firstKey = r.affiliation?.trim() || UNGROUPED;
                        secondKey = respectType ? (r.type || 'unknown') : '';
                    }
                } else {
                    // 不遵循归属时，根据 respectType 决定分组方式
                    if (respectType) {
                        firstKey = r.type || 'unknown';
                        secondKey = ''; // 不进行二级分组
                    } else {
                        // 既不遵循归属也不遵循类型，所有角色平铺
                        firstKey = '所有角色';
                        secondKey = '';
                    }
                }
            } else {
                // groupBy === 'none' 的情况已经在前面处理了，这里是兜底
                firstKey = 'unknown';
                secondKey = '';
            }
            
            if (!affMap.has(firstKey)) { affMap.set(firstKey, new Map()); }
            const tm = affMap.get(firstKey)!;
            if (!tm.has(secondKey)) { tm.set(secondKey, []); }
            tm.get(secondKey)!.push(r);
        }

        const affGroups: RoleHierarchyAffiliationGroup[] = [];
        for (const [firstKey, tMap] of affMap) {
            const typeGroups: RoleHierarchyTypeGroup[] = [];
            for (const [secondKey, arr] of tMap) {
                arr.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans', { numeric: true, sensitivity: 'base' }));
                // 只有当 secondKey 不为空时才创建类型分组
                // 如果为空，说明不需要二级分组，我们将在后面特殊处理
                if (secondKey !== '') {
                    typeGroups.push({ type: secondKey, roles: arr.slice() });
                } else {
                    // 对于不需要二级分组的情况，我们创建一个特殊的类型组
                    // 使用一个特殊标记来表示这是一个"扁平"分组
                    typeGroups.push({ type: '__FLAT__', roles: arr.slice() });
                }
            }
            typeGroups.sort((a, b) => a.type.localeCompare(b.type, 'zh-Hans', { numeric: true, sensitivity: 'base' }));
            affGroups.push({ affiliation: firstKey, types: typeGroups });
        }
        
        affGroups.sort((a, b) => a.affiliation.localeCompare(b.affiliation, 'zh-Hans', { numeric: true, sensitivity: 'base' }));
        return affGroups;
    }

    private buildCustomGroups(
        seen: Set<Role>,
        customGroups: any[],
        respectAffiliation: boolean,
        respectType: boolean
    ): RoleHierarchyAffiliationGroup[] {
        const grouped = new Map<string, Role[]>();
        const ungrouped: Role[] = [];

        // 初始化自定义分组
        for (const group of customGroups) {
            if (group.name) {
                grouped.set(group.name, []);
            }
        }

        // 对每个角色进行分组匹配
        for (const role of seen) {
            let matched = false;
            
            for (const group of customGroups) {
                if (!group.name || !group.patterns || !Array.isArray(group.patterns)) {
                    continue;
                }
                // 自定义分组的匹配应使用真实字段，不受忽略开关影响；
                // 忽略开关只影响后续显示层级是否按类型/归属再分组。
                const matchField = group.matchType === 'type'
                    ? (role.type || '')
                    : (role.affiliation || '');
                
                // 检查是否匹配任何模式
                const isMatch = group.patterns.some((pattern: string) => 
                    matchField.includes(pattern)
                );
                
                if (isMatch) {
                    grouped.get(group.name)!.push(role);
                    matched = true;
                    break; // 只匹配第一个符合条件的分组
                }
            }
            
            if (!matched) {
                ungrouped.push(role);
            }
        }

        // 如果有未分组的角色，添加到"其他"分组
        if (ungrouped.length > 0) {
            grouped.set('其他', ungrouped);
        }

        // 若忽略归属，且存在按归属匹配的自定义分组，则在顶层扁平化：
        // 合并所有自定义分组为一个“全部角色”，仅按类型（或扁平）作为二级显示。
        const hasAffBased = customGroups.some(g => g?.matchType === 'affiliation');
        if (respectType !== undefined && respectAffiliation === false && hasAffBased) {
            const merged: Role[] = [];
            for (const arr of grouped.values()) { merged.push(...arr); }
            if (ungrouped.length) { merged.push(...ungrouped); }
            if (merged.length === 0) { return []; }
            const typeMap = new Map<string, Role[]>();
            for (const r of merged) {
                const t = respectType ? (r.type || 'unknown') : '__FLAT__';
                if (!typeMap.has(t)) { typeMap.set(t, []); }
                typeMap.get(t)!.push(r);
            }
            const tgs: RoleHierarchyTypeGroup[] = [];
            for (const [t, rs] of typeMap) {
                rs.sort((a,b)=>a.name.localeCompare(b.name,'zh-Hans',{numeric:true,sensitivity:'base'}));
                tgs.push({ type: t, roles: rs });
            }
            tgs.sort((a,b)=>a.type.localeCompare(b.type,'zh-Hans',{numeric:true,sensitivity:'base'}));
            return [{ affiliation: '全部角色', types: tgs }];
        }

        // 构建结果
        const result: RoleHierarchyAffiliationGroup[] = [];
        
        for (const [groupName, roles] of grouped) {
            if (roles.length === 0) { continue; }
            
            // 二级分组：若忽略类型，则扁平化（使用 __FLAT__ 标记）
            const typeMap = new Map<string, Role[]>();
            for (const role of roles) {
                const typeKey = respectType ? (role.type || 'unknown') : '__FLAT__';
                if (!typeMap.has(typeKey)) {
                    typeMap.set(typeKey, []);
                }
                typeMap.get(typeKey)!.push(role);
            }
            
            const typeGroups: RoleHierarchyTypeGroup[] = [];
            for (const [type, typeRoles] of typeMap) {
                typeRoles.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans', { numeric: true, sensitivity: 'base' }));
                typeGroups.push({ type, roles: typeRoles });
            }
            
            typeGroups.sort((a, b) => a.type.localeCompare(b.type, 'zh-Hans', { numeric: true, sensitivity: 'base' }));
            result.push({ affiliation: groupName, types: typeGroups });
        }
        
        // 按自定义分组顺序排序，"其他"放在最后
        result.sort((a, b) => {
            if (a.affiliation === '其他') { return 1; }
            if (b.affiliation === '其他') { return -1; }
            
            const aIndex = customGroups.findIndex(g => g.name === a.affiliation);
            const bIndex = customGroups.findIndex(g => g.name === b.affiliation);
            
            return aIndex - bIndex;
        });
        
        return result;
    }
}

export function getDocumentRolesModel(): DocumentRolesModel {
    return DocumentRolesModel.instance;
}
