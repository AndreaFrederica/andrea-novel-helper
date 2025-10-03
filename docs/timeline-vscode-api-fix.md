# 时间线编辑器消息通信修复

## 问题描述

前端发送 `dataChanged` 消息后，后端完全没有接收到：

```
新建连接 {source: '2', target: '0199a58c-b0ba-7c-996d-d79d07134fcc'}
[TimelinePage] Sending dataChanged message to backend
[TimelinePage] Events count: 5 Connections count: 7
```

后端没有任何日志输出，说明消息根本没有到达。

## 根本原因

**错误的消息发送方式：**

TimelinePage.vue 使用了 `window.parent.postMessage()`，这在 VSCode webview 环境中不可靠。

```typescript
// ❌ 错误的方式
window.parent.postMessage({
  type: 'dataChanged',
  data: { events, connections }
}, '*');
```

**正确的方式：**

应该使用 VSCode Webview API：

```typescript
// ✅ 正确的方式
const vscode = acquireVsCodeApi();
vscode.postMessage({
  type: 'dataChanged',
  data: { events, connections }
});
```

## 为什么 RelationGraphPage 能工作？

RelationGraphPage.vue 从一开始就使用了正确的 VSCode API：

```typescript
// RelationGraphPage.vue
const vscode = (globalThis as any).acquireVsCodeApi?.();
if (vscode) {
  vscodeApi.value = {
    postMessage: (message: any) => {
      vscode.postMessage(message);  // ✅ 使用 VSCode API
    },
    // ...
  };
}
```

而 TimelinePage.vue 直接使用了 `window.parent.postMessage`，这在某些环境下可能失败。

## 修复方案

### 1. 添加 VSCode API 初始化

```typescript
// VSCode API 通信接口
const vscodeApi = ref<{
  postMessage: (message: any) => void;
  addEventListener: (type: string, listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: string, listener: (event: MessageEvent) => void) => void;
} | null>(null);

// 初始化VSCode API
function initVSCodeApi() {
  const vscode = (globalThis as any).acquireVsCodeApi?.();

  if (vscode) {
    // 使用VSCode原生API
    vscodeApi.value = {
      postMessage: (message: any) => {
        console.log('[VSCode API] Sending message:', message.type);
        vscode.postMessage(message);
      },
      addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
        globalThis.addEventListener?.(type, listener as EventListener);
      },
      removeEventListener: (type: string, listener: (event: MessageEvent) => void) => {
        globalThis.removeEventListener?.(type, listener as EventListener);
      }
    };
    console.log('[VSCode API] Initialized with VSCode webview API');
  } else {
    // 降级方案：使用 window.parent
    const global = globalThis as any;
    if (global.parent?.postMessage) {
      vscodeApi.value = {
        postMessage: (message: any) => {
          console.log('[VSCode API] Sending message via window.parent:', message.type);
          global.parent.postMessage(message, '*');
        },
        addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
          global.addEventListener?.(type, listener as EventListener);
        },
        removeEventListener: (type: string, listener: (event: MessageEvent) => void) => {
          global.removeEventListener?.(type, listener as EventListener);
        }
      };
      console.log('[VSCode API] Initialized with window.parent fallback');
    } else {
      console.error('[VSCode API] Failed to initialize - no communication method available');
    }
  }
}
```

### 2. 在 onMounted 中初始化

```typescript
onMounted(() => {
  // ✅ 首先初始化 VSCode API
  initVSCodeApi();

  // 加载渲染设置
  settingsStore.loadFromLocalStorage();
  loadTimelineViewState();

  // 使用 vscodeApi 监听消息
  if (vscodeApi.value?.addEventListener) {
    vscodeApi.value.addEventListener('message', handleMessage);
  } else {
    window.addEventListener('message', handleMessage);
  }

  loadInitialData();
  
  // 其他事件监听器
  window.addEventListener('timeline-node-update', handleTimelineNodeUpdate);
  window.addEventListener('timeline-open-editor', handleOpenEditor);
});
```

### 3. 更新所有消息发送点

#### loadInitialData

```typescript
function loadInitialData() {
  isLoading.value = true;

  // ✅ 使用 vscodeApi
  if (vscodeApi.value?.postMessage) {
    vscodeApi.value.postMessage({
      type: 'requestTimelineData',
    });
  } else {
    console.error('[loadInitialData] VSCode API not available');
  }
  
  // ...
}
```

#### saveTimelineData

```typescript
function saveTimelineData() {
  // 转换数据...
  
  console.log('[TimelinePage] Sending dataChanged message to backend');
  console.log('[TimelinePage] Events count:', plainEvents.length, 'Connections count:', plainConnections.length);

  // ✅ 使用 vscodeApi
  if (vscodeApi.value?.postMessage) {
    vscodeApi.value.postMessage({
      type: 'dataChanged',
      data: {
        events: plainEvents,
        connections: plainConnections,
      },
    });
  } else {
    console.error('[saveTimelineData] VSCode API not available');
  }
}
```

### 4. 正确清理监听器

