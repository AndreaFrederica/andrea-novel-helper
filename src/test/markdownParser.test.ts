import * as assert from 'assert';
import { parseMarkdownRoles } from '../utils/Parser/markdownParser';
import { LEGACY_RESOURCE_KEYWORDS } from '../projectConfig/resourceFileNaming';

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

        const roles = parseMarkdownRoles(content, `${LEGACY_RESOURCE_KEYWORDS.sensitive}.md`, '', '敏感词');

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

    test('uuid field stops at first uuid-like value when followed by markdown noise', () => {
        const content = `# 角色形象集

## 附录：提及但未登场的角色

### UUID

019e4af4-2246-79fc-a6c7-091d643780f8
**首次登场**：第1章
| 角色 | 出处 | 说明 |
|:----|:----|:-----|
| 五爪金龙 | 第29章 | 提及 |
`;

        const roles = parseMarkdownRoles(content, '角色形象集.md', '', '角色');

        assert.strictEqual(roles.length, 1);
        assert.strictEqual(roles[0].uuid, '019e4af4-2246-79fc-a6c7-091d643780f8');
    });

    test('role markdown supports nested role headings with their own fields', () => {
        const content = `# 角色形象集

## 一、核心主角

### UUID

019e4ac7-5339-766f-9503-c046b104faef

### 1. 李修缘

#### UUID

019e4ac7-466a-73cf-88fc-51ecab550bea

#### 类型

主角

### 2. 陈汐梅

#### UUID

019e4ac7-466a-79fa-b819-1ff4b4ed43ce

#### 类型

主角

### 备注

分组级备注
`;

        const roles = parseMarkdownRoles(content, '角色形象集.md', '', '角色');

        assert.deepStrictEqual(roles.map(role => role.name), ['一、核心主角', '1. 李修缘', '2. 陈汐梅']);
        assert.strictEqual(roles[0].uuid, '019e4ac7-5339-766f-9503-c046b104faef');
        assert.strictEqual(roles[1].uuid, '019e4ac7-466a-73cf-88fc-51ecab550bea');
        assert.strictEqual(roles[2].uuid, '019e4ac7-466a-79fa-b819-1ff4b4ed43ce');
        assert.strictEqual((roles[0] as any).note, '分组级备注');
    });

    test('unknown section headings stay fields instead of nested roles without semantic children', () => {
        const content = `# 佐藤紬

## UUID

01998c7a-1d68-781f-9cfe-c4b0b6ce9b30

## 立绘

<!-- 待添加立绘图片 -->

## 类型

主角
`;

        const roles = parseMarkdownRoles(content, '佐藤紬_character.md', '', '角色');

        assert.strictEqual(roles.length, 1);
        assert.strictEqual(roles[0].name, '佐藤紬');
        assert.strictEqual(roles[0].uuid, '01998c7a-1d68-781f-9cfe-c4b0b6ce9b30');
        assert.strictEqual((roles[0] as any)['立绘'], '<!-- 待添加立绘图片 -->');
    });
});
