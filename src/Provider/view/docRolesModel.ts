import * as vscode from 'vscode';
import { ahoCorasickManager } from '../../utils/ahoCorasickManager';
import { isHugeFile } from '../../utils/utils';
import { getRoleMatches } from '../../utils/roleAsyncShared';
import { getDocumentRoleOccurrences } from '../../utils/documentRolesCache';
import { Role } from '../../extension';

const UNGROUPED = '(未分组)';

export interface RoleHierarchyTypeGroup { type: string; roles: Role[]; }
export interface RoleHierarchyAffiliationGroup { affiliation: string; types: RoleHierarchyTypeGroup[]; }

class DocumentRolesModel {
    private static _instance: DocumentRolesModel | undefined;
    static get instance(): DocumentRolesModel { return this._instance ??= new DocumentRolesModel(); }

    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    private lastDocUri: string | undefined;
    private lastVersion: number | undefined;
    private cachedHierarchy: RoleHierarchyAffiliationGroup[] = [];
    private rebuildScheduled = false;
    private pendingAsync = new Set<string>(); // uri -> in-flight async match

    private constructor() {
        vscode.window.onDidChangeActiveTextEditor(() => this.scheduleRebuild());
        vscode.workspace.onDidChangeTextDocument(ev => {
            const active = vscode.window.activeTextEditor?.document;
            if (!active) { return; }
            if (ev.document === active) {
                this.scheduleRebuild();
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
        const active = vscode.window.activeTextEditor?.document;
        if (!active) { return []; }
        if (active.uri.toString() !== this.lastDocUri || active.version !== this.lastVersion) {
            this.rebuild();
        }
        return this.cachedHierarchy;
    }

    private rebuild(force = false): boolean {
        const active = vscode.window.activeTextEditor?.document;
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
        if (!(doc.languageId === 'markdown' || doc.languageId === 'plaintext')) {
            return [];
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
        } else {
            // 异步匹配：避免同步 AC 阻塞主线程
            const uriStr = doc.uri.toString();
            if (!this.pendingAsync.has(uriStr)) {
                this.pendingAsync.add(uriStr);
                const versionAtReq = doc.version;
                getRoleMatches(doc).then(matches => {
                    try {
                        if (doc.isClosed || doc.version !== versionAtReq) { return; }
                        // 确保 patternMap 已构建
                        ahoCorasickManager.initAutomaton();
                        const asyncSeen = new Set<Role>();
                        for (const m of matches) {
                            for (const pat of m.pats) {
                                const r = ahoCorasickManager.getRole(pat.trim().normalize('NFC'));
                                if (r) { asyncSeen.add(r); }
                            }
                        }
                        // 只有当当前层级为空或角色集合不同才刷新
                        if (asyncSeen.size) {
                            const before = this.cachedHierarchy;
                            const newHier = this.hierarchyFromSeen(asyncSeen);
                            const changed = JSON.stringify(before) !== JSON.stringify(newHier);
                            if (changed) {
                                this.cachedHierarchy = newHier;
                                this._onDidChange.fire();
                            }
                        }
                    } finally {
                        this.pendingAsync.delete(uriStr);
                    }
                }).catch(()=>{ this.pendingAsync.delete(uriStr); });
            }
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
