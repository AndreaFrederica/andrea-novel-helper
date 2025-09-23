<template>
  <div class="relation-graph-container">
    <div class="graph-and-json">
      <!-- 左侧过滤面板，可开关显示（带过渡动画） -->
      <transition name="filter-slide">
        <div class="filter-pane" v-if="showFilterPane">
          <div class="filter-pane-header">
            <span>节点过滤</span>
            <q-btn
              dense
              round
              flat
              size="sm"
              icon="close"
              @click="showFilterPane = false"
              class="close-btn"
            />
          </div>
          <div class="filter-content">
            <div class="filter-section">
              <div class="section-title">按属性过滤</div>
              <div class="attr-filters">
                <div class="attr-row">
                  <div class="attr-label">性别</div>
                  <q-option-group
                    v-model="checkedSex"
                    :options="[{ label: '全部', value: '' }, { label: '男性', value: 'male' }, { label: '女性', value: 'female' }, { label: '无', value: 'none' }, { label: '其他', value: 'other' }]"
                    type="radio"
                    dense
                    @update:model-value="doFilter"
                  />
                </div>
                <div class="attr-row">
                  <div class="attr-label">正负角色</div>
                  <q-option-group
                    v-model="checkedIsGoodman"
                    :options="[{ label: '全部', value: '' }, { label: '正面角色', value: 'true' }, { label: '负面角色', value: 'false' }, { label: '其他', value: 'other' }]"
                    type="radio"
                    dense
                    @update:model-value="doFilter"
                  />
                </div>
              </div>
            </div>

            <div class="filter-section">
              <div class="section-title">关系类型过滤</div>
              <div class="rel-list">
                <q-option-group
                  v-model="relCheckList"
                  :options="allRelType.map(t => ({ label: t, value: t }))"
                  type="checkbox"
                  dense
                  @update:model-value="doFilter"
                />
              </div>
              <div class="filter-actions" style="margin-top: 8px;">
                <q-btn
                  dense
                  size="sm"
                  color="primary"
                  label="全选"
                  @click="selectAllRelations"
                  class="action-btn"
                />
                <q-btn
                  dense
                  size="sm"
                  color="grey"
                  label="全不选"
                  @click="deselectAllRelations"
                  class="action-btn"
                />
              </div>
            </div>
            <div class="filter-section">
              <div class="section-title">显示/隐藏节点</div>
              <div class="node-list">
                <div
                  v-for="node in allNodes"
                  :key="node.id"
                  class="node-item"
                  :class="{ 'node-hidden': hiddenNodeIds.has(node.id) }"
                >
                  <q-checkbox
                    :model-value="!hiddenNodeIds.has(node.id)"
                    @update:model-value="toggleNodeVisibility(node.id, $event)"
                    :label="node.text || node.id"
                    dense
                  />
                </div>
              </div>
            </div>
            <div class="filter-actions">
              <q-btn
                dense
                color="primary"
                label="全部显示"
                @click="showAllNodes"
                class="action-btn"
              />
              <q-btn
                dense
                color="grey"
                label="全部隐藏"
                @click="hideAllNodes"
                class="action-btn"
              />
            </div>
          </div>
        </div>
      </transition>

      <div class="graph-pane">
        <div
          ref="graphWrapperRef"
          style="height: calc(100vh)"
          @touchstart="onTouchStart"
          @touchend="onTouchEnd"
          @touchmove="onTouchMove"
        >
          <RelationGraph
            ref="graphRef"
            :options="graphOptions"
            :on-line-click="onLineClick"
            :on-node-drag-start="onNodeDragStart"
            :on-node-dragging="onNodeDragging"
            :on-node-drag-end="onNodeDragEnd"
            :on-contextmenu="onContextmenu"
          >
            <template #tool-bar>
              <RelationGraphToolBar />
            </template>
          </RelationGraph>

          <!-- 过滤面板开关按钮（固定在左上角） -->
          <div class="filter-toggle-btn">
            <q-btn
              dense
              round
              color="grey-7"
              :icon="showFilterPane ? 'keyboard_double_arrow_left' : 'filter_list'"
              @click="showFilterPane = !showFilterPane"
            >
              <q-tooltip>{{ showFilterPane ? '隐藏过滤面板' : '显示过滤面板' }}</q-tooltip>
            </q-btn>
          </div>

          <!-- JSON 面板开关按钮（固定在右上角） -->
          <div class="json-toggle-btn">
            <q-btn
              dense
              round
              color="grey-7"
              :icon="showJsonPane ? 'keyboard_double_arrow_right' : 'code'"
              @click="showJsonPane = !showJsonPane"
            >
              <q-tooltip>{{ showJsonPane ? '隐藏JSON面板' : '显示JSON面板' }}</q-tooltip>
            </q-btn>
          </div>

          <!-- 连线右键菜单 -->
          <q-menu
            ref="linkMenuRef"
            touch-position
            context-menu

            v-model="showLinkMenu"
          >
            <q-list dense style="min-width: 200px">
              <q-item clickable v-close-popup @click="toggleDashed">
                <q-item-section avatar>
                  <q-icon :name="isDashed(currentLine) ? 'check_box' : 'check_box_outline_blank'" />
                </q-item-section>
                <q-item-section>{{
                  isDashed(currentLine) ? '切换为实线' : '切换为虚线'
                }}</q-item-section>
              </q-item>

              <q-item clickable v-close-popup @click="toggleStartArrow">
                <q-item-section avatar>
                  <q-icon
                    :name="
                      currentLine?.showStartArrow && !currentLine?.isHideArrow
                        ? 'check_box'
                        : 'check_box_outline_blank'
                    "
                  />
                </q-item-section>
                <q-item-section>起点箭头</q-item-section>
              </q-item>

              <q-item clickable v-close-popup @click="toggleEndArrow">
                <q-item-section avatar>
                  <q-icon
                    :name="
                      currentLine?.showEndArrow && !currentLine?.isHideArrow
                        ? 'check_box'
                        : 'check_box_outline_blank'
                    "
                  />
                </q-item-section>
                <q-item-section>终点箭头</q-item-section>
              </q-item>

              <q-item clickable v-close-popup @click="toggleHideAllArrows">
                <q-item-section avatar>
                  <q-icon
                    :name="currentLine?.isHideArrow ? 'check_box' : 'check_box_outline_blank'"
                  />
                </q-item-section>
                <q-item-section>隐藏全部箭头</q-item-section>
              </q-item>

              <q-separator />

              <q-item clickable v-close-popup @click="changeRelationType">
                <q-item-section avatar>
                  <q-icon name="category" color="primary" />
                </q-item-section>
                <q-item-section>调整关系类型</q-item-section>
              </q-item>

              <q-item clickable v-close-popup @click="changeRelationLiteral">
                <q-item-section avatar>
                  <q-icon name="edit" color="primary" />
                </q-item-section>
                <q-item-section>更改关系字面值</q-item-section>
              </q-item>

              <q-item clickable v-close-popup @click="changeLineColor">
                <q-item-section avatar>
                  <q-icon name="palette" color="primary" />
                </q-item-section>
                <q-item-section>更改连线颜色</q-item-section>
              </q-item>

              <q-separator />

              <q-item clickable v-close-popup @click="setLineWidth(1)">
                <q-item-section avatar>
                  <q-icon
                    :name="
                      currentLine?.lineWidth === 1
                        ? 'radio_button_checked'
                        : 'radio_button_unchecked'
                    "
                  />
                </q-item-section>
                <q-item-section>线宽 1</q-item-section>
              </q-item>
              <q-item clickable v-close-popup @click="setLineWidth(2)">
                <q-item-section avatar>
                  <q-icon
                    :name="
                      currentLine?.lineWidth === 2
                        ? 'radio_button_checked'
                        : 'radio_button_unchecked'
                    "
                  />
                </q-item-section>
                <q-item-section>线宽 2</q-item-section>
              </q-item>
              <q-item clickable v-close-popup @click="setLineWidth(3)">
                <q-item-section avatar>
                  <q-icon
                    :name="
                      currentLine?.lineWidth === 3
                        ? 'radio_button_checked'
                        : 'radio_button_unchecked'
                    "
                  />
                </q-item-section>
                <q-item-section>线宽 3</q-item-section>
              </q-item>

              <q-separator />

              <q-item clickable v-close-popup @click="deleteCurrentLink">
                <q-item-section avatar>
                  <q-icon name="delete" color="negative" />
                </q-item-section>
                <q-item-section>删除连线</q-item-section>
              </q-item>
            </q-list>
          </q-menu>

          <!-- 节点右键菜单 -->
          <q-menu
            ref="nodeMenuRef"
            touch-position
            context-menu

            v-model="showNodeMenu"
          >
            <q-list dense style="min-width: 200px">
              <q-item clickable v-close-popup @click="editNodeText">
                <q-item-section avatar>
                  <q-icon name="edit" color="primary" />
                </q-item-section>
                <q-item-section>编辑节点</q-item-section>
              </q-item>

              <q-separator />

              <q-item clickable v-close-popup @click="deleteCurrentNode">
                <q-item-section avatar>
                  <q-icon name="delete" color="negative" />
                </q-item-section>
                <q-item-section>删除节点</q-item-section>
              </q-item>
            </q-list>
          </q-menu>

          <!-- 画布右键菜单 -->
          <q-menu
            ref="canvasMenuRef"
            touch-position
            context-menu

            v-model="showCanvasMenu"
          >
            <q-list dense style="min-width: 200px">
              <q-item clickable v-close-popup @click="addNewNode">
                <q-item-section avatar>
                  <q-icon name="add_circle" color="positive" />
                </q-item-section>
                <q-item-section>添加节点</q-item-section>
              </q-item>

              <q-item clickable v-close-popup @click="centerGraph">
                <q-item-section avatar>
                  <q-icon name="center_focus_strong" color="primary" />
                </q-item-section>
                <q-item-section>居中显示</q-item-section>
              </q-item>

              <q-item clickable v-close-popup @click="fitToScreen">
                <q-item-section avatar>
                  <q-icon name="fit_screen" color="primary" />
                </q-item-section>
                <q-item-section>适应屏幕</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </div>
      </div>

      <!-- 右侧JSON面板，可开关显示（带过渡动画） -->
      <transition name="json-slide">
        <div class="json-pane" v-if="showJsonPane">
          <div class="json-pane-header">JSON（双向同步）</div>
          <q-input v-model="jsonText" type="textarea" autogrow outlined class="json-input" />
          <div class="json-actions">
            <q-btn color="primary" dense label="应用(替换)" @click="applyJsonReplace" />
            <q-btn
              color="secondary"
              dense
              label="追加(新增)"
              @click="applyJsonAppend"
              class="q-ml-sm"
            />
            <q-btn
              color="grey"
              dense
              label="刷新JSON"
              @click="updateJsonTextFromGraph"
              class="q-ml-sm"
            />
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, ref, nextTick, computed, onUnmounted } from 'vue';
import RelationGraph, {
  type RGJsonData,
  type RGOptions,
  type RelationGraphComponent,
  type RGUserEvent,
  type RGLink,
  type RGNode,
  type RGLine,
  type RGEventTargetType,
  type RGPosition,
} from 'relation-graph-vue3';
import RelationGraphToolBar from '../components/RelationGraphToolBar.vue';
import { useQuasar } from 'quasar';
import type { QMenu } from 'quasar';

