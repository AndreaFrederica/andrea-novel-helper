<template>
  <q-layout class="layout-no-size">
    <!-- 左侧边栏（由 q-layout 管理，框架将自动挤压主内容） -->
    <q-drawer
      v-model="drawerOpen"
      side="left"
      bordered
      :breakpoint="0"
      :class="['drawer-fullheight']"
      style="height: 100vh"
    >
      <q-scroll-area class="fit">
        <div class="q-pa-md">
          <div class="row items-center justify-between q-mb-sm">
            <div class="text-subtitle1">事件（{{ events.length }}）</div>
            <q-btn
              dense
              flat
              round
              icon="close"
              @click="drawerOpen = false"
            >
              <q-tooltip>关闭事件列表</q-tooltip>
            </q-btn>
          </div>

          <q-list separator>
            <!-- 如果没有事件，显示提示 -->
            <div v-if="events.length === 0">
              <q-item>
                <q-item-section>
                  <q-item-label class="text-center text-gray-500">暂无事件</q-item-label>
                </q-item-section>
              </q-item>
            </div>
            <template v-else>
              <!-- 直接显示所有事件 -->
              <q-item
                v-for="event in events"
                :key="event.id"
                clickable
                class="cursor-pointer hover:bg-gray-100"
              >
                <q-item-section>
                  <q-item-label class="font-medium">{{ event.title }}</q-item-label>
                  <q-item-label caption
                    >{{ event.date }} - {{ event.group }} -
                    {{ event.type === 'main' ? '主要' : '次要' }}</q-item-label
                  >
                </q-item-section>
                <q-item-section side>
                  <q-btn
                    @click.stop="deleteEvent(event.id)"
                    color="negative"
                    size="sm"
                    icon="delete"
                  />
                </q-item-section>
              </q-item>
            </template>
          </q-list>

          <!-- 列表风格的“添加事件”项 -->
          <div class="q-pa-sm">
            <q-item clickable dense class="hoverable" @click="openAddDialog">
              <q-item-section avatar>
                <q-icon name="add" color="primary" />
              </q-item-section>
              <q-item-section>
                <div class="text-subtitle2">添加事件</div>
              </q-item-section>
            </q-item>
          </div>
        </div>
      </q-scroll-area>
    </q-drawer>

    <!-- 设置侧边栏 -->
    <q-drawer
      v-model="settingsDrawerOpen"
      side="right"
      bordered
      :breakpoint="0"
      :class="['drawer-fullheight']"
      style="height: 100vh; width: 380px; z-index: 2000"
    >
      <q-scroll-area class="fit">
        <div class="q-pa-md">
          <div class="row items-center justify-between q-mb-md" style="min-height: 40px;">
            <div class="text-h6">渲染设置</div>
            <q-btn
              dense
              flat
              round
              icon="close"
              @click="settingsDrawerOpen = false"
              style="flex-shrink: 0;"
            >
              <q-tooltip>关闭设置</q-tooltip>
            </q-btn>
          </div>

          <TimelineRenderSettings />
        </div>
      </q-scroll-area>
    </q-drawer>

    <!-- 右侧边栏（数据快照） -->
    <q-drawer
      v-model="snapshotDrawerOpen"
      side="right"
      bordered
      :breakpoint="0"
      :class="['drawer-fullheight']"
      style="height: 100vh; width: 400px; z-index: 2000"
    >
      <q-scroll-area class="fit">
        <div class="q-pa-md">
          <div class="row items-center justify-between q-mb-md">
            <div class="text-h6">当前数据快照</div>
            <q-btn
              dense
              flat
              round
              icon="close"
              @click="snapshotDrawerOpen = false"
            >
              <q-tooltip>关闭数据快照</q-tooltip>
            </q-btn>
          </div>
          <q-card flat bordered>
            <q-card-section>
              <pre style="white-space: pre-wrap; word-wrap: break-word;">{{ timelineData }}</pre>
            </q-card-section>
          </q-card>
        </div>
      </q-scroll-area>
    </q-drawer>

    <!-- 右侧主体：100vh 可滚动 -->
    <q-page-container class="layout-no-size" style="height: 100vh; overflow: hidden">
      <!-- 添加事件对话框 -->
      <q-dialog v-model="isAddDialogOpen" persistent>
        <q-card style="max-width: 500px; width: 90vw">
          <q-card-section>
            <div class="text-xl font-bold">添加新事件</div>
          </q-card-section>
          <q-card-section>
            <q-form @submit.prevent="addEvent">
              <q-input v-model="eventForm.title" label="事件标题" required filled class="q-mb-md" />
              <q-input v-model="eventForm.group" label="事件分组" required filled class="q-mb-md" />
              <q-select
                v-model="eventForm.type"
                label="事件类型"
                :options="[
                  { label: '主要事件', value: 'main' },
                  { label: '次要事件', value: 'side' },
                ]"
                filled
                class="q-mb-md"
              />
              <q-input
                v-model="eventForm.date"
                type="date"
                label="事件日期"
                required
                filled
                class="q-mb-md"
              />
              <q-input
                v-model="eventForm.description"
                label="事件描述"
                type="textarea"
                filled
                class="q-mb-md"
              />
              <div class="row justify-end">
                <q-btn label="取消" @click="isAddDialogOpen = false" class="q-mr-sm" />
                <q-btn label="添加" type="submit" color="primary" />
              </div>
            </q-form>
          </q-card-section>
        </q-card>
      </q-dialog>

      <!-- 删除/编辑连线对话框 -->
      <q-dialog v-model="deleteConnectionDialog" persistent>
        <q-card>
          <q-card-section class="row items-center">
            <q-avatar icon="link" color="primary" text-color="white" />
            <span class="q-ml-sm">要对这条连线进行什么操作？</span>
          </q-card-section>

          <q-card-section class="text-caption text-grey-6">
            提示：右键点击连线可直接打开编辑器
          </q-card-section>

          <q-card-actions align="right">
            <q-btn flat label="取消" color="primary" v-close-popup />
            <q-btn
              flat
              label="编辑"
              color="primary"
              @click="editConnectionFromDialog"
            />
            <q-btn
              flat
              label="删除"
              color="negative"
              @click="deleteConnection"
              v-close-popup
            />
          </q-card-actions>
        </q-card>
      </q-dialog>

      <!-- 示例数据初始化对话框 -->
      <q-dialog v-model="showSampleDataDialog" persistent>
        <q-card style="min-width: 350px">
          <q-card-section>
            <div class="text-h6">初始化时间线</div>
          </q-card-section>

          <q-card-section class="q-pt-none">
            当前文件为空，是否使用示例数据初始化？<br />
            <span class="text-caption text-grey-6">
              示例数据包含 5 个事件和 5 个连接，可帮助您快速了解时间线编辑器的功能。
            </span>
          </q-card-section>

          <q-card-actions align="right">
            <q-btn flat label="不使用" color="grey" @click="declineUseSampleData" />
            <q-btn
              flat
              label="使用示例数据"
              color="primary"
              @click="confirmUseSampleData"
            />
          </q-card-actions>
        </q-card>
      </q-dialog>

      <!-- 节点编辑器对话框 -->
      <TimelineEventEditor
        v-model="isEditDialogOpen"
        :event="editingEvent"
        :all-events="events"
        @save="handleEventSave"
      />

      <!-- 连线编辑器对话框 -->
      <ConnectionEditor
        v-model="isConnectionEditDialogOpen"
        :connection="editingConnection"
        :source-event-title="getEventTitle(editingConnection?.source)"
        :target-event-title="getEventTitle(editingConnection?.target)"
        @save="handleConnectionSave"
        @delete="handleConnectionDelete"
      />

      <!-- 右键菜单 -->
      <q-menu
        v-model="contextMenu.show"
        context-menu
        auto-close
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px', position: 'fixed' }"
      >
        <q-list dense style="min-width: 180px">
          <!-- 画布右键菜单 -->
          <template v-if="contextMenu.canvasClick">
            <q-item clickable @click="createNodeAtPosition">
              <q-item-section avatar>
                <q-icon name="add_circle" color="primary" />
              </q-item-section>
              <q-item-section>创建节点</q-item-section>
            </q-item>
            <q-separator v-if="clipboard.event" />
            <q-item v-if="clipboard.event" clickable @click="pasteNode">
              <q-item-section avatar>
                <q-icon name="content_paste" color="primary" />
              </q-item-section>
              <q-item-section>粘贴</q-item-section>
              <q-item-section side>
                <q-badge color="grey">{{ clipboard.type === 'cut' ? '剪切' : '复制' }}</q-badge>
              </q-item-section>
            </q-item>
          </template>

          <!-- 节点右键菜单 -->
          <template v-else>
            <q-item clickable @click="copyNode">
              <q-item-section avatar>
                <q-icon name="content_copy" color="primary" />
              </q-item-section>
              <q-item-section>复制</q-item-section>
              <q-item-section side>
                <q-badge color="grey">Ctrl+C</q-badge>
              </q-item-section>
            </q-item>
            <q-item clickable @click="cutNode">
              <q-item-section avatar>
                <q-icon name="content_cut" color="orange" />
              </q-item-section>
              <q-item-section>剪切</q-item-section>
              <q-item-section side>
                <q-badge color="grey">Ctrl+X</q-badge>
              </q-item-section>
            </q-item>
            <q-separator />
            <q-item clickable @click="deleteNodeFromContext">
              <q-item-section avatar>
                <q-icon name="delete" color="negative" />
              </q-item-section>
              <q-item-section>删除</q-item-section>
              <q-item-section side>
                <q-badge color="grey">Del</q-badge>
              </q-item-section>
            </q-item>
          </template>
        </q-list>
      </q-menu>

      <!-- 时间轴可视化与画布 -->
      <q-page class="timeline-workspace column no-wrap">
        <!-- 顶部时间线面板（可折叠） -->
        <div class="timeline-top-panel" :class="{ 'timeline-top-panel--open': timelineDrawerOpen }">
          <div class="timeline-panel-header" @click="toggleTimelinePanel">
            <div class="text-subtitle1 text-weight-medium">时间线视图</div>
            <q-btn
              dense
              flat
              round
              :icon="timelineDrawerOpen ? 'expand_less' : 'expand_more'"
              @click.stop="toggleTimelinePanel"
            >
              <q-tooltip>{{ timelineDrawerOpen ? '收起' : '展开' }}时间线</q-tooltip>
            </q-btn>
          </div>
          <q-slide-transition>
            <div v-show="timelineDrawerOpen" class="timeline-panel-body-wrapper">
              <div class="timeline-panel-body" :style="{ height: `${timelinePanelHeight}px` }">
                <TimelineView :events="events" :connections="connections" />
                <!-- 底部拖动调整条 -->
                <div
                  class="timeline-resize-handle"
                  @mousedown="startResize"
                >
                  <div class="timeline-resize-indicator"></div>
                </div>
              </div>
            </div>
          </q-slide-transition>
        </div>

        <!-- 流程图画布区域 -->
        <div class="timeline-flow">
          <!-- 左上角工具栏 -->
          <div class="toolbar-top-left">
            <q-btn
              v-if="!drawerOpen"
              dense
              flat
              round
              icon="menu"
              @click="drawerOpen = true"
            >
              <q-tooltip>打开事件列表</q-tooltip>
            </q-btn>
          </div>

          <!-- 右上角工具栏 -->
          <div class="toolbar-top-right">
            <q-btn
              v-if="!timelineDrawerOpen && !settingsDrawerOpen && !snapshotDrawerOpen"
              dense
              flat
              round
              icon="timeline"
              @click="timelineDrawerOpen = true"
              class="q-mr-sm"
            >
              <q-tooltip>打开时间线视图</q-tooltip>
            </q-btn>
            <q-btn
              v-if="!settingsDrawerOpen && !snapshotDrawerOpen && !timelineDrawerOpen"
              dense
              flat
              round
              icon="settings"
              @click="settingsDrawerOpen = true"
              class="q-mr-sm"
            >
              <q-tooltip>打开设置</q-tooltip>
            </q-btn>
            <q-btn
              v-if="!snapshotDrawerOpen && !settingsDrawerOpen && !timelineDrawerOpen"
              dense
              flat
              round
              icon="visibility"
              @click="snapshotDrawerOpen = true"
            >
              <q-tooltip>打开数据快照</q-tooltip>
            </q-btn>
          </div>

          <VueFlow
            class="timeline-flow__canvas w-full h-full"
            :class="{ 'edges-on-top': settingsStore.edgesOnTop }"
            :nodes="nodes"
            :edges="edges"
            fit-view-on-init
            :node-types="nodeTypes"
            :connection-radius="30"
            :edges-updatable="true"
            :nodes-draggable="true"
            :node-drag-threshold="0"
            :snap-to-grid="false"
            :elevate-edges-on-select="true"
            :allow-self-loops="true"
            no-drag-class-name="no-drag"
            @edges-change="onEdgesChange"
            @pane-context-menu="showCanvasContextMenu"
          >
            <Background v-if="settingsStore.showBackground" />
            <Controls v-if="settingsStore.showControls" />
            <MiniMap v-if="settingsStore.showMiniMap" />
          </VueFlow>
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, reactive, nextTick } from 'vue';
import { MarkerType, VueFlow, useVueFlow, Position } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MiniMap } from '@vue-flow/minimap';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vue-flow/controls/dist/style.css';
import '@vue-flow/minimap/dist/style.css';
import { generateUUIDv7 } from '../utils/uuid';
import EditableEventNode from '../components/EditableEventNode.vue';
import TimelineEventEditor from '../components/TimelineEventEditor.vue';
import ConnectionEditor from '../components/ConnectionEditor.vue';
import TimelineView from '../components/TimelineView.vue';
import TimelineRenderSettings from '../components/TimelineRenderSettings.vue';
import { useTimelineSettingsStore } from '../stores/timeline-settings';
import type { TimelineEvent, TimelineConnection, TimelineData, BindingReference } from '../types/timeline';
import { sampleEvents, sampleConnections } from '../data/timelineSampleData';

