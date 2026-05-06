<template>
  <div class="role-graph-page">
    <aside class="graph-sidebar">
      <header class="sidebar-header">
        <div>
          <div class="sidebar-title">角色关系图谱</div>
          <div class="sidebar-subtitle">{{ graphData.nodes.length }} 个角色 / {{ filteredEdges.length }} 条关系</div>
        </div>
        <q-btn dense round flat icon="refresh" @click="requestGraphData">
          <q-tooltip>刷新图谱</q-tooltip>
        </q-btn>
      </header>

      <q-input
        v-model="searchText"
        dense
        outlined
        clearable
        placeholder="搜索角色、类型、关系"
        class="filter-control"
      />

      <section class="filter-section">
        <div class="section-title">关系来源</div>
        <q-option-group
          v-model="enabledSources"
          :options="sourceOptions"
          type="checkbox"
          dense
          @update:model-value="rebuildGraph"
        />
      </section>

      <section class="filter-section">
        <div class="section-title">显示</div>
        <q-toggle v-model="showIsolatedNodes" dense label="显示孤立角色" @update:model-value="rebuildGraph" />
        <q-toggle
          v-model="hoverFocusEnabled"
          dense
          label="悬停高亮邻居"
          @update:model-value="refreshGraphDisplay"
        />
        <q-toggle
          v-model="hideUnfocusedWhenSelected"
          dense
          label="选中角色后只显示一跳网络"
          @update:model-value="refreshGraphDisplay"
        />
        <q-toggle
          v-model="hoverTooltipEnabled"
          dense
          label="角色悬浮卡片"
          @update:model-value="handleHoverTooltipToggle"
        />
        <q-toggle v-model="hoverTooltipFollowMouse" dense label="悬浮卡片跟随鼠标" />
        <q-select
          v-model="hoverTooltipScrollModifier"
          :options="hoverTooltipScrollModifierOptions"
          dense
          outlined
          emit-value
          map-options
          class="filter-control compact inline-select"
        >
          <template #prepend>
            <span class="field-prefix-label">滚动捕获</span>
          </template>
        </q-select>
      </section>

      <section class="filter-section">
        <div class="section-title">连线显示</div>
        <q-select
          v-model="edgeDisplayStrategy"
          :options="edgeDisplayOptions"
          dense
          outlined
          emit-value
          map-options
          class="filter-control compact"
          @update:model-value="refreshGraphDisplay"
        />
        <q-toggle v-model="showEdgeLabels" dense label="显示关系标签" @update:model-value="refreshGraphDisplay" />
      </section>

      <section class="filter-section">
        <div class="section-title">布局</div>
        <q-select
          v-model="layoutStrategy"
          :options="layoutOptions"
          dense
          outlined
          emit-value
          map-options
          class="filter-control compact"
          @update:model-value="applyLayoutStrategy(true)"
        />
        <div class="layout-actions">
          <q-btn dense flat :icon="layoutRunning ? 'pause' : 'play_arrow'" @click="toggleLayout">
            <q-tooltip>{{ layoutRunning ? '暂停布局' : '运行当前布局' }}</q-tooltip>
          </q-btn>
          <q-btn dense flat icon="center_focus_strong" @click="fitGraph">
            <q-tooltip>居中图谱</q-tooltip>
          </q-btn>
        </div>
      </section>

      <section v-if="selectedNode" class="detail-section">
        <div class="section-title">角色</div>
        <div class="detail-title">{{ selectedNode.label }}</div>
        <div class="meta-row" v-if="selectedNode.type">类型：{{ selectedNode.type }}</div>
        <div class="meta-row" v-if="selectedNode.affiliation">阵营：{{ selectedNode.affiliation }}</div>
        <div class="meta-row">连接数：{{ selectedNode.degree }}</div>
        <div class="meta-row path" v-if="selectedNode.packagePath">{{ selectedNode.packagePath }}</div>
        <q-btn
          v-if="selectedNode.sourcePath"
          dense
          flat
          icon="open_in_new"
          label="打开角色文件"
          class="open-source-btn"
          @click="openSource(selectedNode.sourcePath)"
        />
        <div v-if="selectedNodeRelations.length" class="node-relation-list">
          <div class="section-title relation-list-title">关联角色</div>
          <div
            v-for="item in selectedNodeRelations"
            :key="item.edge.id"
            class="node-relation-card"
            @click="selectRelation(item.edge)"
          >
            <div class="relation-card-head">
              <span class="relation-target">{{ item.direction }} {{ item.other.label }}</span>
              <span class="relation-type">{{ item.edge.type }}</span>
            </div>
            <div class="meta-row">{{ item.edge.label }}</div>
            <div class="source-chips small">
              <q-chip
                v-for="source in item.edge.sources"
                :key="source"
                dense
                :color="sourceColor(source)"
                text-color="white"
              >
                {{ sourceLabel(source) }}
              </q-chip>
            </div>
            <div class="edge-detail-list compact">
              <div v-for="(detail, index) in item.edge.details" :key="index" class="edge-detail">
                <div>{{ sourceLabel(detail.source) }}：{{ detail.label }}</div>
                <div v-for="row in detailMetadataRows(detail)" :key="row.label" class="meta-row">
                  {{ row.label }}：{{ row.value }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-if="selectedEdge" class="detail-section">
        <div class="section-title">关系</div>
        <div class="detail-title">{{ edgeTitle(selectedEdge) }}</div>
        <div class="meta-row">类型：{{ selectedEdge.type }}</div>
        <div class="meta-row">权重：{{ selectedEdge.weight }}</div>
        <div class="source-chips">
          <q-chip
            v-for="source in selectedEdge.sources"
            :key="source"
            dense
            :color="sourceColor(source)"
            text-color="white"
          >
            {{ sourceLabel(source) }}
          </q-chip>
        </div>
        <div class="edge-detail-list">
          <div v-for="(detail, index) in selectedEdge.details" :key="index" class="edge-detail">
            <div>{{ sourceLabel(detail.source) }}：{{ detail.label }}</div>
            <div v-for="row in detailMetadataRows(detail)" :key="row.label" class="meta-row" :class="{ path: row.path }">
              {{ row.label }}：{{ row.value }}
            </div>
          </div>
        </div>
      </section>

      <section v-if="errorMessage" class="error-section">
        {{ errorMessage }}
      </section>
    </aside>

    <main class="graph-main">
      <div ref="graphContainer" class="sigma-container"></div>
      <div class="graph-hud">
        <span>滚轮缩放</span>
        <span>拖拽平移</span>
        <span v-if="hoverFocusEnabled">悬停高亮邻居</span>
        <span v-if="hoverScrollHint">{{ hoverScrollHint }}</span>
      </div>
      <RoleHoverTooltip
        :visible="hoverTooltipEnabled && hoverTooltipVisible"
        :role="hoverTooltipRole"
        :position="hoverTooltipPosition"
        :relations="hoverTooltipRelations"
        :follow-mouse="hoverTooltipFollowMouse"
        :scroll-modifier="hoverTooltipScrollModifier"
        @tooltip-hover="handleRoleTooltipHover"
      />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { MultiDirectedGraph } from 'graphology';
import Sigma from 'sigma';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';
import type Graph from 'graphology';
import RoleHoverTooltip from '../components/RoleHoverTooltip.vue';
import type {
  RoleRelationshipGraphData,
  RoleRelationshipGraphEdge,
  RoleRelationshipGraphEdgeDetail,
  RoleRelationshipGraphEdgeSource,
  RoleRelationshipGraphNode,
} from '../types/roleRelationshipGraph';
import type { RoleHoverTooltipScrollModifier } from '../components/RoleHoverTooltip.vue';

declare const acquireVsCodeApi: undefined | (() => { postMessage: (message: unknown) => void });

type GraphNodeAttributes = {
  label: string;
  x: number;
  y: number;
  size: number;
  color: string;
  role: RoleRelationshipGraphNode;
  highlighted?: boolean;
  hidden?: boolean;
  zIndex?: number;
};

type GraphEdgeAttributes = {
  label: string;
  size: number;
  color: string;
  edge: RoleRelationshipGraphEdge;
  hidden?: boolean;
};

type LayoutStrategy = 'force' | 'circle' | 'concentric' | 'typeBands' | 'selectedRadial';
type EdgeDisplayStrategy = 'smartFocus' | 'all' | 'highlightOnly' | 'selectedOnly' | 'hideReference';

const HOVER_SCROLL_MODIFIER_STORAGE_KEY = 'anh-role-graph-hover-scroll-modifier';
const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
const graphContainer = ref<HTMLDivElement>();
const graphData = ref<RoleRelationshipGraphData>({ nodes: [], edges: [], stats: { roleCount: 0, edgeCount: 0, referenceEdgeCount: 0, markedEdgeCount: 0, relationshipEdgeCount: 0 } });
const searchText = ref('');
const enabledSources = ref<RoleRelationshipGraphEdgeSource[]>(['relationship', 'marked', 'reference']);
const showIsolatedNodes = ref(true);
const hoverFocusEnabled = ref(true);
const hideUnfocusedWhenSelected = ref(true);
const edgeDisplayStrategy = ref<EdgeDisplayStrategy>('smartFocus');
const showEdgeLabels = ref(false);
const hoverTooltipEnabled = ref(true);
const hoverTooltipFollowMouse = ref(true);
const hoverTooltipScrollModifier = ref<RoleHoverTooltipScrollModifier>(loadHoverScrollModifier());
const hoverTooltipVisible = ref(false);
const hoverTooltipRole = ref<RoleRelationshipGraphNode | null>(null);
const hoverTooltipPosition = ref({ x: 0, y: 0 });
const isHoveringRoleTooltip = ref(false);
const selectedNode = ref<RoleRelationshipGraphNode | null>(null);
const selectedEdge = ref<RoleRelationshipGraphEdge | null>(null);
const hoveredNodeId = ref<string | null>(null);
const errorMessage = ref('');
const layoutRunning = ref(false);
const layoutStrategy = ref<LayoutStrategy>('force');

let sigma: Sigma<GraphNodeAttributes, GraphEdgeAttributes> | null = null;
let graph: Graph<GraphNodeAttributes, GraphEdgeAttributes> | null = null;
let layoutFrame: number | null = null;
let layoutTicks = 0;
let draggedNode: string | null = null;
let isDragging = false;
let themeObserver: MutationObserver | null = null;
let showHoverTooltipTimer: number | null = null;
let hideHoverTooltipTimer: number | null = null;

const sourceOptions = [
  { label: '关系表', value: 'relationship' },
  { label: 'relations 标记', value: 'marked' },
  { label: '角色内引用', value: 'reference' },
];

const layoutOptions: Array<{ label: string; value: LayoutStrategy }> = [
  { label: '力导向', value: 'force' },
  { label: '环形', value: 'circle' },
  { label: '中心层级', value: 'concentric' },
  { label: '按类型分组', value: 'typeBands' },
  { label: '选中角色放射', value: 'selectedRadial' },
];

const edgeDisplayOptions: Array<{ label: string; value: EdgeDisplayStrategy }> = [
  { label: '智能聚焦：选中/悬浮后只显示相关连线', value: 'smartFocus' },
  { label: '全部连线', value: 'all' },
  { label: '只显示高亮连线', value: 'highlightOnly' },
  { label: '只看选中角色连线', value: 'selectedOnly' },
  { label: '隐藏自动引用边', value: 'hideReference' },
];

const hoverTooltipScrollModifierOptions: Array<{ label: string; value: RoleHoverTooltipScrollModifier }> = [
  { label: 'Ctrl + 滚轮', value: 'ctrl' },
  { label: 'Alt + 滚轮', value: 'alt' },
  { label: 'Shift + 滚轮', value: 'shift' },
  { label: 'Command/Win + 滚轮', value: 'meta' },
  { label: '直接用滚轮', value: 'none' },
  { label: '关闭滚轮捕获', value: 'disabled' },
];

const filteredEdges = computed(() => {
  const needle = searchText.value.trim().toLowerCase();
  const sourceSet = new Set(enabledSources.value);
  return graphData.value.edges.filter(edge => {
    if (!edge.sources.some(source => sourceSet.has(source))) {
      return false;
    }
    if (!needle) {
      return true;
    }
    const source = graphData.value.nodes.find(node => node.id === edge.source)?.label || '';
    const target = graphData.value.nodes.find(node => node.id === edge.target)?.label || '';
    return [source, target, edge.label, edge.type].some(value => value.toLowerCase().includes(needle));
  });
});

const filteredNodes = computed(() => {
  const needle = searchText.value.trim().toLowerCase();
  const linkedNodeIds = new Set<string>();
  for (const edge of filteredEdges.value) {
    linkedNodeIds.add(edge.source);
    linkedNodeIds.add(edge.target);
  }

  return graphData.value.nodes.filter(node => {
    const matchesSearch = !needle || [node.label, node.type || '', node.affiliation || '', node.packagePath || '']
      .some(value => value.toLowerCase().includes(needle));
    const linked = linkedNodeIds.has(node.id);
    return matchesSearch && (showIsolatedNodes.value || linked);
  });
});

const nodeById = computed(() => new Map(graphData.value.nodes.map(node => [node.id, node])));

const selectedNodeRelations = computed(() => {
  if (!selectedNode.value) {
    return [];
  }
  return getNodeRelations(selectedNode.value.id);
});

const hoverTooltipRelations = computed(() => {
  if (!hoverTooltipRole.value) {
    return [];
  }
  return getNodeRelations(hoverTooltipRole.value.id).map(item => ({
    id: item.edge.id,
    target: item.other.label,
    type: item.edge.type || item.edge.label,
    label: item.edge.label,
    direction: item.direction,
    source: item.edge.sources.map(sourceLabel).join('/'),
  }));
});

function getNodeRelations(nodeId: string): Array<{ edge: RoleRelationshipGraphEdge; other: RoleRelationshipGraphNode; direction: string }> {
  return filteredEdges.value
    .filter(edge => edge.source === nodeId || edge.target === nodeId)
    .map(edge => {
      const isOutgoing = edge.source === nodeId;
      const otherId = isOutgoing ? edge.target : edge.source;
      const other = nodeById.value.get(otherId);
      return other
        ? {
            edge,
            other,
            direction: isOutgoing ? '->' : '<-',
          }
        : undefined;
    })
    .filter(Boolean) as Array<{ edge: RoleRelationshipGraphEdge; other: RoleRelationshipGraphNode; direction: string }>;
}

const hoveredFirstDegree = computed(() => {
  const hovered = activeFocusNodeId.value;
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  if (!hovered) {
    return { nodeIds, edgeIds };
  }
  nodeIds.add(hovered);
  for (const edge of filteredEdges.value) {
    if (edge.source === hovered || edge.target === hovered) {
      edgeIds.add(edge.id);
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }
  }
  return { nodeIds, edgeIds };
});

const activeFocusNodeId = computed(() => selectedNode.value?.id || (hoverFocusEnabled.value ? hoveredNodeId.value : null));
const hoverScrollHint = computed(() => {
  if (!hoverTooltipEnabled.value || hoverTooltipScrollModifier.value === 'disabled') {
    return '';
  }
  if (hoverTooltipScrollModifier.value === 'none') {
    return 'Hover 卡片滚轮滚动';
  }
  return `${modifierLabel(hoverTooltipScrollModifier.value)}+滚轮滚动卡片`;
});

function requestGraphData() {
  errorMessage.value = '';
  vscode?.postMessage({ command: 'roleRelationshipGraph.refresh' });
}

function openSource(sourcePath: string) {
  vscode?.postMessage({ command: 'roleRelationshipGraph.openSource', sourcePath });
}

function rebuildGraph() {
  void nextTick(() => {
    createSigmaGraph();
  });
}

function refreshGraphDisplay() {
  sigma?.setSetting('renderEdgeLabels', showEdgeLabels.value);
  sigma?.refresh();
}

function createSigmaGraph() {
  stopLayout();
  hideRoleTooltip();
  sigma?.kill();
  sigma = null;
  graph = new MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>();

  const nodes = filteredNodes.value;
  const nodeIds = new Set(nodes.map(node => node.id));
  const radius = Math.max(10, Math.sqrt(nodes.length) * 12);
  nodes.forEach((node, index) => {
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    graph?.addNode(node.id, {
      label: node.label,
      x: Math.cos(angle) * radius + randomJitter(),
      y: Math.sin(angle) * radius + randomJitter(),
      size: node.size,
      color: node.color || themeColor('--vscode-charts-blue', '#4f8cff'),
      role: node,
    });
  });

  for (const edge of filteredEdges.value) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      continue;
    }
    graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, {
      label: edge.label,
      size: Math.min(5, 0.75 + Math.sqrt(edge.weight)),
      color: edgeColor(edge),
      edge,
    });
  }

  if (!graphContainer.value) {
    return;
  }

  sigma = new Sigma(graph, graphContainer.value, {
    renderLabels: true,
    renderEdgeLabels: showEdgeLabels.value,
    enableEdgeEvents: true,
    labelRenderedSizeThreshold: 6,
    labelDensity: 0.14,
    defaultNodeColor: themeColor('--vscode-charts-blue', '#4f8cff'),
    defaultEdgeColor: themeColor('--vscode-descriptionForeground', '#7c8da1'),
    labelColor: { color: themeColor('--vscode-editor-foreground', '#d7dee8') },
    edgeLabelColor: { color: themeColor('--vscode-editor-foreground', '#d7dee8') },
    hideEdgesOnMove: false,
    hideLabelsOnMove: false,
    zoomDuration: 160,
    minCameraRatio: 0.05,
    maxCameraRatio: 8,
    zIndex: true,
    nodeReducer: reduceNode,
    edgeReducer: reduceEdge,
  });

  bindSigmaEvents();
  applyLayoutStrategy(false);
  window.setTimeout(fitGraph, 80);
}

