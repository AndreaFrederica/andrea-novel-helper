import { Role } from '../extension';

const SUPER_KEYS = [
	'super',
	'Super',
	'extends',
	'Extends',
	'extend',
	'baseRole',
	'base',
	'prototype',
	'superRole',
	'基类',
	'基础角色',
	'继承自',
	'集成自',
	'集成',
] as const;

const DERIVED_FROM_KEYS = [
	'derivedFrom',
	'derivedFromRole',
	'derived',
	'variantOf',
	'originRole',
	'sourceRole',
	'prototypeRole',
	'派生自',
	'变体自',
	'原型角色',
	'来源角色',
] as const;

const RELATION_KEYS = [
	'relation',
	'relationship',
	'type',
	'关系',
	'关系类型',
] as const;

const COMPOSITION_KEYS = [
	'includes',
	'composedOf',
	'uses',
	'parts',
	'包含角色',
	'组合角色',
	'引用角色',
	'使用角色',
	'部件',
] as const;

export type CompositionRef = {
	kind: 'reference' | 'nested';
	name?: string;
	uuid?: string;
	relation?: string;
};

const ROLE_IDENTITY_KEYS = new Set([
	'name',
	'uuid',
	'type',
	'packagePath',
	'sourcePath',
	'_computedPriority',
	'_priorityBreakdown',
	'__jsonRoleHadExplicitType',
]);

const LINEAGE_KEYS = new Set<string>([
	...SUPER_KEYS,
	...DERIVED_FROM_KEYS,
	...COMPOSITION_KEYS,
	'superRole',
	'superRoleUuid',
	'superRelation',
	'derivedFromRole',
	'derivedFromRoleUuid',
	'derivedRelation',
	'composedRoles',
	'composedRoleUuids',
	'inherit',
	'copyFromSuper',
	'copyFromSource',
	'继承',
	'继承字段',
]);

export type RoleLineageKind = 'inheritance' | 'derivation';

export interface RoleLineageRef {
	kind: RoleLineageKind;
	name?: string;
	uuid?: string;
	relation?: string;
	inherit?: boolean;
}

export function pickRoleSuperRef(role: Partial<Role>): RoleLineageRef | undefined {
	const ref = pickRoleRef(role, SUPER_KEYS, 'inheritance');
	if (!ref) {
		return undefined;
	}
	ref.relation = ref.relation || '继承';
	ref.inherit = true;
	return ref;
}

export function pickRoleDerivedFromRef(role: Partial<Role>): RoleLineageRef | undefined {
	const ref = pickRoleRef(role, DERIVED_FROM_KEYS, 'derivation');
	if (!ref) {
		return undefined;
	}
	ref.relation = ref.relation || '派生';
	ref.inherit = ref.inherit ?? shouldDerivedRefInherit(role);
	return ref;
}

export function applyRoleLineage(roles: Role[]): void {
	const index = buildRoleIndex(roles);
	for (let pass = 0; pass < 8; pass++) {
		let changed = false;
		for (const role of roles) {
			const superRef = pickRoleSuperRef(role);
			if (superRef) {
				const baseRole = resolveRoleRef(superRef, index);
				normalizeLineageFields(role, superRef, baseRole);
				if (baseRole && mergeMissingFields(role, baseRole)) {
					changed = true;
				}
			}

			const derivedRef = pickRoleDerivedFromRef(role);
			if (derivedRef) {
				const sourceRole = resolveRoleRef(derivedRef, index);
				normalizeLineageFields(role, derivedRef, sourceRole);
				if (derivedRef.inherit && sourceRole && mergeMissingFields(role, sourceRole)) {
					changed = true;
				}
			}
		}
		if (!changed) {
			break;
		}
	}

	applyComposition(roles);
}

export function getRoleLineageRefs(role: Role): RoleLineageRef[] {
	const refs: RoleLineageRef[] = [];
	const superRef = pickRoleSuperRef(role);
	if (superRef) {
		refs.push(superRef);
	}
	const derivedRef = pickRoleDerivedFromRef(role);
	if (derivedRef) {
		refs.push(derivedRef);
	}
	return refs;
}

