import * as assert from 'assert';
import { mdToPlainText } from '../utils/md_plain';

suite('Markdown Plain Text Preview Parser', () => {
    test('treats four-space indentation as text and fenced blocks as code', () => {
        const src = [
            ' 缩进 1',
            '  缩进 2',
            '    缩进文本',
            '\tTab 缩进',
            '',
            '  ```',
            'code',
            '  ```',
        ].join('\n');

        const { blocks } = mdToPlainText(src, {});

        assert.strictEqual(blocks[0].kind, undefined);
        assert.strictEqual(blocks[0].text, ' 缩进 1\n  缩进 2\n    缩进文本\n\tTab 缩进');
        assert.strictEqual(blocks.find(block => block.kind === 'code')?.text, 'code');
    });
});
