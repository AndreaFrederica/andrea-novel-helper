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
        :roles-list="rolesList"
        :articles-list="articlesList"
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

      <!-- Quasar 右键菜单：用 ref + show(event) 打开，内容根据上下文切换 -->
      <q-menu
        ref="contextMenuRef"
        context-menu
        no-parent-event
        persistent
        touch-position
        anchor="top left"
        self="top left"
        transition-show="jump-down"
        transition-hide="jump-up"
        separate-close-popup
        :content-class="'timeline-context-menu z-topmost'"
        :content-style="{ zIndex: 200000 }"
      >
        <q-list dense style="min-width: 200px" class="timeline-context-menu">
          <!-- 画布右键菜单 -->
          <template v-if="contextMenu.canvasClick">
            <q-item clickable v-close-popup @click="createNodeAtPosition">
              <q-item-section avatar>
                <q-icon name="add_circle" color="primary" />
              </q-item-section>
              <q-item-section>
                <q-item-label>创建普通节点</q-item-label>
                <q-item-label caption>在此位置创建新的时间线节点</q-item-label>
              </q-item-section>
            </q-item>
            <q-item clickable v-close-popup @click="createConditionNodeAtPosition">
              <q-item-section avatar>
                <q-icon name="help" color="warning" />
              </q-item-section>
              <q-item-section>
                <q-item-label>创建条件节点</q-item-label>
                <q-item-label caption>在此位置创建条件判断节点</q-item-label>
              </q-item-section>
            </q-item>
            <template v-if="clipboard.event">
              <q-separator spaced />
              <q-item clickable v-close-popup @click="pasteNode">
                <q-item-section avatar>
                  <q-icon name="content_paste" color="positive" />
                </q-item-section>
                <q-item-section>
                  <q-item-label>粘贴节点</q-item-label>
                  <q-item-label caption>
                    {{ clipboard.type === 'cut' ? '粘贴（剪切）' : '粘贴（复制）' }}
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-icon :name="clipboard.type === 'cut' ? 'content_cut' : 'content_copy'" size="xs" :color="clipboard.type === 'cut' ? 'orange' : 'grey'" />
                </q-item-section>
              </q-item>
            </template>
          </template>

          <!-- 节点右键菜单 -->
          <template v-else>
            <template v-if="contextMenuBindings.length">
              <q-item-label header>绑定资源</q-item-label>
              <q-item
                v-for="(binding, index) in contextMenuBindings"
                :key="`${binding.uuid}-${index}`"
                clickable
                v-close-popup
                @click="jumpToBinding(binding)"
              >
                <q-item-section avatar>
                  <q-avatar size="sm" :color="getBindingColor(binding)" text-color="white">
                    <q-icon :name="getBindingIcon(binding.type)" size="xs" />
                  </q-avatar>
                </q-item-section>
                <q-item-section>
                  <q-item-label>{{ getBindingDisplayName(binding) }}</q-item-label>
                  <q-item-label caption>{{ getBindingTypeLabel(binding.type) }}</q-item-label>
                  <q-item-label caption v-if="getBindingAdditionalInfo(binding)">
                    {{ getBindingAdditionalInfo(binding) }}
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-icon name="open_in_new" color="primary" />
                </q-item-section>
              </q-item>
              <q-separator spaced />
            </template>
            <q-item clickable v-close-popup @click="copyNode">
              <q-item-section avatar>
                <q-icon name="content_copy" color="primary" />
              </q-item-section>
              <q-item-section>
                <q-item-label>复制</q-item-label>
                <q-item-label caption>复制此节点</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-badge color="grey-7" text-color="white">Ctrl+C</q-badge>
              </q-item-section>
            </q-item>
            <q-item clickable v-close-popup @click="cutNode">
              <q-item-section avatar>
                <q-icon name="content_cut" color="orange" />
              </q-item-section>
              <q-item-section>
                <q-item-label>剪切</q-item-label>
                <q-item-label caption>剪切此节点</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-badge color="grey-7" text-color="white">Ctrl+X</q-badge>
              </q-item-section>
            </q-item>
            <q-separator spaced />
            <q-item clickable v-close-popup @click="deleteNodeFromContext">
              <q-item-section avatar>
                <q-icon name="delete" color="negative" />
              </q-item-section>
              <q-item-section>
                <q-item-label>删除</q-item-label>
                <q-item-label caption>删除此节点</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-badge color="grey-7" text-color="white">Del</q-badge>
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

          <div class="timeline-flow-wrapper">
            <VueFlow
              class="timeline-flow__canvas w-full h-full"
              :class="{ 'edges-on-top': settingsStore.edgesOnTop }"
              :nodes="nodes"
              :edges="edges"
              fit-view-on-init
              :node-types="nodeTypes"
              :edge-types="edgeTypes"
              :connection-radius="30"
              :edges-updatable="true"
              :nodes-draggable="true"
              :node-drag-threshold="0"
              :snap-to-grid="false"
              :elevate-edges-on-select="true"
              :allow-self-loops="true"
              no-drag-class-name="no-drag"
              @edges-change="onEdgesChange"
              @pane-click="onPaneClick"
              @pane-context-menu="onPaneContextMenu"
              @node-context-menu="onNodeContextMenu"
              @edge-context-menu="onEdgeContextMenu"
            >
              <Background v-if="settingsStore.showBackground" />
              <Controls v-if="settingsStore.showControls" />
              <MiniMap v-if="settingsStore.showMiniMap" />
            </VueFlow>
          </div>
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, reactive, nextTick, markRaw } from 'vue';
import { MarkerType, VueFlow, useVueFlow, Position } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MiniMap } from '@vue-flow/minimap';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vue-flow/controls/dist/style.css';
import '@vue-flow/minimap/dist/style.css';
import '@vue-flow/node-resizer/dist/style.css';
import { generateUUIDv7 } from '../utils/uuid';
import EditableEventNode from '../components/EditableEventNode.vue';
import ConditionNode from '../components/ConditionNode.vue';
import LoopbackEdge from '../components/LoopbackEdge.vue';
import TimelineEventEditor from '../components/TimelineEventEditor.vue';
import ConnectionEditor from '../components/ConnectionEditor.vue';
import TimelineView from '../components/TimelineView.vue';
import TimelineRenderSettings from '../components/TimelineRenderSettings.vue';
import { useTimelineSettingsStore } from '../stores/timeline-settings';
import { useVsCodeApiStore } from '../stores/vscode';
import type { TimelineEvent, TimelineConnection, TimelineData, BindingReference } from '../types/timeline';
import timelineSampleData from '../data/timelineSampleData';
// timelineSampleData 使用默认导出，解构出 events 和 connections 以兼容原来的命名变量
const { events: sampleEvents, connections: sampleConnections } = timelineSampleData;

