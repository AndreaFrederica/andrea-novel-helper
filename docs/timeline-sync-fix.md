# 时间线编辑器数据同步问题修复

## 问题描述

用户报告了两个关键问题：

### 1. 创建新连接后没有写入文件
```
新建连接 {source: '2', target: '0199a58c-b0ba-7c-996d-d79d07134fcc'}
```
这之后数据没有保存到 `.tjson5` 文件中。

### 2. 初始化默认数据时没有写入后端
当文件为空时，前端会生成示例数据，但这些数据没有同步到后端文件。

## 根本原因分析

### 问题 1：消息监听器配置错误

**前端代码（修复前）：**
```typescript
function loadInitialData() {
  // ❌ 错误：只监听一次消息
  window.addEventListener('message', handleMessage, { once: true });
  
  window.parent.postMessage({ type: 'requestTimelineData' }, '*');
}
```

**问题：**
- 使用 `{ once: true }` 导致监听器在第一次触发后就被移除
- 如果后端响应稍有延迟，监听器可能已经失效
- 后续的所有消息（如 `dataChangeAck`）都无法接收

### 问题 2：后端缺少消息处理

**后端代码（修复前）：**
```typescript
switch (message.type) {
    case 'dataChanged': { ... }
    case 'saveTimelineData': { ... }
    // ❌ 缺少 'requestTimelineData' 处理
}
```

**问题：**
- 前端发送 `requestTimelineData` 但后端不处理
- 导致前端超时后使用示例数据
- 示例数据生成后没有触发保存

### 问题 3：初始化数据后未保存

**前端代码（修复前）：**
```typescript
setTimeout(() => {
  if (events.value.length === 0) {
    events.value = [...示例数据];
    connections.value = [...示例连接];
    void updateFlowElements();
    // ❌ 缺少：void saveTimelineData();
  }
  isLoading.value = false;
}, 500);
```

**问题：**
- 生成示例数据后只更新了视图
- 没有调用 `saveTimelineData()` 将数据同步到后端

## 修复方案

### 修复 1：改为持续监听消息

**packages/webview/src/pages/TimelinePage.vue**

```typescript
// ✅ 在 onMounted 中添加持续监听
onMounted(() => {
  // 添加全局消息监听器（持续监听来自 VSCode 的消息）
  window.addEventListener('message', handleMessage);
  
  loadInitialData();
  // ...
});

onUnmounted(() => {
  // 清理监听器
  window.removeEventListener('message', handleMessage);
  // ...
});

// ✅ loadInitialData 中移除 once 监听
function loadInitialData() {
  isLoading.value = true;
  // 移除了 window.addEventListener('message', handleMessage, { once: true });
  window.parent.postMessage({ type: 'requestTimelineData' }, '*');
  // ...
}
```

### 修复 2：后端添加 requestTimelineData 处理

**src/Provider/editor/TimelineJson5EditorProvider.ts**

```typescript
switch (message.type) {
    case 'requestTimelineData': {
        // ✅ 新增：处理前端请求
        console.log('[TimelineJson5EditorProvider] Received requestTimelineData');
        await updateWebview();
        break;
    }
    
    case 'dataChanged': { ... }
    case 'saveTimelineData': { ... }
}
```

### 修复 3：初始化数据后触发保存

**packages/webview/src/pages/TimelinePage.vue**

```typescript
setTimeout(() => {
  if (events.value.length === 0) {
    events.value = [...示例数据];
    connections.value = [...示例连接];
    void updateFlowElements();
    // ✅ 新增：保存初始化的示例数据
    void saveTimelineData();
  }
  isLoading.value = false;
}, 500);
```

### 修复 4：添加详细日志

**packages/webview/src/pages/TimelinePage.vue**

```typescript
function saveTimelineData() {
  // ...转换数据...
  
  // ✅ 新增：详细日志
  console.log('[TimelinePage] Sending dataChanged message to backend');
  console.log('[TimelinePage] Events count:', plainEvents.length, 'Connections count:', plainConnections.length);
  
  window.parent.postMessage({
    type: 'dataChanged',
    data: { events: plainEvents, connections: plainConnections }
  }, '*');
}
```

## 消息流程（修复后）

### 场景 1：打开已有 .tjson5 文件

```
1. 前端 onMounted
   ├─ 添加全局消息监听器
   └─ 调用 loadInitialData()

2. 前端 → 后端: { type: 'requestTimelineData' }

3. 后端处理
   ├─ 接收到 requestTimelineData
   ├─ 解析文件内容
   └─ 发送: { type: 'timelineData', data: {...} }

4. 前端接收
   ├─ handleMessage 处理消息
   ├─ events.value = data.events
   ├─ connections.value = data.connections
   └─ updateFlowElements()

5. ✅ 文件数据成功加载
```

### 场景 2：打开空的 .tjson5 文件

