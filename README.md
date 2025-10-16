# Andrea Novel Helper (小说助手)

> **最新版本：0.4.10 (2025-10-07)**  
> 🔗 **重大更新：支持了角色引用热力图和气泡图**  
> 📝 近期已大幅重构异步加载与性能管线，若从老版本升级，建议阅读"近期版本速览"。   
> 独立组件 Anh Chat(小说助手 聊天组件)已经发布! [GitHub](https://github.com/AndreaFrederica/Roo-Code-Chat) [![VS Code Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/andreafrederica.anh-cline?label=VS%20Marketplace&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=andreafrederica.anh-cline) [![Open VSX Version](https://img.shields.io/open-vsx/v/andreafrederica/anh-cline?label=Open%20VSX)](https://open-vsx.org/extension/andreafrederica/anh-cline)

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

## 📖 简介

一个围绕"设定集 / 资料集"组织写作资产的 VS Code 小说写作增强扩展。核心理念：把你的世界观、角色、敏感词、专业词汇、正则高亮规则和章节文件放进一个"包"（Package），由"包管理器"统一可视化管理与快速生成。

## 💬 反馈和交流

- [GitHub Issues](https://github.com/AndreaFrederica/andrea-novel-helper/issues)
- [QQ群【小说助手用户反馈和交流】](https://qm.qq.com/q/SG5A3XLoSQ)
- [Discord](https://discord.gg/YeVAXeKX)

## 🔔 近期版本速览

### 🌟 0.4.3（2025-09-17）- 角色关系图编辑器与文件格式扩展

#### ✨ 新增功能
- **🔗 角色关系图编辑器**：全新的可视化角色关系管理系统，支持拖拽编辑、右键菜单操作、节点过滤等功能
- **📄 文件格式扩展**：新增 `.rjson5` 和 `.ojson5` 格式支持，完善文件管理生态
- **🎯 角色管理增强**：新增角色UUID系统和跳转到定义功能

#### 🖋️ 系统优化
- **重构文件变更追踪系统**：提升性能和稳定性
- **智能窗体锁定**：改善用户交互体验
- **AutoGit自动拉取**：保持代码同步
- **状态栏优化**：完善状态指示器管理

### 🌟 0.4.2（2025-09-15）- 兼容性更新

#### 🖋️ 更改
- **降低 VS Code 引擎要求至 ^1.100.0**：支持 Trae 安装与运行

### 🌟 0.4.1（2025-01-15）- 独立侧边栏与修复更新

#### 🐛 修复问题
- **修复WebDAV面板diff列表混入目录问题**：在文件比较时过滤掉目录类型，确保只显示文件差异
- **修复WebDAV面板统计数量不准确问题**：统计信息现在正确反映过滤后的文件数量

#### ✨ 新增功能
- **🎯 独立批注侧边栏（AndreaCommentsSidebar）**：将批注管理功能从主侧边栏中分离，提供更专注的批注管理体验
- **📁 独立WebDAV侧边栏（AndreaWebDAVSidebar）**：将WebDAV相关功能从主侧边栏中分离，包括WebDAV管理面板和文件树视图

#### 🖋️ 界面优化
- **重新组织侧边栏结构**：原小说助手侧边栏现在专注于核心功能（包管理器、角色管理），批注和WebDAV功能移至各自的专用侧边栏
- **优化用户界面布局**：通过功能分离提供更清晰的工作流程和更好的用户体验
- **侧边栏状态持久化**：VS Code会自动记住各个侧边栏的展开/折叠状态

### 🌟 0.4.0（2025-01-15）- WebDAV云端同步 错别字检测 批注

#### ✨ 新增功能
- **🌐 WebDAV云端同步功能**：支持与WebDAV服务器进行文件同步，实现跨设备协作写作
- **📊 WebDAV同步状态栏**：实时显示同步状态，支持转圈动画和进度显示，让同步过程一目了然
- **👤 WebDAV账户管理**：支持多账户配置和管理，方便切换不同的云端存储服务
- **📁 WebDAV文件树视图**：可视化管理云端文件，支持文件上传、下载、删除等操作
- **⚙️ WebDAV同步面板**：提供详细的同步配置和状态信息，包括同步规则、排除文件等设置
- **🔍 错别字统计功能**：智能识别和统计文档中的错别字，提供详细的错误分析和修正建议
- **📝 批注功能**：支持在文档中添加、编辑和管理批注，便于写作过程中的备注和协作交流


### 0.3.25（2025-09-07）- 展开状态持久化

#### ✨ 新增功能
- 新增展开状态持久化功能：所有角色视图、当前文章角色视图（侧边栏和Explorer）、包管理器视图现在都会记住用户的展开/折叠状态
- 新增跨文档展开状态继承：切换到新文档时，如果新文档尚无展开记录，可继承上个文档的展开集合（仅对共有的节点生效）
- 新增设置开关 `AndreaNovelHelper.docRoles.inheritExpandedFromPrevious`：控制是否启用跨文档展开状态继承（默认开启）
- 新增角色展开显示功能：角色节点支持展开显示详细信息，包括名称、类型、颜色等字段
- 优化角色显示：支持角色自带SVG图标、角色名彩色方块标记、颜色字段可视化显示
- 新增角色详情键图标映射：基于JSON配置为不同类型的角色字段显示对应的VS Code内置图标
- 写作资源管理器现在支持显示参考资料（如图片、PDF等不计入字数统计的文件）
- 支持基于自定义分类的角色显示，可以按类型或归属进行更灵活的分组

#### 🐛 修复问题
- 修复角色视图展开状态在重启VS Code后丢失的问题
- 修复切换文档时布局被重置的问题
- 略微优化了Decorations性能，减少大文件打开时的阻塞

*更早的功能里程碑见 [CHANGELOG.md](CHANGELOG.md)*

## 🚀 核心功能概览

### 🎯 三大专用侧边栏
- **📚 小说助手侧边栏（AndreaNovelHelperSidebar）**：专注于核心写作功能，包含包管理器、角色管理等
- **📝 批注功能侧边栏（AndreaCommentsSidebar）**：专门用于批注管理，提供批注的归总、跳转和快速处理
- **☁️ WebDAV功能侧边栏（AndreaWebDAVSidebar）**：专门用于云端同步管理，包含WebDAV面板和文件树视图

### 📦 包管理器（设定集中心）
图形化管理 `novel-helper/` 下的"包"与资源文件（JSON5 / Markdown / TXT）。

### 📝 多格式设定集支持
- **Markdown 设定集**：可用纯 Markdown 撰写角色/词汇/敏感词，自动解析章节式结构与字段标题
- **JSON5 结构化数据**：角色库 / 敏感词库 / 词汇库 / 正则库统一 JSON5；支持注释、尾逗号、灵活顺序
- **TXT 快速迁移**：支持放置 `*.txt`（一行一条）快速从其它软件/导出数据导入，后续再渐进转 Markdown / JSON5 精细化

### 🎯 智能补全与着色
主名称 + 别名 / 词汇 / 敏感词 / 正则匹配全部支持补全、跳转、Hover、着色。

### 🌳 角色层级树视图
按【从属 → 类型 → 角色】分层，词汇/敏感词/正则表达式三类统一置底"特殊分类"分组；展开状态持久化。

### 👥 "当前文章角色" 双视图
侧边栏 & Explorer 各一份实时显示当前文档出现过的角色/词汇/敏感词/正则命中，复用缓存免重复扫描；展开状态持久化，支持跨文档继承。

### 📊 写作资源视图（Word Count Explorer）
可替代原生 Explorer，聚焦写作文件字数、排序、索引管理与拖拽组织，现在支持显示参考资料；展开状态持久化。

### ⚡ 性能优化
懒加载大纲、分片文件追踪数据库、读写降噪、共享缓存 + 异步刷新（含文档角色缓存模型）。

### 📈 写作统计与时间追踪
- 分钟级/会话级统计
- CPM（字符每分钟）峰值
- 活跃度趋势
- 写作统计仪表板

### 🛠️ 其他实用工具
- 一键导出txt/纯文本内容
- 写作预览工具
- 写作版式设置，格式化工具
- 角色卡编辑器（可视化）
- 敏感词识别与高亮
- 正则表达式着色

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