// 使用VueFlow组合式函数
const { onInit, onNodeDragStop, onConnect, onEdgeClick, onNodesChange, addEdges, removeEdges, toObject, project, vueFlowRef } = useVueFlow();

// 使用 Pinia store
const settingsStore = useTimelineSettingsStore();
const vsCodeApiStore = useVsCodeApiStore();

// 使用 store 中的 vscode 实例
const vscodeApi = computed(() => vsCodeApiStore.vscode);


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

// 角色和文章数据(从后端加载一次,传递给子组件)
const rolesList = ref<Array<{ uuid: string; name: string; type: string; color?: string }>>([]);
const articlesList = ref<Array<{ uuid: string; title: string; path: string; fullPath: string }>>([]);

// 右键菜单相关
const contextMenu = ref({
  show: false,
  x: 0,
  y: 0,
  nodeId: null as string | null,
  canvasClick: false,
});
const contextMenuRef = ref<unknown>(null);

const contextMenuEvent = computed(() => {
  if (!contextMenu.value.nodeId) {
    return null;
  }
  return events.value.find(event => event.id === contextMenu.value.nodeId) ?? null;
});

const contextMenuBindings = computed<BindingReference[]>(() => {
  return contextMenuEvent.value?.bindings ?? [];
});

function openQuasarMenuFromMouseEvent(evt: MouseEvent, opts: { nodeId: string | null; canvasClick: boolean }) {
  // console.log('[CTX] openQuasarMenuFromMouseEvent', {
  //   x: evt?.clientX,
  //   y: evt?.clientY,
  //   nodeId: opts.nodeId,
  //   canvasClick: opts.canvasClick,
  //   target: (evt?.target as HTMLElement)?.className,
  // });
  evt.stopPropagation?.();

  // 先隐藏旧菜单（如果存在）
  const menu = (contextMenuRef.value as unknown as { hide?: () => void; show?: (e: MouseEvent) => void });
  if (menu?.hide) {
    menu.hide();
  }

  // 计算相对于 Vue Flow 容器的坐标
  let relativeX = evt.clientX;
  let relativeY = evt.clientY;

  if (vueFlowRef.value) {
    const rect = vueFlowRef.value.getBoundingClientRect();
    relativeX = evt.clientX - rect.left;
    relativeY = evt.clientY - rect.top;
  }

  // 更新上下文状态（保存相对坐标）
  contextMenu.value = {
    show: true,
    x: relativeX,
    y: relativeY,
    nodeId: opts.nodeId,
    canvasClick: opts.canvasClick,
  };

  // 在新位置打开菜单（使用原始屏幕坐标）
  if (menu?.show) {
    menu.show(evt);
    // console.log('[CTX] quasar menu show() invoked at new position');
    // Debug: check menu dom existence after render
    // void nextTick(() => {
    //   const el = document.querySelector('.q-menu');
    //   if (el instanceof HTMLElement) {
    //     const rect = el.getBoundingClientRect();
    //     console.log('[CTX] q-menu present', { rect });
    //   } else {
    //     console.warn('[CTX] q-menu not found in DOM');
    //   }
    // });
  } else {
    console.warn('[CTX] quasar menu ref missing show()');
  }
}