function bindSigmaEvents() {
  if (!sigma || !graph) {
    return;
  }

  sigma.on('enterNode', payload => {
    const node = payload.node;
    hoveredNodeId.value = node;
    const role = graph?.getNodeAttribute(node, 'role') as RoleRelationshipGraphNode | undefined;
    scheduleShowRoleTooltip(role || null, getPointerPosition(payload));
    sigma?.refresh();
  });
  sigma.on('leaveNode', () => {
    if (!draggedNode) {
      hoveredNodeId.value = null;
      sigma?.refresh();
    }
    scheduleHideRoleTooltip();
  });
  sigma.on('clickNode', ({ node }) => {
    const role = graph?.getNodeAttribute(node, 'role') as RoleRelationshipGraphNode | undefined;
    selectedNode.value = role || null;
    selectedEdge.value = null;
    if (layoutStrategy.value === 'selectedRadial') {
      applyLayoutStrategy(true);
    } else {
      refreshGraphDisplay();
    }
  });
  sigma.on('clickEdge', ({ edge }) => {
    const data = graph?.getEdgeAttribute(edge, 'edge') as RoleRelationshipGraphEdge | undefined;
    selectedEdge.value = data || null;
    selectedNode.value = null;
  });
  sigma.on('clickStage', () => {
    selectedNode.value = null;
    selectedEdge.value = null;
    hideRoleTooltip();
    refreshGraphDisplay();
  });
  sigma.on('downNode', e => {
    draggedNode = e.node;
    isDragging = true;
    hoveredNodeId.value = e.node;
    hideRoleTooltip();
    e.preventSigmaDefault();
  });

  const mouse = sigma.getMouseCaptor();
  mouse.on('mousemovebody', event => {
    updateRoleTooltipPosition(event);
    if (!isDragging || !draggedNode || !sigma || !graph) {
      return;
    }
    const pos = sigma.viewportToGraph(event);
    graph.setNodeAttribute(draggedNode, 'x', pos.x);
    graph.setNodeAttribute(draggedNode, 'y', pos.y);
    sigma.refresh();
  });
  mouse.on('mouseup', () => {
    isDragging = false;
    draggedNode = null;
  });
}

