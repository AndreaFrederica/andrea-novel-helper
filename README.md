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

---

## 演示
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

---

## 已知问题 / Known Issues

- 如果角色库非常庞大，首次扫描和着色可能略有延迟
- JSON5 格式不支持复杂嵌套，目前只解析顶层数组
- 无自动检测重复名称或别名，需要手动维护库的一致性
- JS提供的分词器可能不够准确，某些词如“睡觉”可能被错误识别为角色名，后期考虑更换后端来解决，如使用 `jieba` 等中文分词库。

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
- 支持部分i18n，添加中文语言包
- 增加角色类型支持，提供默认颜色映射

### 0.0.4
- 修复了不能动态提供建议的问题

### 0.0.5
- 增加 CSpell 字典生成，支持角色名拼写检查

### 0.0.6
- 重构装饰更新逻辑，独立 `updateDecorations` 函数
- 优化工具函数，添加区间重叠检查和正则转义功能
- 现在能避免 hoverRanges 区间重复的问题
- 修复了角色信息窗口不能显示颜色的bug

## 问题

- 分词尚不理想 某些词 比如说“睡觉” 觉 可能被发现为角色
- 角色名字发生包含时，可能会导致着色不准确
- 没有UUID支持，需要手动保证角色名字不重合
- 目前没有关系类型支持，后期可能参考数据库的关系模式添加
- 没有自定义角色类型支持，后期可能添加

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