function getRoleByUuid(uuid: string) {
  return rolesList.value.find(role => role.uuid === uuid);
}

function getArticleByUuid(uuid: string) {
  return articlesList.value.find(article => article.uuid === uuid);
}

function getBindingDisplayName(binding: BindingReference): string {
  if (binding.label && binding.label.trim()) {
    return binding.label;
  }
  if (binding.type === 'character') {
    const role = getRoleByUuid(binding.uuid);
    if (role?.name) {
      return role.name;
    }
  } else if (binding.type === 'article') {
    const article = getArticleByUuid(binding.uuid);
    if (article?.title) {
      return article.title;
    }
  }
  return binding.uuid;
}

function getBindingColor(binding: BindingReference): string {
  if (binding.type === 'character') {
    const role = getRoleByUuid(binding.uuid);
    if (typeof role?.color === 'string' && role.color.trim().length > 0) {
      return role.color;
    }
    return 'purple';
  }
  if (binding.type === 'article') {
    return 'blue';
  }
  return 'grey';
}

function getBindingIcon(type: string): string {
  const iconMap: Record<string, string> = {
    character: 'person',
    article: 'description',
  };
  return iconMap[type] || 'label';
}

function getBindingTypeLabel(type: string): string {
  const labelMap: Record<string, string> = {
    character: '角色',
    article: '文章/章节',
  };
  return labelMap[type] || '其他';
}

function getBindingAdditionalInfo(binding: BindingReference): string | undefined {
  if (binding.type === 'character') {
    const role = getRoleByUuid(binding.uuid);
    if (role?.type) {
      return role.type;
    }
  } else if (binding.type === 'article') {
    const article = getArticleByUuid(binding.uuid);
    if (article) {
      return article.fullPath || article.path;
    }
  }
  return undefined;
}

function jumpToBinding(binding: BindingReference) {
  const api = vscodeApi.value;
  if (!api?.postMessage) {
    console.warn('[TimelinePage] VSCode API not available, cannot jump to definition');
    return;
  }

  console.log('[TimelinePage] Jumping to definition via context menu:', binding.type, binding.uuid);

  if (binding.type === 'character') {
    api.postMessage({
      type: 'jumpToRoleDefinition',
      roleUuid: binding.uuid,
    });
    return;
  }

  if (binding.type === 'article') {
    api.postMessage({
      type: 'jumpToDefinition',
      resourceType: binding.type,
      resourceUuid: binding.uuid,
    });
  }
}

