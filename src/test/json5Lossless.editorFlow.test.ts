import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import JSON5 from 'json5';
import { ensureRoleUUIDs } from '../utils/roleUuidManager';
import { tryLosslessJson5UpdateText } from '../utils/json5Lossless';
import { generateCharacterGalleryJson5 } from '../templates/templateGenerators';

type JsonRole = {
    name: string;
    type: string;
    description?: string;
    uuid?: string;
    [key: string]: unknown;
};

type RoleSource = {
    roles: JsonRole[];
};

suite('JSON5 Lossless Editor Flow Test Suite', () => {
    test('uuid autofix then editor-like mutations keep comments', async () => {
        const sample = generateCharacterGalleryJson5();

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anh-editor-flow-'));
        const filePath = path.join(tmpDir, 'roles.ojson5');
        fs.writeFileSync(filePath, sample, 'utf8');

        // 1) UUID 补全阶段：模拟载入到内存后触发自动补 UUID 写回
        const parsedForUuid = JSON5.parse(sample) as JsonRole[];
        const rolesForUuidFix = parsedForUuid.map(role => ({
            ...role,
            uuid: undefined, // 强制触发补 UUID
            sourcePath: filePath,
            packagePath: 'pkg',
        }));

        await ensureRoleUUIDs(rolesForUuidFix as any[], true);

        const afterUuid = fs.readFileSync(filePath, 'utf8');
        assert.ok(afterUuid.includes('// === 示例角色（可删除）==='));

        // 2) 可视化编辑器阶段：模拟增删改字段与角色
        const source = JSON5.parse(afterUuid) as JsonRole[];
        const next: JsonRole[] = source
            .map(role => {
                if (role.name === '示例角色') {
                    return {
                        ...role,
                        description: '编辑器修改后的描述', // 修改
                        priority: 10, // 新增字段
                    };
                }

                return role;
            })
            .filter(role => role.name !== '示例角色'); // 删除模板角色，模拟编辑器删除

        next.push({
            name: '测试角色C',
            type: '路人',
            description: '编辑器新增角色',
        });

        const updated = tryLosslessJson5UpdateText(afterUuid, next, vscode.Uri.file(filePath));
        assert.ok(updated.text, `Expected generated text, got error: ${updated.error ?? 'unknown'}`);
        fs.writeFileSync(filePath, updated.text!, 'utf8');

        const finalText = fs.readFileSync(filePath, 'utf8');
        assert.ok(finalText.includes('// === 示例角色（可删除）==='), 'Template comment should be preserved after editor flow');

        const finalData = JSON5.parse(finalText) as JsonRole[];
        assert.strictEqual(finalData.length, 1);
        assert.ok(finalData.some(role => role.name === '测试角色C'));

        const roleC = finalData.find(role => role.name === '测试角色C');
        assert.strictEqual(roleC?.description, '编辑器新增角色');

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('multiple consecutive editor updates do not strip comments', () => {
        const input = [
            '{',
            '  // editor flow root comment',
            '  roles: [',
            '    { name: "A", type: "主角" },',
            '  ],',
            '}',
            '',
        ].join('\n');

        const step1 = tryLosslessJson5UpdateText(input, {
            roles: [
                { name: 'A', type: '主角', tags: ['x'] },
                { name: 'B', type: '配角' },
            ],
        });
        assert.ok(step1.text, `step1 failed: ${step1.error ?? 'unknown'}`);

        const step2 = tryLosslessJson5UpdateText(step1.text!, {
            roles: [
                { name: 'B', type: '配角', description: 'promoted' },
            ],
        });
        assert.ok(step2.text, `step2 failed: ${step2.error ?? 'unknown'}`);

        assert.ok(step2.text!.includes('// editor flow root comment'));

        const parsed = JSON5.parse(step2.text!) as RoleSource;
        assert.strictEqual(parsed.roles.length, 1);
        assert.strictEqual(parsed.roles[0].name, 'B');
        assert.strictEqual(parsed.roles[0].description, 'promoted');
    });
});
