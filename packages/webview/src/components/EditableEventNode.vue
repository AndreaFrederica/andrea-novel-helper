<template>
  <div class="custom-node" :style="nodeStyle" @contextmenu="handleContextMenu">
    <!-- NodeResizer - 所有节点都可以调整大小 -->
    <NodeResizer
      :min-width="150"
      :min-height="100"
      @resize="handleResize"
      :color="props.data.type === 'main' ? '#42b883' : '#64748b'"
      :handle-class-name="'resizer-handle'"
    />

    <!-- Handles - 不可拖动 -->
    <Handle
      type="target"
      :position="Position.Left"
      class="custom-handle no-drag"
      @mousedown.stop
    />
    <Handle
      type="source"
      :position="Position.Right"
      class="custom-handle no-drag"
      @mousedown.stop
    />

    <!-- 拖动把手区域 - 只有这个区域可以拖动节点 -->
    <div class="drag-handle">
      <q-icon name="drag_indicator" size="xs" style="color: rgba(255,255,255,0.6)" />
    </div>

    <div class="node-content no-drag">
      <!-- 分组标签 -->
      <div v-if="data.group" class="group-badge">
        <q-badge color="white" text-color="primary" :label="data.group" />
      </div>

      <!-- 标题编辑区域 -->
      <div v-if="isEditing" class="title-edit-container">
        <input
          v-model="editingTitle"
          type="text"
          class="title-input"
          @blur="saveTitle"
          @keyup.enter="saveTitle"
          @keyup.escape="cancelEdit"
          @mousedown.stop
          ref="titleInput"
        />
      </div>
      <div v-else class="title-display" @mousedown.stop>
        <div style="font-weight: bold; cursor: pointer" @click="startEdit">
          {{ data.label || '未命名事件' }}
        </div>
      </div>

      <!-- 日期和描述 -->
      <div style="font-size: 0.9em" @mousedown.stop>
        <template v-if="data.endDate">
          {{ formatDateTime(data.date) }} ~ {{ formatDateTime(data.endDate) }}
        </template>
        <template v-else>
          {{ formatDateTime(data.date) }}
        </template>
      </div>
      <div style="font-size: 0.8em; margin-top: 5px" @mousedown.stop>{{ data.description }}</div>
    </div>

    <!-- 编辑/保存按钮 - 不可拖动 -->
    <div class="node-actions no-drag" @mousedown.stop @click.stop>
      <q-btn
        @click="openFullEditor"
        icon="edit"
        size="sm"
        round
        color="primary"
        style="opacity: 0.9"
      >
        <q-tooltip>完整编辑</q-tooltip>
      </q-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, computed } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import { NodeResizer, type OnResize } from '@vue-flow/node-resizer';
import { QBtn, QBadge, QIcon } from 'quasar';

// 定义props
interface Props {
  id: string;
  data: {
    label?: string;
    date: string;
    endDate?: string;
    description: string;
    type: 'main' | 'side';
    group?: string;
    parentNode?: string; // 添加到 data 中
    hasChildren?: boolean; // 是否有子节点
    color?: string; // 自定义颜色
  };
}

const props = defineProps<Props>();

// 发射事件给父组件
const emit = defineEmits<{
  'open-editor': [id: string];
  'resize': [{ width: number; height: number }];
}>();

// 处理大小调整
function handleResize(params: OnResize) {
  // console.log('[EditableEventNode handleResize] 触发', params);

  // OnResize 的实际数据在 params.params 中
  const resizeParams = (params as any).params;
  // console.log('[EditableEventNode handleResize] resizeParams:', resizeParams);

  const width = resizeParams?.width;
  const height = resizeParams?.height;

  // console.log('[EditableEventNode handleResize] 提取的尺寸:', { width, height });

  if (typeof width === 'number' && typeof height === 'number') {
    emit('resize', { width, height });
    // 通过全局事件通知父组件更新节点尺寸
    const eventData = { id: props.id, width, height };
  // console.log('[EditableEventNode handleResize] 保存到 localStorage:', eventData);
    localStorage.setItem('tempNodeResize', JSON.stringify(eventData));
    window.dispatchEvent(new Event('timeline-node-resize'));
  // console.log('[EditableEventNode handleResize] 已触发全局事件');
  } else {
    // console.warn('[EditableEventNode handleResize] 宽高类型不正确:', typeof width, typeof height);
  }
}

// 编辑状态
const isEditing = ref(false);
const editingTitle = ref('');
const titleInput = ref<HTMLInputElement | null>(null);

// 打开完整编辑器
function openFullEditor() {
  console.log('[EditableEventNode] 打开完整编辑器:', props.id);
  // 通过全局事件通知父组件打开编辑器
  localStorage.setItem('openNodeEditor', props.id);
  window.dispatchEvent(new Event('timeline-open-editor'));
  console.log('[EditableEventNode] 已触发 timeline-open-editor 事件');
}

