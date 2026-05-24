import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureRoleUUIDs } from '../utils/roleUuidManager';

type RoleLike = {
    name: string;
    type: string;
    sourcePath?: string;
    packagePath?: string;
    uuid?: string;
};

suite('RoleUuidManager Lossless Test Suite', () => {
    test('uuid autofix keeps JSON5 comments', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anh-uuid-lossless-'));
        const filePath = path.join(tmpDir, 'roles.ojson5');

        const initial = [
            '[',
            '  // uuid comment should remain',
            "  { name: 'Alice', type: '角色' },",
            ']',
            '',
        ].join('\n');

        fs.writeFileSync(filePath, initial, 'utf8');

        const role: RoleLike = {
            name: 'Alice',
            type: '角色',
            sourcePath: filePath,
            packagePath: 'pkg',
        };

        await ensureRoleUUIDs([role as any], true);

        const after = fs.readFileSync(filePath, 'utf8');
        assert.ok(after.includes('// uuid comment should remain'));

        // Use dynamic import to avoid bringing JSON5 into product code path solely for this test file.
        const JSON5 = require('json5') as { parse: (text: string) => unknown };
        const parsed = JSON5.parse(after) as Array<Record<string, unknown>>;
        assert.ok(typeof parsed[0]?.uuid === 'string');

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
});
