import * as assert from 'assert';
import { parseMarkdownRoles } from '../utils/Parser/markdownParser';

suite('Markdown Parser Test Suite', () => {
    test('sensitive markdown skips same-level group header before detailed entries', () => {
        const content = `# 敏感词表

## 政治相关

### xxx 运动
### xxx 社区

#### UUID

019e3515-04ab-7489-937c-fa1f696cdee0
#### 类型
敏感词
#### 描述
测试用敏感词
#### 自定义字段
这是自定义字段

### xxxx 行动

#### UUID

019e3515-04ac-70c6-8750-8dcc704c05ee
#### 类型
敏感词

> 注意：这些词汇在特定语境下可能引起争议
`;

        const roles = parseMarkdownRoles(content, 'sensitive-words.md', '', '敏感词');

        assert.deepStrictEqual(roles.map(role => role.name), ['xxx 社区', 'xxxx 行动']);
        assert.strictEqual(roles[0].uuid, '019e3515-04ab-7489-937c-fa1f696cdee0');
        assert.strictEqual(roles[1].uuid, '019e3515-04ac-70c6-8750-8dcc704c05ee');
        assert.strictEqual(roles[1].type, '敏感词');
    });

    test('role markdown still keeps simple role headings before detailed entries', () => {
        const content = `# 角色库

### 简单角色

### 详细角色
#### 类型
角色
`;

        const roles = parseMarkdownRoles(content, 'characters.md', '', '角色');

        assert.deepStrictEqual(roles.map(role => role.name), ['简单角色', '详细角色']);
    });
});
