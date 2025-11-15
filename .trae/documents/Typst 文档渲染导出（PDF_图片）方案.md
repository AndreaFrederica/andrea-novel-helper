## 目标

- 将 Markdown/纯文本文档，通过 Typst 模板渲染为 `pdf` 或分页图片（`png`/`svg`）。
- 支持模板选择、样式定制、封面/页眉页脚、字体路径与分辨率配置。
- 默认对“当前活动编辑器的文档”导出；后续支持批量导出。

## 技术路线

- 方案 A（推荐）：`Markdown → AST → Liquid 模板 → .typ → Typst CLI 编译`
  - 使用 `remark` 系列生成 MDAST；将 AST 转为中间数据（标题、段落、行内强调、图片等）。
  - 用 `liquidjs` 渲染 `.typ.liquid` 模板生成 `.typ`，保证模板可维护、可复用。
  - 调用 `typst compile` 生成目标文件。
- 方案 B（备用）：`Markdown → 文本 → Typst 包装模板 + sys.inputs → Typst CLI`
  - 通过 `--input key=value` 传递内容到模板中的 `sys.inputs`（适合少量参数，不利于复杂排版）。

参考：Typst CLI 支持 `pdf/png/svg/html` 四种输出，并对 PNG 可设 `--ppi`；多页 PNG/SVG 需在输出名使用页占位（如 `output-{p}.png`）[Arch manpage](https://man.archlinux.org/man/extra/typst/typst-compile.1.en)；输出格式枚举与工作流见 [DeepWiki 文档](https://deepwiki.com/wesleyel/typst/6-output-formats)。

## 模板设计

- 模板目录：工作区或扩展内置 `templates/typst`。
- 模板文件：如 `book.typ.liquid`、`article.typ.liquid`，包含：
  - 页面与字体设置、段前缩进、行距、页眉页脚、目录等。
  - 对中间数据进行遍历输出 Typst 语法（标题、段落、图片、代码块、引言）。
- 变量约定：
  - 文档元数据：`title`, `author`, `date`, `cover_image`。
  - 内容：`blocks`（数组，元素含 `type`, `text`, `level`, `inline` 等）。

## AST 转换

- 使用 `remark-parse` 生成 MDAST，配合 `remark-frontmatter` 读取 YAML 头。
- 规则映射：
  - `heading` → `{ type: 'heading', level, text, inline }`
  - `paragraph` → `{ type: 'paragraph', inline }`
  - `blockquote`、`list`、`code`、`image`、`thematicBreak` 等 → 对应结构。
- 行内节点（`strong`/`emphasis`/`inlineCode`/`link`/`break`）→ 生成 Typst 片段，保持中文排版细节（如中文引号、标点挤压可交由模板处理）。

## 命令与入口

- 在 `package.json` 贡献新命令：
  - `andrea.typst.exportCurrent`（导出当前文件为 PDF/图片）。
  - `andrea.typst.exportBatch`（选目录批量导出，后续迭代）。
- 集成入口：复用预览面板现有导出位置（`src/Provider/view/previewPane.ts:371` 旁新增“导出 PDF/PNG/SVG”）。

## 执行流程

1) 读取活动文档文本与元数据（文件名、YAML Frontmatter）。
2) 解析为 MDAST → 转中间数据。
3) 选择模板（默认或弹窗选择），通过 `liquidjs` 渲染得到 `.typ` 临时文件。
4) 调用 Typst CLI：
   - PDF：`typst compile <tmp.typ> <out.pdf>`
   - PNG：`typst compile -f png --ppi <ppi> <tmp.typ> <out-{p}.png>`
   - SVG：`typst compile -f svg <tmp.typ> <out-{p}.svg>`
5) 打开导出结果（`vscode.open`），并提示完成。

## 配置项

- `andrea.typst.cliPath`：Typst 可执行路径（为空则查 `PATH`）。
- `andrea.typst.templatesDir`：模板目录（支持工作区相对路径）。
- `andrea.typst.defaultTemplate`：默认模板文件名。
- `andrea.typst.output.format`：`pdf` | `png` | `svg`。
- `andrea.typst.output.ppi`：PNG 导出分辨率（默认 144）。
- `andrea.typst.font.paths`：额外字体搜索路径（传 `--font-path`，Windows 用 `;` 分隔）。
- `andrea.typst.pages`：导出页码/范围（传 `--pages`）。

## 错误处理

- 未安装 Typst：给出下载链接与安装说明；允许选择 CLI 路径。
- 模板缺失/变量不匹配：提示具体模板名与字段；提供示例模板。
- 编译失败：捕获 `stderr` 并高亮显示首错行列。

## 验证与预览

- 本地生成后自动打开：
  - PDF：使用 VS Code 内置或系统默认查看器。
  - 图片：打开第 1 页，提供“打开所在文件夹”。
- 生成文件命名：`<basename>.pdf`、`<basename>-{p}.png`（避免覆盖）。

## 迭代扩展

- Markdown 细节：脚注、表格、任务列表、数学公式到 Typst（公式可直接传原文至 Typst 数学语法）。
- 模板包：选择不同版式（小说、论文、剧本），以及封面/目录/章节页模板。
- `sys.inputs` 支持：将小型变量通过 CLI `--input` 注入。
- 批量导出与队列、导出日志面板。

## 与现有代码的落点

- 命令注册与 UI：`package.json`（新增命令与菜单）
- 逻辑实现：`src/commands/typstExport.ts`（新建），并在 `src/Provider/view/previewPane.ts:371` 附近挂入口按钮。
- 依赖使用：检查是否已有 `remark/liquidjs`，如无则引入并封装在子模块。

## 说明

- 你提出的“Liquid 渲染 + MD AST → Typst → 编译”路线是主推方案；能充分利用模板表达力与 MD 语义保持。若仅需快速文本排版，可走 `sys.inputs` 包装方案，但不利于复杂版式。