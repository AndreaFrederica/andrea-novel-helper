# 时间线编辑器 UI 改进总结

## 📝 本次更新内容

### 1. 术语优化
将所有"父节点"相关术语改为"亲代节点",以避免潜在的敏感性问题。

#### 修改范围:
- ✅ `TimelineEventEditor.vue` - 所有UI文本
- ✅ `CHANGELOG.md` - 更新日志
- ✅ `docs/nested-nodes-quick-guide.md` - 快速指南
- ✅ `docs/nested-nodes-implementation.md` - 实现文档
- ✅ `docs/nested-nodes-test-checklist.md` - 测试清单

#### 术语对照表:
| 旧术语 | 新术语 |
|--------|--------|
| 父节点 | 亲代节点 |
| 父节点ID | 亲代节点 |
| 限制在父节点内移动 | 限制在亲代节点内移动 |
| 自动扩展父节点 | 自动扩展亲代节点 |

**注意**: 代码层面的变量名(`parentNode`)保持不变,仅更新用户可见的UI文本。

---

### 2. 亲代节点选择器改进

#### 从输入框改为下拉选择框

**之前** (输入框):
```vue
<q-input
  v-model="formData.parentNode"
  label="父节点ID (可选)"
  hint="输入父节点的ID使此节点成为子节点"
  clearable
/>
```

**现在** (下拉选择框):
```vue
<q-select
  v-model="formData.parentNode"
  :options="availableParentNodes"
  label="亲代节点 (可选)"
  hint="选择亲代节点使此节点成为子节点"
  clearable
  emit-value
  map-options
  option-label="label"
  option-value="value"
/>
```

#### 智能过滤逻辑

下拉选项自动过滤:
1. **排除当前节点本身** - 避免节点成为自己的亲代
2. **排除已有亲代的节点** - 防止嵌套过深(限制为两层)
3. **仅显示可用节点** - 只显示可以作为亲代的节点

#### 选项显示格式

```
<节点标题> (<节点ID前8位>...)
```

示例:
```
第一章:相遇 (0192a5e0...)
第二章:冲突 (0192a5e1...)
```

---

### 3. 技术实现细节

#### 新增 Props
```typescript
interface Props {
  modelValue: boolean;
  event?: TimelineEvent | null;
  allEvents?: TimelineEvent[];  // 新增:所有事件列表
}
```

#### 计算属性
```typescript
const availableParentNodes = computed(() => {
  if (!props.allEvents) return [];
  
  const currentEventId = props.event?.id;
  
  return props.allEvents
    .filter(e => {
      // 排除当前节点本身
      if (e.id === currentEventId) return false;
      // 排除已经是子节点的节点(避免嵌套过深)
      if (e.parentNode) return false;
      return true;
    })
    .map(e => ({
      label: `${e.title} (${e.id.substring(0, 8)}...)`,
      value: e.id,
    }));
});
```

#### TimelinePage 传递数据
```vue
<TimelineEventEditor
  v-model="isEditDialogOpen"
  :event="editingEvent"
  :all-events="events"  <!-- 新增 -->
  @save="handleEventSave"
/>
```

---

## 🎯 用户体验改进

### 改进前的痛点:
1. ❌ 用户需要手动复制粘贴节点ID
2. ❌ 容易输入错误的ID
3. ❌ 不知道哪些节点可以作为亲代
4. ❌ 可能创建无效的嵌套关系
5. ❌ "父节点"术语可能引起不适

### 改进后的优势:
1. ✅ 点击下拉框即可选择
2. ✅ 自动显示节点标题,易于识别
3. ✅ 只显示可用的亲代节点
4. ✅ 防止无效的嵌套关系
5. ✅ 使用中性的"亲代节点"术语

---

## 📸 UI 对比

### 选择亲代节点

**之前**:
```
┌─────────────────────────────────────┐
│ 父节点ID (可选)                      │
│ ┌─────────────────────────────────┐ │
│ │ [输入框需要手动粘贴ID]           │ │
│ └─────────────────────────────────┘ │
│ 输入父节点的ID使此节点成为子节点     │
└─────────────────────────────────────┘
```

**现在**:
```
┌─────────────────────────────────────┐
│ 亲代节点 (可选)                      │
│ ┌─────────────────────────────────┐ │
│ │ 第一章:相遇 (0192a5e0...)    ▼  │ │
│ └─────────────────────────────────┘ │
│ 选择亲代节点使此节点成为子节点       │
└─────────────────────────────────────┘
```

---

## ✅ 测试验证

### 功能测试
- [x] 下拉框正确显示可用亲代节点
- [x] 当前节点不出现在选项中
- [x] 已有亲代的节点不出现在选项中
- [x] 选项格式正确显示标题和ID
- [x] 选择后正确保存到 formData.parentNode
- [x] 清空按钮正确工作
- [x] 无可用节点时显示"无可用的亲代节点"

### 兼容性测试
- [x] TypeScript 编译无错误
- [x] 现有功能不受影响
- [x] 保存/加载数据正常
- [x] 节点渲染正常

---

## 📋 相关代码变更

### 修改的文件
1. `packages/webview/src/components/TimelineEventEditor.vue`
   - 导入 `computed` from vue
   - 添加 `allEvents` props
   - 添加 `availableParentNodes` 计算属性
   - 将输入框改为下拉选择框
   - 更新所有"父节点"为"亲代节点"

2. `packages/webview/src/pages/TimelinePage.vue`
   - 传递 `:all-events="events"` 给编辑器

3. `CHANGELOG.md`
   - 更新术语为"亲代节点"
   - 添加下拉选择框功能说明

4. `docs/*.md` (3个文件)
   - 批量替换"父节点"为"亲代节点"

---

## 🔮 未来可能的改进

1. **可视化选择**: 在时间线画布上直接点击节点作为亲代
2. **拖拽建立关系**: 拖动节点到另一个节点上建立亲代关系
3. **多层嵌套**: 支持超过两层的嵌套结构
4. **亲代节点预览**: 下拉框显示节点缩略图
5. **快速创建**: 一键创建亲代节点并添加当前节点为子节点

---

**更新日期**: 2025-10-03  
**影响范围**: UI/UX, 文档术语  
**向后兼容**: ✅ 完全兼容  
**破坏性变更**: ❌ 无
