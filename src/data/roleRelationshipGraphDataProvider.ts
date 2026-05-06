import { Role } from '../extension';
import { RoleRelationship } from '../types/relationshipTypes';
import { globalRelationshipManager } from '../utils/globalRelationshipManager';

export type RoleRelationshipGraphEdgeSource = 'reference' | 'marked' | 'relationship';

export interface RoleRelationshipGraphNode {
    id: string;
    label: string;
    name: string;
    uuid?: string;
    type?: string;
    affiliation?: string;
    packagePath?: string;
    sourcePath?: string;
    color?: string;
    roleData?: Record<string, unknown>;
    size: number;
    degree: number;
}

export interface RoleRelationshipGraphEdgeDetail {
    source: RoleRelationshipGraphEdgeSource;
    label: string;
    type: string;
    field?: string;
    sourceFile?: string;
    strength?: number;
    directed?: boolean;
    raw?: unknown;
}

export interface RoleRelationshipGraphEdge {
    id: string;
    source: string;
    target: string;
    label: string;
    type: string;
    sources: RoleRelationshipGraphEdgeSource[];
    weight: number;
    directed: boolean;
    details: RoleRelationshipGraphEdgeDetail[];
}

export interface RoleRelationshipGraphData {
    nodes: RoleRelationshipGraphNode[];
    edges: RoleRelationshipGraphEdge[];
    stats: {
        roleCount: number;
        edgeCount: number;
        referenceEdgeCount: number;
        markedEdgeCount: number;
        relationshipEdgeCount: number;
    };
}

type RoleLike = Role & Record<string, unknown>;

const EXCLUDED_REFERENCE_KEYS = new Set([
    'name',
    'uuid',
    'id',
    'type',
    'color',
    'aliases',
    'fixes',
    'fixs',
    'packagePath',
    'sourcePath',
    'wordSegmentFilter',
    'regex',
    'regexFlags',
    'priority',
    'relations',
    'relationships',
]);

const NON_CHARACTER_TYPES = new Set(['敏感词', '词汇', '正则表达式']);

export class RoleRelationshipGraphDataProvider {
    constructor(private readonly roles: Role[]) {}

    public getGraphData(): RoleRelationshipGraphData {
        const graphRoles = this.getGraphRoles();
        const resolver = new RoleResolver(graphRoles);
        const nodes = new Map<string, RoleRelationshipGraphNode>();
        const edges = new Map<string, RoleRelationshipGraphEdge>();

        for (const role of graphRoles) {
            nodes.set(getRoleId(role), this.toNode(role));
        }

        for (const role of graphRoles) {
            this.collectMarkedEdges(role, resolver, edges);
            this.collectReferenceEdges(role, graphRoles, resolver, edges);
        }

        for (const relationship of globalRelationshipManager.getAllRelationships()) {
            this.collectRelationshipEdge(relationship, resolver, edges);
        }

        for (const edge of edges.values()) {
            const source = nodes.get(edge.source);
            const target = nodes.get(edge.target);
            if (source) {
                source.degree += 1;
            }
            if (target) {
                target.degree += 1;
            }
        }

        const nodeList = Array.from(nodes.values()).map(node => ({
            ...node,
            size: Math.min(18, 5 + Math.sqrt(node.degree + 1) * 2),
        }));
        const edgeList = Array.from(edges.values());

        return {
            nodes: nodeList,
            edges: edgeList,
            stats: {
                roleCount: nodeList.length,
                edgeCount: edgeList.length,
                referenceEdgeCount: edgeList.filter(edge => edge.sources.includes('reference')).length,
                markedEdgeCount: edgeList.filter(edge => edge.sources.includes('marked')).length,
                relationshipEdgeCount: edgeList.filter(edge => edge.sources.includes('relationship')).length,
            },
        };
    }

    private getGraphRoles(): RoleLike[] {
        return this.roles
            .filter(role => role && role.name && role.sourcePath)
            .filter(role => !NON_CHARACTER_TYPES.has(String(role.type || '')))
            .map(role => role as RoleLike);
    }

    private toNode(role: RoleLike): RoleRelationshipGraphNode {
        return {
            id: getRoleId(role),
            label: role.name,
            name: role.name,
            uuid: role.uuid,
            type: role.type,
            affiliation: role.affiliation,
            packagePath: role.packagePath,
            sourcePath: role.sourcePath,
            color: typeof role.color === 'string' ? role.color : colorForRoleType(role.type),
            roleData: sanitizeRoleData(role),
            size: 6,
            degree: 0,
        };
    }

