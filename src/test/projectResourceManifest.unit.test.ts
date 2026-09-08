import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import JSON5 from 'json5';
import {
    clearProjectJson5ConfigCache,
    getProjectJson5Config,
    normalizeProjectResourceIncludes,
    updateProjectResourceIncludes,
} from '../projectConfig/projectJson5Config';
import { resolveProjectResourceIncludes } from '../utils/utils';

suite('Project Resource Manifest Unit Tests', () => {
    test('normalizes shorthand, preserves recursive false, and removes duplicates', () => {
        assert.deepStrictEqual(normalizeProjectResourceIncludes([
            'root-role.md',
            { path: 'library\\roles', kind: 'role', recursive: false },
            { path: 'library/roles', kind: 'role', recursive: false },
            { path: 'library/terms/**/*.md', kind: 'vocabulary' },
        ]), [
            { path: 'root-role.md', kind: 'auto' },
            { path: 'library/roles', kind: 'role', recursive: false },
            { path: 'library/terms/**/*.md', kind: 'vocabulary' },
        ]);
    });

    test('updates includes without discarding existing JSON5 comments', () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'anh-resource-manifest-'));
        const configPath = path.join(workspaceRoot, 'project-config.json5');
        try {
            fs.writeFileSync(configPath, [
                '{',
                '  // keep this project note',
                '  autoDiscovery: false,',
                '  includes: [],',
                '}',
                '',
            ].join('\n'), 'utf8');

            assert.strictEqual(updateProjectResourceIncludes(workspaceRoot, includes => [
                ...includes,
                { path: '角色.md', kind: 'role' },
            ]), true);

            const updatedText = fs.readFileSync(configPath, 'utf8');
            const parsed = JSON5.parse(updatedText) as { includes: unknown[] };
            assert.ok(updatedText.includes('// keep this project note'));
            assert.deepStrictEqual(parsed.includes, [{ path: '角色.md', kind: 'role' }]);
        } finally {
            fs.rmSync(workspaceRoot, { recursive: true, force: true });
        }
    });

    test('resolves root files, directories, globs, and excludes without admitting the root directory', () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'anh-resource-resolve-'));
        const write = (relativePath: string) => {
            const target = path.join(workspaceRoot, relativePath);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, '# test\n', 'utf8');
        };
        try {
            (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [
                { uri: { fsPath: workspaceRoot } },
            ];
            write('root-role.md');
            write('library/direct.md');
            write('library/nested/deep.md');
            write('library/draft/hidden.md');
            write('glossary/terms/a.md');
            fs.writeFileSync(path.join(workspaceRoot, 'project-config.json5'), JSON5.stringify({
                autoDiscovery: false,
                includes: [
                    { path: 'root-role.md', kind: 'role' },
                    { path: 'library', kind: 'role' },
                    { path: 'glossary/**/*.md', kind: 'vocabulary' },
                    { path: '.', kind: 'role' },
                    { path: '../outside.md', kind: 'role' },
                ],
                excludes: ['library/draft/**'],
            }, null, 2), 'utf8');

            const resolved = resolveProjectResourceIncludes(workspaceRoot);
            const relativeFiles = resolved.files
                .map(item => `${path.relative(workspaceRoot, item.filePath).replace(/\\/g, '/')}:${item.kind}`)
                .sort();

            assert.deepStrictEqual(relativeFiles, [
                'glossary/terms/a.md:vocabulary',
                'library/direct.md:role',
                'library/nested/deep.md:role',
                'root-role.md:role',
            ]);
            assert.deepStrictEqual(
                resolved.directories.map(item => path.relative(workspaceRoot, item.directoryPath).replace(/\\/g, '/')),
                ['library']
            );
        } finally {
            clearProjectJson5ConfigCache(workspaceRoot);
            (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = undefined;
            fs.rmSync(workspaceRoot, { recursive: true, force: true });
        }
    });

    test('keeps three discovery modes and maps legacy autoDiscovery values', () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'anh-resource-mode-'));
        const configPath = path.join(workspaceRoot, 'project-config.json5');
        try {
            (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [{ uri: { fsPath: workspaceRoot } }];
            fs.writeFileSync(configPath, "{ resourceDiscovery: 'marker' }\n", 'utf8');
            assert.strictEqual(getProjectJson5Config(workspaceRoot).resourceDiscovery, 'marker');
            clearProjectJson5ConfigCache(workspaceRoot);
            fs.writeFileSync(configPath, '{ autoDiscovery: true }\n', 'utf8');
            assert.strictEqual(getProjectJson5Config(workspaceRoot).resourceDiscovery, 'all');
            clearProjectJson5ConfigCache(workspaceRoot);
            fs.writeFileSync(configPath, '{ autoDiscovery: false }\n', 'utf8');
            assert.strictEqual(getProjectJson5Config(workspaceRoot).resourceDiscovery, 'explicit');
        } finally {
            clearProjectJson5ConfigCache(workspaceRoot);
            (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = undefined;
            fs.rmSync(workspaceRoot, { recursive: true, force: true });
        }
    });
});