const $q = useQuasar();

const graphOptions: RGOptions = {
  debug: true,
  allowSwitchLineShape: true,
  allowSwitchJunctionPoint: true,
  allowShowDownloadButton: true,
  defaultJunctionPoint: 'border',
  // 禁用自动布局，优先保留JSON中的x、y位置
  allowAutoLayoutIfSupport: false,
};

const graphRef = ref<RelationGraphComponent>();

// 过滤面板显示/隐藏
const showFilterPane = ref(true);

// JSON面板显示/隐藏
const showJsonPane = ref(true);

// 节点过滤相关状态
const allNodes = ref<RGNode[]>([]);
const hiddenNodeIds = ref<Set<string>>(new Set());

// 实时JSON字符串
const jsonText = ref('');

// 右键菜单状态
const linkMenuRef = ref<QMenu | null>(null);
const nodeMenuRef = ref<QMenu | null>(null);
const canvasMenuRef = ref<QMenu | null>(null);
const showLinkMenu = ref(false);
const showNodeMenu = ref(false);
const showCanvasMenu = ref(false);
const currentLink = ref<RGLink | null>(null);
const currentLine = ref<RGLine | null>(null);
const currentNode = ref<RGNode | null>(null);
const contextMenuPosition = ref({ x: 0, y: 0 });
const graphWrapperRef = ref<HTMLElement | null>(null);
const menuTarget = computed(() => graphWrapperRef.value ?? true);

// 示例中的属性过滤状态
const checkedSex = ref<string>('');
const checkedIsGoodman = ref<string>('');
const relCheckList = ref<string[]>([]);
const allRelType = ref<string[]>([]);

// VSCode通信相关变量和函数
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

// 使用ref创建安全的VSCode通信接口
const vscodeApi = ref<{
  postMessage: (message: any) => void;
  addEventListener: (type: string, listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: string, listener: (event: MessageEvent) => void) => void;
} | null>(null);

// 初始化VSCode API - 完全不依赖window
function initVSCodeApi() {
  // 尝试获取VSCode webview API
  const vscode = (globalThis as any).acquireVsCodeApi?.();
  
  if (vscode) {
    // 使用VSCode原生API
    vscodeApi.value = {
      postMessage: (message: any) => {
        vscode.postMessage(message);
      },
      addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
        // VSCode webview使用全局事件监听
        globalThis.addEventListener?.(type, listener as EventListener);
      },
      removeEventListener: (type: string, listener: (event: MessageEvent) => void) => {
        globalThis.removeEventListener?.(type, listener as EventListener);
      }
    };
  } else {
    // 降级方案：使用globalThis而不是window
    const global = globalThis as any;
    if (global.parent?.postMessage) {
      vscodeApi.value = {
        postMessage: (message: any) => {
          global.parent.postMessage(message, '*');
        },
        addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
          global.addEventListener?.(type, listener as EventListener);
        },
        removeEventListener: (type: string, listener: (event: MessageEvent) => void) => {
          global.removeEventListener?.(type, listener as EventListener);
        }
      };
    }
  }
}