```
1. 前端 onMounted
   ├─ 添加全局消息监听器
   └─ 调用 loadInitialData()

2. 前端 → 后端: { type: 'requestTimelineData' }

3. 后端处理
   ├─ 接收到 requestTimelineData
   ├─ 解析文件内容（空文件）
   └─ 发送: { type: 'timelineData', data: { events: [], connections: [] } }

4. 前端接收空数据
   ├─ events.value = [] (长度为 0)
   └─ 500ms 后触发示例数据生成

5. 生成示例数据
   ├─ events.value = [示例事件...]
   ├─ connections.value = [示例连接...]
   ├─ updateFlowElements()
   └─ ✅ saveTimelineData() ← 新增

6. 前端 → 后端: { type: 'dataChanged', data: {...} }

7. 后端同步数据
   ├─ syncJsonDataChange()
   ├─ 应用 WorkspaceEdit
   ├─ 触发 dirty 状态
   └─ 发送: { type: 'dataChangeAck', ok: true }

8. ✅ 示例数据已保存到文件
```

### 场景 3：创建新连接

```
1. 用户在 VueFlow 中拖拽创建连接

2. onConnect 触发
   ├─ console.log('新建连接', params)
   ├─ connections.value.push(newConnection)
   ├─ updateFlowElements()
   └─ saveTimelineData()

3. 前端 → 后端: { type: 'dataChanged', data: {...} }
   ├─ console.log('[TimelinePage] Sending dataChanged...')
   └─ 包含新连接的完整数据

4. 后端同步数据
   ├─ console.log('[TimelineJson5EditorProvider] Received dataChanged')
   ├─ console.log('Data change - events: X, connections: Y')
   ├─ syncJsonDataChange()
   ├─ 检查数据是否变化
   ├─ 应用 WorkspaceEdit
   ├─ 触发 dirty 状态（文件名旁显示 ●）
   └─ 发送: { type: 'dataChangeAck', ok: true }

5. 根据自动保存设置
   ├─ autoSave=off: 等待手动 Ctrl+S
   └─ autoSave=on: VSCode 自动保存

6. ✅ 新连接已保存到文件
```

## 验证步骤

### 测试 1：空文件初始化

1. 创建新的 `.tjson5` 文件（空内容）
2. 用时间线编辑器打开
3. **预期结果：**
   - 自动生成示例事件和连接
   - 文件标记为未保存（显示 ●）
   - 按 Ctrl+S 保存后，文件包含示例数据

### 测试 2：创建新连接

1. 打开已有的 `.tjson5` 文件
2. 拖拽创建新连接
3. **预期结果：**
   - 控制台输出：`新建连接 {...}`
   - 控制台输出：`[TimelinePage] Sending dataChanged...`
   - 控制台输出：`[TimelineJson5EditorProvider] Received dataChanged`
   - 文件标记为未保存
   - 保存后，新连接出现在文件中

### 测试 3：编辑现有数据

1. 打开已有的 `.tjson5` 文件
2. 修改事件标题或连接类型
3. **预期结果：**
   - 每次修改都触发 `dataChanged`
   - 文件实时标记为未保存
   - 根据自动保存设置自动或手动保存

## 调试日志

启用详细日志后，应该看到类似输出：

```
// 前端初始化
[TimelinePage] Sending requestTimelineData

// 后端响应
[TimelineJson5EditorProvider] Received requestTimelineData
[TimelineJson5EditorProvider] Document text length: 0
[TimelineJson5EditorProvider] Timeline data events count: 0
[TimelineJson5EditorProvider] Timeline data connections count: 0

// 前端生成示例数据
[TimelinePage] Sending dataChanged message to backend
[TimelinePage] Events count: 5 Connections count: 6

// 后端同步数据
[TimelineJson5EditorProvider] Received dataChanged notification
[TimelineJson5EditorProvider] Data change - events: 5, connections: 6
[syncJsonDataChange] Timeline data changed, syncing to document
[syncJsonDataChange] Document synced successfully
```

## 性能优化建议

当前实现在每次数据变化时都会：
1. 序列化整个数据结构
2. 字符串比较检测变化
3. 应用 WorkspaceEdit

**潜在优化：**
- 使用深度对象比较而不是字符串比较
- 实现防抖机制，避免频繁触发
- 使用增量更新而不是全量替换

```typescript
// 建议的优化（未实现）
const debouncedSave = debounce(saveTimelineData, 300);

onConnect((params) => {
  connections.value.push(newConnection);
  updateFlowElements();
  debouncedSave(); // 使用防抖
});
```

## 相关文件

### 修改的文件
- ✅ `src/Provider/editor/TimelineJson5EditorProvider.ts`
  - 添加 `requestTimelineData` 消息处理
  
- ✅ `packages/webview/src/pages/TimelinePage.vue`
  - 修改消息监听为持续监听
  - 移除 `{ once: true }`
  - 在 `onMounted`/`onUnmounted` 中管理监听器
  - 初始化数据后调用 `saveTimelineData()`
  - 添加详细日志

### 不需要修改的文件
- ✅ `syncJsonDataChange` 逻辑正确
- ✅ `scheduleWrite` 逻辑正确
- ✅ `onWillSaveTextDocument`/`onDidSaveTextDocument` 正确

## 总结

修复的核心问题：
1. **消息监听机制** - 从一次性改为持续监听
2. **消息处理完整性** - 添加缺失的 `requestTimelineData` 处理
3. **数据初始化保存** - 生成示例数据后触发保存
4. **调试可见性** - 添加详细日志便于排查问题

所有修改都遵循现有的架构模式，与 `RelationshipJson5EditorProvider` 保持一致。