function scheduleShowRoleTooltip(role: RoleRelationshipGraphNode | null, position: { x: number; y: number }) {
  clearHoverTooltipTimers();
  if (!hoverTooltipEnabled.value || !role || isDragging) {
    return;
  }
  hoverTooltipRole.value = role;
  hoverTooltipPosition.value = position;
  showHoverTooltipTimer = window.setTimeout(() => {
    hoverTooltipVisible.value = true;
    showHoverTooltipTimer = null;
  }, 260);
}

function scheduleHideRoleTooltip() {
  if (showHoverTooltipTimer !== null) {
    window.clearTimeout(showHoverTooltipTimer);
    showHoverTooltipTimer = null;
  }
  if (hideHoverTooltipTimer !== null) {
    window.clearTimeout(hideHoverTooltipTimer);
  }
  hideHoverTooltipTimer = window.setTimeout(() => {
    if (!isHoveringRoleTooltip.value) {
      hoverTooltipVisible.value = false;
      hoverTooltipRole.value = null;
    }
    hideHoverTooltipTimer = null;
  }, 140);
}

function hideRoleTooltip() {
  clearHoverTooltipTimers();
  hoverTooltipVisible.value = false;
  hoverTooltipRole.value = null;
  isHoveringRoleTooltip.value = false;
}