export function pickRoleCompositionRefs(role: Partial<Role>): CompositionRef[] {
	const refs: CompositionRef[] = [];
	for (const key of COMPOSITION_KEYS) {
		const value = (role as any)[key];
		if (!value) { continue; }
		if (Array.isArray(value)) {
			for (const item of value) {
				const ref = parseRoleRef(item, 'composition');
				if (ref) { refs.push(ref as CompositionRef); }
			}
		} else {
			const ref = parseRoleRef(value, 'composition');
			if (ref) { refs.push(ref as CompositionRef); }
		}
	}
	return refs;
}

export function getRoleCompositionRefs(role: Role): CompositionRef[] {
	return pickRoleCompositionRefs(role);
}

export function applyComposition(roles: Role[]): void {
	const globalIndex = buildRoleIndex(roles);

	for (const role of roles) {
		const refs = pickRoleCompositionRefs(role);
		if (refs.length === 0) { continue; }

		const sourceFile = role.sourcePath || '';
		const localIndex = buildFilteredIndex(roles, r => (r.sourcePath || '') === sourceFile);
		const pkg = role.packagePath || '';
		const packageIndex = buildFilteredIndex(roles, r => (r.packagePath || '') === pkg);

		const composedNames: string[] = [];
		const composedUuids: string[] = [];
		for (const ref of refs) {
			const target = resolveRoleRefLayered(ref as any, localIndex, packageIndex, globalIndex);
			if (ref.name) { composedNames.push(ref.name); }
			if (ref.uuid) { composedUuids.push(ref.uuid); }

			if (ref.kind === 'nested' && target) {
				applyComposition([target]);
			}
		}

		if (composedNames.length > 0) {
			(role as any).composedRoles = composedNames;
		}
		if (composedUuids.length > 0) {
			(role as any).composedRoleUuids = composedUuids;
		}
	}
}

function normalizeLineageFields(role: Role, ref: RoleLineageRef, resolvedRole: Role | undefined): void {
	const resolvedName = resolvedRole?.name || ref.name;
	const resolvedUuid = resolvedRole?.uuid || ref.uuid;
	if (ref.kind === 'inheritance') {
		if (resolvedName) {
			(role as any).superRole = resolvedName;
		}
		if (resolvedUuid) {
			(role as any).superRoleUuid = resolvedUuid;
		}
		(role as any).superRelation = ref.relation || '继承';
	} else {
		if (resolvedName) {
			(role as any).derivedFromRole = resolvedName;
		}
		if (resolvedUuid) {
			(role as any).derivedFromRoleUuid = resolvedUuid;
		}
		(role as any).derivedRelation = ref.relation || '派生';
	}
}

function mergeMissingFields(target: Role, source: Role): boolean {
	let changed = false;
	for (const [key, value] of Object.entries(source)) {
		if (ROLE_IDENTITY_KEYS.has(key) || LINEAGE_KEYS.has(key) || key.startsWith('关系')) {
			continue;
		}
		if (value === undefined || value === null || value === '') {
			continue;
		}
		const current = (target as any)[key];
		if (current === undefined || current === null || current === '') {
			(target as any)[key] = cloneValue(value);
			changed = true;
		} else if (Array.isArray(current) && Array.isArray(value)) {
			const merged = mergeStringLikeArrays(current, value);
			if (merged.length !== current.length) {
				(target as any)[key] = merged;
				changed = true;
			}
		}
	}
	return changed;
}

function pickRoleRef(role: Partial<Role>, keys: readonly string[], kind: RoleLineageKind): RoleLineageRef | undefined {
	for (const key of keys) {
		if (!Object.prototype.hasOwnProperty.call(role, key)) {
			continue;
		}
		return parseRoleRef((role as any)[key], kind) as RoleLineageRef | undefined;
	}
	return undefined;
}