// 处理来自VSCode的消息
function handleVSCodeMessage(event: MessageEvent) {
  const message = event.data;
  console.log('收到VSCode消息:', message);
  
  switch (message.type) {
    case 'relationshipData':
      // 接收到关系数据，更新图表
      console.log('收到关系数据:', message.data);
      if (message.data) {
        void loadRelationshipData(message.data);
      } else {
        console.log('关系数据为空，显示空图表');
        // 如果没有数据，显示空图表
        void loadRelationshipData({ nodes: [], lines: [] });
      }
      break;
    case 'saveSuccess':
      $q.notify({
        type: 'positive',
        message: '关系图数据已保存',
        position: 'top',
      });
      break;
    case 'saveError':
      $q.notify({
        type: 'negative',
        message: '保存失败: ' + (message.error || '未知错误'),
        position: 'top',
      });
      break;
    default:
      console.log('收到未知消息类型:', message.type);
  }
}

// 向VSCode请求关系数据
function requestRelationshipData() {
  console.log('请求关系数据...');
  if (vscodeApi.value?.postMessage) {
    vscodeApi.value.postMessage({
      type: 'requestRelationshipData'
    });
    console.log('已发送requestRelationshipData消息');
  } else {
    console.log('无法发送消息：VSCode API不可用');
  }
}

// 加载关系数据到图表
async function loadRelationshipData(data: RGJsonData) {
  const graphInstance = graphRef.value?.getInstance();
  if (!graphInstance) return;

  try {
    // 确保数据格式正确
    if (!data.nodes) data.nodes = [];
    if (!data.lines) data.lines = [];
    
    // 为节点设置默认属性
    data.nodes.forEach((node: any) => {
      if (!node.data) {
        node.data = {};
      }
      if (!node.data.sexType) {
        node.data.sexType = 'other';
      }
      if (node.data.isGoodMan === undefined) {
        node.data.isGoodMan = 'other';
      }
    });

    // 为连线设置默认属性
    data.lines.forEach((line: any) => {
      if (!line.data) {
        line.data = {};
      }
      if (!line.data.type) {
        line.data.type = '其他关系';
      }
      if (!line.text || line.text === '') {
        line.text = line.data.type;
      }
    });

    // 手动添加节点和连线，避免自动布局
    graphInstance.addNodes(data.nodes);
    graphInstance.addLines(data.lines);
    // rootNode 属性可能不存在于当前版本的 relation-graph-vue3 中
    // if (data.rootId) {
    //   graphInstance.rootNode = graphInstance.getNodeById(data.rootId);
    // }
    // 不调用 doLayout()，直接移动到中心和缩放适应
    graphInstance.moveToCenter?.();
    graphInstance.zoomToFit?.();
    await updateJsonTextFromGraph();
    updateNodesList();
    
    $q.notify({
      type: 'positive',
      message: '关系数据已加载',
      position: 'top',
    });
  } catch (err) {
    console.error('加载关系数据失败:', err);
    $q.notify({
      type: 'negative',
      message: '加载关系数据失败: ' + String(err),
      position: 'top',
    });
  }
}

// 深度清理对象，移除所有不可序列化的属性
function deepCleanObject(obj: any, visited = new WeakSet()): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  // 防止循环引用
  if (visited.has(obj)) {
    return null;
  }
  visited.add(obj);
  
  // 过滤不可序列化的对象类型
  if (obj instanceof HTMLElement || 
      obj instanceof Node || 
      obj instanceof Window ||
      obj instanceof Document ||
      typeof obj === 'function') {
    return null;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => deepCleanObject(item, visited)).filter(item => item !== null);
  }
  
  const cleaned: any = {};
  for (const [key, value] of Object.entries(obj)) {
    // 跳过不需要的属性
    if (key.startsWith('_') || 
        key.startsWith('$') ||
        key === 'seeks_id' ||
        key === 'fromNode' ||
        key === 'toNode' ||
        key === 'relations' ||
        key === 'el' ||
        key === 'dom' ||
        key === 'element' ||
        typeof value === 'function') {
      continue;
    }
    
    const cleanedValue = deepCleanObject(value, visited);
    if (cleanedValue !== null) {
      cleaned[key] = cleanedValue;
    }
  }
  
  return cleaned;
}

// 保存关系数据到VSCode
function saveRelationshipData() {
  const graphInstance = graphRef.value?.getInstance();
  if (!graphInstance) return;

  try {
    const rawData = graphInstance.getGraphJsonData();
    console.log('原始数据:', rawData);
    
    // 使用深度清理函数
    const cleanData = deepCleanObject(rawData);
    console.log('清理后数据:', cleanData);
    
    if (vscodeApi.value?.postMessage) {
      vscodeApi.value.postMessage({
        type: 'saveRelationshipData',
        data: cleanData
      });
      
      $q.notify({
        type: 'positive',
        message: '数据保存成功',
        position: 'top',
      });
    }
  } catch (err) {
    console.error('保存关系数据失败:', err);
    $q.notify({
      type: 'negative',
      message: '保存失败: ' + String(err),
      position: 'top',
    });
  }
}

// 延迟保存功能（防抖）
function scheduleSave() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  
  saveTimeout = setTimeout(() => {
    saveRelationshipData();
    saveTimeout = null;
  }, 2000); // 2秒后自动保存
}

onMounted(() => {
  // 初始化VSCode API
  initVSCodeApi();
  
  // 禁用画布区域的默认右键菜单
  // const wrapper = graphWrapperRef.value;
  // if (wrapper) {
  //   wrapper.addEventListener('contextmenu', (e) => {
  //     e.preventDefault();
  //     return false;
  //   });
  // }
  
  // 设置VSCode消息监听器
  if (vscodeApi.value?.addEventListener) {
    vscodeApi.value.addEventListener('message', handleVSCodeMessage);
  }
  
  // 只请求后端数据，不加载测试数据
  requestRelationshipData();
  
  // 注释掉开发模式的测试数据加载
  // 如果需要在开发环境中测试，可以通过其他方式加载测试数据
  // if (!window.parent || window.parent === window) {
  //   console.log('开发模式：显示示例数据');
  //   void showGraph();
  // }
});