```typescript
onUnmounted(() => {
  // ✅ 使用 vscodeApi 移除监听器
  if (vscodeApi.value?.removeEventListener) {
    vscodeApi.value.removeEventListener('message', handleMessage);
  } else {
    window.removeEventListener('message', handleMessage);
  }
  
  window.removeEventListener('timeline-node-update', handleTimelineNodeUpdate);
  window.removeEventListener('timeline-open-editor', handleOpenEditor);
});
```

## 修改的文件

### packages/webview/src/pages/TimelinePage.vue

**新增：**
- `vscodeApi` ref 变量
- `initVSCodeApi()` 函数

**修改：**
- `onMounted()` - 添加 API 初始化
- `onUnmounted()` - 使用 API 清理监听器
- `loadInitialData()` - 使用 `vscodeApi.value.postMessage`
- `saveTimelineData()` - 使用 `vscodeApi.value.postMessage`

## 验证方法

### 1. 检查初始化日志

打开 DevTools（在 webview 中右键 → 检查元素），应该看到：

```
[VSCode API] Initialized with VSCode webview API
```

或（降级方案）：

```
[VSCode API] Initialized with window.parent fallback
```

### 2. 检查消息发送

创建新连接时，应该看到：

```
新建连接 {...}
[TimelinePage] Sending dataChanged message to backend
[TimelinePage] Events count: X Connections count: Y
[VSCode API] Sending message: dataChanged
```

### 3. 检查后端接收

在扩展宿主进程的输出中，应该看到：

```
[TimelineJson5EditorProvider] Received dataChanged notification
[TimelineJson5EditorProvider] Data change - events: X, connections: Y
[syncJsonDataChange] Timeline data changed, syncing to document
[syncJsonDataChange] Document synced successfully
```

### 4. 验证文件保存

- 文件名旁应该显示未保存标记 ●
- 手动保存（Ctrl+S）或自动保存后，`.tjson5` 文件应该包含新连接

## VSCode Webview API 文档

### acquireVsCodeApi()

在 VSCode webview 环境中，调用 `acquireVsCodeApi()` 返回一个对象：

```typescript
interface VSCodeApi {
  postMessage(message: any): void;
  setState(state: any): void;
  getState(): any;
}
```

**注意：**
- 只能调用一次 `acquireVsCodeApi()`
- 应该在页面加载时立即调用并缓存结果
- 返回的对象用于所有后续通信

### 消息监听

使用全局 `window.addEventListener('message', handler)` 监听来自扩展的消息：

```typescript
window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data;
  switch (message.type) {
    case 'timelineData':
      // 处理数据
      break;
  }
});
```

## 最佳实践

### 1. 总是使用 VSCode API

```typescript
// ✅ 推荐
const vscode = acquireVsCodeApi();
vscode.postMessage({ type: 'myMessage', data: {...} });

// ❌ 不推荐（不可靠）
window.parent.postMessage({ type: 'myMessage', data: {...} }, '*');
```

### 2. 添加降级方案

```typescript
function initVSCodeApi() {
  const vscode = (globalThis as any).acquireVsCodeApi?.();
  
  if (vscode) {
    // 优先使用 VSCode API
    return createVSCodeApiWrapper(vscode);
  } else {
    // 降级到 window.parent（用于开发或测试）
    return createWindowParentWrapper();
  }
}
```

### 3. 添加详细日志

```typescript
postMessage: (message: any) => {
  console.log('[VSCode API] Sending message:', message.type);
  vscode.postMessage(message);
}
```

### 4. 错误处理

```typescript
if (vscodeApi.value?.postMessage) {
  vscodeApi.value.postMessage(message);
} else {
  console.error('[Error] VSCode API not available');
  // 可选：显示用户友好的错误提示
}
```

## 与 RelationGraphPage 的对比

| 特性 | RelationGraphPage | TimelinePage (修复前) | TimelinePage (修复后) |
|------|------------------|---------------------|---------------------|
| API 初始化 | ✅ `acquireVsCodeApi()` | ❌ 直接用 `window.parent` | ✅ `acquireVsCodeApi()` |
| 降级方案 | ✅ 有 | ❌ 无 | ✅ 有 |
| 错误日志 | ✅ 有 | ❌ 无 | ✅ 有 |
| 消息监听 | ✅ API 封装 | ❌ 直接用 `window` | ✅ API 封装 |
| 消息发送 | ✅ API 封装 | ❌ 直接用 `window.parent` | ✅ API 封装 |

## 总结

修复的核心问题：
1. **错误的通信方式** - 使用 `window.parent.postMessage` 而不是 VSCode API
2. **缺少 API 初始化** - 没有调用 `acquireVsCodeApi()`
3. **缺少降级方案** - 没有备用通信方法
4. **缺少错误处理** - 没有检查 API 是否可用

修复后：
- ✅ 使用正确的 VSCode Webview API
- ✅ 添加了完整的初始化流程
- ✅ 提供了降级方案（开发时有用）
- ✅ 添加了详细的日志和错误处理
- ✅ 与 RelationGraphPage 保持一致的架构

现在消息可以正确地从前端发送到后端，数据变化会被正确同步和保存。
