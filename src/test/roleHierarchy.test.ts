import * as assert from 'assert';
import { flattenJsonRoleTree, pickRoleHierarchyParentName, pickRoleHierarchyRelation } from '../utils/roleHierarchy';

suite('Role Hierarchy Test Suite', () => {
    test('flattens nested json roles and assigns parent metadata', () => {
        const roles = flattenJsonRoleTree([
            {
                name: '核心主角',
                type: '分组',
                uuid: 'parent-uuid',
                parentRelation: '包含',
                children: [
                    { name: '李修缘', type: '主角' },
                    { name: '陈汐梅', type: '主角', parentRelation: '队友' }
                ]
            }
        ], '角色');

        assert.deepStrictEqual(roles.map(role => role.name), ['核心主角', '李修缘', '陈汐梅']);
        assert.strictEqual(pickRoleHierarchyParentName(roles[1]), '核心主角');
        assert.strictEqual((roles[1] as any).parentRoleUuid, 'parent-uuid');
        assert.strictEqual(pickRoleHierarchyRelation(roles[1]), '包含');
        assert.strictEqual(roles[1].affiliation, '核心主角');
        assert.strictEqual(pickRoleHierarchyRelation(roles[2]), '队友');
    });

    test('flattens object-style child roles', () => {
        const roles = flattenJsonRoleTree([
            {
                name: '神兽',
                type: '分组',
                子角色: {
                    凤凰: { type: '神兽' },
                    青龙: { type: '神兽' }
                }
            }
        ], '角色');

        assert.deepStrictEqual(roles.map(role => role.name), ['神兽', '凤凰', '青龙']);
        assert.strictEqual(pickRoleHierarchyParentName(roles[1]), '神兽');
        assert.strictEqual(pickRoleHierarchyParentName(roles[2]), '神兽');
    });
});
