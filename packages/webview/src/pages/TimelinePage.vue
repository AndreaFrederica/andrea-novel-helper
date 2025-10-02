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

          <!-- 显示设置 -->
          <q-card flat bordered class="q-mb-md">
            <q-card-section>
              <div class="text-subtitle2 q-mb-md">显示组件</div>

              <q-toggle
                v-model="renderSettings.showBackground"
                label="显示背景网格"
                color="primary"
                @update:model-value="updateFlowElements"
              />

              <q-toggle
                v-model="renderSettings.showMiniMap"
                label="显示小地图"
                color="primary"
                @update:model-value="updateFlowElements"
              />

              <q-toggle
                v-model="renderSettings.showControls"
                label="显示控制按钮"
                color="primary"
                @update:model-value="updateFlowElements"
              />
            </q-card-section>
          </q-card>

          <!-- 连线设置 -->
          <q-card flat bordered class="q-mb-md">
            <q-card-section>
              <div class="text-subtitle2 q-mb-sm">连线设置</div>

              <q-toggle
                v-model="renderSettings.edgesOnTop"
                label="连线显示在节点上方"
                color="primary"
                @update:model-value="updateFlowElements"
              >
                <q-tooltip>启用后，连线会绘制在节点上方，更容易看清连接关系</q-tooltip>
              </q-toggle>

              <div class="q-mt-md">
                <div class="text-body2 q-mb-sm">
                  动画速度: {{ renderSettings.edgeAnimationSpeed }}
                </div>
                <q-slider
                  v-model="renderSettings.edgeAnimationSpeed"
                  :min="1"
                  :max="5"
                  :step="1"
                  label
                  color="primary"
                  markers
                  @update:model-value="updateFlowElements"
                />
              </div>
            </q-card-section>
          </q-card>

          <!-- 布局设置 -->
          <q-card flat bordered class="q-mb-md">
            <q-card-section>
              <div class="text-subtitle2 q-mb-sm">布局设置</div>

              <div class="q-mb-md">
                <div class="text-body2 q-mb-sm">
                  节点默认间距: {{ renderSettings.nodeSpacing }}px
                </div>
                <q-slider
                  v-model="renderSettings.nodeSpacing"
                  :min="100"
                  :max="400"
                  :step="50"
                  label
                  color="primary"
                  markers
                  @update:model-value="updateFlowElements"
                />
              </div>
            </q-card-section>
          </q-card>

          <!-- 重置按钮 -->
          <q-btn
            label="重置为默认设置"
            color="grey"
            outline
            class="full-width"
            @click="resetSettings"
          />
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

      <!-- 节点编辑器对话框 -->
      <TimelineEventEditor
        v-model="isEditDialogOpen"
        :event="editingEvent"
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

      <!-- 时间轴可视化与画布 -->
      <q-page class="timeline-workspace column no-wrap">
        <!-- 顶部时间线面板（可折叠） -->
        <div class="timeline-top-panel" :class="{ 'timeline-top-panel--open': timelineDrawerOpen }">
          <div class="timeline-panel-header">
            <div class="text-subtitle1 text-weight-medium">时间线视图</div>
            <q-btn
              dense
              flat
              round
              :icon="timelineDrawerOpen ? 'expand_less' : 'expand_more'"
              @click="timelineDrawerOpen = !timelineDrawerOpen"
            >
              <q-tooltip>{{ timelineDrawerOpen ? '收起' : '展开' }}时间线</q-tooltip>
            </q-btn>
          </div>
          <q-slide-transition>
            <div v-show="timelineDrawerOpen" class="timeline-panel-body">
              <TimelineView :events="events" />
            </div>
          </q-slide-transition>
        </div>

        <!-- 流程图画布区域 -->
        <div class="timeline-flow">
          <VueFlow
            class="timeline-flow__canvas w-full h-full"
            :class="{ 'edges-on-top': renderSettings.edgesOnTop }"
            :nodes="nodes"
            :edges="edges"
            fit-view-on-init
            :node-types="nodeTypes"
            :connection-radius="30"
            :edges-updatable="true"
            :nodes-draggable="true"
            :node-drag-threshold="0"
            :snap-to-grid="false"
            no-drag-class-name="no-drag"
            @edges-change="onEdgesChange"
          >
            <Background v-if="renderSettings.showBackground" />
            <Controls v-if="renderSettings.showControls" />
            <MiniMap v-if="renderSettings.showMiniMap" />
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

interface RenderSettings {
  edgesOnTop: boolean; // 连线显示在节点上方
  showMiniMap: boolean; // 显示小地图
  showBackground: boolean; // 显示背景网格
  showControls: boolean; // 显示控制按钮
  edgeAnimationSpeed: number; // 连线动画速度 (1-5)
  nodeSpacing: number; // 节点默认间距
}

interface BindingReference {
  uuid: string;
  type: 'character' | 'article' | 'location' | 'item' | 'other';
  label?: string; // 显示名称
}

interface TimelineEvent {
  id: string;
  title: string;
  group: string;
  type: 'main' | 'side';
  date: string;
  description: string;
  timeless?: boolean; // 是否与时间无关
  position?: { x: number; y: number }; // 节点坐标
  bindings?: BindingReference[]; // 绑定的资源引用
  data?: {
    type: 'main' | 'side';
  };
}

interface TimelineConnection {
  id: string;
  source: string;
  target: string;
  label?: string; // 连线注解
  connectionType?: 'normal' | 'time-travel' | 'reincarnation' | 'parallel' | 'dream' | 'flashback' | 'other'; // 连线类型
}