function clearHoverTooltipTimers() {
  if (showHoverTooltipTimer !== null) {
    window.clearTimeout(showHoverTooltipTimer);
    showHoverTooltipTimer = null;
  }
  if (hideHoverTooltipTimer !== null) {
    window.clearTimeout(hideHoverTooltipTimer);
    hideHoverTooltipTimer = null;
  }
}

function handleRoleTooltipHover(isHovering: boolean) {
  isHoveringRoleTooltip.value = isHovering;
  if (!isHovering) {
    scheduleHideRoleTooltip();
  } else if (hideHoverTooltipTimer !== null) {
    window.clearTimeout(hideHoverTooltipTimer);
    hideHoverTooltipTimer = null;
  }
}

function handleHoverTooltipToggle(value: boolean) {
  if (!value) {
    hideRoleTooltip();
  }
}

function updateRoleTooltipPosition(event: unknown) {
  if (!hoverTooltipVisible.value || !hoverTooltipFollowMouse.value || isDragging) {
    return;
  }
  hoverTooltipPosition.value = getPointerPosition(event);
}

function getPointerPosition(payload: unknown) {
  const data = payload as {
    x?: number;
    y?: number;
    event?: { x?: number; y?: number; original?: MouseEvent };
    original?: MouseEvent;
  };
  const original = data?.event?.original || data?.original;
  if (original) {
    return { x: original.clientX, y: original.clientY };
  }
  if (typeof data?.event?.x === 'number' && typeof data?.event?.y === 'number') {
    return { x: data.event.x, y: data.event.y };
  }
  if (typeof data?.x === 'number' && typeof data?.y === 'number') {
    return { x: data.x, y: data.y };
  }
  return hoverTooltipPosition.value;
}

