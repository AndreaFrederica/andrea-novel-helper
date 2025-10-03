# 时间线编辑器使用说明

## 概述

时间线编辑器（Timeline JSON5 Editor）是一个可视化编辑器，用于编辑 `.tjson5` 格式的时间线文件。它支持实时同步、自动保存，并与 VSCode 的保存机制深度集成。

## 文件格式

### `.tjson5` 文件结构

```json5
{
  events: [
    {
      id: "1",
      title: "事件标题",
      group: "主要情节",
      type: "main",
      date: "2024-01-01",
      description: "事件描述",
      timeless: false,
      position: {
        x: 0,
        y: 100
      },
      bindings: [
        {
          uuid: "role-uuid-123",
          type: "character",
          label: "主角"
        }
      ],
      data: {
        type: "main"
      }
    }
  ],
  connections: [
    {
      id: "conn-1",
      source: "1",
      target: "2",
      label: "导致",
      connectionType: "normal"
    }
  ]
}
```

## 自动保存机制

### 1. 实时数据同步

当您在编辑器中修改事件或连接时：
- 前端立即发送 `dataChanged` 消息
- 后端同步更新文档内容
- VSCode 显示 **未保存状态**（文件名旁出现白点 ●）
- 数据变化被跟踪，但不会立即写入磁盘

### 2. 自动保存模式

根据 VSCode 的 `files.autoSave` 设置：

#### ✅ 自动保存开启 (`afterDelay` / `onFocusChange` / `onWindowChange`)
- 数据变化后自动触发保存
- 文档会自动写入磁盘
- 无需手动 Ctrl+S

#### ⚠️ 自动保存关闭 (`off`)
- 数据变化标记为未保存状态
- 需要手动保存（Ctrl+S）
- 保存时会应用所有挂起的更改

### 3. 消息协议

#### 前端 → 后端

| 消息类型 | 说明 | 数据格式 |
|---------|------|---------|
| `dataChanged` | 实时数据变化通知 | `{ events: [], connections: [] }` |
| `saveTimelineData` | 显式保存请求 | `{ events: [], connections: [] }` |
| `requestTimelineData` | 请求初始数据 | 无 |

#### 后端 → 前端

| 消息类型 | 说明 | 数据格式 |
|---------|------|---------|
| `timelineData` | 时间线数据 | `{ events: [], connections: [] }` |
| `dataChangeAck` | 数据变化确认 | `{ ok: true }` |
| `saveAck` | 保存确认 | `{ ok: true, queued: boolean }` |

## 使用流程

### 创建时间线文件

1. 在资源包目录中创建新文件，命名为 `*.tjson5`
   - 例如：`timeline.tjson5`、`main-story-timeline.tjson5`

2. VSCode 会自动识别 `.tjson5` 文件并使用时间线编辑器打开

### 编辑时间线

1. **添加事件**
   - 点击"添加事件"按钮
   - 填写事件信息（标题、日期、描述等）
   - 拖拽调整事件位置

2. **创建连接**
   - 从一个事件拖拽到另一个事件
   - 选择连接类型
   - 添加连接标签

3. **实时保存**
   - 每次修改都会触发 `dataChanged` 消息
   - 后端自动同步到文档
   - 根据自动保存设置决定是否立即写入磁盘

### 包管理器集成

`.tjson5` 文件会在包管理器中显示：
- ✅ **显示**：在资源包树中可见
- ❌ **不计入字数统计**：不影响小说字数统计

## 技术细节

### 防止更新循环

使用 **mute window（静音窗口）** 机制：
- 后端更新文档后，设置 300ms 静音期
- 在静音期内忽略文档变化事件
- 防止前端 → 后端 → 前端的无限循环

### 坐标持久化

事件的 `position` 字段会被保存：
```json5
{
  position: {
    x: 100,  // 画布上的 X 坐标
    y: 200   // 画布上的 Y 坐标
  }
}
```

下次打开时，事件会出现在原来的位置。

### 数据验证

后端会验证数据格式：
- 必须包含 `events` 数组
- 必须包含 `connections` 数组
- 如果格式错误，返回空数据

## 故障排查

### 问题：数据没有保存

**检查项：**
1. 查看 VSCode 状态栏是否显示"未保存"标记
2. 检查 `files.autoSave` 设置
3. 如果自动保存关闭，手动按 Ctrl+S 保存

### 问题：编辑器不能打开 .tjson5 文件

**解决方案：**
1. 确认文件扩展名确实是 `.tjson5`
2. 重启 VSCode
3. 检查扩展是否正确激活

### 问题：数据格式错误

**解决方案：**
1. 打开 `.tjson5` 文件的文本编辑器
2. 检查 JSON5 语法是否正确
3. 确认包含 `events` 和 `connections` 字段

## 与关系图编辑器的对比

| 特性 | 时间线编辑器 | 关系图编辑器 |
|------|------------|------------|
| 文件格式 | `.tjson5` | `.rjson5` |
| 数据结构 | `{ events, connections }` | `{ nodes, lines }` |
| 用途 | 时间轴可视化 | 人物关系图 |
| 字数统计 | ❌ 不计入 | ❌ 不计入 |
| 包管理器 | ✅ 显示 | ✅ 显示 |
| 实时同步 | ✅ 支持 | ✅ 支持 |
| 自动保存 | ✅ 支持 | ✅ 支持 |

## 开发者注意事项

### 前端消息发送

使用 `dataChanged` 进行实时同步：
```typescript
window.parent.postMessage({
  type: 'dataChanged',
  data: {
    events: plainEvents,
    connections: plainConnections,
  }
}, '*');
```

### 后端消息处理

两个核心方法：
- `syncJsonDataChange()` - 实时同步，触发 dirty 状态
- `scheduleWrite()` - 按自动保存策略写入

### 序列化问题

⚠️ **重要**：发送前必须将 Vue reactive 对象转换为 plain object：
```typescript
const plainEvents = events.value.map(event => ({
  id: event.id,
  title: event.title,
  // ... 其他字段
}));
```

否则会导致 `DataCloneError`。