// VueFlow 右键：节点
function onNodeContextMenu(e: any) {
  const ev: MouseEvent | undefined = 'event' in e ? (e.event as MouseEvent) : e;
  ev?.preventDefault?.();
  ev?.stopPropagation?.();
  // console.log('[CTX] onNodeContextMenu', { hasEvent: !!ev, id: e?.node?.id, target: (ev?.target as HTMLElement)?.className });
  if (!ev) return;
  const id = e?.node?.id ?? null;
  openQuasarMenuFromMouseEvent(ev, { nodeId: id, canvasClick: false });
}

// VueFlow 右键：边
function onEdgeContextMenu(e: any) {
  const ev: MouseEvent | undefined = 'event' in e ? (e.event as MouseEvent) : e;
  ev?.preventDefault?.();
  ev?.stopPropagation?.();
  // console.log('[CTX] onEdgeContextMenu', { hasEvent: !!ev, id: e?.edge?.id, target: (ev?.target as HTMLElement)?.className });
  if (!ev) return;
  // 暂不针对边做专菜单，按画布处理或可扩展
  openQuasarMenuFromMouseEvent(ev, { nodeId: null, canvasClick: true });
}

// VueFlow 左键：画布（点击空白处）
function onPaneClick(e: MouseEvent) {
  // console.log('[CTX] onPaneClick', { x: e.clientX, y: e.clientY });
  // 点击空白处关闭右键菜单
  hideContextMenu();
}

// VueFlow 右键：画布
function onPaneContextMenu(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  // console.log('[CTX] onPaneContextMenu', { x: e.clientX, y: e.clientY, target: (e.target as HTMLElement)?.className });
  openQuasarMenuFromMouseEvent(e, { nodeId: null, canvasClick: true });
}

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
const eventForm = reactive<{
  id: string;
  title: string;
  group: string;
  type: 'main' | 'side';
  date: string;
  description: string;
  color?: string; // 自定义颜色
  data?: {
    type: 'main' | 'side' | 'condition'; // 支持条件节点类型
  };
}>({
  id: '',
  title: '',
  group: '',
  type: 'main' as 'main' | 'side',
  date: new Date().toISOString().split('T')[0] || '',
  description: '',
});

// Vue Flow相关
const nodeTypes = ref<any>({
  editable: markRaw(EditableEventNode),
  condition: markRaw(ConditionNode),
});

