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
        const affMap = new Map<string, Map<string, Role[]>>();
        for (const r of seen) {
            const aff = r.affiliation?.trim() || UNGROUPED;
            const type = r.type || 'unknown';
            if (!affMap.has(aff)) { affMap.set(aff, new Map()); }
            const tm = affMap.get(aff)!;
            if (!tm.has(type)) { tm.set(type, []); }
            tm.get(type)!.push(r);
        }
        const affGroups: RoleHierarchyAffiliationGroup[] = [];
        for (const [aff, tMap] of affMap) {
            const typeGroups: RoleHierarchyTypeGroup[] = [];
            for (const [type, arr] of tMap) {
                arr.sort((a,b)=>a.name.localeCompare(b.name,'zh-Hans',{numeric:true,sensitivity:'base'}));
                typeGroups.push({ type, roles: arr.slice() });
            }
            typeGroups.sort((a,b)=>a.type.localeCompare(b.type,'zh-Hans',{numeric:true,sensitivity:'base'}));
            affGroups.push({ affiliation: aff, types: typeGroups });
        }
    affGroups.sort((a,b)=>a.affiliation.localeCompare(b.affiliation,'zh-Hans',{numeric:true,sensitivity:'base'}));
    return affGroups;
    }
}

export function getDocumentRolesModel(): DocumentRolesModel {
    return DocumentRolesModel.instance;
}
