# Andrea Novel Helper (小说助手)

> 说明：预发布版本实际上是跟随 VS Code 自动启动的版本；启用 VS Code 的预发布渠道后，本扩展会随 Code 自动加载，而不是需要触发才加载，但是如果您使用了那个版本,Code的插件禁用功能将不生效，您需要使用ANH自己的禁用功能。

> **最新版本：0.4.45 (2025-12-04)**
> 🔗 **最新更新：新增了实时Typst模板导出预览功能**  
> 📝 近期已大幅重构异步加载与性能管线，若从老版本升级，建议阅读"近期版本速览"。   
> 独立组件（生成式AI组件） Anh Chat(小说助手 聊天组件)已经发布! [GitHub] (https://github.com/AndreaFrederica/Roo-Code-Chat) [![VS Code Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/andreafrederica.anh-cline?label=VS%20Marketplace&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=andreafrederica.anh-cline) [![Open VSX Version](https://img.shields.io/open-vsx/v/andreafrederica/anh-cline?label=Open%20VSX)](https://open-vsx.org/extension/andreafrederica/anh-cline)
> 如果您需要生成式AI相关功能（AI生成设定集或者润色，或者与AI聊天（聊天功能尤其强化）），请安装 Anh Chat 组件。

[![License: MPL-2.0](https://img.shields.io/badge/License-MPL%202.0-brightgreen.svg)](https://www.mozilla.org/MPL/2.0/)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Vue](https://img.shields.io/badge/Vue-42b883?logo=vuedotjs&logoColor=white)
![Quasar](https://img.shields.io/badge/Quasar-1976D2?logo=quasar&logoColor=white)

[![VS Code Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/andreafrederica.andrea-novel-helper?label=VS%20Marketplace&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=andreafrederica.andrea-novel-helper)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/andreafrederica.andrea-novel-helper)](https://marketplace.visualstudio.com/items?itemName=andreafrederica.andrea-novel-helper)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/andreafrederica.andrea-novel-helper)](https://marketplace.visualstudio.com/items?itemName=andreafrederica.andrea-novel-helper)
[![Rating](https://img.shields.io/visual-studio-marketplace/stars/andreafrederica.andrea-novel-helper)](https://marketplace.visualstudio.com/items?itemName=andreafrederica.andrea-novel-helper)

[![Open VSX Version](https://img.shields.io/open-vsx/v/andreafrederica/andrea-novel-helper?label=Open%20VSX)](https://open-vsx.org/extension/andreafrederica/andrea-novel-helper)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/andreafrederica/andrea-novel-helper?label=Open%20VSX%20Downloads)](https://open-vsx.org/extension/andreafrederica/andrea-novel-helper)

**官网**：<https://anh.sirrus.cc/>
**文档和博客**：<https://blog.sirrus.cc>
**爱发电（捐赠项目）**：<https://afdian.com/a/andreaf>

## 📖 简介

一个围绕"设定集 / 资料集"组织写作资产的 VS Code 小说写作增强扩展。核心理念：把你的世界观、角色、敏感词、专业词汇、正则高亮规则和章节文件放进一个"包"（Package），由"包管理器"统一可视化管理与快速生成。

## 💬 反馈和交流

- [GitHub Issues](https://github.com/AndreaFrederica/andrea-novel-helper/issues)
- [QQ群【小说助手用户反馈和交流】](https://qm.qq.com/q/SG5A3XLoSQ)
- [Discord](https://discord.gg/YeVAXeKX)

### 📥 Issue标签说明

| 标签 | 说明 |
|------|------|
|**future request**|新功能请求|
|**bug**|这是一个已经确认的bug|
|**need test**|bug或许修复 待测试|
|**wait release**|功能完成 等待发布|
|**qq/bilibili/rednote**|反馈收集的社交媒体来源|


## 🚀 核心功能概览

### ✒️ 核心写作体验

#### 智能统计与分析
- **实时字数统计**：支持 CJK 字符与英文单词统计，提供多种统计标准（含标点/不含标点/词计）。
- **写作速度监测**：实时显示 CPM (每分钟字符数) 或 CPH (每小时字符数)。
- **统计仪表板**：可视化展示今日与历史写作时长、字数、平均速度及活跃度趋势。
- **状态栏自定义**：支持详细、半精简、精简三种显示模式。

#### 名字生成器
- **多文化名字生成**：
  - **中文姓名**：支持现代、经典、奇幻、历史等多种风格的中文姓名生成。
  - **英文名字**：基于 @faker-js/faker 库，提供真实的英文姓名组合。
  - **日语名字**：包含常见日本姓氏和名字的组合生成。
  - **奇幻风格**：专为奇幻小说设计的音节组合名字生成器。
- **智能过滤选项**：
  - 按性别筛选（男/女/中性/任意）
  - 按风格筛选（现代/经典/奇幻/科幻/历史）
  - 按文化背景筛选
  - 可选择是否包含姓氏
- **便捷使用方式**：
  - 命令面板快捷访问（Ctrl+Shift+P → "生成随机名字"）
  - 快速生成功能（默认生成5个名字）
  - 批量生成（支持1-50个名字）
  - 多种输出方式（复制到剪贴板/插入到文档/查看详情）
- **统计功能**：查看名字生成的使用统计和文化分布。

#### 排版与辅助
- **智能格式化**：
  - **智慧回车**：智能处理段落换行。
  - **智慧括号**：成对符号自动补全与跳出。
  - **自动空行**：自动补充段间空行。
  - **版式设置**：自定义段首/段尾标点规则。
- **错别字和语法检测**：内置错别字和语法错误统计与识别功能。
- **LLM 翻译**：基于大模型的快速翻译工具，支持替换选区或复制结果。

#### 快捷设置面板
- **一站式管理**：通过命令 `andrea.quickSettings` 或者状态栏按钮 唤起聚合菜单，无需深入 VS Code 设置即可调整常用写作选项。
- **功能亮点**：
  - **排版与外观**：快速切换自动换行、首行缩进、段间空行、小地图及滚轮缩放。
  - **字体管理**：提供图形化的编辑器字体家族管理工具。
  - **智能辅助**：一键启停智慧回车、智慧括号、智能分组锁。
  - **统计配置**：调整字数统计单位、状态栏模式及里程碑提醒。
  - **规则管理**：图形化管理 `.wcignore` 忽略规则。

#### 阅读与预览
- **侧边栏预览**：支持 Markdown 和 TXT 格式的实时预览。
- **个性化阅读**：支持自定义预览界面的主题与字体设置。
- **大纲视图**：支持懒加载大纲生成，提供双重大纲辅助写作。
- **Typst模板渲染预览**：支持Typst格式的高质量排版预览。(为您的小说创作提供专业的排版体验) **需要配合Tinymist Typst插件使用**。

#### 批注系统
- **独立侧边栏**：专用的批注管理视图，支持归总、跳转与快速处理。
- **伏笔管理**：便于记录和追踪剧情伏笔。

### 🌍 设定集与世界观构建 (包管理器)

#### 多格式资源管理
- **统一管理**：通过"包"（Package）概念统一管理角色、敏感词、词汇和正则规则。
- **格式兼容**：
  - **JSON5 (推荐)**：支持复杂结构与所有字段，提供**可视化角色编辑器**，无需手写代码即可管理（同时也支持手动编辑）。
  - **Markdown (推荐)**：支持复杂角色，适合文档化编写设定。
  - **TXT**：仅支持角色名称（一行一个），用于快速批量导入外部名单。

#### 统一对象模型 (Unified Object Model)
本插件采用统一的**角色对象 (Role Object)** 模型来管理所有设定元素。无论是人物、敏感词、专有词汇还是正则规则，本质上都是具有不同 `type` 属性的角色对象。

- **通用特性**：
  - **全能别名支持**：所有对象均支持定义别名 (Aliases)，在补全、高亮、引用查找时会自动识别主名与所有别名，并支持统一替换。
  - **代码级导航体验**：
    - **跳转到定义 (Go to Definition)**：像查看代码定义一样，一键跳转到角色/词汇的源文件定义处。
    - **查看引用 (Find All References)**：查找该角色在所有章节中的出现位置，支持列表跳转。
  - **智能补全与高亮**：所有类型的对象均支持自动补全与文中高亮显示。
  - **可视化编辑**：提供统一的图形化卡片编辑器。
  - **引用分析**：支持引用索引、热力图与气泡图，分析对象在文档中的分布。

- **类型特化支持**：
  - **角色 (Type: 主角/配角等)**：
    - 支持别名、颜色、从属关系及任意自定义字段。
    - 支持 UUID 唯一标识。
  - **敏感词 (Type: 敏感词)**：
    - 支持 `fixes` 字段提供替换建议。
    - 在文中检测到时显示警告与修复选项。
  - **词汇 (Type: 词汇)**：
    - 用于管理世界观专有名词、术语表。
    - 支持高亮与解释说明。
  - **正则规则 (Type: 正则表达式)**：
    - 支持 `regex` 和 `regexFlags` 字段。
    - 用于自定义基于正则表达式的文本高亮规则。

#### 实时辅助视图
- **当前文章角色视图**：
  - 实时显示当前编辑器文档中出现的角色、词汇等对象。
  - **自定义分类**：支持按类型、阵营等自定义分类分组显示，清晰把握当前章节涉及的人物关系。
  - 双入口：支持在侧边栏或资源管理器中显示。

#### 关系与时间线
- **角色关系图**：
  - 可视化拖拽编辑。
  - 支持节点筛选、过滤与样式自定义。
  - 支持 `.rjson5` 关系文件格式。
- **时间线编辑器**：
  - 支持嵌套节点（父子事件）。
  - 精确时间控制（ISO 8601 标准）。
  - 拖拽调整布局。

### 📂 项目与文件管理

#### 写作资源管理器
- **专注视图**：替代原生资源管理器，仅显示写作相关文件。
- **灵活排序**：支持手动拖拽排序（生成稀疏索引）或自动排序。
- **目录聚合**：自动聚合计算目录下的总字数。
- **文件追踪**：基于分片数据库的高性能文件追踪系统。

#### 云端同步 (WebDAV) WIP
- **多账户支持**：配置多个 WebDAV 账户。
- **实时同步**：状态栏实时显示同步进度与状态。
- **可视化管理**：独立的 WebDAV 文件树视图与同步控制面板。
- **冲突处理**：智能处理本地与云端文件冲突。

#### 项目配置
- **初始化向导**：一键生成项目结构、配置文件及忽略规则（`.gitignore`, `.wcignore`）。

### 🤖 自动化与扩展

#### 用户脚本与 MCP 运行时
- **用户脚本系统**：内置脚本运行器，允许用户编写自定义脚本扩展功能。
- **MCP (Model Context Protocol) 支持**：
  - 集成 MCP 运行时，可调用外部工具与服务。
  - **自动发布场景**：结合浏览器自动化工具（如 Puppeteer/Playwright via MCP），可编写脚本实现章节**自动发布到小说网站**。
  - 侧边栏一键运行管理。

#### Typst 排版导出
- **实时预览**：支持实时Typst模板导出预览，编辑时即时查看排版效果。
- **高质量输出**：基于 Typst 引擎导出 PDF、图片（PNG/SVG）。
- **模板系统**：内置多种模板（如论坛体），支持自定义模板开发。
- **智能转换**：Markdown 语法自动转换为 Typst 格式，支持图片路径自动处理。

#### 其他导出
- **纯文本导出**：一键导出章节或全文为 TXT 格式。

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
    pattern: '\\d{4}年\\d{1,2}月\\d{1,2}日',
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

```
核心信念：永远不要放弃希望
```

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

## 🔍 智能功能说明

### 补全 / 着色 / 跳转行为

| 资源 | 触发方式 | Hover | 跳转定义 | 备注 |
|------|----------|-------|----------|------|
| 角色 & 别名 | 文本输入前缀 | 展示类型/从属/描述/颜色 | 跳至源 JSON5 / Markdown | 别名合并补全池 |
| 敏感词 | 完整词匹配 | 警示 + 描述 | 定位 JSON5 / Markdown | 支持高亮诊断集合 |
| 词汇 | 前缀 | 描述 | 源位置 | 与角色独立，不着色冲突 |
| 正则 | 模式匹配 | 规则说明 | 规则定义 | 高亮任意结构文本 |

## ⚙️ 重要配置

| 配置项 | 说明 |
|--------|------|
| `AndreaNovelHelper.outline.lazyMode` | 未打开大纲编辑器不生成大纲文件 |
| `AndreaNovelHelper.fileTracker.writeLegacySnapshot` | 控制是否写出旧版 `file-tracking.json` |
| `AndreaNovelHelper.timeStats.persistReadOnlySessions` | 是否持久化纯阅读会话 |
| `AndreaNovelHelper.wordCount.order.*` | 手动排序显示/索引步长/补零/自动重排 |
| `AndreaNovelHelper.wordCount.displayFormat` | 字数格式转换 |
| `AndreaNovelHelper.wordCount.debug` | 启用字数统计调试日志 |
| `AndreaNovelHelper.docRoles.inheritExpandedFromPrevious` | 控制是否启用跨文档展开状态继承 |
| `AndreaNovelHelper.externalFolder.ignoredDirectories` | 外部角色文件夹扫描时忽略的目录列表，默认排除 `.git`、`.vscode`、`node_modules` 等 |

## 🛠️ 快速开始

### 🚀 项目初始化向导（推荐）

**自动启动**：当您打开一个空的工作区时，初始化向导会自动弹出，引导您快速配置项目。

**手动启动**：
1. **启动初始化向导**：打开命令面板（Ctrl+Shift+P），搜索并执行 "Andrea Novel Helper: Initialize Project"
2. **配置项目信息**：按向导提示填写项目名称、描述、作者等基本信息
3. **自动生成配置**：向导会自动创建 `anhproject.md` 项目配置文件和基础目录结构
4. **开始写作**：配置完成后即可开始使用所有功能进行创作

> 💡 **提示**：向导会在检测到空工作区时自动弹出，为新用户提供最佳的入门体验。

### 📝 项目配置文件示例（anhproject.md）

```markdown
# testbook

## 项目名称
testbook-一本测试小说

## 项目描述
这是一个小说项目

## 作者
AndreaFrederica

## 项目UUID
145dd1ab-a4b6-40d7-b4c9-461fbf04fac8

## 封面


## 项目简介
项目简介1111111111111111111122222

## 标签
小说, 创作

## 创建时间
2025-09-13T17:41:55.107Z

## 更新时间
2025-09-13T17:41:55.118Z
```

### 🔧 手动配置（高级用户）

1. **创建设定包**：新建 `novel-helper/main/` 目录，创建 `character-gallery.json5`
2. **导入现有数据**：若已有外部名单，先贴入 `character-gallery.txt`
3. **逐步完善**：启动后补全 / 解析可见基础高亮；逐步转 Markdown 或补全 JSON5 字段
4. **添加其他资源**：创建 `sensitive-words.json5`、`vocabulary.json5` 或先丢入对应 `.txt` 进行批量迁移
5. **自定义高亮**：根据需要添加 `regex-patterns.json5` 定义高亮规则
6. **组织章节**：使用 Word Count Explorer 组织章节：索引/排序/重排/拖拽
7. **持续优化**：持续补齐描述、别名、颜色、扩展字段（Markdown 或 JSON5）
8. **查看统计**：查看写作统计 / 时间追踪，优化节奏

## 🏗️ 本地构建指南（兼容老系统）

- 依赖：Node 20+、npm、VSCE、Pixi
- 安装 VSCE：`npm i -g @vscode/vsce`
- 安装 Pixi：参考 https://prefix.dev/pixi 安装后在项目根运行

### 构建 WebView 与扩展
- 一次性构建：`pixi run build_all`
- 仅 WebView：`pixi run build_web`
- 仅扩展：`pixi run build`

### 打包 VSIX（本机平台）
- 稳定版：`pixi run local_std`
- 预发布：`pixi run local_exp`
- 两者顺序执行：`pixi run local_both`

说明：
- 默认 Electron 版本为 `30.0.9`，可在命令前设置环境变量 `ELECTRON_VERSION` 覆盖
- 本地脚本会自动重建 `@vscode/sqlite3` 原生模块并在打包时调整 `onStartupFinished`
- 打包输出位于 `dist/anh-std-<platform-arch>.vsix` 与 `dist/anh-exp-<platform-arch>.vsix`

### Linux 老系统兼容建议
- 若遇到 glibc 过高导致不兼容，建议在旧版容器中构建（如 Debian buster）：
  - `docker run --rm -v "$PWD":/work -w /work debian:buster bash -lc "apt-get update && apt-get install -y git curl python3 make g++ && npm ci && pixi run local_both"`
- 或使用较新的 VS Code 版本对应的 Electron 版本设置 `ELECTRON_VERSION`

## 🌐 WebDAV 云端同步使用指南

### 配置 WebDAV 账户

1. 打开命令面板（Ctrl+Shift+P）
2. 搜索并执行 "Andrea Novel Helper: Configure WebDAV"
3. 输入 WebDAV 服务器信息：
   - 服务器地址（如：https://your-webdav-server.com/dav/）
   - 用户名和密码
   - 账户名称（用于区分多个账户）

### 开始同步

1. 配置完成后，在状态栏会显示 WebDAV 同步状态
2. 点击状态栏图标可以手动触发同步
3. 支持自动同步和手动同步两种模式

### 同步规则

- 默认同步整个工作区
- 自动排除 `.git` 和 `.anh-fsdb` 文件夹
- 支持自定义排除规则
- 冲突时优先保留本地文件

### WebDAV 服务器推荐

- **坚果云**：国内用户推荐，稳定可靠
- **Nextcloud**：开源自建方案
- **ownCloud**：企业级解决方案
- **Box**、**Dropbox** 等商业云存储服务

## 📋 已知问题

- 极大库首轮扫描可能轻微延迟
- 分词偶尔误判（考虑更换分词引擎）
- Markdown 角色解析依赖标题结构，非规范标题可能被视为普通文本
- 没有 UUID 支持，需要手动保证角色名字不重合
- 目前没有关系类型支持，后期可能参考数据库的关系模式添加

## 🤝 贡献与反馈

欢迎提交 Issue / PR 改进字段支持、解析策略、性能与新场景。

### 📢 社区讨论

- **GitHub Discussions**: [https://github.com/AndreaFrederica/andrea-novel-helper/discussions](https://github.com/AndreaFrederica/andrea-novel-helper/discussions)
  - 功能建议和想法交流
  - 使用经验分享
  - 问题求助和解答
  - 社区互动和反馈

### 🐛 问题报告

- **GitHub Issues**: 用于报告 Bug 和提交功能请求
- **Pull Requests**: 欢迎直接提交代码改进

## 📄 许可证

本项目采用 [MPL-2.0](https://www.mozilla.org/MPL/2.0/) 许可证。

## 📺 演示 (部分沿用旧示例)

### 旧示例

以下演示来自 0.0.x 版本，展示了扩展的核心功能：

- **创建角色**
  ![创建角色](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/%E5%88%9B%E5%BB%BA%E8%A7%92%E8%89%B2.gif)

- **为角色创建颜色**
  ![为角色创建颜色](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/为角色创建颜色.gif)

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

## 🙏 致谢

- 感谢所有贡献者和 Beta 测试用户
- 特别感谢 VS Code 扩展开发社区
- 灵感来源于全世界创作者的需求

---

**Enjoy Writing!** ✨
