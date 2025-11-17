## 目标
- 保留旧命令 `andrea.formatDocument` 不变。
- 新增只针对 MD/TXT 的命令：自动补段间空行，避开 Markdown 结构与代码栅栏。

## 识别细节（结合你的补充）
- 上一行：使用 `prev.trimEnd()` 判断是否以句末标点 `。！？!?…；;：:`（可跟右引号/括号）结尾。
- 下一行：允许前导空格/Tab；使用 `next.trimStart()` 检查首字符是否为汉字或英文字母。
- 两行均非结构行（标题/引用/列表/表格）且不在 fenced code block 内；两者之间当前无空行（`lines[i+1]` 非空串）。
- 命中则在二者之间插入 N 个空行（N 来自 `andrea.typeset.blankLinesBetweenParas`）。
- 对已有空行串：规范为 exactly N；始终清理行尾空格（若开启）。

## 命令与菜单
- 新命令 ID：`andrea.formatDocument.addBlanks`，标题例如“快速排版全文（自动补段间空行）”。
- 右键菜单：仅在 `editorLangId == markdown || editorLangId == plaintext` 时显示；不包含 `json5`。
- 快速设置：在 `src/typeset/quickSettings.ts:1048-1077` 增加入口项，执行新命令。

## 修改点
- `src/typeset/core/utils.ts`：新增 `ensureBlankLinesBetweenParas(text, N, trimTrailing)`。
- `src/typeset/format.ts`：新增 `formatWholeDocumentAddBlanks()` 与注册导出；第 1 步调用新函数，第 2 步复用 `applyFirstLineIndent(...)`。
- `package.json`：增加新命令与右键菜单（语言条件仅 MD/TXT）；同步 i18n 文案。

## 验证
- MD/TXT 示例：普通段落间补 N 行；标题/列表/表格/代码栅栏不插空行；尾空格清理与段首缩进保持现状。
- JSON5：不显示新命令的右键项。