## 使用点清单
- `src/utils/AhoCorasick/ahoCorasickManager.ts:1,8,22–99` Aho‑Corasick 管理器与 `search(text)`
- `src/workers/roleAcWorker.ts:69–160` Worker 端构建与搜索，含 `findCompleteWords`
- `src/Provider/hoverProvider.ts:152–175` 使用 `ahoCorasickManager.search` 生成 Hover
- `src/events/updateDecorations.ts:143–146` 初始化自动机
- `src/utils/roleUsageCollector.ts:58–97,99–121` AC 命中映射与“正则表达式”角色扫描
- `src/roleUsage/roleUsageIndexer.ts:372–407` 根据 AC 命中写入范围索引
- 正则广泛使用：`src/utils/utils.ts:227–229,683`、`src/Provider/defProv.ts:42,71`、`src/utils/ignoreUtils.ts:112–118`、`src/Provider/markdownToolbar.ts:123–129,420`、`src/utils/Order/sorter.ts:176–236`、`src/Provider/utils/html-builder.ts:16–21,82`、以及多处视图/命令文件基于通配→正则逻辑。
- 类型/配置：`src/types/ahocorasick.d.ts`、`src/extension.ts:26–28`（角色含 `regex`/`regexFlags`）、`templates/templateGenerators.ts:184–236`（正则模板）、`CHANGELOG.md:368–386`（异步 AC 与分词过滤）。

## 目标
- 统一匹配抽象，隔离实现细节：AC 与 RegExp 均实现同一接口。
- 主线程零阻塞：构建/搜索在 Worker，并支持增量更新。
- 大文件性能优化：引入“基于自然段的拆分缓存”，只重算变更段。
- 一致的边界与优先级：保留/增强分词边界校验与结果合并策略。

## 技术设计
- 接口：`MatcherEngine`（`buildIndex(roles)`, `search(doc, opts)`, `dispose()`）。
- 实现：`AhoCorasickMatcher`（复用/迁移 `roleAcWorker.ts` 逻辑）、`RegexMatcher`（现有正则扫描封装）。
- 段落拆分缓存：
  - 规则：按空行/标题/分隔符拆分为段；维护 `段哈希 → 命中列表`。
  - 文档快照：记录每段起止偏移与行号映射；变更只触发受影响段重算。
  - 合并：段内相对坐标转全局坐标，结果按优先级/去重策略统一输出。
- 边界校验：保留 `Intl.Segmenter`；无支持时回退到字符邻接规则。
- Worker 管线：
  - `buildIndex`：AC 构建在 Worker，支持分批/节流。
  - `search`：传入段文本与起始偏移，返回命中（含词边界标记）。
- 结果融合：AC 与正则统一为 `Match {range, roleId, source, score}`，按 `role.priority` 与稳定排序合并。

## 实施步骤
1. 引入 `MatcherEngine` 抽象与适配层，替换直接 `ahoCorasickManager.search` 的调用点（Hover、Decorations、Collector、Indexer）。
2. 将 `roleAcWorker.ts` 构建/搜索逻辑封装为 `AhoCorasickMatcher`，添加异步队列与取消。
3. 封装现有正则扫描为 `RegexMatcher`，统一迭代与零长匹配保护。
4. 在索引层加入段落拆分缓存：文档分段、哈希、命中缓存、变更增量合并。
5. 统一结果合并/优先级策略，消除重复与范围冲突。
6. 性能护栏：大文件阈值、段最大长度、并发与节流参数。
7. 替换入口：`updateDecorations`、`hoverProvider`、`roleUsageCollector`、`roleUsageIndexer` 使用新接口。

## 迁移与兼容
- 向后兼容角色定义（`regex`/`regexFlags` 保持不变）。
- 保留 `Intl.Segmenter` 校验行为；在无分词环境时结果可能略宽松（提供开关）。
- 逐文件替换入口后进行端到端验证。

## 测试与验证
- 单元：段拆分与哈希、边界校验、零长匹配、结果合并。
- 基准：小/中/大文件（>5MB）构建与搜索耗时、主线程 FPS。
- 集成：Hover/Decorations/索引一致性、滚动与增量编辑正确性。

## 风险与规避
- 段边界错判：提供可配置分段规则与上限保护。
- 缓存失效：基于文档版本与段哈希进行精确失效。
- Worker 通信开销：批量化请求与结果压缩（范围+roleId）。

请确认以上方案与使用清单；确认后我将按“实施步骤”开始重构并提交具体改动。