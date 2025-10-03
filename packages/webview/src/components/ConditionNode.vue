<template>
  <div class="condition-node" :style="nodeStyle" @contextmenu="handleContextMenu">
    <!-- NodeResizer - 条件节点也可以调整大小 -->
    <NodeResizer
      :min-width="150"
      :min-height="100"
      @resize="handleResize"
      :color="'#f59e0b'"
      :handle-class-name="'resizer-handle'"
    />

    <!-- Handles -->
    <Handle
      type="target"
      :position="Position.Top"
      class="custom-handle no-drag"
      @mousedown.stop
    />
    
    <!-- 条件节点通常有两个输出：true 和 false，都在底部 -->
    <Handle
      id="true"
      type="source"
      :position="Position.Bottom"
      :style="{ left: '30%' }"
      class="custom-handle no-drag handle-true"
      @mousedown.stop
    />
    <Handle
      id="false"
      type="source"
      :position="Position.Bottom"
      :style="{ left: '70%' }"
      class="custom-handle no-drag handle-false"
      @mousedown.stop
    />

    <!-- 拖动把手区域 -->
    <div class="drag-handle">
      <q-icon name="drag_indicator" size="xs" style="color: rgba(255,255,255,0.6)" />
    </div>

    <div class="node-content no-drag">
      <!-- 条件图标 -->
      <div class="condition-icon">
        <q-icon name="help" size="md" />
      </div>

      <!-- 标题编辑区域 -->
      <div v-if="isEditing" class="title-edit-container">
        <input
          v-model="editingTitle"
          type="text"
          class="title-input"
          placeholder="条件表达式"
          @blur="saveTitle"
          @keyup.enter="saveTitle"
          @keyup.escape="cancelEdit"
          @mousedown.stop
          ref="titleInput"
        />
      </div>
      <div v-else class="title-display" @mousedown.stop>
        <div style="font-weight: bold; cursor: pointer" @click="startEdit">
          {{ data.label || '未命名条件' }}
        </div>
      </div>

      <!-- 条件说明 -->
      <div style="font-size: 0.8em; margin-top: 5px; opacity: 0.9" @mousedown.stop>
        {{ data.description || '点击编辑条件' }}
      </div>
    </div>

    <!-- 分支标签 - 绝对定位在底部 -->
    <div class="branch-labels no-drag" @mousedown.stop>
      <span class="branch-label branch-true">True</span>
      <span class="branch-label branch-false">False</span>
    </div>

    <!-- 编辑按钮 -->
    <div class="node-actions no-drag" @mousedown.stop @click.stop>
      <q-btn
        @click="openFullEditor"
        icon="settings"
        size="xs"
        dense
        flat
        style="color: white"
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
import { QBtn, QIcon } from 'quasar';

// 定义props
interface Props {
  id: string;
  data: {
    label?: string;
    description?: string;
    hasChildren?: boolean;
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
  // console.log('[ConditionNode handleResize] 触发', params);
  
  const resizeParams = (params as any).params;
  const width = resizeParams?.width;
  const height = resizeParams?.height;
  
  if (typeof width === 'number' && typeof height === 'number') {
    emit('resize', { width, height });
    const eventData = { id: props.id, width, height };
    localStorage.setItem('tempNodeResize', JSON.stringify(eventData));
    window.dispatchEvent(new Event('timeline-node-resize'));
  }
}

// 编辑状态
const isEditing = ref(false);
const editingTitle = ref('');
const titleInput = ref<HTMLInputElement | null>(null);

// 打开完整编辑器
function openFullEditor() {
  localStorage.setItem('openNodeEditor', props.id);
  window.dispatchEvent(new Event('timeline-open-editor'));
}

// 开始编辑
function startEdit() {
  isEditing.value = true;
  editingTitle.value = props.data.label || '';
  void nextTick(() => {
    titleInput.value?.focus();
    titleInput.value?.select();
  });
}

// 保存标题
function saveTitle() {
  if (editingTitle.value.trim()) {
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

const nodeStyle = computed(() => {
  // 条件节点使用圆角矩形样式
  let background: string;
  let border: string | undefined;
  const defaultColor = '#f59e0b'; // 默认橙色
  const baseColor = props.data.color || defaultColor;
  
  if (props.data.hasChildren) {
    // 如果有子节点，使用半透明
    background = baseColor.startsWith('#') 
      ? `${baseColor}4D` // 添加 30% 透明度
      : baseColor.replace('rgb(', 'rgba(').replace(')', ', 0.3)');
    border = `2px dashed ${baseColor}`;
  } else {
    background = baseColor;
  }
  
  return {
    background,
    border,
    color: 'white',
    padding: '10px',
    borderRadius: '8px',
    width: '100%',
    height: '100%',
    boxSizing: 'border-box' as const,
    position: 'relative' as const,
  };
});
</script>

<style scoped>
.condition-node {
  user-select: none;
  cursor: default;
  position: relative;
  min-width: 150px;
  min-height: 100px;
  display: flex;
  flex-direction: column;
}

/* 拖动把手 */
.drag-handle {
  position: absolute;
  left: 50%;
  top: 0;
  transform: translateX(-50%);
  height: 28px;
  cursor: move;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 4px;
  z-index: 5;
  display: flex;
  justify-content: center;
  align-items: center;
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;
  padding: 0 8px;
}

.condition-node:hover .drag-handle {
  pointer-events: auto;
  opacity: 1;
}

.node-content {
  margin-right: 20px;
  cursor: default;
  pointer-events: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 15px;
}

.condition-icon {
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.title-edit-container {
  margin-bottom: 8px;
  width: 100%;
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
  text-align: center;
}

.title-input::placeholder {
  color: rgba(255, 255, 255, 0.6);
}

.title-display {
  text-align: center;
  margin-bottom: 8px;
}

.node-actions {
  position: absolute;
  top: 0;
  right: 0;
  cursor: pointer;
  z-index: 15;
}

.custom-handle {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #555;
  border: 2px solid #fff;
  cursor: crosshair !important;
  pointer-events: all;
  z-index: 20;
}

.custom-handle:hover {
  background: #777;
  width: 12px;
  height: 12px;
}

.handle-true {
  background: #10b981; /* 绿色表示 true */
}

.handle-false {
  background: #ef4444; /* 红色表示 false */
}

.branch-labels {
  display: flex;
  justify-content: space-around;
  width: 100%;
  margin-top: 8px;
  font-size: 0.7em;
  font-weight: bold;
  position: absolute;
  bottom: 5px;
  left: 0;
  right: 0;
}

.branch-label {
  padding: 2px 6px;
  border-radius: 3px;
  opacity: 0.8;
}

.branch-true {
  background: rgba(16, 185, 129, 0.3);
}

.branch-false {
  background: rgba(239, 68, 68, 0.3);
}

:deep(.vue-flow__handle) {
  pointer-events: all !important;
}
</style>
