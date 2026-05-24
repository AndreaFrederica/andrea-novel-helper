import { Role } from '../extension';

export type JsonRoleContainerKey = 'roles' | 'characters';

export const JSON_ROLE_CHILD_KEYS = [
	'children',
	'childRoles',
	'subRoles',
	'subroles',
	'nestedRoles',
	'roles',
	'characters',
	'子角色',
	'子角色列表',
	'下级角色',
	'下属角色',
] as const;

const PARENT_NAME_KEYS = [
	'containerRole',
	'container',
	'ownerRole',
	'belongsTo',
	'parentRole',
	'parent',
	'parentName',
	'parent_role',
	'容器角色',
	'所属角色',
	'归属角色',
	'父角色',
	'亲代角色',
	'上级角色',
] as const;

const PARENT_UUID_KEYS = [
	'containerRoleUuid',
	'containerUuid',
	'ownerRoleUuid',
	'parentRoleUuid',
	'parentRoleUUID',
	'parentUuid',
	'parentUUID',
	'parent_role_uuid',
	'容器角色UUID',
	'所属角色UUID',
	'归属角色UUID',
	'父角色UUID',
	'亲代角色UUID',
] as const;

const PARENT_RELATION_KEYS = [
	'containerRelation',
	'containmentRelation',
	'belongsToRelation',
	'parentRelation',
	'parentRelationship',
	'parentChildRelation',
	'relationshipToParent',
	'parent_relation',
	'归属关系',
	'包含关系',
	'父子关系',
	'亲代关系',
	'从属关系',
] as const;

export interface RoleHierarchyParentRef {
	name?: string;
	uuid?: string;
	relation?: string;
}

export function pickRoleHierarchyParentName(role: Partial<Role>): string | undefined {
	return pickStringKey(role, PARENT_NAME_KEYS);
}

export function pickRoleHierarchyParentUuid(role: Partial<Role>): string | undefined {
	return pickStringKey(role, PARENT_UUID_KEYS);
}

export function pickRoleHierarchyRelation(role: Partial<Role>): string | undefined {
	return pickStringKey(role, PARENT_RELATION_KEYS);
}

export function hasRoleHierarchyParent(role: Partial<Role>): boolean {
	return !!(pickRoleHierarchyParentName(role) || pickRoleHierarchyParentUuid(role));
}

export function flattenJsonRoleTree(inputRoles: unknown[], defaultType: string): Role[] {
	const flattened: Role[] = [];
	for (const item of inputRoles) {
		appendJsonRoleNode(flattened, item, defaultType);
	}
	return flattened;
}

function appendJsonRoleNode(
	output: Role[],
	value: unknown,
	defaultType: string,
	nameFromKey?: string,
	parent?: RoleHierarchyParentRef,
): void {
	if (typeof value === 'string') {
		const role = applyParentRef({ name: value, type: defaultType }, parent);
		output.push(role as Role);
		return;
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return;
	}

	const raw = value as Record<string, unknown>;
	const childEntries = collectChildRoleEntries(raw);
	const role: Record<string, unknown> = {};
	for (const [key, fieldValue] of Object.entries(raw)) {
		if (!JSON_ROLE_CHILD_KEYS.includes(key as any)) {
			role[key] = fieldValue;
		}
	}
	role.__jsonRoleHadExplicitType = isNonEmptyString(role.type);
	if (!isNonEmptyString(role.name) && nameFromKey) {
		role.name = nameFromKey;
	}
	if (!isNonEmptyString(role.type)) {
		role.type = defaultType;
	}

	const roleWithParent = applyParentRef(role as Partial<Role>, parent) as Role;
	if (isNonEmptyString(roleWithParent.name)) {
		output.push(roleWithParent);
	}

	const childParent: RoleHierarchyParentRef = {
		name: roleWithParent.name,
		uuid: typeof roleWithParent.uuid === 'string' ? roleWithParent.uuid : undefined,
		relation: pickRoleHierarchyRelation(roleWithParent),
	};
	for (const child of childEntries) {
		appendJsonRoleNode(output, child.value, defaultType, child.name, childParent);
	}
}

function collectChildRoleEntries(raw: Record<string, unknown>): Array<{ name?: string; value: unknown }> {
	const result: Array<{ name?: string; value: unknown }> = [];
	for (const key of JSON_ROLE_CHILD_KEYS) {
		const value = raw[key];
		if (Array.isArray(value)) {
			for (const child of value) {
				result.push({ value: child });
			}
		} else if (value && typeof value === 'object') {
			for (const [childName, childValue] of Object.entries(value as Record<string, unknown>)) {
				result.push({ name: childName, value: childValue });
			}
		}
	}
	return result;
}

function applyParentRef(role: Partial<Role>, parent: RoleHierarchyParentRef | undefined): Partial<Role> {
	if (!parent) {
		return role;
	}
	if (!pickRoleHierarchyParentName(role) && parent.name) {
		(role as any).containerRole = parent.name;
		(role as any).parentRole = parent.name;
	}
	if (!pickRoleHierarchyParentUuid(role) && parent.uuid) {
		(role as any).containerRoleUuid = parent.uuid;
		(role as any).parentRoleUuid = parent.uuid;
	}
	if (!pickRoleHierarchyRelation(role) && parent.relation) {
		(role as any).containerRelation = parent.relation;
		(role as any).parentRelation = parent.relation;
	}
	if (!role.affiliation && parent.name) {
		role.affiliation = parent.name;
	}
	return role;
}

function pickStringKey(role: Partial<Role>, keys: readonly string[]): string | undefined {
	for (const key of keys) {
		const value = (role as any)[key];
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}
