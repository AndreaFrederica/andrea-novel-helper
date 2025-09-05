import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import ignore from 'ignore';
import { GitIgnoreParser, WordCountIgnoreParser, CombinedIgnoreParser } from '../utils/Parser/gitignoreParser';

suite('Ignore Parser Test Suite', () => {
    let tempDir: string;
    let gitignorePath: string;
    let wcignorePath: string;

    setup(() => {
        // 创建临时测试目录
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ignore-test-'));
        gitignorePath = path.join(tempDir, '.gitignore');
        wcignorePath = path.join(tempDir, '.wcignore');
    });

    teardown(() => {
        // 清理测试目录
        try {
            if (fs.existsSync(gitignorePath)) { fs.unlinkSync(gitignorePath); }
            if (fs.existsSync(wcignorePath)) { fs.unlinkSync(wcignorePath); }
            fs.rmdirSync(tempDir);
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
});
