<template>
  <div class="custom-node" :style="nodeStyle">
    <Handle
      class="handle handle-left"
      type="target"
      :position="Position.Left"
      :style="{
        top: '50%',
        left: '0',
        transform: 'translate(-50%, -50%)',
        background: '#555'
      }"
    />
    <Handle
      class="handle handle-right"
      type="source"
      :position="Position.Right"
      :style="{
        top: '50%',
        right: '0',
        transform: 'translate(50%, -50%)',
        background: '#555'
      }"
    />

    <div class="node-content">
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
          ref="titleInput"
        />
      </div>
      <div v-else class="title-display">
        <div style="font-weight: bold; cursor: pointer" @click="startEdit">
          {{ data.label || '未命名事件' }}
        </div>
      </div>

      <!-- 日期和描述 -->
      <div style="font-size: 0.9em">{{ data.date }}</div>
      <div style="font-size: 0.8em; margin-top: 5px">{{ data.description }}</div>
    </div>

    <!-- 编辑/保存按钮 -->
    <div class="node-actions">
      <q-btn
        v-if="!isEditing"
        @click="startEdit"
        icon="edit"
        size="xs"
        dense
        flat
        style="color: white; position: absolute; top: 5px; right: 5px"
      />
      <q-btn
        v-else
        @click="saveTitle"
        icon="save"
        size="xs"
        dense
        flat
        style="color: white; position: absolute; top: 5px; right: 5px"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, computed } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import { QBtn, QBadge } from 'quasar';

// 定义props
interface Props {
  id: string;
  data: {
    label?: string;
    date: string;
    description: string;
    type: 'main' | 'side';
    group?: string;
  };
}

const props = defineProps<Props>();

// 编辑状态
const isEditing = ref(false);
const editingTitle = ref('');
const titleInput = ref<HTMLInputElement | null>(null);

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

const nodeStyle = computed(() => ({
  background: props.data.type === 'main' ? '#42b883' : '#64748b',
  color: 'white',
  padding: '10px',
  borderRadius: '4px',
  minWidth: '150px',
  position: 'relative' as const,
}));
</script>

<style scoped>
.custom-node {
  user-select: none;
}

.node-content {
  margin-right: 20px; /* 为右侧按钮留出空间 */
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
}

.title-input::placeholder {
  color: rgba(255, 255, 255, 0.6);
}

.node-actions {
  position: absolute;
  top: 0;
  right: 0;
}

.handle {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid #fff;
  cursor: crosshair;
}

/* 确保节点在编辑时不会影响连线位置 */
:deep(.vf-node-connect-handle) {
  z-index: 10;
}
</style>
