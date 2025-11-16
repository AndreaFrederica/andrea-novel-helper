## 范围与目标
- 覆盖补全、悬浮、定义/引用、文档链接、代码操作、诊断与装饰的完整迁移；保守维持现有视觉与交互一致性。
- 抽象统一接口，提供 `local/lsp/hybrid` 模式切换与自动回退。

## 关键调用位置（按能力）
- 注册入口与集中接线：
  - `src/activate.ts:679,693,696,703,708,715-718,722`（注册补全、悬浮、定义、引用、链接、代码操作；监听配置变更与重注册）
- Completion：
  - 角色补全注册：`src/activate.ts:693,696`
  - 注册封装函数：`src/activate.ts:679`（`registerCompletion`）
  - 初次注册：`src/activate.ts:703`
  - 配置变更重注册：`src/activate.ts:708`
  - 提供器实现：`src/Provider/completionProvider.ts:116`
  - 定义补全（特定语言）：`src/language/defCompletion.ts:4`
- Hover：
  - 注册：`src/activate.ts:715`
  - 实现：`src/Provider/hoverProvider.ts:289`
- Definition：
  - 注册：`src/activate.ts:716`
  - 实现：`src/Provider/defProv.ts:102`
  - 批注定义接管：`src/comments/definitionProvider.ts`（注册在文件 scheme 上）
- References：
  - 注册：`src/activate.ts:717`
  - 实现：`src/Provider/roleReferenceProvider.ts:223`
- DocumentLink：
  - 注册：`src/activate.ts:718`
  - 实现：`src/Provider/defLinksProvider.ts:17`
- Code Action：
  - 注册：`src/activate.ts:722`
  - Markdown 代码操作：`src/Provider/markdownToolbar.ts:135`
  - Quick Fix/Refactor（基于诊断与悬停范围）：`src/Provider/fixsCodeActionProvider.ts:122-124`
- Diagnostics：
  - 敏感词：创建与维护集合 `src/events/updateDecorations.ts:124`
  - 错别字：创建集合 `src/typo/typoService.ts:320`，应用与清理 `src/typo/typoService.ts:424-452`
  - 批注：创建/设置/销毁 `src/comments/controller.ts:10,124,170`
  - 项目配置校验：集合创建 `src/projectConfig/projectConfigLinter.ts:41`，驱动 `validateDocument`
- Decorations（动态着色/样式渲染）：
  - 统一更新流程：`src/events/updateDecorations.ts:201`（核心）、范围应用 `src/events/updateDecorations.ts:336,348`
  - 装饰类型构建：`src/events/updateDecorations.ts:157,177`
  - 监听与触发：`src/events/updateDecorations.ts:517,521,525,533`
  - 其他模块装饰：
    - 项目配置：`src/projectConfig/projectConfigDecorator.ts:70,106-112`
    - 批注：`src/comments/controller.ts:505,569,572,586`
  - 触发更新的命令：
    - 刷新角色：`src/commands/refreshRoles.ts:21`
    - 添加词库/敏感词/规则：`src/commands/addVocabulary.ts:79`、`src/commands/addSensitiveWord.ts:85`、`src/commands/addRuleFormSelection.ts:85`
- 配置与设置：
  - 受支持文件类型：`package.json:1325`（`AndreaNovelHelper.supportedFileTypes`）
  - 键盘与行为条件包含 `suggestWidgetVisible`、`inlineSuggestionVisible`：`package.json:2733`
  - 各类 `andrea.*` 命令与 `andrea.anh.enabled` 条件（多处）

## 统一接口抽象
- 服务接口：
  - `CompletionService`, `HoverService`, `DefinitionService`, `ReferenceService`, `DocumentLinkService`, `CodeActionService`, `DiagnosticsService`, `DecorationsService`。
- 适配器：
  - `LocalAdapter`：调用现有 provider/诊断/装饰实现。
  - `LspAdapter`：调用 LSP 标准方法与扩展方法，自带回退逻辑。
- 网关：`LanguageFeatureGateway`：读取设置选择适配器，统一注册/注销与生命周期管理。

## LSP 标准映射
- `textDocument/completion` ← `createRoleCompletionProvider`
- `textDocument/hover` ← `activateHover`
- `textDocument/definition` ← `activateDef`
- `textDocument/references` ← `registerRoleReferenceProvider`
- `textDocument/documentLink` ← `activateDefLinks`
- `textDocument/codeAction` + `codeAction/resolve` ← `registerFixsCodeAction`
- `textDocument/publishDiagnostics` ← 敏感词/错别字/项目配置校验集合

## LSP 扩展方法（为动态装饰与索引）
- `andrea/decorations/ranges`：返回装饰范围与元数据（颜色/样式/提示/来源）
- `$/andrea/decorations/updated`：装饰增量通知
- `andrea/roles/index`、`andrea/roles/usages`：角色数据与文档命中点
- 进度：标准 `workDoneProgress` / `$/progress` 支持长耗时任务

## 设置与模式
- 新增：`AndreaNovelHelper.language.mode` ∈ `local | lsp | hybrid`
- 切换逻辑：集中在 `src/activate.ts`，参照现有配置变更重注册（`src/activate.ts:708`）
- `hybrid` 策略：诊断+代码操作优先走 LSP，其余沿用本地，便于渐进迁移。
- 回退：`LspAdapter` 超时/错误自动降级，并状态栏提示。

## 迁移步骤
1. 抽象接口与网关：不改变行为，先统一接线（注册点仍在 `src/activate.ts`）。
2. 本地适配器：把现有 provider/诊断/装饰包装为 `LocalAdapter`，对外只暴露接口。
3. LSP 服务端与客户端：实现标准方法与扩展；`LspAdapter` 对接客户端。
4. 模式切换与注册：统一在 `src/activate.ts` 读取设置，按模式注册/注销。
5. 动态装饰协同：服务端输出范围；客户端保留渲染（支持语义令牌可选）。
6. 验证与基线：端到端测试与性能基准，确保体验一致。

## 验收标准
- 三种模式的功能一致性与稳定性。
- 问题面板、Quick Fix 行为与现有等价（诊断 `code` 映射一致）。
- 装饰视觉与交互稳定（滚动/编辑无抖动）。
- LSP 失效自动回退，本地模式不受影响。

## 风险与缓解
- 性能与并发：服务端增量/去抖；客户端节流与批处理更新。
- 主题兼容：语义令牌采用有限类型/修饰符；自由颜色通过装饰实现。
- scheme 支持：`andrea-outline` 等非 `file` 文档按需保留本地或同步全文。
- LLM 调用：设降级与重试，避免阻塞补全与悬浮。

## 交付物
- 接口与数据模型 Type 草案（含类别/修饰符枚举）。
- 注册点改造清单与切换逻辑说明。
- LSP 扩展方法规范（`andrea/*`）与示例负载。
- 端到端验证方案与性能基线报告。