    private collectMarkedEdges(
        role: RoleLike,
        resolver: RoleResolver,
        edges: Map<string, RoleRelationshipGraphEdge>,
    ): void {
        const rawRelations = role.relations ?? role.relationships;
        if (!rawRelations) {
            return;
        }

        for (const item of normalizeMarkedRelations(rawRelations)) {
            const target = resolver.resolve(item.targetUuid || item.target);
            if (!target || getRoleId(target) === getRoleId(role)) {
                continue;
            }

            const type = item.type || '标记关系';
            const label = item.label || type;
            addEdge(edges, {
                sourceRole: role,
                targetRole: target,
                source: 'marked',
                type,
                label,
                strength: item.strength,
                directed: item.directed,
                field: 'relations',
                raw: item.raw,
            });
        }
    }

    private collectReferenceEdges(
        role: RoleLike,
        graphRoles: RoleLike[],
        resolver: RoleResolver,
        edges: Map<string, RoleRelationshipGraphEdge>,
    ): void {
        const sourceText = collectReferenceText(role).join('\n');
        if (!sourceText) {
            return;
        }

        const matchedTargets = new Set<string>();
        for (const targetRole of graphRoles) {
            const targetId = getRoleId(targetRole);
            if (targetId === getRoleId(role) || matchedTargets.has(targetId)) {
                continue;
            }
            const hit = resolver.findMentionInText(sourceText, targetRole);
            if (!hit) {
                continue;
            }
            matchedTargets.add(targetId);
            addEdge(edges, {
                sourceRole: role,
                targetRole,
                source: 'reference',
                type: '引用',
                label: '引用',
                directed: true,
                field: hit,
            });
        }
    }

    private collectRelationshipEdge(
        relationship: RoleRelationship,
        resolver: RoleResolver,
        edges: Map<string, RoleRelationshipGraphEdge>,
    ): void {
        const sourceRole = resolver.resolve(relationship.metadata?.sourceRoleUuid || relationship.sourceRole);
        const targetRole = resolver.resolve(relationship.metadata?.targetRoleUuid || relationship.targetRole);
        if (!sourceRole || !targetRole || getRoleId(sourceRole) === getRoleId(targetRole)) {
            return;
        }

        const type = relationship.type || '关系';
        const label = relationship.literalValue || type;
        addEdge(edges, {
            sourceRole,
            targetRole,
            source: 'relationship',
            type,
            label,
            strength: relationship.metadata?.strength,
            directed: relationship.metadata?.isDirectional,
            sourceFile: typeof relationship.metadata?.sourceFile === 'string' ? relationship.metadata.sourceFile : undefined,
            raw: relationship,
        });
    }
}

export function createRoleRelationshipGraphDataProvider(roles: Role[]): RoleRelationshipGraphDataProvider {
    return new RoleRelationshipGraphDataProvider(roles);
}

class RoleResolver {
    private readonly uuidToRole = new Map<string, RoleLike>();
    private readonly nameToRole = new Map<string, RoleLike>();

    constructor(private readonly roles: RoleLike[]) {
        for (const role of roles) {
            if (role.uuid) {
                this.uuidToRole.set(normalizeLookup(role.uuid), role);
            }
            for (const key of getRoleLookupTexts(role)) {
                if (!this.nameToRole.has(normalizeLookup(key))) {
                    this.nameToRole.set(normalizeLookup(key), role);
                }
            }
        }
    }

    public resolve(value: unknown): RoleLike | undefined {
        if (typeof value !== 'string') {
            return undefined;
        }
        const key = normalizeLookup(value);
        return this.uuidToRole.get(key) || this.nameToRole.get(key);
    }

    public findMentionInText(text: string, role: RoleLike): string | undefined {
        const lookupTexts = getRoleLookupTexts(role)
            .filter(item => item.trim().length >= 2)
            .sort((a, b) => b.length - a.length);

        return lookupTexts.find(item => text.includes(item));
    }
}

function addEdge(
    edges: Map<string, RoleRelationshipGraphEdge>,
    input: {
        sourceRole: RoleLike;
        targetRole: RoleLike;
        source: RoleRelationshipGraphEdgeSource;
        type: string;
        label: string;
        strength?: number;
        directed?: boolean;
        field?: string;
        sourceFile?: string;
        raw?: unknown;
    },
): void {
    const sourceId = getRoleId(input.sourceRole);
    const targetId = getRoleId(input.targetRole);
    const directed = input.directed !== false;
    const key = `${sourceId}|${targetId}|${normalizeLookup(input.type)}|${directed ? 'd' : 'u'}`;
    const detail: RoleRelationshipGraphEdgeDetail = {
        source: input.source,
        label: input.label,
        type: input.type,
        field: input.field,
        sourceFile: input.sourceFile || input.sourceRole.sourcePath,
        strength: input.strength,
        directed,
        raw: input.raw,
    };

    const existing = edges.get(key);
    if (existing) {
        existing.weight += normalizeStrength(input.strength);
        existing.details.push(detail);
        if (!existing.sources.includes(input.source)) {
            existing.sources.push(input.source);
        }
        if (!existing.label.includes(input.label)) {
            existing.label = `${existing.label} / ${input.label}`;
        }
        return;
    }

    edges.set(key, {
        id: stableId(key),
        source: sourceId,
        target: targetId,
        label: input.label,
        type: input.type,
        sources: [input.source],
        weight: normalizeStrength(input.strength),
        directed,
        details: [detail],
    });
}