interface TimelineData {
  events: TimelineEvent[];
  connections: TimelineConnection[];
}

// 使用VueFlow组合式函数
const { onInit, onNodeDragStop, onConnect, onEdgeClick, onNodesChange, addEdges, removeEdges, toObject } = useVueFlow();

// 响应式状态
const events = ref<TimelineEvent[]>([]);
const connections = ref<TimelineConnection[]>([]);
const nodes = ref<any[]>([]);
const edges = ref<any[]>([]);
const drawerOpen = ref(true);
const timelineDrawerOpen = ref(false); // 时间线抽屉默认收起
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

// 渲染设置
const renderSettings = ref<RenderSettings>({
  edgesOnTop: false,
  showMiniMap: true,
  showBackground: true,
  showControls: true,
  edgeAnimationSpeed: 3,
  nodeSpacing: 200,
});

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
    id: `conn-${generateUUIDv7()}`,
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
  isAddDialogOpen.value = false;
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
  editingEvent.value = null;
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
  renderSettings.value = {
    edgesOnTop: false,
    showMiniMap: true,
    showBackground: true,
    showControls: true,
    edgeAnimationSpeed: 3,
    nodeSpacing: 200,
  };
  saveRenderSettings();
  updateFlowElements();
}

// 保存渲染设置到 localStorage
function saveRenderSettings() {
  try {
    localStorage.setItem('timeline-render-settings', JSON.stringify(renderSettings.value));
  } catch (error) {
    console.error('保存渲染设置失败:', error);
  }
}

// 从 localStorage 加载渲染设置
function loadRenderSettings() {
  try {
    const saved = localStorage.getItem('timeline-render-settings');
    if (saved) {
      const parsed = JSON.parse(saved) as RenderSettings;
      renderSettings.value = {
        ...renderSettings.value,
        ...parsed,
      };
    }
  } catch (error) {
    console.error('加载渲染设置失败:', error);
  }
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

// 加载初始数据
function loadInitialData() {
  isLoading.value = true;

  // 模拟从VS Code加载数据
  window.addEventListener('message', handleMessage, { once: true });

  // 向VS Code发送消息请求时间线数据
  window.parent.postMessage(
    {
      command: 'getTimelineData',
    },
    '*',
  );

  // 如果没有数据，添加一些示例数据
  setTimeout(() => {
    if (events.value.length === 0) {
      events.value = [
        {
          id: '1',
          title: '故事开始',
          group: '主要情节',
          type: 'main',
          date: '2024-01-01',
          description: '主角出场',
          position: { x: 0, y: 100 },
          data: {
            type: 'main',
          },
        },
        {
          id: '2',
          title: '冲突出现',
          group: '主要情节',
          type: 'main',
          date: '2024-01-05',
          description: '主角面临第一个挑战',
          position: { x: 400, y: 100 },
          data: {
            type: 'main',
          },
        },
        {
          id: '3',
          title: '配角背景',
          group: '背景故事',
          type: 'side',
          date: '2024-01-03',
          description: '配角的过去经历',
          position: { x: 200, y: 250 },
          data: {
            type: 'side',
          },
        },
      ];

      // 添加示例连线
      connections.value = [
        {
          id: 'conn-1',
          source: '1',
          target: '2',
        },
        {
          id: 'conn-2',
          source: '1',
          target: '3',
        },
        {
          id: 'conn-3',
          source: '3',
          target: '2', // 这个会标红，因为日期不符合（01-03 -> 01-05 不对）
        },
      ];

      void updateFlowElements();
    }
    isLoading.value = false;
  }, 500);
}

// 处理从 VS Code 收到的消息
function handleMessage(event: MessageEvent) {
  if (event.data && event.data.command === 'timelineData') {
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
  window.parent.postMessage(
    {
      command: 'saveTimelineData',
      data: {
        events: events.value,
        connections: connections.value,
      },
    },
    '*',
  );
}

// 更新流元素
function updateFlowElements() {
  // 创建节点 - 使用保存的坐标
  const newNodes: any[] = [];

  events.value.forEach((event, index) => {
    newNodes.push({
      id: event.id,
      type: 'editable',
      // 使用保存的坐标，或者根据设置的间距计算默认坐标
      position: event.position || {
        x: index * renderSettings.value.nodeSpacing,
        y: event.type === 'main' ? 100 : 250
      },
      draggable: true,
      selectable: true,
      data: {
        label: event.title, // 关键:这里要同步最新的 title
        date: event.date,
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
        animationDuration: `${6 - renderSettings.value.edgeAnimationSpeed}s`, // 动画速度:1(慢)到5(快)
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
  renderSettings,
  () => {
    saveRenderSettings();
  },
  { deep: true }
);

// 初始化数据
onMounted(() => {
  // 加载渲染设置
  loadRenderSettings();

  loadInitialData();

  // 添加全局事件监听器
  window.addEventListener('timeline-node-update', handleTimelineNodeUpdate);
  window.addEventListener('timeline-open-editor', handleOpenEditor);
});

// 清理事件监听器
onUnmounted(() => {
  window.removeEventListener('timeline-node-update', handleTimelineNodeUpdate);
  window.removeEventListener('timeline-open-editor', handleOpenEditor);
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
    console.error('打开节点编辑器失败:', error);
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

.timeline-panel-body {
  height: 50vh;
  overflow: hidden;
  padding: 0;
  background: var(--q-dark, #1d1d1d);
  display: flex;
  flex-direction: column;
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
  position: fixed;
  top: 16px;
  left: 16px;
  z-index: 1000;
}

/* 右上角工具栏 */
.toolbar-top-right {
  position: fixed;
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
</style>

