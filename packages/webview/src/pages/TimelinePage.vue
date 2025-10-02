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

    <!-- 右侧边栏（数据快照） -->
    <q-drawer
      v-model="snapshotDrawerOpen"
      side="right"
      bordered
      :breakpoint="0"
      :class="['drawer-fullheight']"
      style="height: 100vh; width: 400px"
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
          v-if="!snapshotDrawerOpen"
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

      <!-- 删除连线确认对话框 -->
      <q-dialog v-model="deleteConnectionDialog" persistent>
        <q-card>
          <q-card-section class="row items-center">
            <q-avatar icon="warning" color="negative" text-color="white" />
            <span class="q-ml-sm">确定要删除这条连线吗？</span>
          </q-card-section>

          <q-card-actions align="right">
            <q-btn flat label="取消" color="primary" v-close-popup />
            <q-btn flat label="删除" color="negative" @click="deleteConnection" v-close-popup />
          </q-card-actions>
        </q-card>
      </q-dialog>

      <!-- Vue Flow画布 -->
      <q-page class="fit">
        <VueFlow
          :nodes="nodes"
          :edges="edges"
          fit-view-on-init
          class="w-full h-full"
          :node-types="nodeTypes"
          :connection-radius="30"
          :edges-updatable="true"
          :nodes-draggable="true"
          @edges-change="onEdgesChange"
        >
          <Background />
          <Controls />
          <MiniMap />
        </VueFlow>
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

interface TimelineEvent {
  id: string;
  title: string;
  group: string;
  type: 'main' | 'side';
  date: string;
  description: string;
  position?: { x: number; y: number }; // 节点坐标
  data?: {
    type: 'main' | 'side';
  };
}

interface TimelineConnection {
  id: string;
  source: string;
  target: string;
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
const snapshotDrawerOpen = ref(false);
const isAddDialogOpen = ref(false);
const isEditDialogOpen = ref(false);
const isLoading = ref(false);
const deleteConnectionDialog = ref(false);
const connectionToDelete = ref<string | null>(null);

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
  // 添加到 connections 数组
  const newConnection: TimelineConnection = {
    id: `conn-${generateUUIDv7()}`,
    source: params.source,
    target: params.target,
  };
  connections.value.push(newConnection);
  
  // 更新显示
  updateFlowElements();
  void saveTimelineData();
});

// 点击边时显示确认对话框
onEdgeClick(({ edge }) => {
  console.log('点击边', edge);
  connectionToDelete.value = edge.id;
  deleteConnectionDialog.value = true;
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
  
  if (!sourceEvent || !targetEvent) return true; // 如果找不到事件，默认有效
  
  const sourceDate = new Date(sourceEvent.date);
  const targetDate = new Date(targetEvent.date);
  
  // 源事件的日期应该早于或等于目标事件
  return sourceDate <= targetDate;
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
      // 使用保存的坐标，或者默认坐标
      position: event.position || { x: index * 200, y: event.type === 'main' ? 100 : 250 },
      data: {
        label: event.title,
        date: event.date,
        description: event.description,
        type: event.type,
        group: event.group, // 添加分组信息
      },
    });
  });

  // 创建连线 - 根据 connections 数组
  const newEdges: any[] = [];
  
  connections.value.forEach((conn) => {
    const isValid = isConnectionValid(conn);
    
    newEdges.push({
      id: conn.id,
      source: conn.source,
      target: conn.target,
      type: 'smoothstep',
      markerEnd: MarkerType.Arrow,
      animated: !isValid, // 不符合时间顺序的连线加上动画效果
      selectable: true, // 可选中
      deletable: true, // 可删除
      style: {
        stroke: isValid ? '#b1b1b7' : '#ef4444', // 不符合时间顺序的用红色
        strokeWidth: 2,
      },
    });
  });

  nodes.value = newNodes;
  edges.value = newEdges;
}

// 初始化数据
onMounted(() => {
  loadInitialData();

  // 添加全局事件监听器
  window.addEventListener('timeline-node-update', handleTimelineNodeUpdate);
});

// 清理事件监听器
onUnmounted(() => {
  window.removeEventListener('timeline-node-update', handleTimelineNodeUpdate);
});

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

/* 确保滚动区域正确工作 */
.q-scrollarea__content {
  height: auto !important;
}
</style>