function parseRoleRef(value: unknown, kind: RoleLineageKind | 'composition'): RoleLineageRef | CompositionRef | undefined {
	if (typeof value === 'string' && value.trim()) {
		const trimmed = value.trim();
		const uuidMatch = trimmed.match(/\b(?:urn:uuid:)?\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?\b/i);
		if (uuidMatch) {
			const uuid = uuidMatch[0].replace(/^urn:uuid:/i, '').replace(/^\{|\}$/g, '');
			if (kind === 'composition') {
				return { kind: 'reference', uuid } as CompositionRef;
			}
			return { kind, uuid } as RoleLineageRef;
		}
		if (kind === 'composition') {
			return { kind: 'reference', name: trimmed } as CompositionRef;
		}
		return { kind, name: trimmed } as RoleLineageRef;
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (kind === 'composition') {
		const ref: CompositionRef = {
			kind: pickString(record.kind, record.type) === 'nested' ? 'nested' : 'reference',
			name: pickString(record.name, record.role, record.roleName, record.target, record.角色, record.名称),
			uuid: pickString(record.uuid, record.roleUuid, record.roleUUID, record.UUID),
			relation: pickString(...RELATION_KEYS.map(key => record[key])),
		};
		return ref.name || ref.uuid ? ref : undefined;
	}
	const ref: RoleLineageRef = {
		kind,
		name: pickString(record.name, record.role, record.roleName, record.target, record.角色, record.名称),
		uuid: pickString(record.uuid, record.roleUuid, record.roleUUID, record.UUID),
		relation: pickString(...RELATION_KEYS.map(key => record[key])),
		inherit: typeof record.inherit === 'boolean' ? record.inherit : undefined,
	};
	return ref.name || ref.uuid ? ref : undefined;
}

function shouldDerivedRefInherit(role: Partial<Role>): boolean {
	const value = (role as any).inherit ?? (role as any).copyFromSource ?? (role as any).继承字段;
	return value === true || value === 'true' || value === '是';
}

type RoleIndex = { byName: Map<string, Role>; byUuid: Map<string, Role> };

function buildRoleIndex(roles: Role[]): RoleIndex {
	const byName = new Map<string, Role>();
	const byUuid = new Map<string, Role>();
	for (const role of roles) {
		byName.set(role.name, role);
		if (role.uuid) {
			byUuid.set(role.uuid, role);
		}
	}
	return { byName, byUuid };
}

function buildFilteredIndex(roles: Role[], predicate: (role: Role) => boolean): RoleIndex {
	return buildRoleIndex(roles.filter(predicate));
}

function resolveRoleRefLayered(ref: RoleLineageRef, localIndex: RoleIndex, packageIndex: RoleIndex, globalIndex: RoleIndex): Role | undefined {
	// UUID 直接全局查
	if (ref.uuid) {
		return globalIndex.byUuid.get(ref.uuid);
	}
	if (ref.name) {
		return localIndex.byName.get(ref.name)
			?? packageIndex.byName.get(ref.name)
			?? globalIndex.byName.get(ref.name);
	}
	return undefined;
}

function resolveRoleRef(ref: RoleLineageRef, index: { byName: Map<string, Role>; byUuid: Map<string, Role> }): Role | undefined {
	if (ref.uuid) {
		const byUuid = index.byUuid.get(ref.uuid);
		if (byUuid) {
			return byUuid;
		}
	}
	return ref.name ? index.byName.get(ref.name) : undefined;
}

function cloneValue<T>(value: T): T {
	if (Array.isArray(value)) {
		return [...value] as T;
	}
	if (value && typeof value === 'object') {
		return { ...(value as Record<string, unknown>) } as T;
	}
	return value;
}

function mergeStringLikeArrays(current: unknown[], inherited: unknown[]): unknown[] {
	const seen = new Set(current.map(value => String(value).toLowerCase()));
	const result = [...current];
	for (const value of inherited) {
		const key = String(value).toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			result.push(value);
		}
	}
	return result;
}

function pickString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}