const showGraph = async () => {
  const __graph_json_data: RGJsonData = {
    rootId: '1',
    nodes: [
      {
        id: '1',
        text: '主角',
        borderColor: 'yellow',
        x: 0,
        y: 0,
        data: { sexType: 'male', isGoodMan: true, roleUuid: 'role-uuid-a' }
      },
      {
        id: '2',
        text: '女主',
        color: '#43a2f1',
        fontColor: 'yellow',
        x: 120,
        y: -40,
        data: { sexType: 'female', isGoodMan: true, roleUuid: 'role-uuid-b' }
      },
      {
        id: '3',
        text: '反派',
        nodeShape: 1,
        width: 80,
        height: 60,
        x: -100,
        y: 100,
        data: { sexType: 'male', isGoodMan: false, roleUuid: 'role-uuid-c' }
      },
      {
        id: '4',
        text: '配角1',
        nodeShape: 0,
        width: 100,
        height: 100,
        x: 220,
        y: 120,
        data: { sexType: 'female', isGoodMan: true, roleUuid: 'role-uuid-d' }
      },
      {
        id: '5',
        text: '配角2',
        nodeShape: 0,
        width: 150,
        height: 150,
        x: -200,
        y: -80,
        data: { sexType: 'male', isGoodMan: true, roleUuid: 'role-uuid-e' }
      },
    ],
    lines: [
      { from: '1', to: '2', text: '恋人关系', color: '#43a2f1', data: { type: '恋人关系' } },
      { from: '1', to: '3', text: '敌对关系', data: { type: '敌对关系' } },
      { from: '1', to: '4', text: '朋友关系', data: { type: '朋友关系' } },
      { from: '1', to: '5', text: '师徒关系', data: { type: '师徒关系' } },
      { from: '2', to: '5', text: '闺蜜关系', color: '#67C23A', data: { type: '朋友关系' } },
      { from: '3', to: '4', text: '其他关系', data: { type: '其他关系' } },
      { from: '3', to: '4', text: '其他关系', data: { type: '其他关系' } },
    ],
  };

  const graphInstance = graphRef.value?.getInstance();
  if (graphInstance) {
    // 手动添加节点和连线，避免自动布局
    graphInstance.addNodes(__graph_json_data.nodes);
    graphInstance.addLines(__graph_json_data.lines);
    // rootNode 属性可能不存在于当前版本的 relation-graph-vue3 中
    // if (__graph_json_data.rootId) {
    //   graphInstance.rootNode = graphInstance.getNodeById(__graph_json_data.rootId);
    // }
    // 不调用 doLayout()，直接移动到中心和缩放适应
    graphInstance.moveToCenter?.();
    graphInstance.zoomToFit?.();
    await updateJsonTextFromGraph();
    // 更新节点列表用于过滤面板
    updateNodesList();
  }
}

// 更改连线颜色功能
function changeLineColor() {
  const line = currentLine.value;
  if (!line) return;

  // 获取当前颜色
  const currentColor = line.color || '#666666';

  // 预定义颜色选项
  const colorOptions = [
    { label: '默认灰色', value: '#666666', color: '#666666' },
    { label: '红色', value: '#ff4444', color: '#ff4444' },
    { label: '蓝色', value: '#4444ff', color: '#4444ff' },
    { label: '绿色', value: '#44ff44', color: '#44ff44' },
    { label: '橙色', value: '#ff8844', color: '#ff8844' },
    { label: '紫色', value: '#8844ff', color: '#8844ff' },
    { label: '粉色', value: '#ff44aa', color: '#ff44aa' },
    { label: '青色', value: '#44aaff', color: '#44aaff' },
    { label: '黄色', value: '#ffaa44', color: '#ffaa44' },
    { label: '深红', value: '#aa0000', color: '#aa0000' },
    { label: '深蓝', value: '#0000aa', color: '#0000aa' },
    { label: '深绿', value: '#00aa00', color: '#00aa00' },
    { label: '自定义...', value: 'custom', color: '#000000' }
  ];

  $q.dialog({
    title: '更改连线颜色',
    message: '请选择连线颜色：',
    options: {
      type: 'radio',
      model: currentColor,
      items: colorOptions.map(option => ({
        label: option.label,
        value: option.value,
        color: option.color
      }))
    },
    cancel: true,
    persistent: true,
  }).onOk((selectedColor: string) => {
    if (selectedColor === 'custom') {
      // 显示自定义颜色输入对话框
      $q.dialog({
        title: '自定义连线颜色',
        message: '请输入颜色值（支持十六进制如 #ff0000 或颜色名如 red）：',
        prompt: {
          model: currentColor,
          type: 'text',
          placeholder: '例如：#ff0000 或 red'
        },
        cancel: true,
        persistent: true,
      }).onOk((customColor: string) => {
        if (customColor && customColor.trim()) {
          updateLineColor(customColor.trim());
        }
      });
    } else {
      updateLineColor(selectedColor);
    }
  });

  function updateLineColor(newColor: string) {
    if (!line) return;

    // 设置连线颜色
    line.color = newColor;

    try {
      void updateJsonTextFromGraph();
      $q.notify({
        type: 'positive',
        message: `连线颜色已更新为: ${newColor}`,
        position: 'top',
      });
    } catch (err) {
      console.warn('图刷新失败，但连线颜色已更新。', err);
    }
  }
}

// 更改关系字面值功能
function changeRelationLiteral() {
  const line = currentLine.value;
  if (!line) return;

  // 获取当前字面值（如果文本包含换行，取第一行作为字面值）
  const currentText = line.text || '';
  const currentLiteral = currentText.includes('\n') ? currentText.split('\n')[0] : currentText;

  $q.dialog({
    title: '更改关系字面值',
    message: '请输入新的关系字面值：',
    prompt: {
      model: currentLiteral || '',
      type: 'text',
      placeholder: '例如：深爱、仇恨、师父等'
    },
    cancel: true,
    persistent: true,
  }).onOk((newLiteral: string) => {
    if (newLiteral !== null && newLiteral !== undefined) {
      updateRelationLiteral(newLiteral.trim());
    }
  });

  function updateRelationLiteral(newLiteral: string) {
    if (!line) return;

    // 获取当前关系类型
    const currentType = (line.data as Record<string, unknown>)?.['type'] as string || '其他关系';

    // 设置新的显示文本
    if (newLiteral) {
      line.text = `${newLiteral}\n（${currentType}）`;
    } else {
      line.text = `（${currentType}）`;
    }

    try {
      void updateJsonTextFromGraph();
      $q.notify({
        type: 'positive',
        message: newLiteral ? `关系字面值已更新为: ${newLiteral}` : '关系字面值已清空',
        position: 'top',
      });
    } catch (err) {
      console.warn('图刷新失败，但关系字面值已更新。', err);
    }
  }
};

// 拖拽中节流更新：避免频繁JSON重算导致卡顿
const draggingUpdateTimer = ref<ReturnType<typeof setTimeout> | undefined>();
function scheduleUpdateFromGraph() {
  if (draggingUpdateTimer.value) return;
  draggingUpdateTimer.value = setTimeout(() => {
    draggingUpdateTimer.value = undefined;
    void updateJsonTextFromGraph();
  }, 120);
}

function onNodeDragStart(_node?: RGNode, _e?: RGUserEvent) {
  // 拖拽开始可选择做记录，这里暂不处理
}

// 拖拽中：轻量实时同步（节流），不触发大刷新
function onNodeDragging(_node?: RGNode, _newX?: number, _newY?: number, _e?: RGUserEvent) {
  scheduleUpdateFromGraph();
}

// 拖拽结束后：再做一次最终同步
function onNodeDragEnd(_node?: RGNode, _e?: RGUserEvent) {
  void updateJsonTextFromGraph();
  // 拖拽结束后自动保存
  scheduleSave();
}

// ---- 处理连线双击以编辑文本 ----
const lastLineClickId = ref<string>('');
const lastLineClickAt = ref<number>(0);