// 使用VueFlow组合式函数
const { onInit, onNodeDragStop, onConnect, onEdgeClick, onNodesChange, addEdges, removeEdges, toObject } = useVueFlow();

// 使用 Pinia store
const settingsStore = useTimelineSettingsStore();

// VSCode API 通信接口
const vscodeApi = ref<{
  postMessage: (message: any) => void;
  addEventListener: (type: string, listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: string, listener: (event: MessageEvent) => void) => void;
} | null>(null);

// 初始化VSCode API
function initVSCodeApi() {
  // 尝试获取VSCode webview API
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


// 响应式状态
const events = ref<TimelineEvent[]>([]);
const connections = ref<TimelineConnection[]>([]);
const nodes = ref<any[]>([]);
const edges = ref<any[]>([]);
const drawerOpen = ref(true);
const timelineDrawerOpen = ref(false); // 时间线抽屉默认收起
const timelinePanelHeight = ref(400); // 时间线面板高度（px）
const snapshotDrawerOpen = ref(false);
const settingsDrawerOpen = ref(false);
const isAddDialogOpen = ref(false);
const isEditDialogOpen = ref(false);
const editingEvent = ref<TimelineEvent | null>(null);
const isConnectionEditDialogOpen = ref(false);
const editingConnection = ref<TimelineConnection | null>(null);
const isLoading = ref(false);
const deleteConnectionDialog = ref(false);
const connectionToDelete = ref<string | null>(null);
const showSampleDataDialog = ref(false);

// 右键菜单相关
const contextMenu = ref({
  show: false,
  x: 0,
  y: 0,
  nodeId: null as string | null,
  canvasClick: false, // 是否是画布右键
});

// 剪贴板
const clipboard = ref<{
  type: 'copy' | 'cut' | null;
  event: TimelineEvent | null;
}>({
  type: null,
  event: null,
});

// 时间线面板调整相关
const isResizing = ref(false);
const resizeStartY = ref(0);
const resizeStartHeight = ref(0);

function startResize(event: MouseEvent) {
  isResizing.value = true;
  resizeStartY.value = event.clientY;
  resizeStartHeight.value = timelinePanelHeight.value;

  document.addEventListener('mousemove', handleResize);
  document.addEventListener('mouseup', stopResize);
  event.preventDefault();
}

function handleResize(event: MouseEvent) {
  if (!isResizing.value) return;

  const deltaY = event.clientY - resizeStartY.value;
  const newHeight = resizeStartHeight.value + deltaY;

  // 限制最小和最大高度
  const minHeight = 200;
  const maxHeight = window.innerHeight * 0.8;
  timelinePanelHeight.value = Math.max(minHeight, Math.min(maxHeight, newHeight));
}

function stopResize() {
  if (isResizing.value) {
    isResizing.value = false;
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
    saveTimelineViewState();
  }
}

// 切换时间线面板展开/收起
function toggleTimelinePanel() {
  timelineDrawerOpen.value = !timelineDrawerOpen.value;
}

// 保存时间线视图状态
function saveTimelineViewState() {
  const state = {
    isOpen: timelineDrawerOpen.value,
    height: timelinePanelHeight.value,
  };
  localStorage.setItem('timeline-view-state', JSON.stringify(state));
}

// 加载时间线视图状态
function loadTimelineViewState() {
  try {
    const saved = localStorage.getItem('timeline-view-state');
    if (saved) {
      const state = JSON.parse(saved);
      timelineDrawerOpen.value = state.isOpen ?? false;
      timelinePanelHeight.value = state.height ?? 400;
    }
  } catch (error) {
    console.error('加载时间线视图状态失败:', error);
  }
}

// 计算属性：完整数据快照
const timelineData = computed<TimelineData>(() => ({
  events: events.value,
  connections: connections.value,
}));

// 新建/编辑事件表单
const eventForm = reactive({
  id: '',
  title: '',
  group: '',
  type: 'main' as 'main' | 'side',
  date: new Date().toISOString().split('T')[0] || '',
  description: '',
});

// Vue Flow相关
const nodeTypes = ref<any>({
  editable: EditableEventNode,
});

// VueFlow事件钩子
onInit((vueFlowInstance) => {
  void vueFlowInstance.fitView();
});

onNodeDragStop(({ event, nodes: draggedNodes, node }) => {
  console.log('节点拖动停止', { event, nodes: draggedNodes, node });
  // 保存节点位置
  if (node && node.position) {
    const eventIndex = events.value.findIndex((e) => e.id === node.id);
    if (eventIndex !== -1 && events.value[eventIndex]) {
      events.value[eventIndex].position = {
        x: node.position.x,
        y: node.position.y,
      };
      void saveTimelineData();
    }
  }
});

// 监听节点变化（包括位置变化）- 只更新位置，不重建节点
onNodesChange((changes) => {
  changes.forEach((change) => {
    if (change.type === 'position' && change.position && change.id) {
      const eventIndex = events.value.findIndex((e) => e.id === change.id);
      if (eventIndex !== -1 && events.value[eventIndex] && change.position) {
        // 只更新位置数据，不触发 updateFlowElements
        events.value[eventIndex].position = {
          x: change.position.x,
          y: change.position.y,
        };
      }
    }
  });
});

onConnect((params) => {
  console.log('新建连接', params);
  // 添加到 connections 数组,默认为 normal 类型
  const newConnection: TimelineConnection = {
    id: generateUUIDv7(),
    source: params.source,
    target: params.target,
    connectionType: 'normal', // 默认为正常顺序
  };
  connections.value.push(newConnection);

  // 更新显示
  updateFlowElements();
  void saveTimelineData();
});

// 点击边时打开编辑器
onEdgeClick(({ edge, event }) => {
  console.log('点击边', edge);

  // 检查是否是右键点击
  const mouseEvent = event as MouseEvent;
  if (mouseEvent.button === 2 || mouseEvent.ctrlKey) {
    // 右键或 Ctrl+左键: 打开编辑器
    const conn = connections.value.find((c) => c.id === edge.id);
    if (conn) {
      editingConnection.value = { ...conn };
      isConnectionEditDialogOpen.value = true;
    }
  } else {
    // 左键: 显示删除对话框
    connectionToDelete.value = edge.id;
    deleteConnectionDialog.value = true;
  }
});

// 处理边的变化（包括删除）
function onEdgesChange(changes: any[]) {
  console.log('边变化', changes);
  // 处理删除操作
  changes.forEach((change) => {
    if (change.type === 'remove') {
      const edgeId = change.id;
      connections.value = connections.value.filter((conn) => conn.id !== edgeId);
      void saveTimelineData();
    }
  });
}

// 打开添加事件对话框
function openAddDialog() {
  Object.assign(eventForm, {
    id: '',
    title: '',
    group: '',
    type: 'main' as 'main' | 'side',
    date: new Date().toISOString().split('T')[0] || '',
    description: '',
  });
  isAddDialogOpen.value = true;
}

// 添加事件
function addEvent() {
  const newEvent: TimelineEvent = {
    ...eventForm,
    id: generateUUIDv7(),
    data: {
      type: eventForm.type,
    },
  };

  events.value.push(newEvent);
  updateFlowElements();
  void saveTimelineData();

  // 根据设置决定是否关闭弹窗
  if (settingsStore.closeAfterAdd) {
    isAddDialogOpen.value = false;
  } else {
    // 不关闭弹窗，但清空表单以便继续添加
    eventForm.title = '';
    eventForm.description = '';
    eventForm.group = '';
    eventForm.date = new Date().toISOString().split('T')[0] || '';
  }
}

// 更新事件
function updateEvent() {
  const index = events.value.findIndex((e) => e.id === eventForm.id);
  if (index !== -1) {
    events.value[index] = {
      ...eventForm,
      data: {
        type: eventForm.type,
      },
    };
    updateFlowElements();
    void saveTimelineData();
    isEditDialogOpen.value = false;
  }
}

// 删除事件
function deleteEvent(id: string) {
  events.value = events.value.filter((event) => event.id !== id);
  // 同时删除相关的连线
  connections.value = connections.value.filter(
    (conn) => conn.source !== id && conn.target !== id
  );
  updateFlowElements();
  void saveTimelineData();
}

// 打开节点编辑器
function openNodeEditor(id: string) {
  const event = events.value.find((e) => e.id === id);
  if (event) {
    editingEvent.value = { ...event };
    isEditDialogOpen.value = true;
  }
}

// 处理事件保存
function handleEventSave(updatedEvent: Partial<TimelineEvent>) {
  if (!editingEvent.value?.id) return;

  const index = events.value.findIndex((e) => e.id === editingEvent.value?.id);
  if (index !== -1) {
    const existingEvent = events.value[index];
    if (existingEvent) {
      // 直接更新,使用对象展开保持类型安全
      events.value[index] = {
        ...existingEvent,
        ...updatedEvent,
        id: existingEvent.id, // ID永不变
      } as TimelineEvent;

      updateFlowElements();
      void saveTimelineData();
    }
  }

  // 根据设置决定是否关闭弹窗
  if (settingsStore.closeAfterEdit) {
    editingEvent.value = null;
  }
  // 如果不关闭，保持 editingEvent 不变，弹窗会继续显示
}

// 删除连线
function deleteConnection() {
  if (connectionToDelete.value) {
    connections.value = connections.value.filter(
      (conn) => conn.id !== connectionToDelete.value
    );
    updateFlowElements();
    void saveTimelineData();
    connectionToDelete.value = null;
  }
}

// 检查连线是否符合时间顺序
function isConnectionValid(conn: TimelineConnection): boolean {
  const sourceEvent = events.value.find((e) => e.id === conn.source);
  const targetEvent = events.value.find((e) => e.id === conn.target);

  if (!sourceEvent || !targetEvent) return true;

  // 如果任一事件是无时间的,或连线类型不是normal,则不进行时间验证
  if (sourceEvent.timeless || targetEvent.timeless || conn.connectionType !== 'normal') {
    return true;
  }

  const sourceDate = new Date(sourceEvent.date);
  const targetDate = new Date(targetEvent.date);

  // 源事件的日期应该早于或等于目标事件
  return sourceDate <= targetDate;
}

// 获取连线颜色
function getConnectionColor(type: string, isValid: boolean): string {
  if (!isValid) return '#ef4444'; // 无效的连线用红色

  const colorMap: Record<string, string> = {
    normal: '#b1b1b7',
    'time-travel': '#8b5cf6', // 紫色
    reincarnation: '#06b6d4', // 青色
    parallel: '#f59e0b', // 橙色
    dream: '#ec4899', // 粉色
    flashback: '#10b981', // 绿色
    other: '#6b7280', // 灰色
  };

  return colorMap[type] || '#b1b1b7';
}

// 获取连线类型的显示标签
function getConnectionTypeLabel(type: string): string {
  const labelMap: Record<string, string> = {
    normal: '正常',
    'time-travel': '⏰时间穿越',
    reincarnation: '♻️轮回转世',
    parallel: '🔀平行时空',
    dream: '💭梦境',
    flashback: '⏮️回忆',
    other: '⚡特殊',
  };

  return labelMap[type] || '';
}

// 获取事件标题(用于连线编辑器)
function getEventTitle(eventId: string | undefined): string {
  if (!eventId) return '';
  const event = events.value.find((e) => e.id === eventId);
  return event?.title || '未知事件';
}

// 保存连线更新
function handleConnectionSave(updatedConn: TimelineConnection) {
  const index = connections.value.findIndex((c) => c.id === updatedConn.id);
  if (index !== -1) {
    connections.value[index] = updatedConn;
    updateFlowElements();
    void saveTimelineData();
  }

  // 清空编辑状态（弹窗的关闭由组件自己根据 store 设置决定）
  if (settingsStore.closeAfterEditConnection) {
    editingConnection.value = null;
  }
}

// 删除连线(从编辑器)
function handleConnectionDelete(connId: string) {
  connections.value = connections.value.filter((c) => c.id !== connId);
  updateFlowElements();
  void saveTimelineData();
}

// 从对话框打开连线编辑器
function editConnectionFromDialog() {
  if (connectionToDelete.value) {
    const conn = connections.value.find((c) => c.id === connectionToDelete.value);
    if (conn) {
      editingConnection.value = { ...conn };
      isConnectionEditDialogOpen.value = true;
    }
  }
  deleteConnectionDialog.value = false;
  connectionToDelete.value = null;
}

// 重置设置为默认值
function resetSettings() {
  settingsStore.reset();
  updateFlowElements();
}

// 处理节点标题更新
function handleNodeUpdate({ id, label }: { id: string; label: string }) {
  const eventIndex = events.value.findIndex((event) => event.id === id);
  if (eventIndex !== -1) {
    if (events.value[eventIndex]) {
      events.value[eventIndex].title = label;
    }
    updateFlowElements();
    void saveTimelineData();
  }
}

// ========== 右键菜单功能 ==========

// 显示节点右键菜单
function showNodeContextMenu(event: MouseEvent, nodeId: string) {
  event.preventDefault();
  contextMenu.value = {
    show: true,
    x: event.clientX,
    y: event.clientY,
    nodeId,
    canvasClick: false,
  };
}

// 显示画布右键菜单
function showCanvasContextMenu(event: MouseEvent) {
  event.preventDefault();
  contextMenu.value = {
    show: true,
    x: event.clientX,
    y: event.clientY,
    nodeId: null,
    canvasClick: true,
  };
}

// 隐藏右键菜单
function hideContextMenu() {
  contextMenu.value.show = false;
}

// 复制节点
function copyNode() {
  if (!contextMenu.value.nodeId) return;
  const event = events.value.find((e) => e.id === contextMenu.value.nodeId);
  if (event) {
    clipboard.value = {
      type: 'copy',
      event: JSON.parse(JSON.stringify(event)), // 深拷贝
    };
  }
  hideContextMenu();
}

// 剪切节点
function cutNode() {
  if (!contextMenu.value.nodeId) return;
  const event = events.value.find((e) => e.id === contextMenu.value.nodeId);
  if (event) {
    clipboard.value = {
      type: 'cut',
      event: JSON.parse(JSON.stringify(event)), // 深拷贝
    };
  }
  hideContextMenu();
}

// 粘贴节点
function pasteNode() {
  if (!clipboard.value.event) return;

  // 生成新的 UUID
  const newEvent: TimelineEvent = {
    ...clipboard.value.event,
    id: generateUUIDv7(),
    title: `${clipboard.value.event.title} (副本)`,
    position: {
      x: (clipboard.value.event.position?.x || 0) + 50,
      y: (clipboard.value.event.position?.y || 0) + 50,
    },
  };

  events.value.push(newEvent);
  void updateFlowElements();
  void saveTimelineData();

  // 如果是剪切，删除原节点
  if (clipboard.value.type === 'cut' && clipboard.value.event) {
    deleteEvent(clipboard.value.event.id);
    clipboard.value = { type: null, event: null };
  }

  hideContextMenu();
}

// 删除节点（右键菜单版本）
function deleteNodeFromContext() {
  if (!contextMenu.value.nodeId) return;
  deleteEvent(contextMenu.value.nodeId);
  hideContextMenu();
}

// 在画布上创建新节点
function createNodeAtPosition() {
  // 将屏幕坐标转换为画布坐标（简化版）
  const newEvent: TimelineEvent = {
    id: generateUUIDv7(),
    title: '新事件',
    group: '默认分组',
    type: 'main',
    date: new Date().toISOString().split('T')[0] || '',
    description: '',
    position: {
      x: contextMenu.value.x,
      y: contextMenu.value.y - 200, // 粗略调整
    },
    data: {
      type: 'main',
    },
  };

  events.value.push(newEvent);
  void updateFlowElements();
  void saveTimelineData();
  hideContextMenu();
}

// 确认使用示例数据
function confirmUseSampleData() {
  events.value = [...sampleEvents];
  connections.value = [...sampleConnections];
  void updateFlowElements();
  void saveTimelineData();
  showSampleDataDialog.value = false;
}

// 拒绝使用示例数据
function declineUseSampleData() {
  showSampleDataDialog.value = false;
  // 保持空白，用户可以手动添加事件
}

// 加载初始数据
function loadInitialData() {
  isLoading.value = true;

  // 向VS Code发送消息请求时间线数据
  if (vscodeApi.value?.postMessage) {
    vscodeApi.value.postMessage({
      type: 'requestTimelineData',
    });
  } else {
    console.error('[loadInitialData] VSCode API not available');
  }

  // 如果500ms后没有数据，询问是否使用示例数据初始化
  setTimeout(() => {
    if (events.value.length === 0) {
      showSampleDataDialog.value = true;
    }
    isLoading.value = false;
  }, 500);
}

// 处理从 VS Code 收到的消息
function handleMessage(event: MessageEvent) {
  if (event.data && event.data.type === 'timelineData') {
    try {
      const data = event.data.data as TimelineData;
      events.value = data.events || [];
      connections.value = data.connections || [];
      void updateFlowElements();
    } catch (error) {
      console.error('解析时间线数据失败:', error);
    } finally {
      isLoading.value = false;
    }
  }
}

// 保存数据到 VS Code
function saveTimelineData() {
  // 将响应式对象转换为纯 JavaScript 对象，避免 postMessage 序列化错误
  const plainEvents = events.value.map(event => ({
    id: event.id,
    title: event.title,
    group: event.group,
    type: event.type,
    date: event.date,
    endDate: event.endDate,
    description: event.description,
    timeless: event.timeless,
    position: event.position ? { x: event.position.x, y: event.position.y } : undefined,
    bindings: event.bindings ? event.bindings.map(b => ({
      uuid: b.uuid,
      type: b.type,
      label: b.label,
    })) : undefined,
    data: event.data ? { type: event.data.type } : undefined,
    // 嵌套节点字段
    parentNode: event.parentNode,
    width: event.width,
    height: event.height,
    extent: event.extent,
    expandParent: event.expandParent,
  }));

  const plainConnections = connections.value.map(conn => ({
    id: conn.id,
    source: conn.source,
    target: conn.target,
    label: conn.label,
    connectionType: conn.connectionType,
  }));

  console.log('[TimelinePage] Sending dataChanged message to backend');
  console.log('[TimelinePage] Events count:', plainEvents.length, 'Connections count:', plainConnections.length);

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

// 更新流元素
function updateFlowElements() {
  // 创建节点 - 使用保存的坐标
  const newNodes: any[] = [];

  events.value.forEach((event, index) => {
    const nodeStyle: Record<string, any> = {};
    
    // 如果节点有宽高设置,应用到样式
    if (event.width) nodeStyle.width = `${event.width}px`;
    if (event.height) nodeStyle.height = `${event.height}px`;
    
    // 如果是父节点(有宽高),添加半透明背景
    if (event.width && event.height) {
      nodeStyle.backgroundColor = 'rgba(16, 185, 129, 0.15)';
      nodeStyle.border = '2px solid rgba(16, 185, 129, 0.5)';
      nodeStyle.borderRadius = '8px';
      nodeStyle.padding = '10px';
    }
    
    newNodes.push({
      id: event.id,
      type: 'editable',
      // 使用保存的坐标，或者根据设置的间距计算默认坐标
      position: event.position || {
        x: index * settingsStore.nodeSpacing,
        y: event.type === 'main' ? 100 : 250
      },
      draggable: true,
      selectable: true,
      // 嵌套节点支持
      parentNode: event.parentNode,
      extent: event.extent,
      expandParent: event.expandParent,
      style: nodeStyle,
      data: {
        label: event.title, // 关键:这里要同步最新的 title
        date: event.date,
        endDate: event.endDate,
        description: event.description,
        type: event.type,
        group: event.group,
        timeless: event.timeless,
        bindings: event.bindings,
      },
    });
  });

  // 创建连线 - 根据 connections 数组
  const newEdges: any[] = [];

  connections.value.forEach((conn) => {
    const isValid = isConnectionValid(conn);
    const connectionType = conn.connectionType || 'normal';

    // 获取连线类型的显示标签
    const typeLabel = getConnectionTypeLabel(connectionType);

    // 组合显示文本:类型标签 + 用户注解
    let displayLabel = '';
    if (connectionType !== 'normal') {
      displayLabel = typeLabel;
      if (conn.label) {
        displayLabel += `: ${conn.label}`;
      }
    } else if (conn.label) {
      displayLabel = conn.label;
    }

    newEdges.push({
      id: conn.id,
      source: conn.source,
      target: conn.target,
      type: 'smoothstep',
      label: displayLabel, // 显示类型标签和注解
      markerEnd: MarkerType.Arrow,
      animated: !isValid || connectionType !== 'normal', // 特殊连线或无效连线加动画
      selectable: true,
      deletable: true,
      style: {
        stroke: getConnectionColor(connectionType, isValid),
        strokeWidth: connectionType !== 'normal' ? 3 : 2, // 特殊连线更粗
        strokeDasharray: connectionType === 'dream' || connectionType === 'flashback' ? '5,5' : undefined, // 梦境和闪回用虚线
        animationDuration: `${6 - settingsStore.edgeAnimationSpeed}s`, // 动画速度:1(慢)到5(快)
      },
      labelStyle: {
        fill: connectionType !== 'normal' ? getConnectionColor(connectionType, isValid) : '#666',
        fontSize: connectionType !== 'normal' ? 13 : 12,
        fontWeight: connectionType !== 'normal' ? 'bold' : 'normal',
      },
      labelBgStyle: {
        fill: '#fff',
        fillOpacity: 0.9,
      },
      labelBgPadding: [4, 6],
      labelBgBorderRadius: 3,
    });
  });

  nodes.value = newNodes;
  edges.value = newEdges;
}

// 监听渲染设置变化,自动保存到 localStorage
watch(
  () => settingsStore.$state,
  () => {
    settingsStore.saveToLocalStorage();
  },
  { deep: true }
);

// 监听时间线展开状态变化
watch(() => timelineDrawerOpen.value, () => {
  saveTimelineViewState();
});

// 初始化数据
onMounted(() => {
  // 初始化 VSCode API
  initVSCodeApi();

  // 加载渲染设置
  settingsStore.loadFromLocalStorage();

  // 加载时间线视图状态
  loadTimelineViewState();

  // 添加全局消息监听器（持续监听来自 VSCode 的消息）
  if (vscodeApi.value?.addEventListener) {
    vscodeApi.value.addEventListener('message', handleMessage);
  } else {
    // 降级方案
    window.addEventListener('message', handleMessage);
  }

  loadInitialData();

  // 添加全局事件监听器
  window.addEventListener('timeline-node-update', handleTimelineNodeUpdate);
  window.addEventListener('timeline-open-editor', handleOpenEditor);
  window.addEventListener('timeline-node-contextmenu', handleNodeContextMenuEvent);
  
  // 点击其他地方关闭右键菜单
  document.addEventListener('click', hideContextMenu);
});

// 清理事件监听器
onUnmounted(() => {
  if (vscodeApi.value?.removeEventListener) {
    vscodeApi.value.removeEventListener('message', handleMessage);
  } else {
    window.removeEventListener('message', handleMessage);
  }
  window.removeEventListener('timeline-node-update', handleTimelineNodeUpdate);
  window.removeEventListener('timeline-open-editor', handleOpenEditor);
  window.removeEventListener('timeline-node-contextmenu', handleNodeContextMenuEvent);
  document.removeEventListener('click', hideContextMenu);
});

// 处理打开编辑器事件
function handleOpenEditor() {
  try {
    const nodeId = localStorage.getItem('openNodeEditor');
    if (nodeId) {
      openNodeEditor(nodeId);
      localStorage.removeItem('openNodeEditor');
    }
  } catch (error) {
    console.error('Failed to open editor:', error);
  }
}

// 处理节点右键菜单事件
function handleNodeContextMenuEvent() {
  try {
    const data = localStorage.getItem('nodeContextMenu');
    if (data) {
      const { nodeId, x, y } = JSON.parse(data);
      showNodeContextMenu(new MouseEvent('contextmenu', { clientX: x, clientY: y }), nodeId);
      localStorage.removeItem('nodeContextMenu');
    }
  } catch (error) {
    console.error('Failed to handle node context menu:', error);
  }
}

// 处理时间线节点更新事件
function handleTimelineNodeUpdate() {
  try {
    const eventDataStr = localStorage.getItem('tempNodeUpdate');
    if (eventDataStr) {
      const eventData = JSON.parse(eventDataStr) as { id: string; label: string };
      handleNodeUpdate(eventData);
      localStorage.removeItem('tempNodeUpdate');
    }
  } catch (error) {
    console.error('解析节点更新数据失败:', error);
  }
}
</script>

<style scoped>
.timeline-workspace {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0;
  overflow: hidden;
}

/* 顶部时间线面板 */
.timeline-top-panel {
  flex-shrink: 0;
  background: var(--q-dark, #1d1d1d);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  z-index: 100;
  transition: all 0.3s ease;
}

.timeline-top-panel--open {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.timeline-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.05);
  cursor: pointer;
  user-select: none;
  min-height: 48px;
}

.timeline-panel-header:hover {
  background: rgba(255, 255, 255, 0.08);
}

.timeline-panel-body-wrapper {
  overflow: hidden;
}

.timeline-panel-body {
  overflow: hidden;
  padding: 0;
  background: var(--q-dark, #1d1d1d);
  display: flex;
  flex-direction: column;
  position: relative;
}

/* 拖动调整条 */
.timeline-resize-handle {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 8px;
  cursor: ns-resize;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  transition: background-color 0.2s ease;
}

.timeline-resize-handle:hover {
  background: rgba(66, 184, 131, 0.1);
}

.timeline-resize-indicator {
  width: 40px;
  height: 3px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  transition: all 0.2s ease;
}

.timeline-resize-handle:hover .timeline-resize-indicator {
  width: 60px;
  height: 4px;
  background: rgba(66, 184, 131, 0.6);
}

.timeline-flow {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  width: 100%;
  overflow: hidden;
}

.timeline-flow__canvas {
  width: 100%;
  height: 100%;
}

.timeline-flow__canvas {
  width: 100%;
  height: 100%;
}

/* 左上角工具栏 */
.toolbar-top-left {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 1000;
}

/* 右上角工具栏 */
.toolbar-top-right {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 1000;
}

/* 连线显示在节点上方 */
.edges-on-top :deep(.vue-flow__edges) {
  z-index: 1000 !important;
}

.edges-on-top :deep(.vue-flow__nodes) {
  z-index: 1 !important;
}

/* 确保滚动区域正确工作 */
.q-scrollarea__content {
  height: auto !important;
}

/* VueFlow 控制面板深度样式 - 暗色主题适配 */
:deep(.vue-flow__controls) {
  background: rgba(30, 30, 30, 0.95) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 8px !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
}

:deep(.vue-flow__controls-button) {
  background: transparent !important;
  border: none !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
  color: rgba(255, 255, 255, 0.87) !important;
  transition: all 0.2s ease !important;
}

:deep(.vue-flow__controls-button:hover) {
  background: rgba(255, 255, 255, 0.1) !important;
  color: #ffffff !important;
}

:deep(.vue-flow__controls-button svg) {
  fill: currentColor !important;
}

:deep(.vue-flow__controls-button:last-child) {
  border-bottom: none !important;
}

/* MiniMap 深度样式 - 暗色主题适配 */
:deep(.vue-flow__minimap) {
  background: rgba(30, 30, 30, 0.95) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 8px !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
}

:deep(.vue-flow__minimap-mask) {
  fill: rgba(66, 184, 131, 0.15) !important;
  stroke: rgba(66, 184, 131, 0.6) !important;
  stroke-width: 2 !important;
}

:deep(.vue-flow__minimap-node) {
  fill: rgba(255, 255, 255, 0.2) !important;
  stroke: rgba(255, 255, 255, 0.4) !important;
}

/* Panel 深度样式 */
:deep(.vue-flow__panel) {
  background: rgba(30, 30, 30, 0.95) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 8px !important;
  padding: 8px 12px !important;
  color: rgba(255, 255, 255, 0.87) !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2) !important;
}

:deep(.vue-flow__panel.bottom.left) {
  margin-bottom: 16px !important;
  margin-left: 16px !important;
}
</style>

