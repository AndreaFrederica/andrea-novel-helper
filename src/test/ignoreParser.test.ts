import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import ignore from 'ignore';
import { GitIgnoreParser, WordCountIgnoreParser, FileTrackingIgnoreParser, CombinedIgnoreParser } from '../utils/Parser/gitignoreParser';
import { isFileIgnored } from '../utils/ignoreUtils';

suite('Ignore Parser Test Suite', () => {
    let tempDir: string;
    let gitignorePath: string;
    let wcignorePath: string;
    let ftignorePath: string;

    setup(() => {
        // 创建临时测试目录
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ignore-test-'));
        gitignorePath = path.join(tempDir, '.gitignore');
        wcignorePath = path.join(tempDir, '.wcignore');
        ftignorePath = path.join(tempDir, '.ftignore');
    });

    teardown(() => {
        // 清理测试目录
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (error) {
            console.warn('Failed to cleanup test directory:', error);
        }
    });

    test('Raw ignore library behavior test', () => {
        // 直接测试 ignore 库的行为
        
        // 测试目录规则
        const ig1 = ignore().add('.vscode/');
        assert.strictEqual(ig1.ignores('.vscode'), false, '.vscode should NOT be ignored by .vscode/ rule (without slash)');
        assert.strictEqual(ig1.ignores('.vscode/'), true, '.vscode/ should be ignored by .vscode/ rule');
        assert.strictEqual(ig1.ignores('.vscode/settings.json'), true, '.vscode/settings.json should be ignored by .vscode/ rule');
        
        // 测试非目录规则
        const ig2 = ignore().add('.vscode');
        assert.strictEqual(ig2.ignores('.vscode'), true, '.vscode should be ignored by .vscode rule');
        assert.strictEqual(ig2.ignores('.vscode/'), true, '.vscode/ should be ignored by .vscode rule');
        assert.strictEqual(ig2.ignores('.vscode/settings.json'), true, '.vscode/settings.json should be ignored by .vscode rule');
        
        // 测试行内注释（应该不被支持）
        const ig3 = ignore().add('.vscode/  # comment');
        assert.strictEqual(ig3.ignores('.vscode'), false, '.vscode should NOT be ignored when rule has inline comment');
        assert.strictEqual(ig3.ignores('.vscode/  # comment'), true, 'Exact pattern match should work');
    });

    test('Directory ignore rules with trailing slash', () => {
        // 测试目录忽略规则：带尾部斜杠的规则应该只匹配目录
        fs.writeFileSync(gitignorePath, '.vscode/\n');
        
        const parser = new GitIgnoreParser(tempDir);
        
        // 测试不同的路径格式
        const testCases = [
            { path: '.vscode', expected: true, desc: 'directory name without slash' },
            { path: '.vscode/', expected: true, desc: 'directory name with slash' },
            { path: '.vscode/settings.json', expected: true, desc: 'file inside ignored directory' }
        ];

        testCases.forEach(testCase => {
            const fullPath = path.join(tempDir, testCase.path);
            const result = parser.shouldIgnore(fullPath);
            assert.strictEqual(result, testCase.expected, 
                `Failed for ${testCase.desc}: ${testCase.path} should ${testCase.expected ? 'be ignored' : 'not be ignored'}`);
        });
    });

    test('WCIgnore supports inline comments', () => {
        // 测试 .wcignore 支持行内注释
        fs.writeFileSync(wcignorePath, '.vscode/  # VS Code configuration\n.idea/  # IntelliJ IDEA\n');
        
        const parser = new WordCountIgnoreParser(tempDir);
        
        const testCases = [
            { path: '.vscode/settings.json', expected: true, desc: 'file in directory with inline comment' },
            { path: '.idea/workspace.xml', expected: true, desc: 'file in another directory with inline comment' }
        ];

        testCases.forEach(testCase => {
            const fullPath = path.join(tempDir, testCase.path);
            const result = parser.shouldIgnore(fullPath);
            assert.strictEqual(result, testCase.expected, 
                `Failed for ${testCase.desc}: ${testCase.path} should ${testCase.expected ? 'be ignored' : 'not be ignored'}`);
        });
    });

    test('FTIgnore supports inline comments', () => {
        fs.writeFileSync(ftignorePath, 'tracked-cache/  # file tracking cache\n');

        const parser = new FileTrackingIgnoreParser(tempDir);

        const fullPath = path.join(tempDir, 'tracked-cache', 'chapter.md');
        assert.strictEqual(parser.shouldIgnore(fullPath), true, 'file in .ftignore directory should be ignored');
    });

    test('WCIgnore can be disabled for base file tracking filters', () => {
        fs.writeFileSync(gitignorePath, 'git-drafts/\n');
        fs.writeFileSync(wcignorePath, 'drafts/\n');
        fs.writeFileSync(ftignorePath, 'tracked-cache/\n');
        const parser = new CombinedIgnoreParser(tempDir);
        const gitDraftPath = path.join(tempDir, 'git-drafts', 'chapter.md');
        const filePath = path.join(tempDir, 'drafts', 'chapter.md');
        const trackedCachePath = path.join(tempDir, 'tracked-cache', 'chapter.md');

        assert.strictEqual(
            isFileIgnored(gitDraftPath, {
                workspaceRoot: tempDir,
                respectWcignore: false,
                respectGitignore: true,
                respectFileTrackingIgnore: true,
                ignoreParser: parser,
            }),
            true,
            '.gitignore should block base file tracking filters by default'
        );

        assert.strictEqual(
            isFileIgnored(gitDraftPath, {
                workspaceRoot: tempDir,
                respectWcignore: false,
                respectGitignore: false,
                respectFileTrackingIgnore: true,
                ignoreParser: parser,
            }),
            false,
            '.gitignore should not block base file tracking filters when respectGitignore is false'
        );

        assert.strictEqual(
            isFileIgnored(filePath, {
                workspaceRoot: tempDir,
                respectWcignore: false,
                respectGitignore: true,
                ignoreParser: parser,
            }),
            false,
            '.wcignore should not block tracking when respectWcignore is false'
        );

        assert.strictEqual(
            isFileIgnored(filePath, {
                workspaceRoot: tempDir,
                respectWcignore: true,
                respectGitignore: true,
                ignoreParser: parser,
            }),
            true,
            '.wcignore should still block word-count style filters when enabled'
        );

        assert.strictEqual(
            isFileIgnored(trackedCachePath, {
                workspaceRoot: tempDir,
                respectWcignore: false,
                respectGitignore: true,
                respectFileTrackingIgnore: true,
                ignoreParser: parser,
            }),
            true,
            '.ftignore should block base file tracking filters'
        );

        assert.strictEqual(
            isFileIgnored(trackedCachePath, {
                workspaceRoot: tempDir,
                respectWcignore: true,
                respectGitignore: true,
                respectFileTrackingIgnore: false,
                ignoreParser: parser,
            }),
            false,
            '.ftignore should not block word-count style filters'
        );
    });

    test('Plain JSON is not a default writing resource file type', () => {
        const filePath = path.join(tempDir, 'package.json');

        assert.strictEqual(
            isFileIgnored(filePath, {
                workspaceRoot: tempDir,
                respectWcignore: false,
                respectGitignore: false,
            }),
            true,
            '.json should be ignored by the default writing-resource file type filter'
        );
    });
});
