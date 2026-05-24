import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import JSON5 from 'json5';
import { ensureRoleUUIDs } from '../utils/roleUuidManager';
import { tryLosslessJson5UpdateText } from '../utils/json5Lossless';
import {
    generateRegexPatternsTemplate,
    generateSensitiveWordsJson5,
    generateVocabularyJson5,
} from '../templates/templateGenerators';

type JsonRole = {
    name: string;
    type: string;
    description?: string;
    uuid?: string;
    [key: string]: unknown;
};

function withTempJson5File(prefix: string, initialText: string, cb: (filePath: string) => Promise<void> | void): Promise<void> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const filePath = path.join(dir, 'template.json5');
    fs.writeFileSync(filePath, initialText, 'utf8');

    const done = Promise.resolve(cb(filePath));

    return done.finally(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });
}

suite('JSON5 Lossless Template Variants Test Suite', () => {
    test('sensitive template keeps comments through uuid autofix and CRUD-like update', async () => {
        await withTempJson5File('anh-sensitive-lossless-', generateSensitiveWordsJson5(), async (filePath) => {
            const initialText = fs.readFileSync(filePath, 'utf8');
            const parsed = JSON5.parse(initialText) as JsonRole[];

            const rolesForUuidFix = parsed.map(role => ({
                ...role,
                uuid: undefined,
                sourcePath: filePath,
                packagePath: 'pkg',
            }));

            await ensureRoleUUIDs(rolesForUuidFix as any[], true);

            const afterUuid = fs.readFileSync(filePath, 'utf8');
            assert.ok(afterUuid.includes('// === 示例敏感词（可删除或新增）==='));

            const source = JSON5.parse(afterUuid) as JsonRole[];
            const next = source
                .map(role => role.name === '禁用词'
                    ? { ...role, description: '编辑器更新后的敏感词描述', severity: 'critical' }
                    : role,
                )
                .filter(role => role.name !== '剧透点');

            next.push({
                name: '违禁标记',
                type: '敏感词',
                description: '编辑器新增敏感词',
            });

            const updated = tryLosslessJson5UpdateText(afterUuid, next, vscode.Uri.file(filePath));
            assert.ok(updated.text, `Expected generated text, got error: ${updated.error ?? 'unknown'}`);
            fs.writeFileSync(filePath, updated.text!, 'utf8');

            const finalText = fs.readFileSync(filePath, 'utf8');
            assert.ok(finalText.includes('// === 示例敏感词（可删除或新增）==='));

            const finalData = JSON5.parse(finalText) as JsonRole[];
            assert.ok(finalData.some(role => role.name === '违禁标记'));
            assert.ok(finalData.some(role => role.name === '禁用词' && role.severity === 'critical'));
            assert.ok(!finalData.some(role => role.name === '剧透点'));
        });
    });

    test('vocabulary template keeps comments after multiple editor updates', async () => {
        await withTempJson5File('anh-vocab-lossless-', generateVocabularyJson5(), async (filePath) => {
            const text = fs.readFileSync(filePath, 'utf8');
            assert.ok(text.includes('// === 示例专业词汇 ==='));

            const step1Data = JSON5.parse(text) as JsonRole[];
            const step1Next = [...step1Data, {
                name: '语义锚点',
                type: '词汇',
                description: '编辑器新增词汇',
            }];

            const step1 = tryLosslessJson5UpdateText(text, step1Next, vscode.Uri.file(filePath));
            assert.ok(step1.text, `step1 failed: ${step1.error ?? 'unknown'}`);

            const step2Data = JSON5.parse(step1.text!) as JsonRole[];
            const step2Next = step2Data
                .map(role => role.name === '灵能'
                    ? { ...role, description: '编辑器改写后的世界观描述' }
                    : role,
                )
                .filter(role => role.name !== '聚能阵列');

            const step2 = tryLosslessJson5UpdateText(step1.text!, step2Next, vscode.Uri.file(filePath));
            assert.ok(step2.text, `step2 failed: ${step2.error ?? 'unknown'}`);
            fs.writeFileSync(filePath, step2.text!, 'utf8');

            const finalText = fs.readFileSync(filePath, 'utf8');
            assert.ok(finalText.includes('// === 示例专业词汇 ==='));

            const finalData = JSON5.parse(finalText) as JsonRole[];
            assert.ok(finalData.some(role => role.name === '语义锚点'));
            assert.ok(finalData.some(role => role.name === '灵能' && role.description === '编辑器改写后的世界观描述'));
            assert.ok(!finalData.some(role => role.name === '聚能阵列'));
        });
    });

    test('regex template keeps comments and regex fields after editor-like changes', async () => {
        await withTempJson5File('anh-regex-lossless-', generateRegexPatternsTemplate(), async (filePath) => {
            const text = fs.readFileSync(filePath, 'utf8');
            assert.ok(text.includes('// === 正则表达式角色示例（JSON5 合法）==='));

            const source = JSON5.parse(text) as JsonRole[];
            const next = source
                .map(role => {
                    if (role.name === '中文对话') {
                        return {
                            ...role,
                            regex: '“[^”]{1,120}”',
                            priority: 120,
                        };
                    }

                    return role;
                })
                .filter(role => role.name !== '书名号');

            next.push({
                name: '英文对话',
                type: '正则表达式',
                regex: '"[^"]*"',
                regexFlags: 'g',
                description: '编辑器新增正则角色',
            });

            const updated = tryLosslessJson5UpdateText(text, next, vscode.Uri.file(filePath));
            assert.ok(updated.text, `Expected generated text, got error: ${updated.error ?? 'unknown'}`);
            fs.writeFileSync(filePath, updated.text!, 'utf8');

            const finalText = fs.readFileSync(filePath, 'utf8');
            assert.ok(finalText.includes('// === 正则表达式角色示例（JSON5 合法）==='));

            const finalData = JSON5.parse(finalText) as JsonRole[];
            assert.ok(finalData.some(role => role.name === '英文对话'));
            assert.ok(finalData.some(role => role.name === '中文对话' && role.priority === 120));
            assert.ok(!finalData.some(role => role.name === '书名号'));
        });
    });
});