function onLineClick(line: RGLine, _link: RGLink, _e: RGUserEvent) {
  const now = Date.now();
  const id: string = line?.id ?? `${line?.from ?? ''}->${line?.to ?? ''}`;
  const isSame = lastLineClickId.value === id;
  const within = now - lastLineClickAt.value < 300; // 300ms 内判定为双击

  lastLineClickId.value = id;
  lastLineClickAt.value = now;

  if (isSame && within) {
    // 重置点击状态，避免三击触发
    lastLineClickId.value = '';
    lastLineClickAt.value = 0;

    const currentType = (line.data as Record<string, unknown>)?.['type'] as string || '其他关系';

    $q.dialog({
      title: '编辑连线关系',
      message: '请选择关系类型：',
      options: {
        type: 'radio',
        model: currentType,
        items: [
          { label: '恋人关系', value: '恋人关系' },
          { label: '朋友关系', value: '朋友关系' },
          { label: '敌对关系', value: '敌对关系' },
          { label: '师徒关系', value: '师徒关系' },
          { label: '亲属关系', value: '亲属关系' },
          { label: '同事关系', value: '同事关系' },
          { label: '其他关系', value: '其他关系' }
        ]
      },
      cancel: true,
      persistent: true,
    }).onOk((newType: string) => {
      const graphInstance = graphRef.value?.getInstance();
      if (!graphInstance) return;

      // 同时更新连线的显示文本和关系类型数据，保持一致
      line.text = newType;
      if (!line.data) {
        line.data = {};
      }
      (line.data as Record<string, unknown>)['type'] = newType;

      try {
        void updateJsonTextFromGraph();
        updateNodesList(); // 更新关系类型列表
        // 连线关系修改后自动保存
        scheduleSave();
        $q.notify({
          type: 'positive',
          message: `关系已更新为: ${newType}`,
          position: 'top',
        });
      } catch (err) {
        console.warn('图刷新失败，但关系已更新。', err);
      }
    });
  }
}

// ---- 工具：从事件提取屏幕坐标 ----
function getClientPointFromEvent(ev: any): { x: number; y: number } {
  const t = ev?.touches?.[0] || ev?.changedTouches?.[0];
  const cx = ev?.clientX ?? ev?.pageX ?? t?.clientX ?? t?.pageX ?? 0;
  const cy = ev?.clientY ?? ev?.pageY ?? t?.clientY ?? t?.pageY ?? 0;
  return { x: Number(cx) || 0, y: Number(cy) || 0 };
}

function resolvePointerEvent(ev: any): Event | null {
  const candidate = ev?.evt ?? ev?.event ?? ev?.originalEvent ?? ev;
  if (!candidate) {
    return null;
  }

  if (candidate instanceof Event) {
    return candidate;
  }

  if (
    typeof candidate === 'object' &&
    ('clientX' in candidate || 'touches' in candidate || 'changedTouches' in candidate)
  ) {
    return candidate as Event;
  }

  return null;
}

function buildSyntheticContextEvent(x: number, y: number): Event {
  // 在浏览器环境中创建MouseEvent
  if (typeof MouseEvent === 'function') {
    return new MouseEvent('contextmenu', {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    });
  }

  // 降级方案：返回基础事件对象
  return {
    type: 'contextmenu',
    clientX: x,
    clientY: y,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as Event;
}
// relation-graph 的右键回调：拿原生事件传进去
async function onContextmenu(
  e: RGUserEvent,
  objectType: RGEventTargetType,
  object?: RGNode | RGLink,
) {
  console.log('onContextmenu triggered:', e, objectType, object);

  // 检查事件对象结构
  const native = resolvePointerEvent(e);
  console.log('Resolved native event:', native);

  if (!native) {
    console.error('无法获取原生事件');
    return;
  }

  // 将原生事件传给统一的 openContextMenu 实现进行处理
  await openContextMenu(native as any, objectType || 'canvas', object ?? null);
}

// ✅ 仅调用 menuRef.show(evt) 进行定位；不再依赖 v-model / :target
// 依赖你上面已定义的工具函数：resolvePointerEvent / getClientPointFromEvent / buildSyntheticContextEvent
async function openContextMenu(
  ev: MouseEvent | TouchEvent | PointerEvent,
  type: RGEventTargetType | 'canvas',
  payload?: RGNode | RGLink | null
) {
  // 统一原生事件（relation-graph 可能把原生事件挂在 e.evt / e.event 上）
  const native = (resolvePointerEvent(ev) as MouseEvent | TouchEvent | PointerEvent | null) ?? null;

  // 阻止浏览器默认菜单 & 事件冒泡
  (native ?? ev as any).preventDefault?.();
  (native ?? ev as any).stopPropagation?.();

  // 取坐标（用于后续“在鼠标处添加节点”等功能）
  const { x, y } = getClientPointFromEvent(native ?? ev);
  contextMenuPosition.value = { x, y };

  // 保证传给 QMenu.show 的是“可用的原生事件”
  const eventForMenu: Event =
    native && (native instanceof Event || typeof (native as any).type === 'string')
      ? (native as Event)
      : buildSyntheticContextEvent(x, y);

  // 先设置当前上下文对象
  if (type === 'link' && payload) {
    currentLink.value = payload as RGLink;
    // relation-graph 的连线对象里通常有 relations 数组，取第一个 line 以便修改样式/箭头
    const rels = (currentLink.value as any)?.relations;
    currentLine.value = Array.isArray(rels) ? (rels[0] ?? null) : (payload as unknown as RGLine ?? null);
    currentNode.value = null;

    await nextTick();
    // 不需要操控 v-model；handed Quasar 自己管理开合
    linkMenuRef.value?.hide?.(); // 保守：确保上一次已关闭
    linkMenuRef.value?.show(eventForMenu); // ✅ 用事件坐标定位
    return;
  }

  if (type === 'node' && payload) {
    currentNode.value = payload as RGNode;
    currentLink.value = null;
    currentLine.value = null;

    await nextTick();
    nodeMenuRef.value?.hide?.();
    nodeMenuRef.value?.show(eventForMenu); // ✅ 用事件坐标定位
    return;
  }

  // 默认：画布菜单
  currentNode.value = null;
  currentLink.value = null;
  currentLine.value = null;

  await nextTick();
  canvasMenuRef.value?.hide?.();
  canvasMenuRef?.value?.show(eventForMenu); // ✅ 用事件坐标定位
}


// ---- 长按触发（移动端/触屏）：默认打开画布菜单 ----
const longPressThreshold = 550; // ms
const longPressTimer = ref<ReturnType<typeof setTimeout> | undefined>();

function onTouchStart(ev: TouchEvent) {
  const pt = getClientPointFromEvent(ev);
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value);
  }
  longPressTimer.value = setTimeout(() => {
    const syntheticEvt = buildSyntheticContextEvent(pt.x, pt.y);
    // cast to MouseEvent to satisfy the expected parameter type and call without awaiting
    void openContextMenu(syntheticEvt as unknown as MouseEvent, 'canvas');
  }, longPressThreshold);
}

function onTouchMove(_ev: TouchEvent) {
  // 若位移过大则取消长按
  // 这里简单取消，以免误触
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value);
  }
}

function onTouchEnd(_ev: TouchEvent) {
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value);
  }
}