// 开始编辑
function startEdit() {
  isEditing.value = true;
  editingTitle.value = props.data.label || '';
  // 确保输入框获得焦点
  void nextTick(() => {
    titleInput.value?.focus();
    titleInput.value?.select();
  });
}

// 保存标题
function saveTitle() {
  if (editingTitle.value.trim()) {
    // 使用全局事件总线来传递更新
    const eventData = { id: props.id, label: editingTitle.value.trim() };
    localStorage.setItem('tempNodeUpdate', JSON.stringify(eventData));
    window.dispatchEvent(new Event('timeline-node-update'));
  }
  isEditing.value = false;
}

// 取消编辑
function cancelEdit() {
  isEditing.value = false;
}

// 处理右键菜单
function handleContextMenu(event: MouseEvent) {
  event.preventDefault();
  const eventData = { nodeId: props.id, x: event.clientX, y: event.clientY };
  localStorage.setItem('nodeContextMenu', JSON.stringify(eventData));
  window.dispatchEvent(new Event('timeline-node-contextmenu'));
}

// 格式化日期时间显示
function formatDateTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    // 如果包含时间(不是00:00:00),则显示时间
    if (dateStr.includes('T') && !dateStr.endsWith('T00:00:00')) {
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    // 否则只显示日期
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

const nodeStyle = computed(() => {
  let background: string;
  let border: string | undefined;

  // 如果有自定义颜色，优先使用自定义颜色
  if (props.data.color) {
    if (props.data.hasChildren) {
      // 将自定义颜色转为半透明（简单处理：如果是 hex，转为 rgba；如果已经是 rgba，保持）
      background = props.data.color.startsWith('#')
        ? `${props.data.color}4D` // 添加 30% 透明度 (4D = 77/255 ≈ 30%)
        : props.data.color.replace('rgb(', 'rgba(').replace(')', ', 0.3)');
      border = `2px dashed ${props.data.color}`;
    } else {
      background = props.data.color;
    }
  } else {
    // 使用默认颜色
    const baseColor = props.data.type === 'main' ? '#42b883' : '#64748b';

    if (props.data.hasChildren) {
      // 父节点：半透明背景 + 虚线边框
      background = props.data.type === 'main'
        ? 'rgba(66, 184, 131, 0.3)' // 主线父节点
        : 'rgba(100, 116, 139, 0.3)'; // 支线父节点
      border = `2px dashed ${baseColor}`;
    } else {
      // 普通节点：完全不透明
      background = baseColor;
    }
  }

  return {
    background,
    border,
    color: 'white',
    padding: '10px',
    borderRadius: '4px',
    width: '100%',
    height: '100%',
    boxSizing: 'border-box' as const,
    position: 'relative' as const,
  };
});
</script>

<style scoped>
.custom-node {
  user-select: none;
  cursor: default; /* 默认鼠标样式 */
  position: relative;
  min-width: 150px;
  min-height: 100px;
  display: flex;
  flex-direction: column;
}

/* 拖动把手 - 只有这个区域可以拖动节点 */
.drag-handle {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 28px; /* 固定高度 */
  cursor: move;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 4px 4px 0 0;
  z-index: 5; /* 低于编辑按钮 */
  display: flex;
  justify-content: center;
  align-items: center;
  opacity: 0; /* 默认隐藏 */
  transition: opacity 0.2s ease;
  pointer-events: none; /* 默认不拦截事件 */
}

/* 悬停时启用拖动把手的事件响应 */
.custom-node:hover .drag-handle {
  pointer-events: auto;
}

/* 鼠标悬停节点时显示拖动把手 */
.custom-node:hover .drag-handle {
  opacity: 1;
}

/* 确保 VueFlow 只在 drag-handle 上启用拖动 */
.custom-node :deep(.vue-flow__node-drag-handle) {
  cursor: move;
}

.node-content {
  margin-right: 20px; /* 为右侧按钮留出空间 */
  cursor: default;
  pointer-events: auto;
}

.group-badge {
  margin-bottom: 6px;
}

.title-edit-container {
  margin-bottom: 8px;
}

.title-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 4px;
  padding: 4px 8px;
  color: white;
  font-weight: bold;
  font-size: 1em;
  outline: none;
  cursor: text;
}

.title-input::placeholder {
  color: rgba(255, 255, 255, 0.6);
}

.node-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  cursor: pointer;
  z-index: 15; /* 确保在拖动把手上方 */
  padding: 2px;
}

.custom-handle {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #555;
  border: 2px solid #fff;
  cursor: crosshair !important;
  pointer-events: all;
  z-index: 20; /* 确保 handle 在最上层 */
}

.custom-handle:hover {
  background: #777;
  width: 12px;
  height: 12px;
}

/* 阻止 handle 触发节点拖动 */
:deep(.vue-flow__handle) {
  pointer-events: all !important;
}
</style>
