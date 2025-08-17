import { Role } from '../extension';

/** 角色 Markdown 模板 */
export function generateMarkdownRoleTemplate(): string {
    return `# 主角人物

## 描述
这是一个复杂的角色，有着**丰富的内心世界**和*独特的经历*。

主要特点：
- 善良而坚强
- 富有同情心
- 面对困难从不退缩

> 这个角色代表着希望与勇气

## 类型
主角

## 颜色
rgb(255, 30, 64) - 温暖的红色，也可以用 #ff1e40 或 hsl(348, 100%, 56%)

## 外貌
- **身高**: 175cm
- **发色**: 深棕色长发
- **眼睛**: 明亮的绿色眼眸
- **特征**: 左手腕有一个小小的疤痕

## 性格
性格复杂多面：

1. **表面**: 开朗活泼，善于交际
2. **内心**: 有时会感到孤独和迷茫
3. **压力下**: 表现出惊人的冷静和理智

\`\`\`
核心信念：永远不要放弃希望
\`\`\`

## 背景
出生在一个普通的家庭，从小就展现出**不同寻常的智慧**。

### 童年
- 在乡村长大
- 喜欢读书和探索自然

### 青少年时期
- 搬到城市求学
- 经历了人生的第一次重大挫折

### 成年时期
- 大学毕业后进入职场
- 经历了多次职业转换
- 最终找到了自己的人生方向

## 关系
- **最好的朋友**: 张小明（从小一起长大）
- **导师**: 李教授（大学时的恩师）
- **对手**: 王大强（既是竞争对手又是朋友）

## 技能
1. 优秀的分析能力
2. 出色的沟通技巧
3. 基础的武术功底

## 爱好
喜欢的活动包括：
- 阅读*科幻小说*
- 练习**太极拳**
- 收集古董钢笔

## 备注
这个角色在故事中的作用是推动情节发展，同时也是读者情感投射的对象。

> 重要提示：在描写这个角色时，要注意保持其复杂性和真实感。`;
}

/** 敏感词 Markdown 模板 */
export function generateMarkdownSensitiveTemplate(): string {
    return `# 敏感词表

## 政治相关

### xxx 运动
#### 类型
敏感词
#### 描述
测试用敏感词
#### 自定义字段
这是自定义字段

### xxxx 行动
#### 类型
敏感词

> 注意：这些词汇在特定语境下可能引起争议`;
}

/** 词汇 Markdown 模板 */
export function generateMarkdownVocabularyTemplate(): string {
    // 顶层总标题(#) 仅作容器；具体词汇用二级标题(## 术语)，其下的三级标题(### 描述 / ### 类型 / 等) 为字段。
    // 解析器逻辑：若一个标题的直接子标题中出现任意已知字段（描述/类型/颜色/别名/分类等），该标题即视为一条“角色/词汇”记录。
    return `# 专业词汇表

> 使用说明：下面每个“## 术语名称”块代表一个词条；其下可添加字段子标题：描述 / 类型 / 别名 / 分类(category) / 备注(notes) 等。
> 可删除示例，自行复制粘贴扩展。字段标题既可用中文别名，也可用英文原名。

## 灵能
### 描述
世界观中的核心能源形式，用于驱动特殊技术或能力表现。

### 类型
词汇

### 别名
灵力, 能量

### 分类
世界观

### 备注
可与“聚能阵列”配合出现；在统计/高亮中需特别关注。

## 聚能阵列
### 描述
用于收集并聚焦灵能的装置，通常呈环形或塔状结构。

### 类型
词汇

### 别名
阵列, 聚能器

### 分类
科技

### 备注
与“灵能”同段落高频共现时可作为技术说明段落特征。

## 幻写症
### 描述
作者在创作后期出现的“反复重写但难以推进”的心理/工作状态标签。

### 类型
词汇

### 分类
写作

### 备注
可辅助做写作过程统计或状态标记；不是剧情内概念，可在词汇表中单独归档。

## 占位示例（复制此块新增）
### 描述
在此填写词条的详细说明，可包含列表、引用、图片等 Markdown 语法。

### 类型
词汇

### 别名
在此用逗号分隔多个别名

### 分类
自定义分类

### 备注
更多补充信息。
`;
}

