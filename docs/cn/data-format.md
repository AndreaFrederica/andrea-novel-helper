## 📝 数据格式说明

### JSON5 格式示例

#### 角色库示例（character-gallery.json5）

```json5
[
  {
    name: '艾丽西亚',                // 角色/词条主名称（必填）
    type: '主角',                    // 类型：决定默认色，可自定义扩展
    aliases: ['小艾','旅者'],        // 别名数组（可选）
    description: '北境旅者，拥有冰霜魔法的天赋。性格坚毅但内心温柔，为了寻找失踪的妹妹而踏上冒险之路。',
    color: '#ff1e40',               // 优先级高于类型默认色
    affiliation: '北境雪原',         // 从属/阵营
    priority: 10,                   // 着色/匹配优先级（数值小优先）
    appearance: '高挑，绿瞳，银发',   // 任意扩展字段都保留
    age: 22,                        // 年龄
    weapon: '冰霜法杖',             // 武器
    skills: ['冰霜魔法', '治疗术', '剑术基础'],
    personality: '坚毅、温柔、责任感强',
    background: '出生于北境的魔法世家，从小接受严格的魔法训练'
  },
  {
    name: '暗影刺客',
    type: '反派',
    aliases: ['影子', '夜行者'],
    description: '神秘的刺客组织成员，行踪诡秘。',
    color: '#2d2d2d',
    affiliation: '暗影公会',
    priority: 5,
    skills: ['潜行', '暗杀', '毒术'],
    weapon: '双刃匕首'
  }
]
```

#### 敏感词库示例（sensitive-words.json5）

```json5
[
  {
    name: '血腥',
    description: '暴力内容警告',
    category: '暴力',
    severity: 'high'
  },
  {
    name: '政治敏感词',
    aliases: ['敏感政治', '政治话题'],
    description: '涉及政治敏感内容',
    category: '政治',
    severity: 'critical'
  }
]
```

#### 词汇库示例（vocabulary.json5）

```json5
[
  {
    name: '魔法水晶',
    description: '蕴含魔力的天然水晶，可用于制作魔法道具或增强法术威力。',
    category: '道具',
    rarity: 'rare',
    properties: ['魔力增幅', '法术储存']
  },
  {
    name: '龙语',
    aliases: ['古龙语', '龙族语言'],
    description: '古代龙族使用的神秘语言，掌握者可以施展强大的龙语魔法。',
    category: '语言',
    difficulty: 'legendary'
  }
]
```

#### 正则规则示例（regex-patterns.json5）

```json5
[
  {
    name: '时间标记',
    pattern: '\\d{4}年\\d{1,2}月\\d{1,2}日', // Corrected: escaped backslash for 
    description: '高亮时间格式',
    color: '#4CAF50',
    priority: 1
  },
  {
    name: '魔法咒语',
    pattern: '【[^】]+】',
    description: '魔法咒语格式',
    color: '#9C27B0',
    priority: 2
  },
  {
    name: '心理描写',
    pattern: '（[^）]*心想[^）]*）',
    description: '心理活动描写',
    color: '#FF9800',
    priority: 3
  }
]
```

### Markdown 格式示例

```markdown
# 艾丽西亚

## 描述
这是一个复杂的角色，有着**丰富的内心世界**和*独特的经历*。

北境旅者，拥有冰霜魔法的天赋。性格坚毅但内心温柔，为了寻找失踪的妹妹而踏上冒险之路。

主要特点：
- 善良而坚强
- 富有同情心
- 面对困难从不退缩

> 这个角色代表着希望与勇气

## 类型
主角

## 别名
- 小艾
- 旅者
- 冰霜法师

## 颜色
rgb(255, 30, 64) - 温暖的红色，也可以用 #ff1e40 或 hsl(348, 100%, 56%)

## 从属
北境雪原

## 外貌
- **身高**: 175cm
- **发色**: 银色长发
- **眼睛**: 明亮的绿色眼眸
- **特征**: 左手腕有一个小小的疤痕

## 性格
性格复杂多面：

1. **表面**: 开朗活泼，善于交际
2. **内心**: 有时会感到孤独和迷茫
3. **压力下**: 表现出惊人的冷静和理智

核心信念：永远不要放弃希望

## 背景
出生在北境的魔法世家，从小接受严格的魔法训练。

### 童年
- 在雪原中长大
- 喜欢研究古老的魔法典籍

### 青少年时期
- 掌握了基础的冰霜魔法
- 经历了妹妹失踪的重大变故

### 成年时期
- 踏上寻找妹妹的冒险之路
- 不断提升自己的魔法能力

## 关系
- **妹妹**: 莉莉安（失踪，正在寻找）
- **导师**: 冰霜大法师（魔法启蒙老师）
- **伙伴**: 火焰剑士雷克斯（冒险途中结识）

## 技能
1. 冰霜魔法（高级）
2. 治疗术（中级）
3. 剑术基础
4. 古文字解读

## 武器
冰霜法杖 - 家族传承的魔法道具

## 弱点
- 对火系魔法抗性较低
- 过于信任他人
- 对妹妹的思念影响判断

## 目标
找到失踪的妹妹，揭开家族的秘密

## 台词
"冰雪虽冷，但我的心永远温暖。"
"为了妹妹，我愿意面对任何困难。"

## 备注
角色设计灵感来源于北欧神话中的冰雪女神
```

### 文件命名规范

| 资源类型 | 允许扩展 | 关键词(文件名中需包含任一) | 示例 |
|----------|----------|----------------------------|------|
| 角色 | .json5 .md .txt | `character-gallery` `character` `role` `roles` | `character-gallery.json5` / `world_roles.md` |
| 敏感词 | .json5 .md .txt | `sensitive-words` `sensitive` | `sensitive-words.txt` |
| 词汇 | .json5 .md .txt | `vocabulary` `vocab` | `my_vocabulary.md` |
| 正则规则 | 仅 .json5 | `regex-patterns` `regex` | `regex-patterns.json5` |
```