// ---- 节点菜单操作 ----
function editNodeText() {
  const node = currentNode.value;
  if (!node) return;

  const currentSex = (node.data as Record<string, unknown>)?.['sexType'] as string || 'other';

  $q.dialog({
    title: '编辑节点',
    message: '请编辑节点信息：',
    html: true,
    prompt: {
      model: String(node.text ?? ''),
      type: 'text',
      label: '节点名称'
    },
    options: {
      type: 'radio',
      model: currentSex,
      items: [
        { label: '男性', value: 'male' },
        { label: '女性', value: 'female' },
        { label: '无', value: 'none' },
        { label: '其他', value: 'other' },
        { label: '自定义...', value: 'custom' }
      ]
    },
    cancel: true,
    persistent: true,
  }).onOk((result: { prompt: string, options: string }) => {
    const newText = result.prompt;
    const selectedSex = result.options;

    if (selectedSex === 'custom') {
      // 显示自定义性别输入对话框
      $q.dialog({
        title: '自定义性别',
        message: '请输入自定义性别：',
        prompt: {
          model: '',
          type: 'text',
          placeholder: '例如：跨性别者'
        },
        cancel: true,
        persistent: true,
      }).onOk((customSex: string) => {
        if (customSex && customSex.trim()) {
          updateNodeInfo(newText, customSex.trim());
        } else {
          updateNodeInfo(newText, selectedSex);
        }
      });
    } else {
      updateNodeInfo(newText, selectedSex);
    }
  });

  function updateNodeInfo(newText: string, newSex: string) {
    if (!node) return;

    const graphInstance = graphRef.value?.getInstance();
    if (!graphInstance) return;

    // 更新节点文本和性别
    node.text = newText;
    if (!node.data) {
      node.data = {};
    }
    (node.data as Record<string, unknown>)['sexType'] = newSex;

    try {
      void updateJsonTextFromGraph();
      updateNodesList(); // 更新节点列表
      $q.notify({
        type: 'positive',
        message: `节点信息已更新：${newText}（${newSex}）`,
        position: 'top',
      });
    } catch (err) {
      console.warn('图刷新失败，但信息已更新到对象上。', err);
    }
  }
}

function deleteCurrentNode() {
  const node = currentNode.value;
  if (!node) return;

  const graphInstance = graphRef.value?.getInstance();
  if (!graphInstance) return;

  try {
    graphInstance.removeNodeById(node.id);
    void updateJsonTextFromGraph();
    updateNodesList(); // 更新节点列表
    // 从隐藏列表中移除已删除的节点
    hiddenNodeIds.value.delete(node.id);
    $q.notify({
      type: 'positive',
      message: `已删除节点: ${node.text || node.id}`,
      position: 'top',
    });
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: '删除节点失败: ' + String(err),
      position: 'top',
    });
  }
}

// ---- 画布菜单操作 ----
function addNewNode() {
  const graphInstance = graphRef.value?.getInstance();
  if (!graphInstance) return;

  // 获取当前所有节点，生成下一个数字ID
  const currentData = graphInstance.getGraphJsonData();
  const existingIds = currentData.nodes.map(node => parseInt(node.id)).filter(id => !isNaN(id));
  const nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;

  const newNode = {
    id: nextId.toString(),
    text: '新节点',
    x: contextMenuPosition.value.x - 300, // 相对于画布的位置
    y: contextMenuPosition.value.y - 100,
    data: {
      sexType: 'other', // 默认性别为其他
      isGoodMan: 'other',  // 默认为其他角色
      roleUuid: undefined // 新创建的节点暂时没有关联角色
    }
  };

  try {
    graphInstance.addNodes([newNode]);
    void updateJsonTextFromGraph();
    updateNodesList(); // 更新节点列表
    $q.notify({
      type: 'positive',
      message: '已添加新节点',
      position: 'top',
    });
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: '添加节点失败: ' + String(err),
      position: 'top',
    });
  }
}

function centerGraph() {
  const graphInstance = graphRef.value?.getInstance();
  if (!graphInstance) return;

  try {
    graphInstance.moveToCenter?.();
    $q.notify({
      type: 'positive',
      message: '已居中显示',
      position: 'top',
    });
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: '居中显示失败: ' + String(err),
      position: 'top',
    });
  }
}

function fitToScreen() {
  const graphInstance = graphRef.value?.getInstance();
  if (!graphInstance) return;

  try {
    graphInstance.zoomToFit?.();
    $q.notify({
      type: 'positive',
      message: '已适应屏幕',
      position: 'top',
    });
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: '适应屏幕失败: ' + String(err),
      position: 'top',
    });
  }
}

// ---- 菜单操作 ----
function isDashed(line: RGLine | null) {
  if (!line) return false;
  return !!(line.dashType && line.dashType !== 0);
}

async function toggleDashed() {
  const line = currentLine.value;
  if (!line) return;
  line.dashType = isDashed(line) ? 0 : 1; // 0/undefined 实线；1 虚线
  await applyLineChange();
}

async function toggleStartArrow() {
  const line = currentLine.value;
  if (!line) return;
  line.isHideArrow = false;
  line.showStartArrow = !line.showStartArrow;
  await applyLineChange();
}

async function toggleEndArrow() {
  const line = currentLine.value;
  if (!line) return;
  line.isHideArrow = false;
  line.showEndArrow = !line.showEndArrow;
  await applyLineChange();
}

async function toggleHideAllArrows() {
  const line = currentLine.value;
  if (!line) return;
  line.isHideArrow = !line.isHideArrow;
  if (line.isHideArrow) {
    line.showStartArrow = false;
    line.showEndArrow = false;
  }
  await applyLineChange();
}

async function setLineWidth(width: number) {
  const line = currentLine.value;
  if (!line) return;
  line.lineWidth = width;
  await applyLineChange();
}

function deleteCurrentLink() {
  const link = currentLink.value;
  if (!link) return;

  const graphInstance = graphRef.value?.getInstance();
  if (!graphInstance) return;

  try {
    // 使用 seeks_id 删除连线，如果没有则使用 fromNode 和 toNode 的 seeks_id
    const linkId = link.seeks_id || `${link.fromNode?.seeks_id}-${link.toNode?.seeks_id}`;
    graphInstance.removeLinkById(linkId);
    void updateJsonTextFromGraph();
    $q.notify({
      type: 'positive',
      message: '已删除连线',
      position: 'top'
    });
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: '删除连线失败: ' + String(err),
      position: 'top'
    });
  }
}

async function applyLineChange() {
  try {
    await updateJsonTextFromGraph();
  } catch (e) {
    console.warn('更新JSON失败', e);
  }
}

// 更新右侧JSON文本（从图实例读取）
async function updateJsonTextFromGraph() {
  const graphInstance = graphRef.value?.getInstance();
  if (!graphInstance) return;
  try {
    const data = graphInstance.getGraphJsonData();
    jsonText.value = JSON.stringify(data, null, 2);
    // 触发自动保存
    scheduleSave();
    // 保证函数包含 await，以符合 async 定义并消除编译/lint 警告（该 await 无副作用，仅做微任务调度）
    await Promise.resolve();
  } catch (err) {
    $q.notify({ type: 'negative', message: '获取图数据失败：' + String(err) });
  }
}

