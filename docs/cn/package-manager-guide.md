## 📦 包管理器深入指南

包管理器视图（侧边栏 "包管理器"）以目录 = 包（Package）为单位管理四大主资源类型：

| 资源 | 典型文件 | 支持格式 | 说明 |
|------|----------|----------|------|
| 角色 | `character-gallery.json5` / `*.md` / `*.txt` | JSON5 / Markdown / TXT | 角色设定、别名、颜色、类型、扩展字段；TXT 便于快速导入 |
| 敏感词 | `sensitive-words.json5` / `*.md` / `*.txt` | JSON5 / Markdown / TXT | 内容安全或需要标识的词汇集合；TXT 一行一个词 |
| 词汇 | `vocabulary.json5` / `*.md` / `*.txt` | JSON5 / Markdown / TXT | 世界观专有名词、术语表；TXT 快速迁移来源数据 |
| 正则规则 | `regex-patterns.json5` | JSON5 | 自定义正则高亮/着色规则 |

### 包结构建议

```
novel-helper/
  main/                         # 主设定包（集中核心/跨包共享设定）
    character-gallery.json5     # 主角色集合（结构化）
    world_roles.md              # 追加角色章节 (Markdown，多角色/字段)
    sensitive-words.json5       # 敏感词
    vocabulary.json5            # 词汇
    regex-patterns.json5        # 正则规则
  faction-a/                    # 阵营 / 派系 A（局部角色或补充）
    character-gallery.json5
  faction-b/                    # 阵营 / 派系 B
    character-gallery.json5
```

可将"人物 / 地点 / 事件 / 道具"等再拆分为不同包，利于大型世界观分层：

```
novel-helper/
  characters-core/              # 核心角色（主视角 / 常驻）
    character-gallery.json5
    expansion_roles.md
  characters-factions/          # 各阵营角色分卷
    scarlet_roles.md
    kappa_roles.md
  locations/                    # 地点（文件名含 role/character 则按角色规则；或使用 vocabulary 形式）
    locations_vocabulary.md     # 以"地点名"作为词汇/可着色实体
  events/                       # 重大事件（可当词汇/角色混合，取决于命名关键字）
    historic_roles.md
  items/                        # 重要神器 / 道具
    items_vocabulary.md
  sensitive/                    # 内容安全词汇单独维护
    sensitive-words.json5
  glossary/                     # 术语表 / 专有名词集中
    vocabulary.json5
  regex/                        # 着色正则
    regex-patterns.json5
```

**拆分策略**：按"检索与协作粒度"决定；频繁联动/引用的放在同包，低耦合专题独立包。Markdown 追加文件命名确保含关键词 (roles / character / vocabulary / sensitive 等)。

### 示例设定条目（Markdown 片段）

下面展示一个角色（含多字段 + 自定义字段）在 Markdown 中的写法：