const edgeTypes = ref<any>({
  loopback: markRaw(LoopbackEdge),
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

  // 保存手柄 ID (如果存在)
  if (params.sourceHandle) {
    newConnection.sourceHandle = params.sourceHandle;
  }
  if (params.targetHandle) {
    newConnection.targetHandle = params.targetHandle;
  }

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
    // 设置默认尺寸
    width: 200,
    height: 120,
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
      // 保留 data.type，如果 eventForm.data 存在则使用，否则使用 eventForm.type
      data: eventForm.data || {
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
  console.log('[TimelinePage] openNodeEditor 被调用, id:', id);
  const event = events.value.find((e) => e.id === id);
  console.log('[TimelinePage] 找到的事件:', event);
  if (event) {
    editingEvent.value = { ...event };
    isEditDialogOpen.value = true;
    console.log('[TimelinePage] 已设置 isEditDialogOpen = true');
  } else {
    console.warn('[TimelinePage] 未找到事件, id:', id);
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
  event.stopPropagation();
  // console.log('[CTX] showNodeContextMenu (legacy path)', { nodeId, x: event.clientX, y: event.clientY });
  openQuasarMenuFromMouseEvent(event, { nodeId, canvasClick: false });
}

// 显示画布右键菜单
function showCanvasContextMenu(event: MouseEvent) {
  event.preventDefault();
  // console.log('[CTX] showCanvasContextMenu (legacy path)', { x: event.clientX, y: event.clientY });
  openQuasarMenuFromMouseEvent(event, { nodeId: null, canvasClick: true });
}

// 处理画布右键菜单（备用方法，防止 VueFlow 阻止）
function handleCanvasContextMenu(event: MouseEvent) {
  // 检查是否点击在节点上
  const target = event.target as HTMLElement;
  if (target.closest('.custom-node') || target.closest('.vue-flow__node')) {
    return; // 如果点击在节点上，让节点自己处理
  }

  // 否则显示画布菜单
  event.preventDefault();
  event.stopPropagation();
  // console.log('[CTX] handleCanvasContextMenu (wrapper fallback)', { x: event.clientX, y: event.clientY });
  openQuasarMenuFromMouseEvent(event, { nodeId: null, canvasClick: true });
}

// 隐藏右键菜单
function hideContextMenu() {
  const menu = (contextMenuRef.value as unknown as { hide?: () => void });
  if (menu?.hide) {
    menu.hide();
    // console.log('[CTX] menu hidden via hide()');
  }
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

  // 使用右键菜单的坐标，转换为画布坐标
  const canvasPosition = project({ x: contextMenu.value.x, y: contextMenu.value.y });

  // 生成新的 UUID
  const newEvent: TimelineEvent = {
    ...clipboard.value.event,
    id: generateUUIDv7(),
    title: `${clipboard.value.event.title} (副本)`,
    position: {
      x: canvasPosition.x,
      y: canvasPosition.y,
    },
    // 确保有默认尺寸
    width: clipboard.value.event.width || 200,
    height: clipboard.value.event.height || 120,
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
  // 将屏幕坐标转换为画布坐标
  const canvasPosition = project({ x: contextMenu.value.x, y: contextMenu.value.y });

  const newEvent: TimelineEvent = {
    id: generateUUIDv7(),
    title: '新事件',
    group: '默认分组',
    type: 'main',
    date: new Date().toISOString().split('T')[0] || '',
    description: '',
    position: {
      x: canvasPosition.x,
      y: canvasPosition.y,
    },
    // 设置默认尺寸
    width: 200,
    height: 120,
    data: {
      type: 'main',
    },
  };

  events.value.push(newEvent);
  void updateFlowElements();
  void saveTimelineData();
  hideContextMenu();
}

// 在画布上创建条件节点
function createConditionNodeAtPosition() {
  // 将屏幕坐标转换为画布坐标
  const canvasPosition = project({ x: contextMenu.value.x, y: contextMenu.value.y });

  const newEvent: TimelineEvent = {
    id: generateUUIDv7(),
    title: '新条件',
    group: '条件分组',
    type: 'main',
    date: new Date().toISOString().split('T')[0] || '',
    description: '点击编辑条件',
    position: {
      x: canvasPosition.x,
      y: canvasPosition.y,
    },
    // 设置默认尺寸
    width: 200,
    height: 120,
    data: {
      type: 'condition', // 标记为条件节点
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

  // 为示例数据补全宽高
  events.value.forEach((event) => {
    if (!event.width) event.width = 200;
    if (!event.height) event.height = 120;
  });

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
  console.log('[loadInitialData] Starting...');
  isLoading.value = true;

  // 向VS Code发送消息请求时间线数据和角色文章数据
  if (vscodeApi.value?.postMessage) {
    console.log('[loadInitialData] VSCode API available, requesting data...');

    // 请求时间线数据
    vscodeApi.value.postMessage({
      type: 'requestTimelineData',
    });

    // 请求角色和文章数据(只请求一次,后续传递给子组件)
    vscodeApi.value.postMessage({
      type: 'requestRolesAndArticles',
    });
  } else {
    console.error('[loadInitialData] ❌ VSCode API not available');
    console.error('[loadInitialData] vscodeApi.value:', vscodeApi.value);
    console.error('[loadInitialData] Check if initVSCodeApi() was called and succeeded');
  }

  // 如果500ms后没有数据，询问是否使用示例数据初始化
  setTimeout(() => {
    if (events.value.length === 0) {
      console.log('[loadInitialData] No data received after 500ms, showing sample data dialog');
      showSampleDataDialog.value = true;
    }
    isLoading.value = false;
  }, 500);
}

// 处理从 VS Code 收到的消息
function handleMessage(event: MessageEvent) {
  const message = event.data;
  if (!message || typeof message.type !== 'string') {
    return;
  }

  console.log('[handleMessage] Received message:', message.type, message);

  switch (message.type) {
    case 'timelineData':
    try {
      console.log('[handleMessage] Processing timeline data...');
      const data = message.data as TimelineData;
      events.value = data.events || [];
      connections.value = data.connections || [];
      console.log('[handleMessage] Loaded', events.value.length, 'events and', connections.value.length, 'connections');

      // 为所有没有宽高数据的节点补上默认值
      let hasUpdates = false;
      events.value.forEach((event) => {
        if (!event.width) {
          event.width = 200;
          hasUpdates = true;
        }
        if (!event.height) {
          event.height = 120;
          hasUpdates = true;
        }
      });

      void updateFlowElements();

      // 如果补全了数据，保存一次
      if (hasUpdates) {
        console.log('[TimelinePage] 补全了节点尺寸数据，保存中...');
        void saveTimelineData();
      }
    } catch (error) {
      console.error('[handleMessage] 解析时间线数据失败:', error);
    } finally {
      isLoading.value = false;
    }
      break;

    case 'rolesAndArticlesData':
      console.log('[handleMessage] Processing roles and articles data...');
      rolesList.value = message.roles || [];
      articlesList.value = message.articles || [];
      console.log('[handleMessage] Loaded', rolesList.value.length, 'roles and', articlesList.value.length, 'articles');
      break;

    case 'dataChangeAck':
      console.log('[handleMessage] Received dataChangeAck from backend:', message);
      break;

    default:
      console.log('[handleMessage] Ignoring unsupported message type:', message.type);
      break;
  }
}

// 保存数据到 VS Code
function saveTimelineData() {
  console.log('[saveTimelineData] Starting save...');
  console.log('[saveTimelineData] VSCode API status:', {
    hasVscodeApi: !!vscodeApi.value,
    hasPostMessage: !!vscodeApi.value?.postMessage,
    eventsCount: events.value.length,
    connectionsCount: connections.value.length
  });

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
      status: b.status,
      documentTitle: b.documentTitle,
    })) : undefined,
    color: event.color, // 保存自定义颜色
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
    sourceHandle: conn.sourceHandle, // 保存条件节点的源手柄（true/false）
    targetHandle: conn.targetHandle, // 保存目标手柄
    label: conn.label,
    connectionType: conn.connectionType,
  }));

  console.log('[saveTimelineData] Prepared data - Events:', plainEvents.length, 'Connections:', plainConnections.length);

  if (vscodeApi.value?.postMessage) {
    console.log('[saveTimelineData] Sending dataChanged message to backend...');
    try {
      vscodeApi.value.postMessage({
        type: 'dataChanged',
        data: {
          events: plainEvents,
          connections: plainConnections,
        },
      });
      console.log('[saveTimelineData] ✅ Message sent successfully');
    } catch (error) {
      console.error('[saveTimelineData] ❌ Error sending message:', error);
    }
  } else {
    console.error('[saveTimelineData] ❌ VSCode API not available, cannot save!');
    console.error('[saveTimelineData] vscodeApi.value:', vscodeApi.value);
  }
}

