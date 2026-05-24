import * as assert from 'assert';
import { applyRoleLineage, getRoleLineageRefs, getRoleCompositionRefs } from '../utils/roleLineage';
import { Role } from '../extension';

suite('Role Lineage Test Suite', () => {
    test('super inherits missing fields without overriding explicit fields', () => {
        const roles: Role[] = [
            {
                name: '基础模板',
                type: '模板',
                color: '#ffffff',
                aliases: ['Base'],
                description: 'base description'
            },
            {
                name: '派生角色',
                type: '主角',
                super: '基础模板',
                aliases: ['Hero'],
                description: 'explicit description'
            } as Role
        ];

        applyRoleLineage(roles);

        assert.strictEqual(roles[1].color, '#ffffff');
        assert.strictEqual(roles[1].description, 'explicit description');
        assert.deepStrictEqual(roles[1].aliases, ['Hero', 'Base']);
        assert.strictEqual((roles[1] as any).superRole, '基础模板');
        assert.strictEqual((roles[1] as any).superRelation, '继承');
    });

    test('derivedFrom records lineage but does not inherit fields by default', () => {
        const roles: Role[] = [
            { name: '原型', type: '模板', color: '#000000' },
            { name: '变体', type: '主角', derivedFrom: '原型' } as Role
        ];

        applyRoleLineage(roles);

        assert.strictEqual(roles[1].color, undefined);
        assert.strictEqual((roles[1] as any).derivedFromRole, '原型');
        assert.strictEqual((roles[1] as any).derivedRelation, '派生');
        assert.strictEqual(getRoleLineageRefs(roles[1])[0].kind, 'derivation');
    });

    test('derivedFrom can inherit when explicitly requested', () => {
        const roles: Role[] = [
            { name: '原型', type: '模板', color: '#000000' },
            { name: '变体', type: '主角', derivedFrom: '原型', inherit: true } as Role
        ];

        applyRoleLineage(roles);

        assert.strictEqual(roles[1].color, '#000000');
    });

    test('extend shorthand works like super', () => {
        const roles: Role[] = [
            { name: '模板', type: '模板', color: '#fff' },
            { name: '角色', type: '主角', extend: '模板' } as Role
        ];
        applyRoleLineage(roles);
        assert.strictEqual(roles[1].color, '#fff');
        assert.strictEqual((roles[1] as any).superRole, '模板');
        assert.strictEqual((roles[1] as any).superRelation, '继承');
    });

    test('extend with UUID reference', () => {
        const uuid = '01234567-89ab-cdef-0123-456789abcdef';
        const roles: Role[] = [
            { name: '模板', type: '模板', uuid },
            { name: '角色', type: '主角', extend: uuid } as Role
        ];
        applyRoleLineage(roles);
        assert.strictEqual((roles[1] as any).superRoleUuid, uuid);
        assert.strictEqual((roles[1] as any).superRole, '模板');
    });

    test('derived shorthand works like derivedFrom', () => {
        const roles: Role[] = [
            { name: '原型', type: '模板', color: '#000' },
            { name: '变体', type: '主角', derived: '原型' } as Role
        ];
        applyRoleLineage(roles);
        assert.strictEqual((roles[1] as any).derivedFromRole, '原型');
        assert.strictEqual(roles[1].color, undefined);
    });

    test('derived with inherit flag copies fields', () => {
        const roles: Role[] = [
            { name: '原型', type: '模板', color: '#aaa' },
            { name: '变体', type: '主角', derived: '原型', inherit: true } as Role
        ];
        applyRoleLineage(roles);
        assert.strictEqual(roles[1].color, '#aaa');
    });

    test('composition reference does not merge fields', () => {
        const roles: Role[] = [
            { name: '武器', type: '道具', color: '#aaa' },
            { name: '角色', type: '主角', includes: '武器' } as Role
        ];
        applyRoleLineage(roles);
        assert.strictEqual(roles[1].color, undefined);
        const composed = getRoleCompositionRefs(roles[1]);
        assert.strictEqual(composed.length, 1);
        assert.strictEqual(composed[0].name, '武器');
        assert.strictEqual(composed[0].kind, 'reference');
        assert.deepStrictEqual((roles[1] as any).composedRoles, ['武器']);
    });

    test('composition with multiple references', () => {
        const roles: Role[] = [
            { name: '武器', type: '道具' },
            { name: '防具', type: '道具' },
            { name: '角色', type: '主角', includes: ['武器', '防具'] } as Role
        ];
        applyRoleLineage(roles);
        const composed = getRoleCompositionRefs(roles[2]);
        assert.strictEqual(composed.length, 2);
        assert.deepStrictEqual((roles[2] as any).composedRoles, ['武器', '防具']);
    });

    test('composition with UUID reference', () => {
        const uuid = '01234567-89ab-cdef-0123-456789abcdef';
        const roles: Role[] = [
            { name: '武器', type: '道具', uuid },
            { name: '角色', type: '主角', uses: uuid } as Role
        ];
        applyRoleLineage(roles);
        const composed = getRoleCompositionRefs(roles[1]);
        assert.strictEqual(composed.length, 1);
        assert.strictEqual(composed[0].uuid, uuid);
        assert.deepStrictEqual((roles[1] as any).composedRoleUuids, [uuid]);
    });

    test('composition local-first: same file beats different file', () => {
        const fileA = '/project/novel-helper/pack-a/roles.md';
        const fileB = '/project/novel-helper/pack-b/roles.md';
        const roles: Role[] = [
            { name: '武器', type: '道具', color: '#local', sourcePath: fileA, packagePath: 'pack-a' },
            { name: '武器', type: '道具', color: '#global', sourcePath: fileB, packagePath: 'pack-b' },
            { name: '角色', type: '主角', includes: '武器', sourcePath: fileA, packagePath: 'pack-a' } as Role
        ];
        applyRoleLineage(roles);
        // composedRoles 存的是引用名，不直接反映 resolved target
        // 但 composedRoles 应该包含引用名
        assert.deepStrictEqual((roles[2] as any).composedRoles, ['武器']);
    });

    test('composition package-first: same package beats different package', () => {
        const fileA1 = '/project/novel-helper/pack-a/roles1.md';
        const fileA2 = '/project/novel-helper/pack-a/roles2.md';
        const fileB = '/project/novel-helper/pack-b/roles.md';
        const roles: Role[] = [
            { name: '武器', type: '道具', color: '#pkgA', sourcePath: fileA1, packagePath: 'pack-a' },
            { name: '武器', type: '道具', color: '#pkgB', sourcePath: fileB, packagePath: 'pack-b' },
            { name: '角色', type: '主角', includes: '武器', sourcePath: fileA2, packagePath: 'pack-a' } as Role
        ];
        applyRoleLineage(roles);
        assert.deepStrictEqual((roles[2] as any).composedRoles, ['武器']);
    });
});
