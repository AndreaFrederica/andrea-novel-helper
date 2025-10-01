<template>
  <q-layout class="layout-no-size">
    <!-- 右下角悬浮开关按钮 -->
    <q-btn
      round
      dense
      icon="menu"
      class="drawer-toggle br"
      @click="drawerOpen = !drawerOpen"
      :aria-label="drawerOpen ? '关闭事件列表' : '打开事件列表'"
    />

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
      <q-scroll-area class="fit">
        <!-- Vue Flow画布 -->
        <div class="flex-1" style="height: calc(100vh - 80px)">
          <VueFlow
            :nodes="nodes"
            :edges="edges"
            fit-view-on-init
            class="w-full h-full"
            :node-types="nodeTypes"
            :connection-radius="30"
          >
            <Background />
            <Controls />
            <MiniMap />
          </VueFlow>
        </div>

        <q-separator class="q-my-md" />

        <q-expansion-item label="当前数据快照" icon="visibility" expand-separator>
          <q-card flat bordered>
            <q-card-section>
              <pre style="white-space: pre-wrap">{{ events }}</pre>
            </q-card-section>
          </q-card>
        </q-expansion-item>
      </q-scroll-area>
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
  data?: {
    type: 'main' | 'side';
  };
}

// 使用VueFlow组合式函数
const { onInit, onNodeDragStop, onConnect, addEdges, toObject } = useVueFlow();

// 响应式状态
const events = ref<TimelineEvent[]>([]);
const nodes = ref<any[]>([]);
const edges = ref<any[]>([]);
const drawerOpen = ref(true);
const isAddDialogOpen = ref(false);
const isEditDialogOpen = ref(false);
const isLoading = ref(false);

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
  // 这里可以添加拖动后的保存逻辑
});

onConnect((connection) => {
  console.log('新建连接', connection);
  addEdges(connection);
  void saveEvents();
});

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
  void saveEvents();
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
    void saveEvents();
    isEditDialogOpen.value = false;
  }
}

// 删除事件
function deleteEvent(id: string) {
  events.value = events.value.filter((event) => event.id !== id);
  updateFlowElements();
  void saveEvents();
}

// 处理节点标题更新
function handleNodeUpdate({ id, label }: { id: string; label: string }) {
  const eventIndex = events.value.findIndex((event) => event.id === id);
  if (eventIndex !== -1) {
    if (events.value[eventIndex]) {
      events.value[eventIndex].title = label;
    }
    updateFlowElements();
      void saveEvents();
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
          data: {
            type: 'side',
          },
        },
      ];
      void updateFlowElements();
    }
    isLoading.value = false;
  }, 500);
}

// 处理从VS Code收到的消息
function handleMessage(event: MessageEvent) {
  if (event.data && event.data.command === 'timelineData') {
    try {
      events.value = event.data.data || [];
      void updateFlowElements();
    } catch (error) {
      console.error('解析时间线数据失败:', error);
    } finally {
      isLoading.value = false;
    }
  }
}

// 保存数据到VS Code
function saveEvents() {
  window.parent.postMessage(
    {
      command: 'saveTimelineData',
      data: events.value,
    },
    '*',
  );
}

// 更新流元素
function updateFlowElements() {
  // 按日期排序事件
  const sortedEvents = [...events.value].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  // 创建节点
  const newNodes: any[] = [];
  const newEdges: any[] = [];

  sortedEvents.forEach((event, index) => {
    newNodes.push({
      id: event.id,
      type: 'editable',
      position: { x: index * 200, y: event.type === 'main' ? 100 : 250 },
      data: {
        label: event.title,
        date: event.date,
        description: event.description,
        type: event.type,
      },
    });

    // 创建连线（连接到下一个事件）
    if (index < sortedEvents.length - 1 && sortedEvents[index + 1]) {
      newEdges.push({
        id: `edge-${event.id}-${sortedEvents[index + 1]!.id}`,
        source: event.id,
        target: sortedEvents[index + 1]!.id,
        type: 'smoothstep',
        markerEnd: MarkerType.Arrow,
      });
    }
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

// 监听事件变化，自动更新流元素
watch(
  events,
  () => {
    void updateFlowElements();
  },
  { deep: true },
);
</script>

<style scoped>
/* 自定义样式 */
.drawer-toggle {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 1000;
}

/* 确保滚动区域正确工作 */
.q-scrollarea__content {
  height: auto !important;
}
</style>
