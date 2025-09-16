<template>
  <div class="relation-graph-container">
    <div class="graph-and-json">
      <div class="graph-pane">
        <div style="height: calc(100vh)">
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
          <q-menu ref="linkMenuRef" :separate-close-popup="false">
            <q-list dense style="min-width: 200px">
              <q-item clickable v-close-popup @click="toggleDashed">
                <q-item-section avatar>
                  <q-icon :name="isDashed(currentLine) ? 'check_box' : 'check_box_outline_blank'" />
                </q-item-section>
                <q-item-section>{{ isDashed(currentLine) ? '切换为实线' : '切换为虚线' }}</q-item-section>
              </q-item>

              <q-item clickable v-close-popup @click="toggleStartArrow">
                <q-item-section avatar>
                  <q-icon :name="currentLine?.showStartArrow && !currentLine?.isHideArrow ? 'check_box' : 'check_box_outline_blank'" />
                </q-item-section>
                <q-item-section>起点箭头</q-item-section>
              </q-item>

              <q-item clickable v-close-popup @click="toggleEndArrow">
                <q-item-section avatar>
                  <q-icon :name="currentLine?.showEndArrow && !currentLine?.isHideArrow ? 'check_box' : 'check_box_outline_blank'" />
                </q-item-section>
                <q-item-section>终点箭头</q-item-section>
              </q-item>

              <q-item clickable v-close-popup @click="toggleHideAllArrows">
                <q-item-section avatar>
                  <q-icon :name="currentLine?.isHideArrow ? 'check_box' : 'check_box_outline_blank'" />
                </q-item-section>
                <q-item-section>隐藏全部箭头</q-item-section>
              </q-item>

              <q-separator />

              <q-item clickable v-close-popup @click="setLineWidth(1)">
                <q-item-section avatar>
                  <q-icon :name="currentLine?.lineWidth === 1 ? 'radio_button_checked' : 'radio_button_unchecked'" />
                </q-item-section>
                <q-item-section>线宽 1</q-item-section>
              </q-item>
              <q-item clickable v-close-popup @click="setLineWidth(2)">
                <q-item-section avatar>
                  <q-icon :name="currentLine?.lineWidth === 2 ? 'radio_button_checked' : 'radio_button_unchecked'" />
                </q-item-section>
                <q-item-section>线宽 2</q-item-section>
              </q-item>
              <q-item clickable v-close-popup @click="setLineWidth(3)">
                <q-item-section avatar>
                  <q-icon :name="currentLine?.lineWidth === 3 ? 'radio_button_checked' : 'radio_button_unchecked'" />
                </q-item-section>
                <q-item-section>线宽 3</q-item-section>
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
            <q-btn color="secondary" dense label="追加(新增)" @click="applyJsonAppend" class="q-ml-sm" />
            <q-btn color="grey" dense label="刷新JSON" @click="updateJsonTextFromGraph" class="q-ml-sm" />
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import RelationGraph, {
  type RGJsonData,
  type RGOptions,
  type RelationGraphComponent
} from 'relation-graph-vue3';
import RelationGraphToolBar from '../components/RelationGraphToolBar.vue';
import { useQuasar } from 'quasar';

const $q = useQuasar();

const graphOptions: RGOptions = {
  debug: true,
  allowSwitchLineShape: true,
  allowSwitchJunctionPoint: true,
  allowShowDownloadButton: true,
  defaultJunctionPoint: 'border',
  // 禁用自动布局，优先保留JSON中的x、y位置
  allowAutoLayoutIfSupport: false
};

const graphRef = ref<RelationGraphComponent>();

// JSON面板显示/隐藏
const showJsonPane = ref(true);

// 实时JSON字符串
const jsonText = ref('');

// 右键菜单状态
const linkMenuRef = ref<any>();
const currentLink = ref<any | null>(null);
const currentLine = ref<any | null>(null);

onMounted(() => {
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
      { id: 'e', text: '配角2', nodeShape: 0, width: 150, height: 150, x: -200, y: -80 }
    ],
    lines: [
      { from: 'a', to: 'b', text: '恋人关系', color: '#43a2f1' },
      { from: 'a', to: 'c', text: '敌对关系' },
      { from: 'a', to: 'd', text: '朋友关系' },
      { from: 'a', to: 'e', text: '师徒关系' },
      { from: 'b', to: 'e', text: '闺蜜关系', color: '#67C23A' }
    ]
  };

  const graphInstance = graphRef.value?.getInstance();
  if (graphInstance) {
    // setJsonData 与 moveToCenter 非 Promise；zoomToFit 返回 Promise
    graphInstance.setJsonData(__graph_json_data, false);
    graphInstance.moveToCenter?.();
    await graphInstance.zoomToFit?.();
    await updateJsonTextFromGraph();
  }
};