// 应用JSON（替换整图数据）
async function applyJsonReplace() {
  const graphInstance = graphRef.value?.getInstance();
  if (!graphInstance) return;
  try {
    const parsed = JSON.parse(jsonText.value) as RGJsonData;
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.lines)) {
      throw new Error('JSON结构无效，需要包含nodes[]与lines[]');
    }
    // 手动添加节点和连线，避免自动布局
    graphInstance.addNodes(parsed.nodes);
    graphInstance.addLines(parsed.lines);
    // rootNode 属性可能不存在于当前版本的 relation-graph-vue3 中
    // if (parsed.rootId) {
    //   graphInstance.rootNode = graphInstance.getNodeById(parsed.rootId);
    // }
    // 不调用 doLayout()，直接缩放适应
    graphInstance.zoomToFit?.();
    await updateJsonTextFromGraph();
    updateNodesList(); // 更新节点列表
    $q.notify({ type: 'positive', message: '已应用JSON（替换）' });
  } catch (err) {
    $q.notify({ type: 'negative', message: '应用失败：' + String(err) });
  }
}

// 追加JSON（仅新增nodes/lines，保留现有）
async function applyJsonAppend() {
  const graphInstance = graphRef.value?.getInstance();
  if (!graphInstance) return;
  try {
    const parsed = JSON.parse(jsonText.value) as RGJsonData;
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.lines)) {
      throw new Error('JSON结构无效，需要包含nodes[]与lines[]');
    }
    // 过滤已存在的节点与连线，避免重复
    const existingNodeIds = new Set(graphInstance.getNodes().map((n: RGNode) => n.id));

    const nodesToAdd = parsed.nodes.filter(
      (n) =>
        n && (n as { id?: string }).id && !existingNodeIds.has((n as { id: string }).id as string),
    );

    // 为新添加的节点设置默认过滤属性
    nodesToAdd.forEach((node: any) => {
      if (!node.data) {
        node.data = {};
      }
      if (!node.data.sexType) {
        node.data.sexType = 'other'; // 默认性别为其他
      }
      if (node.data.isGoodMan === undefined) {
        node.data.isGoodMan = 'other'; // 默认为其他角色
      }
    });

    const existingLines = graphInstance.getLines();
    type LineLike = { from: string; to: string; text?: string };
    const lineKey = (l: LineLike) => `${l.from}__${l.to}__${l.text ?? ''}`;
    const existingLineKeys = new Set(existingLines.map((l) => lineKey(l)));
    const linesToAdd = parsed.lines.filter(
      (l) =>
        l &&
        (l as LineLike).from &&
        (l as LineLike).to &&
        !existingLineKeys.has(lineKey(l as LineLike)),
    );

    // 为新添加的连线设置默认类型属性
    linesToAdd.forEach((line: any) => {
      if (!line.data) {
        line.data = {};
      }
      if (!line.data.type) {
        line.data.type = '其他关系'; // 默认关系类型为其他关系
      }
      // 确保连线的显示文本与关系类型一致
      if (!line.text || line.text === '') {
        line.text = line.data.type;
      }
    });

    if (nodesToAdd.length) graphInstance.addNodes(nodesToAdd as unknown as any[]);
    if (linesToAdd.length) graphInstance.addLines(linesToAdd as unknown as any[]);
    // 不调用重布局，仅在必要时才刷新
    // void graphInstance.refresh?.();
    await updateJsonTextFromGraph();
    updateNodesList(); // 更新节点列表
    $q.notify({ type: 'positive', message: '已追加JSON（新增）' });
  } catch (err) {
    $q.notify({ type: 'negative', message: '追加失败：' + String(err) });
  }
}

// ---- 节点过滤相关函数 ----
function updateNodesList() {
  const graphInstance = graphRef.value?.getInstance();
  if (!graphInstance) return;

  try {
    const nodes = graphInstance.getNodes();
    allNodes.value = [...nodes];
    // 收集关系类型，供关系过滤 UI 使用
    try {
      const links = graphInstance.getLinks();
      const types = new Set<string>();
      links.forEach((lk: RGLink) => {
        const rels = lk.relations ?? [];
        rels.forEach((r: RGLine) => {
          const t = (r.data as Record<string, unknown>)?.['type'];
          if (typeof t === 'string' && t) types.add(t);
        });
      });
      allRelType.value = Array.from(types);
      // 如果 relCheckList 还未初始化，则默认选中所有类型
      if (!relCheckList.value || relCheckList.value.length === 0) relCheckList.value = Array.from(types);
    } catch (err) {
      // ignore
    }
  } catch (err) {
    console.warn('获取节点列表失败:', err);
  }
}

// 关系过滤的全选和全不选功能
async function selectAllRelations() {
  relCheckList.value = [...allRelType.value];
  await doFilter();
}

async function deselectAllRelations() {
  relCheckList.value = [];
  await doFilter();
}

async function toggleNodeVisibility(nodeId: string, visible: boolean) {
  if (visible) {
    hiddenNodeIds.value.delete(nodeId);
  } else {
    hiddenNodeIds.value.add(nodeId);
  }
  await doFilter();
}

async function showAllNodes() {
  hiddenNodeIds.value.clear();
  await doFilter();
}

async function hideAllNodes() {
  allNodes.value.forEach(node => {
    hiddenNodeIds.value.add(node.id);
  });
  await doFilter();
}

async function applyNodeFilter() {
  // 保留 applyNodeFilter 作为兼容入口，实际委托给 doFilter
  await doFilter();
}

// 来自示例的过滤逻辑：按节点属性设置 opacity，并按关系类型隐藏连线
async function doFilter() {
  const graphInstance = graphRef.value?.getInstance();
  if (!graphInstance) return;

  try {
    const _all_nodes = graphInstance.getNodes();
    const _all_links = graphInstance.getLinks();

    _all_nodes.forEach((thisNode: RGNode) => {
      let _isDim = false;
      const data = thisNode.data as Record<string, unknown> | undefined;

      if (checkedSex.value !== '') {
        const sex = (data?.['sexType'] as string) ?? '';
        // 处理'无'选项：当选择'无'时，匹配空字符串、undefined或'none'
        if (checkedSex.value === 'none') {
          if (sex !== '' && sex !== 'none' && sex !== undefined) _isDim = true;
        } else {
          if (sex !== checkedSex.value) _isDim = true;
        }
      }

      if (checkedIsGoodman.value !== '') {
        const isGoodValue = data?.['isGoodMan'];
        let isGood: string;

        if (isGoodValue === true || isGoodValue === 'true') {
          isGood = 'true';
        } else if (isGoodValue === false || isGoodValue === 'false') {
          isGood = 'false';
        } else {
          isGood = 'other';
        }

        if (isGood !== checkedIsGoodman.value) _isDim = true;
      }

      // respect manual hide via checkbox
      if (hiddenNodeIds.value.has(thisNode.id)) _isDim = true;

      // 将可视化效果设置为半透明以示被过滤
      (thisNode as unknown as RGNode).opacity = _isDim ? 0.15 : 1;
    });

    _all_links.forEach((thisLink: RGLink) => {
      const rels = thisLink.relations ?? [];
      rels.forEach((thisLine: RGLine) => {
        const t = (thisLine.data as Record<string, unknown>)?.['type'] as string | undefined;
        const allowed = !t || relCheckList.value.indexOf(t) !== -1;
        // 如果任一端节点被手动隐藏，也隐藏该连线的子项
        const fromHidden = hiddenNodeIds.value.has(thisLine.from);
        const toHidden = hiddenNodeIds.value.has(thisLine.to);
        const shouldHide = !allowed || fromHidden || toHidden;
        thisLine.isHide = shouldHide;
      });
      // 如果 link 下所有 relations 都被隐藏，则隐藏 link 本身
      try {
        const allHidden = (thisLink.relations ?? []).every((r: RGLine) => !!r.isHide);
        (thisLink as any).isHide = allHidden;
      } catch {
        // ignore
      }
    });

    // 更新图形（优先使用轻量更新 dataUpdated，如果没有再用 refresh）
    graphInstance.dataUpdated?.();
    await Promise.resolve();
  } catch (err) {
    console.warn('doFilter 失败', err);
  }
}