function loadHoverScrollModifier(): RoleHoverTooltipScrollModifier {
  try {
    const stored = localStorage.getItem(HOVER_SCROLL_MODIFIER_STORAGE_KEY);
    if (isHoverScrollModifier(stored)) {
      return stored;
    }
  } catch {
    // localStorage 在部分测试环境不可用，直接使用默认值。
  }
  return 'ctrl';
}

function isHoverScrollModifier(value: unknown): value is RoleHoverTooltipScrollModifier {
  return value === 'ctrl' || value === 'alt' || value === 'shift' || value === 'meta' || value === 'none' || value === 'disabled';
}

function modifierLabel(value: RoleHoverTooltipScrollModifier) {
  if (value === 'ctrl') {
    return 'Ctrl';
  }
  if (value === 'alt') {
    return 'Alt';
  }
  if (value === 'shift') {
    return 'Shift';
  }
  if (value === 'meta') {
    return 'Command/Win';
  }
  return '';
}

function reduceNode(nodeId: string, data: GraphNodeAttributes): Partial<GraphNodeAttributes> {
  if (!activeFocusNodeId.value || !graph) {
    return data;
  }
  const isNeighbor = hoveredFirstDegree.value.nodeIds.has(nodeId);
  const isFocused = nodeId === activeFocusNodeId.value;
  const shouldHide = !!selectedNode.value && hideUnfocusedWhenSelected.value && !isNeighbor;
  return {
    ...data,
    hidden: shouldHide,
    color: isNeighbor ? data.color : alphaColor(themeColor('--vscode-descriptionForeground', '#788492'), 0.16),
    label: isNeighbor ? data.label : '',
    size: isFocused ? data.size + 3 : isNeighbor ? data.size + 1.5 : Math.max(2, data.size * 0.62),
    zIndex: isFocused ? 4 : isNeighbor ? 3 : 0,
  };
}

function reduceEdge(edgeId: string, data: GraphEdgeAttributes): Partial<GraphEdgeAttributes> {
  const edge = graph?.getEdgeAttribute(edgeId, 'edge') as RoleRelationshipGraphEdge | undefined;
  if (!edge) {
    return data;
  }
  const active = hoveredFirstDegree.value.edgeIds.has(edge.id);
  const visible = shouldShowEdge(edge, active);
  return {
    ...data,
    hidden: !visible,
    color: active ? data.color : alphaColor(themeColor('--vscode-descriptionForeground', '#6e7a88'), 0.16),
    size: active ? data.size + 1.2 : Math.max(0.35, data.size * 0.38),
  };
}

function shouldShowEdge(edge: RoleRelationshipGraphEdge, active: boolean) {
  if (edgeDisplayStrategy.value === 'all') {
    return true;
  }
  if (edgeDisplayStrategy.value === 'hideReference') {
    return !edge.sources.includes('reference');
  }
  if (edgeDisplayStrategy.value === 'highlightOnly') {
    return !!activeFocusNodeId.value && active;
  }
  if (edgeDisplayStrategy.value === 'selectedOnly') {
    if (!selectedNode.value) {
      return true;
    }
    return edge.source === selectedNode.value.id || edge.target === selectedNode.value.id;
  }
  if (!activeFocusNodeId.value) {
    return true;
  }
  return active;
}