// 拖拽中节流更新：避免频繁JSON重算导致卡顿
let draggingUpdateTimer: number | undefined;
function scheduleUpdateFromGraph() {
  if (draggingUpdateTimer) return;
  draggingUpdateTimer = window.setTimeout(async () => {
    draggingUpdateTimer = undefined;
    await updateJsonTextFromGraph();
  }, 120);
}

function onNodeDragStart(_node?: any, _e?: any) {
  // 拖拽开始可选择做记录，这里暂不处理
}

// 拖拽中：轻量实时同步（节流），不触发大刷新
function onNodeDragging(_node?: any, _newX?: number, _newY?: number, _e?: any) {
  scheduleUpdateFromGraph();
}

// 拖拽结束后：再做一次最终同步
function onNodeDragEnd(_node?: any, _e?: any) {
  void updateJsonTextFromGraph();
}

// ---- 处理连线双击以编辑文本 ----
const lastLineClickId = ref<string>('');
const lastLineClickAt = ref<number>(0);

function onLineClick(line: any, _link: any, _e: any) {
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
        type: 'text'
      },
      cancel: true,
      persistent: true
    }).onOk((newText: string) => {
      const graphInstance = graphRef.value?.getInstance();
      if (!graphInstance) return;
      // 直接修改行对象文本并刷新
      line.text = newText;
      try {
        // 避免大刷新，这里仅最小化刷新或依赖内部响应
        // void graphInstance.refresh();
        void updateJsonTextFromGraph();
      } catch (err) {
        console.warn('图刷新失败，但文本已更新到对象上。', err);
      }
    });
  }
}

// ---- 右键菜单回调（仅在连线上触发） ----
function onContextmenu(e: MouseEvent | TouchEvent, objectType: 'canvas' | 'node' | 'link', object: any) {
  if (objectType !== 'link' || !object) return;
  currentLink.value = object;
  currentLine.value = Array.isArray(object?.relations) ? object.relations[0] : null;
  // 展示菜单到鼠标位置
  // @ts-ignore
  linkMenuRef.value?.show?.(e);
}

// ---- 菜单操作 ----
function isDashed(line: any | null) {
  if (!line) return false;
  return !!(line.dashType && line.dashType !== 0);
}

function toggleDashed() {
  const line = currentLine.value;
  if (!line) return;
  line.dashType = isDashed(line) ? 0 : 1; // 0/undefined 实线；1 虚线
  applyLineChange();
}

function toggleStartArrow() {
  const line = currentLine.value;
  if (!line) return;
  line.isHideArrow = false;
  line.showStartArrow = !line.showStartArrow;
  applyLineChange();
}

function toggleEndArrow() {
  const line = currentLine.value;
  if (!line) return;
  line.isHideArrow = false;
  line.showEndArrow = !line.showEndArrow;
  applyLineChange();
}

function toggleHideAllArrows() {
  const line = currentLine.value;
  if (!line) return;
  line.isHideArrow = !line.isHideArrow;
  if (line.isHideArrow) {
    line.showStartArrow = false;
    line.showEndArrow = false;
  }
  applyLineChange();
}

function setLineWidth(width: number) {
  const line = currentLine.value;
  if (!line) return;
  line.lineWidth = width;
  applyLineChange();
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
    graphInstance.setJsonData(parsed, false);
    await graphInstance.zoomToFit?.();
    await updateJsonTextFromGraph();
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
    const existingNodeIds = new Set(graphInstance.getNodes().map((n: any) => n.id));
    const nodesToAdd = parsed.nodes.filter((n) => n && n.id && !existingNodeIds.has(n.id));

    const existingLines = graphInstance.getLines();
    const lineKey = (l: any) => `${l.from}__${l.to}__${l.text ?? ''}`;
    const existingLineKeys = new Set(existingLines.map((l: any) => lineKey(l)));
    const linesToAdd = parsed.lines.filter((l) => l && l.from && l.to && !existingLineKeys.has(lineKey(l)));

    if (nodesToAdd.length) graphInstance.addNodes(nodesToAdd);
    if (linesToAdd.length) graphInstance.addLines(linesToAdd);
    // 不调用重布局，仅在必要时才刷新
    // void graphInstance.refresh?.();
    await updateJsonTextFromGraph();
    $q.notify({ type: 'positive', message: '已追加JSON（新增）' });
  } catch (err) {
    $q.notify({ type: 'negative', message: '追加失败：' + String(err) });
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
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
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
/* 右侧 JSON 面板的进入/离开动画 */
.json-slide-enter-active,
.json-slide-leave-active {
  transition: flex-basis 220ms ease, width 220ms ease, padding 220ms ease, opacity 180ms ease;
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