// 节流辅助函数
function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastRan: number | null = null;

  return function(this: any, ...args: Parameters<T>) {
    const now = Date.now();

    if (lastRan === null || now - lastRan >= wait) {
      // 立即执行
      func.apply(this, args);
      lastRan = now;

      // 清除pending的timeout
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    } else {
      // 延迟执行
      if (timeout) clearTimeout(timeout);

      timeout = setTimeout(() => {
        func.apply(this, args);
        lastRan = Date.now();
        timeout = null;
      }, wait - (now - lastRan));
    }
  };
}

// 节流版本的保存函数（用于拖动调整大小时）
const saveTimelineDataThrottled = throttle(saveTimelineData, 500);

// 计算节点的最小高度（基于绑定数量）
function calculateMinNodeHeight(event: TimelineEvent): number {
  const baseHeight = 120; // 基础高度
  const bindingsCount = event.bindings?.length || 0;

  if (bindingsCount === 0) {
    return baseHeight;
  }

  // 每个角色绑定大约需要 30px（头像+名称+状态）
  // 每个文档绑定大约需要 24px
  const characterBindings = event.bindings?.filter(b => b.type === 'character').length || 0;
  const documentBindings = event.bindings?.filter(b => b.type === 'article').length || 0;

  const bindingsHeight = (characterBindings * 30) + (documentBindings * 24) + 20; // 20px for padding/border

  return baseHeight + bindingsHeight;
}