function startLayout() {
  if (!graph || graph.order === 0) {
    return;
  }
  if (layoutStrategy.value !== 'force') {
    applyLayoutStrategy(true);
    return;
  }
  layoutRunning.value = true;
  layoutTicks = 0;
  const settings = {
    ...forceAtlas2.inferSettings(graph),
    linLogMode: true,
    gravity: 0.08,
    scalingRatio: Math.max(12, Math.sqrt(graph.order) * 3),
    slowDown: 8,
    edgeWeightInfluence: 0.6,
    barnesHutOptimize: graph.order > 120,
  };

  const tick = () => {
    if (!layoutRunning.value || !graph) {
      return;
    }
    forceAtlas2.assign(graph, { iterations: graph.order > 350 ? 1 : 2, settings });
    if (layoutTicks % 24 === 0) {
      noverlap.assign(graph, { maxIterations: 12, settings: { margin: 3, ratio: 1.1, expansion: 1.05 } });
    }
    sigma?.refresh();
    layoutTicks += 1;
    if (layoutTicks > 220) {
      layoutRunning.value = false;
      return;
    }
    layoutFrame = window.requestAnimationFrame(tick);
  };

  layoutFrame = window.requestAnimationFrame(tick);
}

function applyLayoutStrategy(shouldFit: boolean) {
  if (!graph || graph.order === 0) {
    return;
  }
  stopLayout();

  if (layoutStrategy.value === 'force') {
    startLayout();
  } else if (layoutStrategy.value === 'circle') {
    applyCircleLayout();
  } else if (layoutStrategy.value === 'concentric') {
    applyConcentricLayout();
  } else if (layoutStrategy.value === 'typeBands') {
    applyTypeBandLayout();
  } else {
    applySelectedRadialLayout();
  }

  sigma?.refresh();
  if (shouldFit) {
    window.setTimeout(fitGraph, 40);
  }
}

function applyCircleLayout() {
  if (!graph) {
    return;
  }
  const nodeIds = sortedGraphNodeIds();
  const radius = Math.max(80, nodeIds.length * 5.5);
  nodeIds.forEach((nodeId, index) => {
    const angle = (index / Math.max(nodeIds.length, 1)) * Math.PI * 2;
    setNodePosition(nodeId, Math.cos(angle) * radius, Math.sin(angle) * radius);
  });
}

function applyConcentricLayout() {
  if (!graph) {
    return;
  }
  const nodeIds = sortedGraphNodeIds((a, b) => graph!.degree(b) - graph!.degree(a));
  const centerCount = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(nodeIds.length) / 2)));
  nodeIds.forEach((nodeId, index) => {
    if (index < centerCount) {
      const angle = (index / centerCount) * Math.PI * 2;
      setNodePosition(nodeId, Math.cos(angle) * 24, Math.sin(angle) * 24);
      return;
    }
    const ringIndex = Math.floor(Math.sqrt(index - centerCount));
    const ringStart = centerCount + ringIndex * ringIndex;
    const ringSize = Math.max(1, (ringIndex + 1) * 6);
    const ringOffset = index - ringStart;
    const angle = (ringOffset / ringSize) * Math.PI * 2;
    const radius = 90 + ringIndex * 78;
    setNodePosition(nodeId, Math.cos(angle) * radius, Math.sin(angle) * radius);
  });
}

function applyTypeBandLayout() {
  if (!graph) {
    return;
  }
  const groups = new Map<string, string[]>();
  for (const nodeId of sortedGraphNodeIds()) {
    const role = graph.getNodeAttribute(nodeId, 'role') as RoleRelationshipGraphNode;
    const group = role.type || role.affiliation || '未分类';
    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group)!.push(nodeId);
  }

  const groupEntries = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  const bandGap = 160;
  groupEntries.forEach(([, nodeIds], groupIndex) => {
    const y = (groupIndex - (groupEntries.length - 1) / 2) * bandGap;
    const width = Math.max(120, nodeIds.length * 72);
    nodeIds.forEach((nodeId, index) => {
      const x = nodeIds.length === 1 ? 0 : (index / (nodeIds.length - 1) - 0.5) * width;
      setNodePosition(nodeId, x, y + Math.sin(index * 1.7) * 24);
    });
  });
}

function applySelectedRadialLayout() {
  if (!graph) {
    return;
  }
  const selectedId = selectedNode.value?.id;
  if (!selectedId || !graph.hasNode(selectedId)) {
    applyConcentricLayout();
    return;
  }

  setNodePosition(selectedId, 0, 0);
  const directIds = new Set<string>();
  const secondIds = new Set<string>();
  for (const edge of filteredEdges.value) {
    if (edge.source === selectedId && graph.hasNode(edge.target)) {
      directIds.add(edge.target);
    } else if (edge.target === selectedId && graph.hasNode(edge.source)) {
      directIds.add(edge.source);
    }
  }
  for (const edge of filteredEdges.value) {
    if (directIds.has(edge.source) && graph.hasNode(edge.target) && edge.target !== selectedId && !directIds.has(edge.target)) {
      secondIds.add(edge.target);
    }
    if (directIds.has(edge.target) && graph.hasNode(edge.source) && edge.source !== selectedId && !directIds.has(edge.source)) {
      secondIds.add(edge.source);
    }
  }

  placeOnRing(Array.from(directIds), 110, -Math.PI / 2);
  placeOnRing(Array.from(secondIds), 245, -Math.PI / 2 + 0.18);
  const placed = new Set([selectedId, ...directIds, ...secondIds]);
  const rest = sortedGraphNodeIds().filter(nodeId => !placed.has(nodeId));
  placeOnRing(rest, Math.max(390, rest.length * 8), Math.PI / 8);
}

function placeOnRing(nodeIds: string[], radius: number, angleOffset = 0) {
  nodeIds.forEach((nodeId, index) => {
    const angle = angleOffset + (index / Math.max(nodeIds.length, 1)) * Math.PI * 2;
    setNodePosition(nodeId, Math.cos(angle) * radius, Math.sin(angle) * radius);
  });
}