// 调整关系类型功能
function changeRelationType() {
  const line = currentLine.value;
  if (!line) return;

  const currentType = (line.data as Record<string, unknown>)?.['type'] as string || '其他关系';

  $q.dialog({
    title: '调整关系类型',
    message: '请选择关系类型或输入自定义类型：',
    options: {
      type: 'radio',
      model: currentType,
      items: [
        { label: '恋人关系', value: '恋人关系' },
        { label: '朋友关系', value: '朋友关系' },
        { label: '敌对关系', value: '敌对关系' },
        { label: '师徒关系', value: '师徒关系' },
        { label: '亲属关系', value: '亲属关系' },
        { label: '同事关系', value: '同事关系' },
        { label: '其他关系', value: '其他关系' },
        { label: '自定义...', value: 'custom' }
      ]
    },
    cancel: true,
    persistent: true,
  }).onOk((selectedType: string) => {
    if (selectedType === 'custom') {
      // 显示自定义输入对话框
      $q.dialog({
        title: '自定义关系类型',
        message: '请输入自定义关系类型：',
        prompt: {
          model: '',
          type: 'text',
          placeholder: '例如：师兄弟关系'
        },
        cancel: true,
        persistent: true,
      }).onOk((customType: string) => {
        if (customType && customType.trim()) {
          updateRelationType(customType.trim());
        }
      });
    } else {
      updateRelationType(selectedType);
    }
  });

  function updateRelationType(newType: string) {
    if (!line) return;

    if (!line.data) {
      line.data = {};
    }
    (line.data as Record<string, unknown>)['type'] = newType;

    // 设置连线显示文本为"字面值\n（关系类型）"格式
    // 如果已有字面值，保持字面值；否则使用关系类型作为字面值
    const currentText = line.text || newType;
    const literalValue = currentText.includes('\n') ? currentText.split('\n')[0] : currentText;
    line.text = `${literalValue}\n（${newType}）`;

    try {
      void updateJsonTextFromGraph();
      updateNodesList(); // 更新关系类型列表
      // 关系类型修改后自动保存
      scheduleSave();
      $q.notify({
        type: 'positive',
        message: `关系类型已更新为: ${newType}`,
        position: 'top',
      });
    } catch (err) {
      console.warn('图刷新失败，但关系类型已更新。', err);
    }
  }
}

// 组件卸载时清理定时器和事件监听器
onUnmounted(() => {
  if (draggingUpdateTimer.value) {
    clearTimeout(draggingUpdateTimer.value);
  }
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value);
  }
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  
  // 移除VSCode消息监听器
  if (vscodeApi.value?.removeEventListener) {
    vscodeApi.value.removeEventListener('message', handleVSCodeMessage);
  }
});


</script>

<style lang="scss" scoped>
.relation-graph-container {
  width: 100%;
  height: 100vh;
  overflow: hidden;
}

.graph-and-json {
  display: flex;
  height: 100%;
}

.graph-pane {
  flex: 1 1 auto;
  min-width: 0;
  position: relative;
}

.json-toggle-btn {
  position: absolute;
  z-index: 40;
  top: 10px;
  right: 10px;
}

/* 过滤面板开关按钮（固定在左上角） */
.filter-toggle-btn {
  position: absolute;
  z-index: 9999;
  bottom: 12px;
  left: 12px;
}

/* 过滤面板样式 */
.filter-pane {
  /* 作为左侧固定面板占据空间（与 JSON 面板对称） */
  flex: 0 0 320px;
  width: 320px;
  padding: 16px;
  border-right: 1px solid #efefef;
  background: #fafafa;
  box-sizing: border-box;
  overflow: hidden;
  position: relative;
}

.body--dark .filter-pane {
  background: #1f1f1f;
  border-color: #333;
}

.filter-pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.filter-content {
  height: calc(100vh - 120px);
  overflow: auto;
}

.node-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.node-item {
  display: flex;
  align-items: center;
}

.node-hidden {
  opacity: 0.5;
}

.filter-actions {
  margin-top: 8px;
  display: flex;
  gap: 8px;
}

/* keep toggle button above everything (handled above) */

.json-pane {
  /* 固定侧栏宽度，作为 flex 子项以固定主轴尺寸 */
  flex: 0 0 420px;
  width: 420px;
  padding: 10px;
  border-left: 1px solid #efefef;
  background: #fafafa;
  overflow: hidden; // 动画期间避免内容外溢
}

.body--dark .json-pane {
  background: #1f1f1f;
  border-color: #333;
}.json-pane-header {
  font-size: 13px;
  color: #666;
  margin-bottom: 8px;
}

.json-input {
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
  max-height: calc(100vh - 120px);
  overflow: auto;
}

.json-actions {
  margin-top: 8px;
}

:deep(.relation-graph) {
  .my-node-template {
    transform: translateX(-60px) translateY(-60px) !important;
    cursor: default;
  }
}

.c-node-menu-item {
  line-height: 30px;
  padding-left: 10px;
  cursor: pointer;
  color: #444444;
  font-size: 14px;
  border-top: #efefef solid 1px;
}

.c-node-menu-item:hover {
  background-color: rgba(66, 187, 66, 0.2);
}
/* 左侧过滤面板的进入/离开动画 */
.filter-slide-enter-active,
.filter-slide-leave-active {
  transition:
    flex-basis 250ms ease,
    width 250ms ease,
    padding 250ms ease,
    opacity 200ms ease;
}

.filter-slide-enter-from,
.filter-slide-leave-to {
  flex-basis: 0;
  width: 0;
  padding: 0;
  opacity: 0;
}

.filter-slide-enter-to,
.filter-slide-leave-from {
  flex-basis: 320px;
  width: 320px;
  padding: 16px;
  opacity: 1;
}

/* 右侧 JSON 面板的进入/离开动画 */
.json-slide-enter-active,
.json-slide-leave-active {
  transition:
    flex-basis 220ms ease,
    width 220ms ease,
    padding 220ms ease,
    opacity 180ms ease;
}

.json-slide-enter-from,
.json-slide-leave-to {
  flex-basis: 0;
  width: 0;
  padding: 0;
  opacity: 0;
}

.json-slide-enter-to,
.json-slide-leave-from {
  flex-basis: 420px;
  width: 420px;
  padding: 10px;
  opacity: 1;
}
</style>



