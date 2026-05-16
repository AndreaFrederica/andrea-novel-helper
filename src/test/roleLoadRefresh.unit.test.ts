import * as assert from 'assert';
import { SmartRoleAdder } from '../utils/roleMerger';
import { shouldIncrementalRoleLoad } from '../utils/roleLoadMode';
import { Role } from '../extension';

function role(name: string, uuid: string, sourcePath: string, extra: Partial<Role> = {}): Role {
    return {
        name,
        uuid,
        type: '角色',
        sourcePath,
        packagePath: 'pkg',
        ...extra,
    };
}

function addAll(manager: SmartRoleAdder, roleItems: Role[]): void {
    for (const item of roleItems) {
        manager.addRole({ ...item });
    }
}

function names(roleItems: Role[]): string[] {
    return roleItems.map(item => item.name).sort();
}

suite('Role Load Refresh Unit Tests', () => {
    test('load mode uses incremental only for non-forced changed files', () => {
        assert.strictEqual(shouldIncrementalRoleLoad(false, ['a.json5']), true);
        assert.strictEqual(shouldIncrementalRoleLoad(false, []), false);
        assert.strictEqual(shouldIncrementalRoleLoad(false, undefined), false);
        assert.strictEqual(shouldIncrementalRoleLoad(true, ['a.json5']), false);
    });

    test('reusing SmartRoleAdder after full clear documents stale-map failure mode', () => {
        const loadedRoles = [
            role('Alice', 'uuid-a', 'roles.json5'),
            role('Bob', 'uuid-b', 'vocabulary.json5'),
        ];
        const manager = new SmartRoleAdder(loadedRoles);

        loadedRoles.length = 0;
        addAll(manager, [
            role('Alice', 'uuid-a', 'roles.json5'),
            role('Bob', 'uuid-b', 'vocabulary.json5'),
            role('Carol', 'uuid-c', 'sensitive.json5'),
        ]);

        assert.deepStrictEqual(
            names(loadedRoles),
            ['Carol'],
            'This documents the stale-map failure mode that full scans must avoid.'
        );
    });

    test('rebuilding SmartRoleAdder after full clear restores all UUID roles', () => {
        const loadedRoles = [
            role('Alice', 'uuid-a', 'roles.json5'),
            role('Bob', 'uuid-b', 'vocabulary.json5'),
        ];

        loadedRoles.length = 0;
        const manager = new SmartRoleAdder(loadedRoles);
        addAll(manager, [
            role('Alice', 'uuid-a', 'roles.json5'),
            role('Bob', 'uuid-b', 'vocabulary.json5'),
            role('Carol', 'uuid-c', 'sensitive.json5'),
        ]);

        assert.deepStrictEqual(names(loadedRoles), ['Alice', 'Bob', 'Carol']);
    });

    test('incremental reload only replaces roles from touched file', () => {
        const loadedRoles = [
            role('Alice', 'uuid-a', 'roles.json5'),
            role('Bob', 'uuid-b', 'vocabulary.json5'),
            role('OldTerm', 'uuid-old-term', 'vocabulary.json5'),
            role('Carol', 'uuid-c', 'sensitive.json5'),
        ];
        const manager = new SmartRoleAdder(loadedRoles);

        manager.removeRolesByFile('vocabulary.json5');
        addAll(manager, [
            role('Bob', 'uuid-b', 'vocabulary.json5', { description: 'updated' }),
            role('NewTerm', 'uuid-new-term', 'vocabulary.json5'),
        ]);

        assert.deepStrictEqual(names(loadedRoles), ['Alice', 'Bob', 'Carol', 'NewTerm']);
        assert.strictEqual(
            loadedRoles.find(item => item.name === 'Bob')?.description,
            'updated'
        );
        assert.ok(!loadedRoles.some(item => item.name === 'OldTerm'));
    });
});