// 更新流元素
function updateFlowElements() {
  // 创建节点 - 使用保存的坐标
  const newNodes: any[] = [];

  events.value.forEach((event, index) => {
    // 确保所有节点都有默认尺寸
    if (!event.width) event.width = 200;

    // 根据绑定数量计算最小高度
    const minHeight = calculateMinNodeHeight(event);
    if (!event.height || event.height < minHeight) {
      event.height = minHeight;
    }

    const nodeStyle: Record<string, any> = {};

    // 应用节点尺寸
    nodeStyle.width = `${event.width}px`;
    nodeStyle.height = `${event.height}px`;
    nodeStyle.minHeight = `${minHeight}px`; // 设置最小高度

    // 检查是否是父节点（有子节点）
    const hasChildren = events.value.some(e => e.parentNode === event.id);

    // 根据 data.type 确定节点类型
    const nodeType = event.data?.type === 'condition' ? 'condition' : 'editable';

    newNodes.push({
      id: event.id,
      type: nodeType,
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
        parentNode: event.parentNode, // 传递 parentNode 信息给组件
        hasChildren, // 传递是否有子节点的信息
        color: event.color, // 传递自定义颜色
        rolesList: rolesList.value, // 传递角色列表
        articlesList: articlesList.value, // 传递文章列表
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
      sourceHandle: conn.sourceHandle, // 传递源手柄 ID
      targetHandle: conn.targetHandle, // 传递目标手柄 ID
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
  void (() => {
    if (!vscodeApi.value) {
      console.error('[TimelinePage] VSCode API not available, using window fallback listeners');
    }

    // 加载渲染设置
    settingsStore.loadFromLocalStorage();

    // 加载时间线视图状态
    loadTimelineViewState();

    // 添加消息监听 - VS Code webview 中总是通过 window.addEventListener 监听消息
    window.addEventListener('message', handleMessage as EventListener);

    if (vscodeApi.value?.postMessage) {
      loadInitialData();
    } else {
      console.error('[TimelinePage] Cannot request initial data - VSCode API unavailable');
    }

    // 添加全局事件监听器
    window.addEventListener('timeline-node-update', handleTimelineNodeUpdate as EventListener);
    window.addEventListener('timeline-node-resize', handleTimelineNodeResize as EventListener);
    window.addEventListener('timeline-open-editor', handleOpenEditor as EventListener);
    window.addEventListener('timeline-node-contextmenu', handleNodeContextMenuEvent as EventListener);
  })();

  // 不再绑定全局 click 关闭，交由 Quasar 自己处理，避免刚打开就被关闭

  // 菜单采用 contextmenu + show(event) 进行定位
});

// 清理事件监听器
onUnmounted(() => {
  window.removeEventListener('message', handleMessage);
  window.removeEventListener('timeline-node-update', handleTimelineNodeUpdate);
  window.removeEventListener('timeline-node-resize', handleTimelineNodeResize);
  window.removeEventListener('timeline-open-editor', handleOpenEditor);
  window.removeEventListener('timeline-node-contextmenu', handleNodeContextMenuEvent);
  // 无全局 click 监听，无需移除
});

// 处理打开编辑器事件
function handleOpenEditor() {
  console.log('[TimelinePage] handleOpenEditor 被调用');
  try {
    const nodeId = localStorage.getItem('openNodeEditor');
    console.log('[TimelinePage] 从 localStorage 获取 nodeId:', nodeId);
    if (nodeId) {
      console.log('[TimelinePage] 调用 openNodeEditor');
      openNodeEditor(nodeId);
      localStorage.removeItem('openNodeEditor');
    } else {
      console.warn('[TimelinePage] nodeId 为空');
    }
  } catch (error) {
    console.error('[TimelinePage] Failed to open editor:', error);
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

// 处理时间线节点大小调整事件
function handleTimelineNodeResize() {
  // console.log('[handleTimelineNodeResize] 事件触发');
  try {
    const eventDataStr = localStorage.getItem('tempNodeResize');
    // console.log('[handleTimelineNodeResize] localStorage数据:', eventDataStr);

    if (eventDataStr) {
      const eventData = JSON.parse(eventDataStr) as { id: string; width: number; height: number };
      // console.log('[handleTimelineNodeResize] 解析后的数据:', eventData);

      const eventIndex = events.value.findIndex((e) => e.id === eventData.id);
      // console.log('[handleTimelineNodeResize] 找到节点索引:', eventIndex);

      if (eventIndex !== -1 && events.value[eventIndex]) {
        // console.log('[handleTimelineNodeResize] 更新前:', {
        //   width: events.value[eventIndex].width,
        //   height: events.value[eventIndex].height
        // });

        events.value[eventIndex].width = eventData.width;
        events.value[eventIndex].height = eventData.height;

        // console.log('[handleTimelineNodeResize] 更新后:', {
        //   width: events.value[eventIndex].width,
        //   height: events.value[eventIndex].height
        // });
      }
      localStorage.removeItem('tempNodeResize');
    }

    // 检查并补全所有节点的宽高数据
    let hasUpdates = false;
    events.value.forEach((event) => {
      if (!event.width || !event.height) {
        if (!event.width) {
          event.width = 200;
          hasUpdates = true;
        }
        if (!event.height) {
          event.height = 120;
          hasUpdates = true;
        }
      }
    });

    // 如果有任何更新（调整大小或补全数据），刷新并保存
    if (eventDataStr || hasUpdates) {
      updateFlowElements();
      // 使用节流版本避免拖动时频繁保存
      void saveTimelineDataThrottled();
    }
  } catch (error) {
    console.error('解析节点大小调整数据失败:', error);
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

.timeline-flow-wrapper {
  width: 100%;
  height: 100%;
  position: relative;
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

/* 右键菜单美化样式 */
:deep(.timeline-context-menu) {
  background: rgba(30, 30, 30, 0.98) !important;
  backdrop-filter: blur(10px);
  border-radius: 8px !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1) !important;
  padding: 4px !important;
}

:deep(.timeline-context-menu .q-item) {
  border-radius: 6px !important;
  margin: 2px 0 !important;
  padding: 10px 12px !important;
  transition: all 0.2s ease !important;
}

:deep(.timeline-context-menu .q-item:hover) {
  background: rgba(66, 184, 131, 0.15) !important;
}

:deep(.timeline-context-menu .q-item__label) {
  font-weight: 500 !important;
}

:deep(.timeline-context-menu .q-item__label--caption) {
  font-size: 11px !important;
  opacity: 0.7 !important;
  margin-top: 2px !important;
}

:deep(.timeline-context-menu .q-separator) {
  background: rgba(255, 255, 255, 0.08) !important;
  margin: 4px 8px !important;
}

:deep(.timeline-context-menu .q-badge) {
  font-size: 10px !important;
  padding: 2px 6px !important;
  border-radius: 4px !important;
  font-weight: 500 !important;
}

:deep(.timeline-context-menu .q-icon) {
  font-size: 20px !important;
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

/* 移除 Vue Flow 默认给节点添加的边框 */
:deep(.vue-flow__node) {
  border: none !important;
}

/* NodeResizer 样式 - 默认隐藏，悬停时显示 */
:deep(.vue-flow__resize-control) {
  opacity: 0;
  transition: opacity 0.2s ease;
  z-index: 100; /* 确保在最上层 */
}

:deep(.vue-flow__node:hover .vue-flow__resize-control) {
  opacity: 1;
}

:deep(.vue-flow__resize-control.handle) {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: white;
  border: 2px solid #42b883;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  cursor: nwse-resize;
}

:deep(.vue-flow__resize-control.handle:hover) {
  width: 14px;
  height: 14px;
  background: #42b883;
  border-color: white;
}

:deep(.vue-flow__resize-control.line) {
  border-color: #42b883;
  border-width: 2px;
  /* 不设置 opacity，继承父元素的 opacity */
}
</style>

