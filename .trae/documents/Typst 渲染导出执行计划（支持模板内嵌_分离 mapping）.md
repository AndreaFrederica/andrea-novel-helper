## 目标
- 将 Markdown/纯文本文档通过 Typst 模板渲染成 `.typ`，再编译为 `pdf` 或分页图片（`png`/`svg`）。
- 模板与 mapping 作为“模板包”提供，支持“模板内嵌 mapping”与“分离 mapping 文件”的两种模式；模板清单显式声明依赖的 mapping。

## 模板包设计
- 目录结构：
  - `templates/<pack>/template.yml`：清单（入口文件、包含文件、默认参数、mapping 策略）
  - `templates/<pack>/entry.typ.liquid`：入口 Liquid 模板（输出 Typst）
  - `templates/<pack>/mapping/`（可选）：分离式 mapping 部件
    - `block.typ.liquid`：块级节点映射（heading/paragraph/list/code/blockquote…）
    - `inline.typ.liquid`：行内节点映射（strong/emphasis/link/inlineCode…）
- 清单字段：
  - `name/version/engine: liquid/entry`
  - `mapping: inline | separated`
  - `includes: ["mapping/block.typ.liquid","mapping/inline.typ.liquid"]`（当 `mapping=separated`）
  - `defaults`：版式、字体、页眉页脚、ppi 等
- 运行时加载：
  - `mapping=inline`：在 `entry.typ.liquid` 内定义或 `include` 内联片段
  - `mapping=separated`：入口通过 `{% include %}` 引入；我们提供 Liquid 文件系统加载器解析模板相对路径

## 数据流
1) 读取活动文档文本与元数据（YAML Frontmatter 可选）
2) Markdown → MDAST（`remark-parse` 等）
3) 归一化为中间数据：`meta` + `blocks`（块内含 `runs` 行内片段）
4) 选择模板包，加载清单与所需 mapping
5) 用 `liquidjs` 渲染 `.typ` 临时文件
6) Typst CLI 编译为目标输出（PDF/PNG/SVG）

## 技术栈与依赖
- 解析：`remark-parse`、`remark-frontmatter`；必要时 `mdast-util-to-string`
- 模板：`liquidjs`（支持 include 与相对路径文件系统加载）
- 编译：Typst CLI（支持 `pdf/png/svg/html`；PNG 可设 `--ppi`；多页 PNG/SVG 需 `{p}` 占位）
  - 参考：Arch 手册 `typst-compile(1)`（输出格式与参数）；DeepWiki 对输出工作流的整理

## 命令与 UI
- 新命令：
  - `andrea.typst.exportCurrent`：导出当前文件为 PDF/PNG/SVG
  - 未来：`andrea.typst.exportBatch`：选目录批量导出
- 入口位置：靠近现有导出入口（`src/Provider/view/previewPane.ts:371` 的 `exportTxtOfActiveEditor`）旁新增“导出 PDF/PNG/SVG”按钮

## 编译调用
- PDF：`typst compile <tmp.typ> <out.pdf>`
- PNG：`typst compile -f png --ppi <ppi> <tmp.typ> <out-{p}.png>`（多页每页一文件）
- SVG：`typst compile -f svg <tmp.typ> <out-{p}.svg>`
- 页码范围：`--pages` 支持 `2,3-6,8-`
- 字体路径：`--font-path`（Windows 用 `;` 分隔）；可配 `ignore-system-fonts`

## 配置项
- `andrea.typst.cliPath`（为空则查 `PATH`）
- `andrea.typst.templatesDir`、`andrea.typst.defaultTemplate`
- `andrea.typst.output.format`：`pdf|png|svg`；`andrea.typst.output.ppi`（PNG 分辨率）
- `andrea.typst.font.paths`、`andrea.typst.pages`

## 错误处理
- CLI 未安装：提示下载与选择路径
- 模板/包含缺失：明确报缺失文件与相对路径；提供示例模板包
- 编译失败：捕获 `stderr` 并定位 `.typ` 临时文件错误位置

## 验证
- 导出完成后自动打开：PDF 或首张图片；提供“打开所在文件夹”
- 文件命名不覆盖源：`<basename>.pdf`、`<basename>-{p}.png`

## 实施步骤（里程碑）
1) 加命令与配置骨架，挂 UI 入口（`package.json` + `previewPane.ts:371` 附近）
2) 实现 MDAST → 中间数据转换器（块级/行内覆盖常见节点）
3) 接入 Liquid 渲染，支持 include 与模板包清单（内嵌/分离 mapping）
4) 编译器封装：Typst CLI 参数构建与执行、错误与日志
5) 增加默认模板包（示例：小说版式），并完善中文排版细节
6) 完成导出与打开结果；加入基本单元测试与端到端试跑

如确认该方案，我将按此计划开始实现，并提供一个可运行的基础模板包以便快速试用。