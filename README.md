# Andrea Novel Helper

> 最新版本：**0.3.11 (2025-08-23)**  
> 近期已大幅重构异步加载与性能管线，若从老版本 (<0.0.21) 升级，建议阅读本节“近期版本速览”。

一个围绕“设定集 / 资料集”组织写作资产的 VS Code 小说写作增强扩展。核心理念：把你的世界观、角色、敏感词、专业词汇、正则高亮规则和章节文件放进一个“包”（Package），由“包管理器”统一可视化管理与快速生成。
## 反馈和交流
- Github Issues
- [QQ群【小说助手用户反馈和交流】](https://qm.qq.com/q/SG5A3XLoSQ)

## 🔔 近期版本速览

### 0.3.1 (2025-08-18)
**新增**
- 初始化向导改进：项目/库缺失时更直观的创建引导。

**修复（重点是前一轮“仓促异步化”遗留问题）**
- Definition 在 JSON5 中失效。
- 补全项颜色不显示 / 补全偶发整体失效。
- 着色尾拖 / 着色随机失效 / 别名不着色。
- “当前文章角色” 视图偶发不刷新。
- 敏感词库文件内部仍报敏感词诊断（已针对多敏感词库支持修复）。

### 0.2.24 (2025-08-17)
- 角色加载状态在缺失描述文件时不消失的问题。
- 版本号长时间未按语义化递增的矫正。

### 0.0.23 (2025-08-17) – 性能与准确性聚焦
- Aho-Corasick 匹配全面异步化（共享 Worker）。
- 装饰刷新差异化 / 正则分片切片 / 大文件防护策略。
- 目录与字数聚合缓存 / 大文件近似字数 (≈) + 后台校准。
- 分词过滤：短词自动边界验证 (`Intl.Segmenter`)；可配置开关与长度阈值。
- Worker 构建等待 & 搜索超时防护，重建触发与缓存版本化。 

（更早的功能里程碑见下文“Release Notes” 与 CHANGELOG）


## 🚀 核心亮点概览

1. 包管理器（设定集中心）：图形化管理 `novel-helper/` 下的“包”与资源文件（JSON5 / Markdown / TXT）。
2. Markdown 设定集：可用纯 Markdown 撰写角色/词汇/敏感词，自动解析章节式结构与字段标题。
3. JSON5 结构化数据：角色库 / 敏感词库 / 词汇库 / 正则库统一 JSON5；支持注释、尾逗号、灵活顺序。
4. TXT 快速迁移：支持放置 `*.txt`（一行一条）快速从其它软件/导出数据导入，后续再渐进转 Markdown / JSON5 精细化。
5. 智能补全与着色：主名称 + 别名 / 词汇 / 敏感词 / 正则匹配全部支持补全、跳转、Hover、着色。
6. 角色层级树视图：按【从属 → 类型 → 角色】分层，词汇/敏感词/正则表达式三类统一置底“特殊分类”分组；展开状态持久化。
7. “当前文章角色” 双视图：侧边栏 & Explorer 各一份实时显示当前文档出现过的角色/词汇/敏感词/正则命中，复用缓存免重复扫描。
8. 写作资源视图（Word Count Explorer）：可替代原生 Explorer，聚焦写作文件字数、排序、索引管理与拖拽组织。
9. 性能优化：懒加载大纲、分片文件追踪数据库、读写降噪、共享缓存 + 异步刷新（含文档角色缓存模型）。
10. 写作时间 & 统计仪表板：分钟级/会话级统计、CPM（字符每分钟）峰值、活跃度趋势。

---
## ⚡ 0.0.23 匹配性能

本版本开始：

- Aho-Corasick 角色/词汇匹配迁移到共享 Worker 异步执行，避免主线程在长文本上被阻塞。
- 增加了大文件防护，对于过大的文件（默认超过 100KB）将不再自动触发角色/词汇匹配，避免卡顿。
- 增加了大文件字数估计，用户可在设置中调整阈值，先估算再慢慢统计。
- 实时字数统计异步化处理，TimeStats的实时字数统计将不再阻塞主线程。


---
## 📦 包管理器深入指南

包管理器视图（侧边栏 “包管理器”）以目录 = 包（Package）为单位管理四大主资源类型：
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
可将“人物 / 地点 / 事件 / 道具”等再拆分为不同包，利于大型世界观分层：
```
novel-helper/
  characters-core/              # 核心角色（主视角 / 常驻）
    character-gallery.json5
    expansion_roles.md
  characters-factions/          # 各阵营角色分卷
    scarlet_roles.md
    kappa_roles.md
  locations/                    # 地点（文件名含 role/character 则按角色规则；或使用 vocabulary 形式）
    locations_vocabulary.md     # 以“地点名”作为词汇/可着色实体
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
> 拆分策略：按“检索与协作粒度”决定；频繁联动/引用的放在同包，低耦合专题独立包。Markdown 追加文件命名确保含关键词 (roles / character / vocabulary / sensitive 等)。

### 示例设定条目（Markdown 片段）
下面展示一个角色（含多字段 + 自定义字段）在 Markdown 中的写法：
```markdown
# 博丽灵梦

## 立绘
![博丽灵梦（萃梦想 立绘）](https://upload.thbwiki.cc/b/ba/%E5%8D%9A%E4%B8%BD%E7%81%B5%E6%A2%A6%EF%BC%88%E8%90%83%E6%A2%A6%E6%83%B3%E7%AB%8B%E7%BB%98%EF%BC%89.png)

## 别名
- 博丽灵梦
- 灵梦
- Reimu

## 描述
乐园的巫女。作为“博丽神社”的现任巫女，灵梦负责维持幻想乡的安宁与秩序——把异变当作日常，把非日常当作寻常。她看似大而化之，实则直觉敏锐，面对异变时往往以最直接的方式闯到问题核心；神社香火的清淡与钱包的清冷则是她永恒的现实烦恼。她在空中轻盈自如，飞舞的御札与阴阳玉描出红白交错的轨迹，最终以“梦想封印”一口气收束混乱。

## 类型
主角

## 从属
博丽神社（现任巫女，负责维护博丽大结界与日常的“妖怪退治”）。

## 颜色
#e94152ff —— 红白主色（巫女服与阴阳玉的印象色）。

## 外貌
- 红白巫女服，大红蝴蝶结与流苏。
- 手持御币（驱邪用）与御札，随身带阴阳玉。

## 性格
- 大而化之、随性懒散，但直觉敏锐、行动果断。
- 不愿拐弯抹角，讲究“解决就完了”的实干路线。
- 对金钱不敏感，却又为神社香火清淡而烦恼。

## 背景
- 人类。幻想乡“博丽神社”的巫女。
- 处理异变是她的日常工作，也因此与各路人妖都“熟得过分”。
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
- 与其说“爱好”，不如说“把异变当工作”；偶尔也会悠闲地泡茶、打扫神社（如果她想起来的话）。

## 关系（简述）
- 与雾雨魔理沙等常在异变中并肩或对阵；与人类与妖怪两边都交情复杂，既是调停者也是“对手”。（概括性描述）

## 备注
- 作为系列门面的“红白”，灵梦的立场介于“人之侧”与“幻想乡整体秩序”之间：与其讨好某一方，不如把问题本身一击了断。
- 神社香火、打赏与“工作费”常年不足，这一点在日常段子与设定补充中反复出现。
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
拖拽：
* 同目录内：重排文件顺序（配合写作视图索引更直观）
* 跨目录：物理移动文件/包
* 支持直接放置 `.txt` 文件（角色 / 敏感词 / 词汇）后再逐步结构化迁移为 JSON5 / Markdown。

---
## 📝 Markdown & TXT 设定集语法

Markdown 方式可一次性定义多个角色 / 词汇 / 敏感词。TXT 方式用于“快速粗导入”：
* `*.txt` 读取规则（简单模式）：一行一个条目，忽略空行；自动去重（同名合并至第一次出现）；默认类型：放入的上下文（角色/敏感词/词汇）推断。
* 可后续右键“打开方式…”转为 Markdown 或复制到 JSON5 精细补充字段。

Markdown 解析逻辑：
1. 顶级或同级标题（# / ## / ### ...）作为角色起点。
2. 若该标题下存在下一层子标题，且这些子标题名称属于已知字段（中英文均可），则判定为“结构化角色”。
3. 没有字段子标题的简单标题 == 仅 name 角色。
4. 字段标题支持中文别名：例如 “外貌” = appearance, “性格” = personality。

示例（多角色混合）：
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
```
novel-helper/
  main/                       # 主设定包（命名需含关键字方可被扫描）
    character-gallery.json5   # 角色（主集合）
    world_roles.md            # 角色追加（MD：多角色/字段）
    sensitive-words.json5     # 敏感词（或 sensitive-words.txt / sensitive-extra.md）
    vocabulary.json5          # 词汇（或 vocabulary.txt / glossary_vocabulary.md）
    regex-patterns.json5      # 正则规则（仅 json5 支持）
  faction-a/
    character-gallery.json5   # 分支/阵营角色（文件名带 character / role）
  faction-b/
    character-gallery.json5
  notes/                      # 纯资料：不含关键字 -> 不会被自动解析（可当普通笔记）
    worldbuilding.md
```
> 说明：不想被解析的设定文稿命名不要包含上述关键字；想被解析的必须包含并使用支持的扩展名。
name(名称), description(描述), type(类型), color(颜色), affiliation(从属), alias/aliases(别名), age(年龄), gender(性别), occupation(职业), personality(性格), appearance(外貌), background(背景), relationship(s)(关系), skill(s)(技能), weakness(es)(弱点), goal(s)(目标), motivation(动机), fear(s)(恐惧), secret(s)(秘密), quote(s)(台词), note(s)(备注), tag(s)(标签), category(分类), level(等级), status(状态), location(位置), origin(出身), family(家庭), education(教育), hobby/hobbies(爱好)

### 文件命名规范（必须匹配才能被扫描加载）
### 自定义 / 扩展字段
解析器策略（见 `markdownParser.ts`）：
1. 标准字段名或其中文别名会被规范化为标准英文 key（例如 “外貌” -> `appearance`）。
2. 任何未出现在内置映射里的子标题，直接以小写（去首尾空白）作为新字段 key，值为其下方 Markdown 原文（保留格式）。
3. 同名字段再次出现会覆盖前一个（建议同一字段集中书写）。
4. 角色标题下未归属任何字段的直写文本，会并入 `description`（若已存在则前置补入）。
5. `aliases/别名` 会按逗号或换行拆分成数组；其他自定义字段不做结构分析，只存 Markdown。

示例（自定义字段）：
```markdown
# 黑曜导师
## 描述
沉默而克制的炼金顾问。
## 战斗风格
偏向防御反击，擅长利用环境。
## 信仰
旧王廷秘教
## 装备
- 黑曜法杖\\n- 腐蚀手甲
```
最终将追加字段：`战斗风格` -> `战斗风格` (key: `战斗风格`)、`信仰`、`装备`，可在 Hover 中被使用（若前端实现显示）。
基于 `loadRoles` / `isRoleFile` 规则，只有文件名同时满足“包含关键词 + 允许扩展名”才会被自动加载。

| 资源类型 | 允许扩展 | 关键词(文件名中需包含任一) | 示例 |
|----------|----------|----------------------------|------|
| 角色 | .json5 .md .txt | `character-gallery` `character` `role` `roles` | `character-gallery.json5` / `world_roles.md` |
| 敏感词 | .json5 .md .txt | `sensitive-words` `sensitive` | `sensitive-words.txt` |
| 词汇 | .json5 .md .txt | `vocabulary` `vocab` | `my_vocabulary.md` |
| 正则规则 | 仅 .json5 | `regex-patterns` `regex` | `regex-patterns.json5` |

注意：
1. 正则规则不支持 `.md` / `.txt`。
2. 其它任意命名（如 `people.md`）即使结构正确也不会被解析。
3. 推荐：**主集合使用** `character-gallery.json5`；章节/专题补充使用 `xxx_roles.md`；批量外部迁移先放 `xxx_vocabulary.txt` / `xxx_sensitive.txt`。
4. 不要在文件名里只写单个极短词（例如 `role.md` + 无字段）而期望高性能批量导入，尽量保持清晰前缀。

开发者提示：判定是否解析的关键字列表在源码 `src/utils/utils.ts` 中常量 `roleKeywords`：
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

---
## 📄 JSON5 数据格式规范

所有库文件（除正则配置外）均是“数组形式”的条目集合：
```json5
[
  {
    name: '艾丽西亚',                // 角色/词条主名称（必填）
    type: '主角',                    // 类型：决定默认色，可自定义扩展
    aliases: ['小艾','旅者'],        // 别名数组（可选）
    description: '北境旅者...',      // Markdown 片段 / 纯文本
    color: '#ff1e40',               // 优先级高于类型默认色
    affiliation: '北境雪原',         // 从属/阵营
    priority: 10,                   // 着色/匹配优先级（数值小优先）
    appearance: '高挑，绿瞳',        // 任意扩展字段都保留
  }
]
```

### 敏感词 / 词汇
```json5
[{ name: '禁忌术', type: '敏感词', color: '#ff0000', description: '需要替换' }]
[{ name: '魔能', type: '词汇', description: '世界观能量单位' }]
```
TXT 快速格式（示例 `sensitive-words.txt`）：
```
禁忌术
违禁品
审查词
```
TXT 快速格式（示例 `vocabulary.txt`）：
```
魔能
源质结晶
反应堆
```

### 正则规则 (regex-patterns.json5)
```json5
[
  { name: '书名号内容', type: '正则表达式', regex: '《[^》]+》', regexFlags: 'g', color: '#0088ff', priority: 50 },
  { name: '单引号内容', type: '正则表达式', regex: "'[^']+'", regexFlags: 'g', color: '#ffaa00' }
]
```
字段说明：
| 字段 | 必填 | 说明 |
|------|------|------|
| name | 是 | 规则名称/显示名 |
| type | 是 | 固定可用 '正则表达式' 或自定义分类 |
| regex | 是 | JS 正则表达式主体（不含 `/` 分隔符）|
| regexFlags | 否 | g / i / m / u / s 等组合 |
| color | 否 | 覆盖类型颜色 |
| priority | 否 | 匹配/着色优先（数值小优先）|

---
## 🔍 补全 / 着色 / 跳转行为

| 资源 | 触发方式 | Hover | 跳转定义 | 备注 |
|------|----------|-------|----------|------|
| 角色 & 别名 | 文本输入前缀 | 展示类型/从属/描述/颜色 | 跳至源 JSON5 / Markdown | 别名合并补全池 |
| 敏感词 | 完整词匹配 | 警示 + 描述 | 定位 JSON5 / Markdown | 支持高亮诊断集合 |
| 词汇 | 前缀 | 描述 | 源位置 | 与角色独立，不着色冲突 |
| 正则 | 模式匹配 | 规则说明 | 规则定义 | 高亮任意结构文本 |

优先级：显式 priority < 颜色与类型默认；正则命中按 priority 升序应用，防止覆盖。

---
## 📊 写作资源视图（Word Count Explorer）要点
* 支持 `.wcignore` + `.gitignore` 忽略（可配置是否尊重 wcignore）。
* 手动排序：稀疏索引 (默认步长 10) + 自动重排 + 前导零格式化。
* 自定义显示：raw / wan / k / qian。
* 上下插入文件/文件夹、批量生成索引、清除索引、跨目录拖动移动。

相关配置前缀：`AndreaNovelHelper.wordCount.*`

---
## ⚙️ 关键配置补充
| 键 | 说明 |
|----|------|
| outline.lazyMode | 未打开大纲编辑器不生成大纲文件 |
| fileTracker.writeLegacySnapshot | 控制是否写出旧版 `file-tracking.json` |
| timeStats.persistReadOnlySessions | 是否持久化纯阅读会话 |
| wordCount.order.* | 手动排序显示/索引步长/补零/自动重排 |
| wordCount.displayFormat | 字数格式转换 |
| wordCount.debug | 启用字数统计调试日志（编码探测/忽略命中/零结果原因） |

---
## 🛠️ 示例工作流
1. 新建 `novel-helper/main/` 目录，创建 `character-gallery.json5`；若已有外部名单，先贴入 `character-gallery.txt`。
2. 若使用 TXT：启动后补全 / 解析可见基础高亮；逐步转 Markdown 或补全 JSON5 字段。
3. 创建 `sensitive-words.json5`、`vocabulary.json5` 或先丢入对应 `.txt` 进行批量迁移。
4. 根据需要添加 `regex-patterns.json5` 定义高亮规则。
5. 使用 Word Count Explorer 组织章节：索引/排序/重排/拖拽。
6. 持续补齐描述、别名、颜色、扩展字段（Markdown 或 JSON5）。
7. 查看写作统计 / 时间追踪，优化节奏。

---
## 🧪 性能与文件追踪 (0.0.20)
详见 CHANGELOG：分片文件追踪 DB、惰性大纲、只读会话抑制、脏分片原因日志、缓存与异步刷新。

---
## 📝 已知问题
（节选，更多见 Issue / CHANGELOG）
* 极大库首轮扫描可能轻微延迟。
* 分词偶尔误判（考虑更换分词引擎）。
* Markdown 角色解析依赖标题结构，非规范标题可能被视为普通文本。
* 分词尚不理想 ~~某些词 比如说“睡觉” 觉 可能被发现为角色~~ 单字角色名已经优化
* ~~角色名字发生包含时，可能会导致着色不准确~~
* 没有 UUID 支持，需要手动保证角色名字不重合
* 目前没有关系类型支持，后期可能参考数据库的关系模式添加
* 没有自定义角色类型支持，后期可能添加
* ~~实验性字数统计功能可能会有性能问题，尤其在大项目中（后续考虑加入缓存机制）~~

---
## 🧩 Release Notes
(早期版本节选，完整参见 CHANGELOG)

### 0.0.21
角色层级树（按从属 → 类型 → 角色，特殊类型置底分组）、“当前文章角色” 双视图（侧边栏 & Explorer）、展开状态持久化、共享文档角色缓存（避免重复扫描）、重复 TreeItem ID 报错修复。

### 0.0.20
Word Count Explorer 大幅升级、包管理器资源操作完善、性能分片与懒加载、统计优化。

---
## 🤝 反馈
欢迎提交 Issue / PR 改进字段支持、解析策略、性能与新场景。

---
**Enjoy Writing!** ✨

## 演示 (部分沿用旧示例)

### 旧示例

- **创建角色**
  ![创建角色演示](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/%E5%88%9B%E5%BB%BA%E8%A7%92%E8%89%B2.gif)

- **为角色创建颜色**
  ![创建颜色](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/为角色创建颜色.gif)

- **中文分词**
  ![中文分词](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/中文分词.gif)

- **自动补全**
  ![自动补全](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/自动补全.gif)

- **转跳定义**
  ![转跳定义](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/转跳定义.gif)

- **字数统计**
  ![字数统计](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/字数统计.gif)

- **敏感词识别**
  ![敏感词识别](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/敏感词识别.gif)

- **实验性大纲**
  ![实验性大纲](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/实验性大纲.gif)

## 发布说明 / Release Notes

### 0.0.1

初始版本：实现基础的 JSON5 角色库加载、分词补全和着色功能
添加别名支持，补全与着色同时涵盖主名称与所有别名
优化补全结果排序：前缀匹配优先
引入 HoverProvider，鼠标悬停显示简介、类型、从属与颜色预览
实现 Go To Definition（Ctrl/Cmd+Click / F12）跳转至角色定义
新增右键命令 “Create Role from Selection”，支持交互式创建新角色
增加文件系统监视器，角色库文件保存时自动刷新补全与着色
使用 `Intl.Segmenter` 实现中文分词，支持多种语言

### 0.0.2

支持部分 i18n，添加中文语言包
增加角色类型支持，提供默认颜色映射

### 0.0.4

修复了不能动态提供建议的问题

### 0.0.5

增加 CSpell 字典生成，支持角色名拼写检查

### 0.0.6

重构装饰更新逻辑，独立 `updateDecorations` 函数
优化工具函数，添加区间重叠检查和正则转义功能
现在能避免 hoverRanges 区间重复的问题
修复了角色信息窗口不能显示颜色的 bug

### 0.0.8

新增实验性字数统计功能，提供对工作区内所有支持文件的字数统计

### 0.0.9
修复了非资源管理器面板打开文件强制重定向到资源管理器的问题
新增敏感词和词汇功能，更新相关配置和命令
更改了 `rolesFile` 的默认路径为 `novel-helper/character-gallery.json5`，以便更好地适应项目结构

### 以后的版本见ChangeLog
## 问题

分词尚不理想 ~~某些词 比如说“睡觉” 觉 可能被发现为角色~~ 单字角色名已经优化
角色名字发生包含时，可能会导致着色不准确
没有 UUID 支持，需要手动保证角色名字不重合
目前没有关系类型支持，后期可能参考数据库的关系模式添加
没有自定义角色类型支持，后期可能添加
实验性字数统计功能可能会有性能问题，尤其在大项目中（后续考虑加入缓存机制）

**Enjoy / Happy Writing!**
# andrea-novel-helper README

andrea-novel-helper 是一个面向 Markdown 写作的 VS Code 扩展，帮助你：

- 在项目根目录维护一个 JSON5 格式的角色库
- 支持中文分词后基于主名称与别名的智能补全
- 在编辑器中为角色名及别名自动着色
- 鼠标悬停时显示角色的简介、类型、从属与颜色信息
- Ctrl/Cmd+Click 或 F12 跳转到角色库定义
- 右键选中文本快速创建新角色并追加到角色库
- 实时监控角色库文件改动并自动刷新，或通过命令手动刷新

andrea-novel-helper is a VS Code extension for Markdown writing that lets you:

- Maintain a JSON5-based character library at your workspace root
- Provide intelligent completions for names and aliases using Chinese word segmentation
- Automatically colorize character names and aliases in the editor
- Show hover tooltips with description, type, affiliation, and color
- Go to definition (Ctrl/Cmd+Click or F12) to jump to the character’s JSON5 entry
- Right-click selection to quickly create a new character in the library
- Auto-refresh on library changes or manually trigger a refresh command

---

## 特性 / Features

- **多名称补全**：输入角色名或任意别名前缀，即可在 Markdown 中补全至对应名称
- **中文分词**：利用 `Intl.Segmenter` 精准提取中文“词”级前缀，无需空格
- **编辑器着色**：根据角色类型或自定义颜色，为主名称和别名统一着色
- **Hover 提示**：详情面板展示角色简介、类型、从属标签和颜色预览
- **转到定义**：在文档中按 F12 或 Ctrl/Cmd+Click 跳到角色库文件内的定义行
- **快速创建**：选中文本右键，填写属性后自动追加 JSON5 格式角色条目
- **自动/手动刷新**：`character-gallery.json5` 保存时即时刷新，或在命令面板执行 “Refresh Role Library”
- **字数统计 / 写作资源视图**：可替代原生 Explorer 的写作专用视图：
  - 目录/文件字数聚合 + 忽略规则 (`.gitignore` / `.wcignore`)
  - 手动/自动排序模式（稀疏索引，支持步长与补零宽度配置）
  - 同目录拖拽重排 / 跨目录拖拽物理移动 / 复制剪切粘贴
  - 可选在标签前显示序号 + 自定义显示格式 (raw / wan / k / qian)
  - 批量生成 / 清除索引命令，适合长篇章节管理
  - **性能提升**：内部加入结果缓存与异步增量刷新，避免全量同步扫描造成卡顿
- **敏感词识别**：自动检测并高亮敏感词，支持自定义敏感词列表
- **词汇库**：提供词汇库支持，可以定义词汇并高亮显示
- **大纲**：提供一个大纲功能，支持在工作区内创建和管理大纲文件（自动创建）
- **包管理器（设定集管理器）**：提供一个包管理器视图，支持创建、重命名和删除设定集（包），以及管理每个包内的资源文件
- **快速格式化工具**：新增快速格式化工具，支持在Markdown文件中快速应用常用格式
- **写作时间追踪（实验性）**：新增写作时间追踪功能，提供实时的写作速度统计（CPM）
- **正则表达式着色**：支持使用正则表达式为文本着色，提供更灵活的样式应用（比如说着色各种标点符号框起来的字符）
- **写作统计仪表板（实验性）**：新增写作统计仪表板，今日和历史的写作时间、平均速度和峰值速度统计,活跃度统计

---

### 0.0.20 性能与文件追踪改进
> 降低无意义磁盘写入与启动时间的针对性优化：
- **分片文件追踪数据库**：单文件追踪改为 `.anh-fsdb` 分片 + `index.json`，仅脏分片增量写入。
- **惰性索引加载**：启动仅加载索引（路径+目录标记），按需访问分片。
- **大纲惰性模式** (`AndreaNovelHelper.outline.lazyMode`)：未打开大纲视图不生成/刷新大纲文件。
- **写作统计只读会话抑制** (`AndreaNovelHelper.timeStats.persistReadOnlySessions=false`)：纯浏览不落盘，避免“打开即产生脏分片”。
- **脏分片原因日志**：输出 markShardDirty 具体原因（新增/内容变更/重命名/统计更新等）。
- **Legacy 快照开关** (`AndreaNovelHelper.fileTracker.writeLegacySnapshot`)：可选继续写出旧版聚合快照用于外部工具/调试。

---

## 要求 / Requirements

- Visual Studio Code **1.50.0** 或更高版本
- Node.js 环境（用于本地开发编译）
- 扩展依赖 `json5`（已在 `package.json` 中声明，无需手动安装）

---

## 扩展设置 / Extension Settings

此扩展在 `contributes.configuration` 中添加了以下设置：

| 设置键                                 | 默认值                     | 描述                                      |
| -------------------------------------- | -------------------------- | ----------------------------------------- |
| `AndreaNovelHelper.rolesFile`          | `roles.json`               | 相对于工作区根目录的角色库 JSON5 文件路径 |
| `AndreaNovelHelper.minChars`           | `1`                        | 触发补全前最少输入的字符数                |
| `AndreaNovelHelper.defaultColor`       | `#CCCCCC`                  | 未指定自定义颜色时的默认文字颜色          |
| `AndreaNovelHelper.supportedFileTypes` | `["markdown","plaintext"]` | 指定在什么格式的文件启用                  |
| `AndreaNovelHelper.outline.lazyMode` | `true` | 大纲惰性模式：未打开大纲编辑器不生成/刷新大纲文件 |
| `AndreaNovelHelper.fileTracker.writeLegacySnapshot` | `false` | 是否写出旧版聚合快照 `file-tracking.json` |
| `AndreaNovelHelper.timeStats.persistReadOnlySessions` | `false` | 是否持久化纯阅读会话（无字符增删仍写入） |

---

## 已知问题 / Known Issues

- 如果角色库非常庞大，首次扫描和着色可能略有延迟
- JSON5 格式不支持复杂嵌套，目前只解析顶层数组
- 无自动检测重复名称或别名，需要手动维护库的一致性
- JS 提供的分词器可能不够准确，某些词如“睡觉”可能被错误识别为角色名，后期考虑更换后端来解决，如使用 `jieba` 等中文分词库。
- 大纲窗体在Code刚启动的时候不能正常显示，需要手动刷新一次。

---

## 发布说明 / Release Notes

### 0.0.1

- 初始版本：实现基础的 JSON5 角色库加载、分词补全和着色功能
- 添加别名支持，补全与着色同时涵盖主名称与所有别名
- 优化补全结果排序：前缀匹配优先
- 引入 HoverProvider，鼠标悬停显示简介、类型、从属与颜色预览
- 实现 Go To Definition（Ctrl/Cmd+Click / F12）跳转至角色定义
- 新增右键命令 “Create Role from Selection”，支持交互式创建新角色
- 增加文件系统监视器，角色库文件保存时自动刷新补全与着色
- 使用 `Intl.Segmenter` 实现中文分词，支持多种语言

### 0.0.2

- 支持部分 i18n，添加中文语言包
- 增加角色类型支持，提供默认颜色映射

### 0.0.4

- 修复了不能动态提供建议的问题

### 0.0.5

- 增加 CSpell 字典生成，支持角色名拼写检查

### 0.0.6

- 重构装饰更新逻辑，独立 `updateDecorations` 函数
- 优化工具函数，添加区间重叠检查和正则转义功能
- 现在能避免 hoverRanges 区间重复的问题
- 修复了角色信息窗口不能显示颜色的 bug

### 0.0.8

- 新增实验性字数统计功能，提供对工作区内所有支持文件的字数统计

### 0.0.9
- 修复了非资源管理器面板打开文件强制重定向到资源管理器的问题
- 新增敏感词和词汇功能，更新相关配置和命令
- 更改了 `rolesFile` 的默认路径为 `novel-helper/character-gallery.json5`，以便更好地适应项目结构

### 以后的版本见ChangeLog


---

## 遵循扩展指南 / Following extension guidelines

在开发过程中，我们参考了 VS Code 官方的最佳实践，确保扩展的激活时机、性能和可用性符合规范。

- [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

---

## 使用 Markdown 撰写文档 / Working with Markdown

在 VS Code 中编写本 README 时，你可以：

- 窗口拆分：`Ctrl+\`（Windows/Linux），`Cmd+\`（macOS）
- 切换预览：`Shift+Ctrl+V`（Windows/Linux），`Shift+Cmd+V`（macOS）
- 快捷片段：输入 `#` 然后 `Ctrl+Space` 查看可用 Markdown 片段

---

## 更多信息 / For more information

- [Visual Studio Code's Markdown Support](https://code.visualstudio.com/docs/languages/markdown)
- [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
