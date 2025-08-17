import * as vscode from 'vscode';
import { ahoCorasickManager } from '../../utils/ahoCorasickManager';
import { isHugeFile } from '../../utils/utils';
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
            // 回退：若缓存还未生成（可能首次还未触发装饰），做一次轻量匹配
            const text = doc.getText();
            const hits = ahoCorasickManager.search(text);
            for (const [, pats] of hits) {
                const arr = Array.isArray(pats) ? pats : [pats];
                for (const p of arr) {
                    const r = ahoCorasickManager.getRole(p.trim().normalize('NFC'));
                    if (r) { seen.add(r); }
                }
            }
        }
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
