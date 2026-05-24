import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addRoleToFile, readRoleFile } from '../utils/roleFileHandler';

type RoleLike = {
    name: string;
    type: string;
    description?: string;
    sourcePath?: string;
    packagePath?: string;
    uuid?: string;
};

suite('RoleFileHandler Lossless Test Suite', () => {
    test('add/update/read keeps JSON5 comments for role file', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anh-role-lossless-'));
        const filePath = path.join(tmpDir, 'roles.ojson5');

        const initial = [
            '[',
            '  // existing role comment',
            "  { name: 'Alice', type: '角色' }, // inline role comment",
            ']',
            '',
        ].join('\n');

        fs.writeFileSync(filePath, initial, 'utf8');

        const addOk = addRoleToFile(filePath, {
            name: 'Bob',
            type: '角色',
            description: 'new role',
        } as RoleLike as any);
        assert.strictEqual(addOk, true);

        const updateOk = addRoleToFile(filePath, {
            name: 'Alice',
            type: '角色',
            description: 'updated',
        } as RoleLike as any);
        assert.strictEqual(updateOk, true);

        const after = fs.readFileSync(filePath, 'utf8');
        assert.ok(after.includes('// existing role comment'));
        assert.ok(after.includes('// inline role comment'));

        const data = readRoleFile(filePath);
        const names = data.roles.map(role => role.name).sort();
        assert.deepStrictEqual(names, ['Alice', 'Bob']);

        const alice = data.roles.find(role => role.name === 'Alice');
        assert.strictEqual(alice?.description, 'updated');

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
});
