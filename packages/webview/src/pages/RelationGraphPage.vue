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
import { onMounted, ref, nextTick, computed } from 'vue';
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

onMounted(() => {
  // 禁用画布区域的默认右键菜单
  // const wrapper = graphWrapperRef.value;
  // if (wrapper) {
  //   wrapper.addEventListener('contextmenu', (e) => {
  //     e.preventDefault();
  //     return false;
  //   });
  // }
  void showGraph();
});

const showGraph = async () => {
  const __graph_json_data: RGJsonData = {
    rootId: 'a',
    nodes: [
      { id: 'a', text: '主角', borderColor: 'yellow', x: 0, y: 0 },
      { id: 'b', text: '女主', color: '#43a2f1', fontColor: 'yellow', x: 120, y: -40 },
      { id: 'c', text: '反派', nodeShape: 1, width: 80, height: 60, x: -100, y: 100 },
      { id: 'd', text: '配角1', nodeShape: 0, width: 100, height: 100, x: 220, y: 120 },
      { id: 'e', text: '配角2', nodeShape: 0, width: 150, height: 150, x: -200, y: -80 },
    ],
    lines: [
      { from: 'a', to: 'b', text: '恋人关系', color: '#43a2f1' },
      { from: 'a', to: 'c', text: '敌对关系' },
      { from: 'a', to: 'd', text: '朋友关系' },
      { from: 'a', to: 'e', text: '师徒关系' },
      { from: 'b', to: 'e', text: '闺蜜关系', color: '#67C23A' },
    ],
  };

  const graphInstance = graphRef.value?.getInstance();
  if (graphInstance) {
    // setJsonData 与 moveToCenter 非 Promise；zoomToFit 返回 Promise
    await graphInstance.setJsonData(__graph_json_data, false);
    graphInstance.moveToCenter?.();
    graphInstance.zoomToFit?.();
    await updateJsonTextFromGraph();
    // 更新节点列表用于过滤面板
    updateNodesList();
  }
};

// 拖拽中节流更新：避免频繁JSON重算导致卡顿
let draggingUpdateTimer: number | undefined;
function scheduleUpdateFromGraph() {
  if (draggingUpdateTimer) return;
  draggingUpdateTimer = window.setTimeout(() => {
    draggingUpdateTimer = undefined;
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

    $q.dialog({
      title: '编辑连线标记',
      prompt: {
        model: String(line?.text ?? ''),
        type: 'text',
      },
      cancel: true,
      persistent: true,
    }).onOk((newText: string) => {
      const graphInstance = graphRef.value?.getInstance();
      if (!graphInstance) return;

      // 直接修改行对象文本并刷新
      line.text = newText;
      try {
        void updateJsonTextFromGraph();
        $q.notify({
          type: 'positive',
          message: '连线标记已更新',
          position: 'top',
        });
      } catch (err) {
        console.warn('图刷新失败，但文本已更新到对象上。', err);
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
  if (typeof window !== 'undefined' && typeof window.MouseEvent === 'function') {
    return new window.MouseEvent('contextmenu', {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
      view: window,
    });
  }

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
    // 不需要操控 v-model；交给 Quasar 自己管理开合
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
  canvasMenuRef.value?.show(eventForMenu); // ✅ 用事件坐标定位
}


// ---- 长按触发（移动端/触屏）：默认打开画布菜单 ----
const longPressThreshold = 550; // ms
let longPressTimer: any = null;

function onTouchStart(ev: TouchEvent) {
  const pt = getClientPointFromEvent(ev);
  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    const syntheticEvt = buildSyntheticContextEvent(pt.x, pt.y);
    // cast to MouseEvent to satisfy the expected parameter type and call without awaiting
    void openContextMenu(syntheticEvt as unknown as MouseEvent, 'canvas');
  }, longPressThreshold);
}

function onTouchMove(_ev: TouchEvent) {
  // 若位移过大则取消长按
  // 这里简单取消，以免误触
  clearTimeout(longPressTimer);
}

function onTouchEnd(_ev: TouchEvent) {
  clearTimeout(longPressTimer);
}

// ---- 节点菜单操作 ----
function editNodeText() {
  const node = currentNode.value;
  if (!node) return;

  $q.dialog({
    title: '编辑节点文本',
    prompt: {
      model: String(node.text ?? ''),
      type: 'text',
    },
    cancel: true,
    persistent: true,
  }).onOk((newText: string) => {
    const graphInstance = graphRef.value?.getInstance();
    if (!graphInstance) return;

    // 直接修改节点文本并刷新
    node.text = newText;
    try {
      void updateJsonTextFromGraph();
      $q.notify({
        type: 'positive',
        message: '节点文本已更新',
        position: 'top',
      });
    } catch (err) {
      console.warn('图刷新失败，但文本已更新到对象上。', err);
    }
  });
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

  const newNodeId = 'node_' + Date.now();
  const newNode = {
    id: newNodeId,
    text: '新节点',
    x: contextMenuPosition.value.x - 300, // 相对于画布的位置
    y: contextMenuPosition.value.y - 100,
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
    graphInstance.removeLinkById(link.seeks_id || `${link.from}-${link.to}`);
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
    await graphInstance.setJsonData(parsed, false);
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
  } catch (err) {
    console.warn('获取节点列表失败:', err);
  }
}

async function toggleNodeVisibility(nodeId: string, visible: boolean) {
  if (visible) {
    hiddenNodeIds.value.delete(nodeId);
  } else {
    hiddenNodeIds.value.add(nodeId);
  }
  await applyNodeFilter();
}

async function showAllNodes() {
  hiddenNodeIds.value.clear();
  await applyNodeFilter();
}

async function hideAllNodes() {
  allNodes.value.forEach(node => {
    hiddenNodeIds.value.add(node.id);
  });
  await applyNodeFilter();
}

async function applyNodeFilter() {
  const graphInstance = graphRef.value?.getInstance();
  if (!graphInstance) return;

  try {
    // 获取所有节点和连线
    const allGraphNodes = graphInstance.getNodes();
    const allGraphLines = graphInstance.getLines();

    // 设置节点的显示/隐藏状态
    allGraphNodes.forEach(node => {
      const shouldHide = hiddenNodeIds.value.has(node.id);
      // 使用 relation-graph 的内置属性来控制节点显示
      (node as any).isHide = shouldHide;
    });

    // 隐藏与隐藏节点相关的连线
    allGraphLines.forEach(line => {
      const fromHidden = hiddenNodeIds.value.has(line.from);
      const toHidden = hiddenNodeIds.value.has(line.to);
      // 如果连线的任一端点被隐藏，则隐藏该连线
      (line as any).isHide = fromHidden || toHidden;
    });

    // 刷新图形显示
    await graphInstance.refresh?.();

    $q.notify({
      type: 'positive',
      message: `已更新节点显示状态`,
      position: 'top',
    });
  } catch (err) {
    console.warn('应用节点过滤失败:', err);
    $q.notify({
      type: 'negative',
      message: '应用过滤失败: ' + String(err),
      position: 'top',
    });
  }
}
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
}
.json-pane-header {
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