function collectReferenceText(value: unknown, path: string[] = []): string[] {
    if (value === null || value === undefined) {
        return [];
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return [String(value)];
    }
    if (Array.isArray(value)) {
        return value.flatMap((item, index) => collectReferenceText(item, [...path, String(index)]));
    }
    if (typeof value === 'object') {
        const result: string[] = [];
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            if (path.length === 0 && EXCLUDED_REFERENCE_KEYS.has(key)) {
                continue;
            }
            result.push(...collectReferenceText(nested, [...path, key]));
        }
        return result;
    }
    return [];
}

function normalizeMarkedRelations(rawRelations: unknown): Array<{
    target?: string;
    targetUuid?: string;
    type?: string;
    label?: string;
    strength?: number;
    directed?: boolean;
    raw: unknown;
}> {
    if (Array.isArray(rawRelations)) {
        return rawRelations.map(item => normalizeMarkedRelationItem(item)).filter(Boolean) as ReturnType<typeof normalizeMarkedRelations>;
    }

    if (typeof rawRelations === 'object' && rawRelations !== null) {
        return Object.entries(rawRelations as Record<string, unknown>).map(([target, value]) => {
            const normalized = normalizeMarkedRelationItem(value);
            return {
                ...normalized,
                target: normalized?.target || target,
                raw: value,
            };
        });
    }

    return [];
}

function normalizeMarkedRelationItem(raw: unknown): {
    target?: string;
    targetUuid?: string;
    type?: string;
    label?: string;
    strength?: number;
    directed?: boolean;
    raw: unknown;
} | undefined {
    if (typeof raw === 'string') {
        return { target: raw, type: '标记关系', label: '标记关系', raw };
    }
    if (typeof raw !== 'object' || raw === null) {
        return undefined;
    }
    const item = raw as Record<string, unknown>;
    return {
        target: getString(item.target) || getString(item.to) || getString(item.role) || getString(item.name) || getString(item.targetRole),
        targetUuid: getString(item.targetUuid) || getString(item.toUuid) || getString(item.roleUuid) || getString(item.targetRoleUuid),
        type: getString(item.type) || getString(item.relationshipType) || getString(item.relation),
        label: getString(item.label) || getString(item.literalValue) || getString(item.description),
        strength: getNumber(item.strength),
        directed: typeof item.directed === 'boolean' ? item.directed : typeof item.isDirectional === 'boolean' ? item.isDirectional : undefined,
        raw,
    };
}

function getRoleLookupTexts(role: RoleLike): string[] {
    const values = [role.name];
    if (Array.isArray(role.aliases)) {
        values.push(...role.aliases.filter(alias => typeof alias === 'string'));
    }
    return Array.from(new Set(values.filter(Boolean).map(String)));
}

function getRoleId(role: RoleLike): string {
    if (role.uuid) {
        return role.uuid;
    }
    return stableId(`${role.sourcePath || role.packagePath || 'role'}:${role.name}`);
}

function normalizeLookup(value: string): string {
    return value.trim().toLowerCase();
}

function normalizeStrength(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(1, value);
    }
    return 1;
}

function getString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stableId(value: string): string {
    return Buffer.from(value).toString('base64').replace(/[+/=]/g, '');
}

function colorForRoleType(type: unknown): string {
    const value = String(type || '');
    if (value.includes('主')) {
        return '#4f8cff';
    }
    if (value.includes('配')) {
        return '#31c48d';
    }
    if (value.includes('反') || value.includes('敌')) {
        return '#f05252';
    }
    return '#9ca3af';
}

function sanitizeRoleData(role: RoleLike): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(role)) {
        if (key === 'wordSegmentFilter') {
            continue;
        }
        const sanitized = sanitizeValue(value, 0);
        if (sanitized !== undefined) {
            data[key] = sanitized;
        }
    }
    return data;
}

function sanitizeValue(value: unknown, depth: number): unknown {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
        return undefined;
    }
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (depth > 2) {
        return '[Object]';
    }
    if (Array.isArray(value)) {
        return value.slice(0, 24).map(item => sanitizeValue(item, depth + 1)).filter(item => item !== undefined);
    }
    if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            const sanitized = sanitizeValue(nested, depth + 1);
            if (sanitized !== undefined) {
                out[key] = sanitized;
            }
        }
        return out;
    }
    return String(value);
}