```markdown
# 博丽灵梦

## 立绘
![](https://upload.thbwiki.cc/b/ba/%E5%8D%9A%E4%B8%BD%E7%81%B5%E6%A2%A6%EF%BC%88%E8%90%83%E6%A2%A6%E6%83%B3%E7%AB%8B%E7%BB%98%EF%BC%89.png)

## 别名
- 博丽灵梦
- 灵梦
- Reimu

## 描述
乐园的巫女。作为"博丽神社"的现任巫女，灵梦负责维持幻想乡的安宁与秩序——把异变当作日常，把非日常当作寻常。她看似大而化之，实则直觉敏锐，面对异变时往往以最直接的方式闯到问题核心；神社香火的清淡与钱包的清冷则是她永恒的现实烦恼。她在空中轻盈自如，飞舞的御札与阴阳玉描出红白交错的轨迹，最终以"梦想封印"一口气收束混乱。

## 类型
主角

## 从属
博丽神社（现任巫女，负责维护博丽大结界与日常的"妖怪退治"）。

## 颜色
#e94152ff —— 红白主色（巫女服与阴阳玉的印象色）。

## 外貌
- 红白巫女服，大红蝴蝶结与流苏。
- 手持御币（驱邪用）与御札，随身带阴阳玉。

## 性格
- 大而化之、随性懒散，但直觉敏锐、行动果断。
- 不愿拐弯抹角，讲究"解决就完了"的实干路线。
- 对金钱不敏感，却又为神社香火清淡而烦恼。

## 背景
- 人类。幻想乡"博丽神社"的巫女。
- 处理异变是她的日常工作，也因此与各路人妖都"熟得过分"。
- 居住在博丽神社，守护并调停人妖两界的平衡。

## 技能
- **在空中飞行程度的能力**。
- 巫女神事与退魔：御札、御币、结界术、博丽神社的传统驱邪法。
- 器物：**阴阳玉**（攻防兼备的象征性法具）。

## 代表符卡／招式（节选）
- 夢符／神技 **「梦想封印」**
- 霊符 **「封魔阵」**
- 結界 **「八方鬼缚阵」**
- 神技 **「梦想天生」**
（不同作品与难度存在变体与命名差异，这里仅示例常见代表。）

## 称号（例）
- **乐园的巫女** 等（各作随情境变化）。

## 爱好
- 与其说"爱好"，不如说"把异变当工作"；偶尔也会悠闲地泡茶、打扫神社（如果她想起来的话）。

## 关系（简述）
- 与雾雨魔理沙等常在异变中并肩或对阵；与人类与妖怪两边都交情复杂，既是调停者也是"对手"。（概括性描述）

## 备注
- 作为系列门面的"红白"，灵梦的立场介于"人之侧"与"幻想乡整体秩序"之间：与其讨好某一方，不如把问题本身一击了断。
- 神社香火、打赏与"工作费"常年不足，这一点在日常段子与设定补充中反复出现。
```

### 常用操作（右键 / 命令）

| 操作 | 作用 |
|------|------|
| 新建子包 | 在当前包目录下创建新子目录（继承结构）|
| 创建 character-gallery.json5 | 生成角色库模板 |
| 创建 sensitive-words / vocabulary | 生成对应 JSON5 库文件（可手动补一个同名 .txt 用于批量迁移）|
| 创建同名 *.md 角色表 | 用 Markdown 编写（与 JSON5 并存，可混用）|
| 创建正则表达式配置 | 初始化 `regex-patterns.json5` |
| 打开 / 打开方式… | 直接打开或选择系统程序 |
| 在文件资源管理器中显示 | 跳转系统文件夹 |
| 重命名 / 删除 | 修改或移除文件/包 |
| 复制 / 剪切 / 粘贴 | 包或资源的物理复制移动 |

**拖拽**：
- 同目录内：重排文件顺序（配合写作视图索引更直观）
- 跨目录：物理移动文件/包

支持直接放置 .txt 文件（角色 / 敏感词 / 词汇）后再逐步结构化迁移为 JSON5 / Markdown。

### 📝 Markdown & TXT 设定集语法

Markdown 方式可一次性定义多个角色 / 词汇 / 敏感词。TXT 方式用于"快速粗导入"：

- **\*.txt 读取规则（简单模式）**：一行一个条目，忽略空行；自动去重（同名合并至第一次出现）；默认类型：放入的上下文（角色/敏感词/词汇）推断。
- 可后续右键"打开方式…"转为 Markdown 或复制到 JSON5 精细补充字段。

**Markdown 解析逻辑**：

1. 顶级或同级标题（# / ## / ### ...）作为角色起点。
2. 若该标题下存在下一层子标题，且这些子标题名称属于已知字段（中英文均可），则判定为"结构化角色"。
3. 没有字段子标题的简单标题 == 仅 name 角色。
4. 字段标题支持中文别名：例如 "外貌" = appearance, "性格" = personality。

**示例（多角色混合）**：

```markdown
# 艾丽西亚
## 描述
来自北境的旅者……
## 类型
主角
## 颜色
#ff1e40
## 别名
艾丽, 小艾

# 临时路人甲
（无字段，仅最简角色，类型采用默认）
```

### 支持字段（英文 / 中文别名）

