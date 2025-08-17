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
角色

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
这些词汇涉及政治敏感内容：

- 词汇1
- 词汇2
- 词汇3

## 暴力相关
涉及暴力的词汇：

- **严重暴力**: 某些极端词汇
- **一般暴力**: 普通暴力词汇

## 其他
其他需要注意的敏感词：

> 注意：这些词汇在特定语境下可能引起争议`;
}

/** 词汇 Markdown 模板 */
export function generateMarkdownVocabularyTemplate(): string {
    return `# 专业词汇表

## 技术术语
技术相关的专业词汇：

1. **术语A**: 详细解释和用法
2. **术语B**: 相关定义和示例
3. **术语C**: 应用场景说明

## 行业术语
特定行业的专业词汇：

### 医疗行业
- **诊断**: 医生对病情的判断
- **治疗方案**: 具体的医疗计划

### 法律行业  
- **诉讼**: 法律程序中的争议解决
- **判决**: 法院的最终决定

## 文学术语
写作相关的专业词汇：

- *情节*: 故事的发展脉络
- *人物弧*: 角色的成长轨迹
- *主题*: 作品要表达的核心思想

## 其他
其他重要的专业词汇：

> 这些词汇在特定领域有专门含义，使用时需要注意语境。`;
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
    color: "#98FB98",
    priority: 100,
    description: "匹配中文引号内的对话内容",
  },
  {
    name: "心理描写",
    type: "正则表达式",
    // 全角括号（中文括号）
    regex: "（[^（）]*）",
    regexFlags: "g",
    color: "#DDA0DD",
    priority: 120,
    description: "匹配全角括号内的心理描写",
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
