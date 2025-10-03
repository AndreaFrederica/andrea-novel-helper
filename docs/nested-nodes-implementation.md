# 时间线编辑器嵌套节点功能实现总结

## 📋 实现的功能

### 1. 时间区间支持
- **开始时间 (date)**: 原有字段,格式改为 ISO 8601 精确到秒 (`YYYY-MM-DDTHH:mm:ss`)
- **结束时间 (endDate)**: 新增可选字段,支持时间区间表示
- **显示格式化**: 
  - 有时间时显示: `2024-01-01 08:30 ~ 09:00`
  - 仅日期时显示: `2024-01-01`
  - 单个时间点不显示 `~`

### 2. 节点嵌套支持
- **parentNode**: 亲代节点ID,设置后该节点将作为子节点渲染在亲代节点内
- **extent**: 设置为 `'parent'` 时,子节点被限制在亲代节点范围内移动
- **expandParent**: 布尔值,启用后拖动子节点到边缘会自动扩大亲代节点
- **width/height**: 亲代节点的宽度和高度(像素),用于创建可容纳子节点的容器

### 3. 节点样式增强
亲代节点(有 width/height 的节点)会自动应用:
- 半透明绿色背景 `rgba(16, 185, 129, 0.15)`
- 绿色边框 `2px solid rgba(16, 185, 129, 0.5)`
- 圆角和内边距

### 4. 编辑器UI增强
新增 **"嵌套和布局配置"** 部分,包含:
- 亲代节点ID输入框 (可选)
- 宽度/高度数字输入 (亲代节点专用)
- "限制在亲代节点内移动" 复选框 (extent)
- "自动扩展亲代节点" 复选框 (expandParent)

### 5. 数据持久化
所有新字段都已集成到:
- ✅ `TimelineEvent` 类型定义
- ✅ `saveTimelineData()` 函数
- ✅ `updateFlowElements()` 节点渲染
- ✅ `handleEventSave()` 事件保存
- ✅ 示例数据更新

## 📁 修改的文件

1. **packages/webview/src/types/timeline.ts**
   - 扩展 `TimelineEvent` 接口,新增 6 个字段

2. **packages/webview/src/data/timelineSampleData.ts**
   - 更新时间格式为 ISO 8601 with seconds
   - 添加嵌套节点示例

3. **packages/webview/src/components/TimelineEventEditor.vue**
   - 新增 UI 表单字段
   - 更新 formData 初始化逻辑 (处理 TypeScript exactOptionalPropertyTypes)
   - 更新 watch 处理器复制新字段

4. **packages/webview/src/components/EditableEventNode.vue**
   - 新增 `endDate` 字段到 Props 接口
   - 新增 `formatDateTime()` 函数
   - 时间区间显示支持

5. **packages/webview/src/pages/TimelinePage.vue**
   - `updateFlowElements()`: 应用 parentNode, extent, expandParent, width/height 到 VueFlow 节点
   - `saveTimelineData()`: 保存所有新字段到后端
   - 节点渲染时应用亲代节点样式

## 🧪 测试文件

创建了 `test-files/nested-nodes-timeline.tjson5`,包含:
- 2 个亲代节点 (有 width/height)
- 3 个子节点 (有 parentNode 和 extent)
- 1 个独立支线节点
- 4 条连线展示层级关系

## 📖 使用方法

### 创建亲代节点
1. 创建或编辑一个节点
2. 在 "嵌套和布局配置" 中设置:
   - **宽度**: 例如 400
   - **高度**: 例如 300
3. 保存后节点会变成半透明绿色容器

### 创建子节点
1. 创建或编辑一个节点
2. 在 "嵌套和布局配置" 中设置:
   - **亲代节点ID**: 粘贴亲代节点的 ID
   - 勾选 **"限制在亲代节点内移动"** (推荐)
   - 勾选 **"自动扩展亲代节点"** (可选)
3. 保存后节点会出现在亲代节点内部

### 设置时间区间
1. 编辑节点
2. 设置 **开始时间**: `2024-01-01T08:00:00`
3. 设置 **结束时间**: `2024-01-01T18:00:00`
4. 保存后节点显示时间区间

## 🔧 技术细节

### TypeScript 严格模式处理
由于 `exactOptionalPropertyTypes: true`,不能直接将 `undefined` 赋值给可选的类型化属性:
```typescript
// ❌ 错误
const data: Partial<TimelineEvent> = {
  endDate: undefined, // 类型错误
};

// ✅ 正确
const data: Partial<TimelineEvent> = {
  // 不包含 endDate 字段
};

// ✅ 条件赋值
if (newEvent.endDate) {
  data.endDate = newEvent.endDate;
}
```

### VueFlow 嵌套节点原理
- `parentNode`: 引用亲代节点 ID,VueFlow 会自动处理层级关系
- `extent: 'parent'`: 限制子节点在亲代节点内拖动
- `expandParent: true`: 子节点拖到边缘时自动扩大亲代节点
- `width/height`: 亲代节点的固定尺寸 (CSS 像素)

### 时间格式标准
- **ISO 8601 精确到秒**: `YYYY-MM-DDTHH:mm:ss`
- **示例**: `2024-01-01T08:30:00` (2024年1月1日 8:30:00)
- **纯日期**: `2024-01-01T00:00:00` (显示时会隐藏时间部分)

## ⏭️ 后续改进建议

1. **拖拽调整大小**: 添加亲代节点四个角的拖拽手柄
2. **时间线视图**: 在 TimelineView 组件中渲染时间区间为横向条形
3. **自动布局**: 智能排列子节点,避免重叠
4. **亲代节点创建向导**: 一键创建亲代节点并添加子节点
5. **可视化时间轴**: 根据时间区间长度动态调整节点宽度

## ✅ 验证清单

- [x] 类型定义扩展
- [x] 示例数据更新
- [x] 编辑器 UI 实现
- [x] formData 初始化修复 (TypeScript 严格模式)
- [x] watch 处理器更新
- [x] 节点渲染支持 (parentNode, extent, expandParent, style)
- [x] 节点显示时间区间
- [x] 保存函数包含新字段
- [x] 测试文件创建
- [ ] 实际运行测试 (需要运行 `pixi run dev`)
- [ ] 拖拽调整大小功能
- [ ] TimelineView 时间区间可视化

---

**完成时间**: 2024
**主要贡献**: 扩展时间线编辑器,支持嵌套节点层级结构和精确时间区间
