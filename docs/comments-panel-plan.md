---
title: 新批注管理面板计划
created: 2026-03-25
---

# 新批注管理面板计划

## 背景

根据用户讨论与仓库现有实现，制定一个并行的新批注管理面板方案，满足：自定义标签（Tag）、扁平显示（去文件/行分组）、与现有老面板并行切换、采用 WebView/框架实现以便更灵活的 UI。

## 现有架构要点

- 数据模型：src/comments/types.ts（CommentThreadData、CommentMessage、CommentAnchor）
- 存储：src/comments/storage.ts、src/comments/mdStorage.ts（JSON + MD 存储）
- 老面板（TreeView）：src/Provider/view/commentsTreeView.ts（按 文件→线程→消息 分层）
- 现有 WebView 面板：src/comments/controller.ts + media/comments.js（卡片式、1:1 同步）
- Web 前端框架：packages/webview（Quasar + Vue 3）
- package.json 已注册侧边栏容器 AndreaCommentsSidebar

## 用户需求（要实现的功能）

1. 支持为批注添加自定义标签（文字标签），可显示在批注前面。
2. 增加“显示类型2：扁平模式”——去掉文件/行的分组，直接按位置或时间扁平显示批注列表。
3. 新面板与老面板并行，用户可选择使用任一面板。
4. 新面板使用 WebView（建议复用 packages/webview 的 Quasar + Vue 实现）。

## 实施步骤（概要）

1. 数据模型扩展（P0）
   - 修改 `src/comments/types.ts`：在 `CommentThreadData` 与 `CommentMetadata` 中新增 `tags?: string[]` 字段。
   - 修改 `src/comments/storage.ts`：确保存/取逻辑兼容 `tags`，并新增 `updateThreadTags(docUuid, threadId, tags)` API。

2. 新 WebView 面板（P0/P1）
   - 在 `packages/webview/src/pages` 新建 `CommentsManagerPage.vue`（基于 Quasar 组件：q-chip、q-list、q-toolbar 等）。
   - 页面功能：扁平批注列表、标签 chips、标签筛选、搜索、状态过滤、点击跳转到编辑器位置。
   - 在 `packages/webview/src/router/routes.ts` 注册路由 `/comments-manager`。

3. Extension 侧 WebView Provider（P0/P1）
   - 新建 `src/Provider/view/commentsManagerWebview.ts`，实现 `WebviewViewProvider`，用于将 Quasar 页面作为侧边栏视图加载。
   - Provider 与主进程通信：支持消息类型 `load-all-comments`、`update-tags`、`jump-to-comment`、`filter-by-tag`、`resolve/reopen`、`search`。
   - 复用现有 `commentsWorker` 或直接调用 `loadComments`/`storage` API 获取数据并进行扁平化。

4. package.json 注册（P0）
   - 在 `AndreaCommentsSidebar` 中新增视图 `andrea.commentsManagerView`（type: webview，name: 批注总览/管理）。

5. 老面板增强（P2，可选）
   - 在 `src/Provider/view/commentsTreeView.ts` 中把 `tags` 显示在 `CommentTreeItem` 的 label 前缀，并添加标签过滤命令。

6. 标签管理（P1/P2）
   - 增加用户配置 `AndreaNovelHelper.comments.predefinedTags`（常用标签列表）和标签颜色配置。
   - 在新面板提供标签增删改交互（对单条线程进行增删），并支持自动补全已使用过的标签。

## 开发优先级建议

- P0: 数据模型改动 + 新 WebView Provider 与页面骨架 + package.json 注册
- P1: 扁平列表渲染、跳转、标签显示与筛选、标签更新 API
- P2: 老面板标签集成、标签颜色与预定义配置、自动补全与 UX 优化

## 技术与实现要点

- 数据层尽量复用现有 storage/worker，避免重复扫描逻辑。
- 新面板建议直接使用 packages/webview 的 Quasar 项目，复用构建流程。
- 新视图与老视图并行注册于 AndreaCommentsSidebar，用户在侧栏选择面板。
- 所有变更需兼容 Windows 路径与 workspace 多根情况，复用现有 `toRelKeyForWs`/tracker 逻辑。

## 预计变更文件清单（概要）

- 修改: src/comments/types.ts
- 修改: src/comments/storage.ts
- 修改: src/comments/controller.ts（WebView 消息处理）
- 新建: packages/webview/src/pages/CommentsManagerPage.vue
- 修改: packages/webview/src/router/routes.ts
- 新建: src/Provider/view/commentsManagerWebview.ts
- 修改: src/activate.ts（注册 provider）
- 修改: package.json（注册新视图）
- 修改: package.nls*.json（新增界面文本）

---

如需，我可以立刻开始实现第一步（添加 tags 字段并更新 storage 的读写），或者直接搭建新面板的 Vue 页面骨架并提交第一个 PR。请选择下一步。