/** 综合入口：根据类型生成 Markdown 模板 */
export function generateMarkdownTemplate(roleType: string): string {
    switch (roleType) {
        case '角色':
            return generateMarkdownRoleTemplate();
        case '敏感词':
            return generateMarkdownSensitiveTemplate();
        case '词汇':
            return generateMarkdownVocabularyTemplate();
        default:
            return generateMarkdownRoleTemplate();
    }
}

/** 正则着色配置文件模板（JSON5 合法） */
export function generateRegexPatternsTemplate(): string {
    return `// 正则表达式着色器配置文件
// 这个文件定义了基于正则表达式的文本着色规则
[
  // === 正则表达式角色示例（JSON5 合法）===
  {
    name: "中文对话",
    type: "正则表达式",
    // 中文引号：U+201C/U+201D
    regex: "“[^”]*”",
    regexFlags: "g",
    color: "#fbdc98ff",
    priority: 100,
    description: "匹配中文引号内的对话内容",
    
  },
    {
    name: "中文对话2",
    type: "正则表达式",
    // 中文引号：U+201C/U+201D
    regex: "「[^」]*」",
    regexFlags: "g",
    color: "#fbdc98ff",
    priority: 100,
    description: "匹配中文引号内的对话内容",
    
  },
      {
    name: "中文思考",
    type: "正则表达式",
    // 中文引号：U+201C/U+201D
    regex: "‘[^’]*’",
    regexFlags: "g",
    color: "#98bbfbff",
    priority: 95,
    description: "匹配中文引号内的对话内容",
    
  },
      {
    name: "书名号",
    type: "正则表达式",
    // 中文引号：U+201C/U+201D
    regex: "《[^》]*》",
    regexFlags: "g",
    color: "#fbbc98ff",
    priority: 90,
    description: "匹配书名号内的内容",
    
  },
]`;
}

/** 示例角色（JSON5 / 代码中复用） */
// 公共示例角色，供多种模板复用，避免重复硬编码
const EXAMPLE_ROLE: Role = {
    name: '示例角色',
    type: '配角',
    affiliation: '示例阵营',
    aliases: ['示例'],
    description: '这是一个示例角色，用于说明角色库格式。',
    color: '#FFA500'
};

export function generateExampleRoleList(): Role[] {
    // 返回副本，防止外部修改内部常量
    return [ { ...EXAMPLE_ROLE, aliases: [...(EXAMPLE_ROLE.aliases||[])] } ];
}

/** 角色库 JSON5 初始模板（含 1 个示例，可删除） */
export function generateCharacterGalleryJson5(): string {
        return `[
    // === 示例角色（可删除）===
    {
        name: "${EXAMPLE_ROLE.name}",
        type: "${EXAMPLE_ROLE.type}",
        affiliation: "${EXAMPLE_ROLE.affiliation}",
        aliases: [${(EXAMPLE_ROLE.aliases||[]).map(a=>`"${a}"`).join(', ')}],
        color: "${EXAMPLE_ROLE.color}",
        description: "${EXAMPLE_ROLE.description}"
    }
]`;
}

/** 示例敏感词 JSON5 模板（字符串形式，直接写入文件） */
export function generateSensitiveWordsJson5(): string {
        return `[
    // === 示例敏感词（可删除或新增）===
    {
        name: "禁用词",
        type: "敏感词",
        color: "#FF4D4F", // 可选：用于高亮
        description: "需要避免使用的词汇，成稿前需替换。",
        aliases: ["替换候选1"],
        category: "内容安全", // 自定义分类字段
        severity: "high"      // 自定义严重级别字段
    },
    {
        name: "剧透点",
        type: "敏感词",
        color: "#FFA940",
        description: "尚未公开的剧情关键词。",
        category: "剧情",
        severity: "medium"
    }
]`;
}

/** 示例词汇 JSON5 模板（字符串形式，直接写入文件） */
export function generateVocabularyJson5(): string {
        return `[
    // === 示例专业词汇 ===
    {
        name: "灵能",
        type: "词汇",
        color: "#1890FF",
        description: "世界观核心能量。",
        category: "世界观"
    },
    {
        name: "聚能阵列",
        type: "词汇",
        description: "用于聚焦灵能的装置。",
        aliases: ["阵列", "聚能器"],
        category: "科技"
    }
]`;
}