function sortedGraphNodeIds(sorter?: (a: string, b: string) => number) {
  if (!graph) {
    return [];
  }
  const nodeIds = graph.nodes();
  if (sorter) {
    return nodeIds.sort(sorter);
  }
  return nodeIds.sort((a, b) => {
    const aLabel = graph?.getNodeAttribute(a, 'label') || a;
    const bLabel = graph?.getNodeAttribute(b, 'label') || b;
    return String(aLabel).localeCompare(String(bLabel), 'zh-Hans-CN');
  });
}

function setNodePosition(nodeId: string, x: number, y: number) {
  graph?.setNodeAttribute(nodeId, 'x', x);
  graph?.setNodeAttribute(nodeId, 'y', y);
}

function stopLayout() {
  layoutRunning.value = false;
  if (layoutFrame !== null) {
    window.cancelAnimationFrame(layoutFrame);
    layoutFrame = null;
  }
}

function toggleLayout() {
  if (layoutRunning.value) {
    stopLayout();
  } else {
    startLayout();
  }
}

function fitGraph() {
  void sigma?.getCamera().animatedReset({ duration: 450 });
}

function selectRelation(edge: RoleRelationshipGraphEdge) {
  selectedEdge.value = edge;
}

function edgeTitle(edge: RoleRelationshipGraphEdge) {
  const source = graphData.value.nodes.find(node => node.id === edge.source)?.label || edge.source;
  const target = graphData.value.nodes.find(node => node.id === edge.target)?.label || edge.target;
  return `${source} -> ${target}`;
}

function edgeColor(edge: RoleRelationshipGraphEdge) {
  if (edge.sources.includes('relationship')) {
    return themeColor('--vscode-charts-yellow', '#f59e0b');
  }
  if (edge.sources.includes('marked')) {
    return themeColor('--vscode-charts-blue', '#06b6d4');
  }
  return themeColor('--vscode-descriptionForeground', '#7c8da1');
}

function sourceColor(source: RoleRelationshipGraphEdgeSource) {
  if (source === 'relationship') {
    return 'amber-8';
  }
  if (source === 'marked') {
    return 'cyan-7';
  }
  return 'blue-grey-6';
}

function sourceLabel(source: RoleRelationshipGraphEdgeSource) {
  if (source === 'relationship') {
    return '关系表';
  }
  if (source === 'marked') {
    return 'relations';
  }
  return '引用';
}

function detailMetadataRows(detail: RoleRelationshipGraphEdgeDetail): Array<{ label: string; value: string; path?: boolean }> {
  const rows: Array<{ label: string; value: string; path?: boolean }> = [];
  if (detail.type) {
    rows.push({ label: '类型', value: detail.type });
  }
  if (detail.field) {
    rows.push({ label: detail.source === 'reference' ? '命中字段' : '字段', value: detail.field });
  }
  if (typeof detail.strength === 'number') {
    rows.push({ label: '强度', value: String(detail.strength) });
  }
  if (typeof detail.directed === 'boolean') {
    rows.push({ label: '方向', value: detail.directed ? '有向' : '无向' });
  }
  const rawMetadata = extractRawMetadata(detail.raw);
  for (const [key, value] of Object.entries(rawMetadata)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    rows.push({ label: metadataLabel(key), value: stringifyMetadataValue(value) });
  }
  if (detail.sourceFile) {
    rows.push({ label: '来源文件', value: detail.sourceFile, path: true });
  }
  return dedupeRows(rows);
}

function extractRawMetadata(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const item = raw as Record<string, unknown>;
  const metadata = item.metadata && typeof item.metadata === 'object'
    ? item.metadata as Record<string, unknown>
    : {};
  const result: Record<string, unknown> = {};
  for (const key of ['status', 'tags', 'notes', 'startTime', 'endTime', 'isPublic', 'lineId']) {
    if (item[key] !== undefined) {
      result[key] = item[key];
    }
    if (metadata[key] !== undefined) {
      result[key] = metadata[key];
    }
  }
  return result;
}

function metadataLabel(key: string) {
  const labels: Record<string, string> = {
    status: '状态',
    tags: '标签',
    notes: '备注',
    startTime: '开始',
    endTime: '结束',
    isPublic: '公开',
    lineId: 'ID',
  };
  return labels[key] || key;
}

function stringifyMetadataValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(item => stringifyMetadataValue(item)).join('、');
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