**name**(名称), **description**(描述), **type**(类型), **color**(颜色), **affiliation**(从属), **alias/aliases**(别名), **age**(年龄), **gender**(性别), **occupation**(职业), **personality**(性格), **appearance**(外貌), **background**(背景), **relationship(s)**(关系), **skill(s)**(技能), **weakness(es)**(弱点), **goal(s)**(目标), **motivation**(动机), **fear(s)**(恐惧), **secret(s)**(秘密), **quote(s)**(台词), **note(s)**(备注), **tag(s)**(标签), **category**(分类), **level**(等级), **status**(状态), **location**(位置), **origin**(出身), **family**(家庭), **education**(教育), **hobby/hobbies**(爱好)

### 文件命名规范（必须匹配才能被扫描加载）

基于 `loadRoles` / `isRoleFile` 规则，只有文件名同时满足"包含关键词 + 允许扩展名"才会被自动加载。

| 资源类型 | 允许扩展 | 关键词(文件名中需包含任一) | 示例 |
|----------|----------|---------------------------|------|
| 角色 | .json5 .md .txt | `character-gallery` `character` `role` `roles` | `character-gallery.json5` / `world_roles.md` |
| 敏感词 | .json5 .md .txt | `sensitive-words` `sensitive` | `sensitive-words.txt` |
| 词汇 | .json5 .md .txt | `vocabulary` `vocab` | `my_vocabulary.md` |
| 正则规则 | 仅 .json5 | `regex-patterns` `regex` | `regex-patterns.json5` |

**注意**：

- 正则规则不支持 .md / .txt。
- 其它任意命名（如 `people.md`）即使结构正确也不会被解析。
- **推荐**：主集合使用 `character-gallery.json5`；章节/专题补充使用 `xxx_roles.md`；批量外部迁移先放 `xxx_vocabulary.txt` / `xxx_sensitive.txt`。
- 不要在文件名里只写单个极短词（例如 `role.md` + 无字段）而期望高性能批量导入，尽量保持清晰前缀。

**开发者提示**：判定是否解析的关键字列表在源码 `src/utils/utils.ts` 中常量 `roleKeywords`。
```ts
const roleKeywords = [
  'character-gallery', 'character', 'role', 'roles',
  'sensitive-words', 'sensitive', 'vocabulary', 'vocab',
  'regex-patterns', 'regex'
];
```
仅当文件名 (lowercase) 包含其中任一子串且扩展名合法时才会被扫描。若你自行编译并想扩展关键字，修改该数组后重新打包即可（同时别忘了更新 README 里的表格保持一致）。

快速命名参考：
```
novel-helper/
  main/character-gallery.json5
  main/world_roles.md
  main/sensitive-words.txt
  main/tech_vocabulary.md
  main/regex-patterns.json5
```

### 图片路径处理
Markdown 中的相对图片 `![](images/a.png)` 会自动转换为绝对 `file://` URI，Hover/渲染更稳定。

### 颜色字段解析
支持：HEX (#RGB/#RRGGBB/#RRGGBBAA/#RGBA)、rgb()/rgba()、hsl()/hsla()、hsv()/hsva()；混入文字仍可提取 (`#ff1e40 (主色)`)。

### 自定义 / 扩展字段

解析器策略（见 `markdownParser.ts`）：

1. 标准字段名或其中文别名会被规范化为标准英文 key（例如 "外貌" -> appearance）。
2. 任何未出现在内置映射里的子标题，直接以小写（去首尾空白）作为新字段 key，值为其下方 Markdown 原文（保留格式）。
3. 同名字段再次出现会覆盖前一个（建议同一字段集中书写）。
4. 角色标题下未归属任何字段的直写文本，会并入 description（若已存在则前置补入）。
5. `aliases/别名` 会按逗号或换行拆分成数组；其他自定义字段不做结构分析，只存 Markdown。

**示例（自定义字段）**：

```markdown
# 黑曜导师
## 描述
沉默而克制的炼金顾问。
## 战斗风格
偏向防御反击，擅长利用环境。
## 信仰
旧王廷秘教
## 装备
- 黑曜法杖
- 腐蚀手甲
```

最终将追加字段：`战斗风格` -> 战斗风格 (key: 战斗风格)、`信仰`、`装备`，可在 Hover 中被使用（若前端实现显示）。
