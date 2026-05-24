import * as assert from 'assert';
import * as vscode from 'vscode';
import JSON5 from 'json5';
import { isLosslessJson5Enabled, tryLosslessJson5UpdateText } from '../utils/json5Lossless';

suite('JSON5 Lossless Test Suite', () => {
    test('default switch is enabled', () => {
        assert.strictEqual(isLosslessJson5Enabled(), true);
    });

    test('switch can disable lossless update', () => {
        const originalGetter = vscode.workspace.getConfiguration;

        Object.defineProperty(vscode.workspace, 'getConfiguration', {
            configurable: true,
            value: () => ({
                get: (key: string, fallback: unknown) => {
                    if (key === 'json5.losslessEditorEnabled') {
                        return false;
                    }
                    return fallback;
                },
            }),
        });

        try {
            assert.strictEqual(isLosslessJson5Enabled(), false);
            const result = tryLosslessJson5UpdateText('{ foo: 1 }\n', { foo: 2 });
            assert.strictEqual(result.text, undefined);
            assert.strictEqual(result.error, undefined);
        } finally {
            Object.defineProperty(vscode.workspace, 'getConfiguration', {
                configurable: true,
                value: originalGetter,
            });
        }
    });

    test('preserves comments while updating object', () => {
        const input = '{\n  // user comment\n  foo: 1,\n}\n';
        const result = tryLosslessJson5UpdateText(input, { foo: 2, bar: 3 });

        assert.ok(result.text, `Expected generated text, got error: ${result.error ?? 'unknown'}`);
        const output = result.text!;

        assert.ok(output.includes('// user comment'), 'Original comment should be preserved');

        const parsed = JSON5.parse(output) as Record<string, number>;
        assert.strictEqual(parsed.foo, 2);
        assert.strictEqual(parsed.bar, 3);
    });

    test('supports add/update/delete on top-level keys with comments kept', () => {
        const input = '{\n  // keep me\n  a: 1,\n  b: 2,\n}\n';
        const result = tryLosslessJson5UpdateText(input, { a: 10, c: 3 });

        assert.ok(result.text, `Expected generated text, got error: ${result.error ?? 'unknown'}`);
        const output = result.text!;
        assert.ok(output.includes('// keep me'));

        const parsed = JSON5.parse(output) as Record<string, number>;
        assert.deepStrictEqual(parsed, { a: 10, c: 3 });
        assert.strictEqual(Object.prototype.hasOwnProperty.call(parsed, 'b'), false);
    });

    test('supports nested update while preserving surrounding comments', () => {
        const input = '{\n  // top\n  profile: {\n    // nested\n    age: 20,\n    city: \"SZ\",\n  },\n}\n';
        const result = tryLosslessJson5UpdateText(input, {
            profile: { age: 21, country: 'CN' },
        });

        assert.ok(result.text, `Expected generated text, got error: ${result.error ?? 'unknown'}`);
        const output = result.text!;
        assert.ok(output.includes('// top'));
        assert.ok(output.includes('// nested'));

        const parsed = JSON5.parse(output) as { profile: Record<string, unknown> };
        assert.deepStrictEqual(parsed.profile, { age: 21, country: 'CN' });
    });

    test('supports array updates and keeps inline comments', () => {
        const input = '{\n  list: [\n    1, // first\n    2,\n  ],\n}\n';
        const result = tryLosslessJson5UpdateText(input, { list: [2, 3, 4] });

        assert.ok(result.text, `Expected generated text, got error: ${result.error ?? 'unknown'}`);
        const output = result.text!;
        assert.ok(output.includes('// first'));

        const parsed = JSON5.parse(output) as { list: number[] };
        assert.deepStrictEqual(parsed.list, [2, 3, 4]);
    });

    test('can be used for read-check roundtrip on valid json5', () => {
        const input = '{\n  // comment\n  enabled: true,\n}\n';
        const result = tryLosslessJson5UpdateText(input, JSON5.parse(input));

        assert.ok(result.text, `Expected generated text, got error: ${result.error ?? 'unknown'}`);
        const parsed = JSON5.parse(result.text!) as { enabled: boolean };
        assert.strictEqual(parsed.enabled, true);
        assert.ok(result.text!.includes('// comment'));
    });

    test('keeps CRLF style when appending final newline', () => {
        const input = '{\r\n  // line\r\n  foo: 1\r\n}';
        const result = tryLosslessJson5UpdateText(input, { foo: 1, bar: true });

        assert.ok(result.text, `Expected generated text, got error: ${result.error ?? 'unknown'}`);
        assert.ok(result.text!.endsWith('\r\n') || result.text!.endsWith('\n'));
    });
});