function dedupeRows(rows: Array<{ label: string; value: string; path?: boolean }>) {
  const seen = new Set<string>();
  return rows.filter(row => {
    const key = `${row.label}:${row.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function randomJitter() {
  return (Math.random() - 0.5) * 8;
}

function themeColor(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function alphaColor(color: string, alpha: number) {
  const trimmed = color.trim();
  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    const normalized = hex.length === 3
      ? hex.split('').map(char => `${char}${char}`).join('')
      : hex;
    const value = Number.parseInt(normalized.slice(0, 6), 16);
    if (Number.isFinite(value)) {
      const r = (value >> 16) & 255;
      const g = (value >> 8) & 255;
      const b = value & 255;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  const rgb = trimmed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgb) {
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
  }
  return trimmed;
}

function refreshThemeColors() {
  if (!sigma || !graph) {
    return;
  }
  sigma.setSettings({
    defaultNodeColor: themeColor('--vscode-charts-blue', '#4f8cff'),
    defaultEdgeColor: themeColor('--vscode-descriptionForeground', '#7c8da1'),
    labelColor: { color: themeColor('--vscode-editor-foreground', '#d7dee8') },
    edgeLabelColor: { color: themeColor('--vscode-editor-foreground', '#d7dee8') },
  });
  graph.forEachEdge(edgeId => {
    const edge = graph?.getEdgeAttribute(edgeId, 'edge') as RoleRelationshipGraphEdge | undefined;
    if (edge) {
      graph?.setEdgeAttribute(edgeId, 'color', edgeColor(edge));
    }
  });
  sigma.refresh();
}

function watchThemeChanges() {
  let scheduled = false;
  const schedule = () => {
    if (scheduled) {
      return;
    }
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      refreshThemeColors();
    });
  };

  themeObserver = new MutationObserver(schedule);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-vscode-theme-kind', 'data-vscode-theme-name'] });
}

watch([searchText, showIsolatedNodes], rebuildGraph);
watch(hoverTooltipScrollModifier, value => {
  try {
    localStorage.setItem(HOVER_SCROLL_MODIFIER_STORAGE_KEY, value);
  } catch {
    // 忽略 webview 存储不可用的情况。
  }
});

onMounted(() => {
  watchThemeChanges();
  window.addEventListener('message', event => {
    const message = event.data;
    if (message?.command === 'roleRelationshipGraph.data') {
      graphData.value = message.data;
      errorMessage.value = '';
      rebuildGraph();
      return;
    }
    if (message?.command === 'roleRelationshipGraph.error') {
      errorMessage.value = message.message || '图谱加载失败';
    }
  });
  vscode?.postMessage({ command: 'roleRelationshipGraph.ready' });
});

onBeforeUnmount(() => {
  stopLayout();
  hideRoleTooltip();
  themeObserver?.disconnect();
  sigma?.kill();
});
</script>

<style scoped>
.role-graph-page {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
}

.graph-sidebar {
  border-right: 1px solid var(--vscode-panel-border, var(--vscode-sideBar-border, rgba(128, 128, 128, 0.35)));
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  overflow: auto;
  padding: 14px;
}

.sidebar-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.sidebar-title {
  font-size: 16px;
  font-weight: 650;
}

.sidebar-subtitle,
.meta-row {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  line-height: 1.5;
}

.filter-control :deep(.q-field__control) {
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
}

.filter-control :deep(.q-field__native),
.filter-control :deep(.q-field__input) {
  color: var(--vscode-input-foreground);
}

.filter-control :deep(.q-field__control::before) {
  border-color: var(--vscode-input-border, var(--vscode-panel-border, rgba(128, 128, 128, 0.45)));
}

.filter-control :deep(.q-field__control:hover::before),
.filter-control :deep(.q-field--focused .q-field__control::after) {
  border-color: var(--vscode-focusBorder);
}

.filter-control {
  margin-bottom: 14px;
}

.filter-control.compact {
  margin-bottom: 8px;
}

.inline-select {
  margin-top: 4px;
}

.inline-select :deep(.q-field__prepend) {
  padding-right: 6px;
}

.field-prefix-label {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}

.filter-section,
.detail-section,
.error-section {
  border-top: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.24));
  padding: 14px 0;
}

.section-title {
  color: var(--vscode-foreground);
  font-size: 12px;
  font-weight: 650;
  margin-bottom: 8px;
}

.layout-actions {
  display: flex;
  gap: 4px;
}

.detail-title {
  color: var(--vscode-editor-foreground);
  font-size: 15px;
  font-weight: 650;
  margin-bottom: 6px;
}

.path {
  overflow-wrap: anywhere;
}

.open-source-btn {
  margin-top: 8px;
}

.source-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0;
}

.source-chips.small {
  gap: 4px;
  margin: 6px 0;
}

.edge-detail-list {
  display: grid;
  gap: 8px;
}

.edge-detail-list.compact {
  gap: 6px;
}

.edge-detail {
  border-left: 2px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.45));
  padding-left: 8px;
  font-size: 12px;
}

.node-relation-list {
  margin-top: 14px;
}

.relation-list-title {
  margin-top: 4px;
}

.node-relation-card {
  border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.24));
  background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background, transparent));
  cursor: pointer;
  margin-bottom: 8px;
  padding: 8px;
}

.node-relation-card:hover {
  border-color: var(--vscode-focusBorder);
  background: var(--vscode-list-hoverBackground, var(--vscode-editorWidget-background, transparent));
}

.relation-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.relation-target {
  color: var(--vscode-editor-foreground);
  font-size: 13px;
  font-weight: 650;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.relation-type {
  color: var(--vscode-descriptionForeground);
  flex: 0 0 auto;
  font-size: 12px;
}

.error-section {
  color: var(--vscode-errorForeground);
}

.graph-main {
  position: relative;
  min-width: 0;
}

.sigma-container {
  position: absolute;
  inset: 0;
  background: var(--vscode-editor-background);
}

.graph-hud {
  position: absolute;
  left: 14px;
  bottom: 14px;
  display: flex;
  gap: 10px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  pointer-events: none;
}

@media (max-width: 760px) {
  .role-graph-page {
    grid-template-columns: 1fr;
    grid-template-rows: 42vh 58vh;
  }

  .graph-sidebar {
    grid-row: 2;
    border-right: 0;
    border-top: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
  }

  .graph-main {
    grid-row: 1;
  }
}
</style>
