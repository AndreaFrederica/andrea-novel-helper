<template>
  <section
    v-if="groupedTimelineItems.length"
    class="timeline-view"
    ref="containerRef"
    @wheel="handleWheel"
    @mousedown="handleMouseDown"
    @mousemove="handleMouseMove"
    @mouseup="handleMouseUp"
    @mouseleave="handleMouseUp"
    @dblclick="resetView"
  >
    <div
      class="timeline-view__content"
      ref="contentRef"
      :style="{
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        transformOrigin: 'left top'
      }"
    >
      <d-timeline direction="horizontal" class="timeline-view__timeline" ref="timelineRef">
        <d-timeline-item
          v-for="group in groupedTimelineItems"
          :key="group.dateKey"
          :dot-color="group.items[0]?.dotColor || 'var(--devui-link)'"
          line-style="dashed"
        >
          <template #time>
            <div class="timeline-view__time">{{ group.displayDate }}</div>
          </template>
          <template #default>
            <div class="timeline-view__card-group">
              <article
                v-for="item in group.items"
                :key="item.id"
                :ref="el => setCardRef(item.id, el as HTMLElement)"
                :data-card-id="item.id"
                class="timeline-view__card"
                :style="{ backgroundColor: item.cardBg, color: item.textColor, borderLeftColor: 'rgba(255,255,255,0.95)' }"
              >
                <header class="timeline-view__card-header">
                  <h3 class="timeline-view__card-title">{{ item.title }}</h3>
                  <d-tag
                    size="sm"
                    class="timeline-status-tag"
                    :style="{ color: item.cardBg, backgroundColor: '#ffffff' }"
                  >
                    {{ item.statusLabel }}
                  </d-tag>
                </header>
                <div class="timeline-view__card-date">{{ item.displayDate }}</div>
                <p v-if="item.description" class="timeline-view__card-description">{{ item.description }}</p>
                <footer class="timeline-view__card-footer">
                  <span v-if="item.group" class="timeline-view__meta">所属分组：{{ item.group }}</span>
                  <span v-if="item.isTimeless" class="timeline-view__meta">时间未定</span>
                </footer>
              </article>
            </div>
          </template>
          <template #extra v-if="group.yearLabel">
            <div class="timeline-view__extra">{{ group.yearLabel }}</div>
          </template>
        </d-timeline-item>
      </d-timeline>

      <!-- SVG 连接线层 - 绝对定位在内容之上 -->
      <svg
        v-if="props.connections && props.connections.length > 0 && renderedConnections.length > 0"
        class="timeline-view__connections"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          overflow: 'visible'
        }"
      >
        <defs>
          <!-- 箭头标记（每种连线类型都有对应颜色的箭头） -->
          <marker
            id="arrowhead-time-travel"
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 10 3, 0 6" fill="#8b5cf6" />
          </marker>
          <marker
            id="arrowhead-reincarnation"
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 10 3, 0 6" fill="#06b6d4" />
          </marker>
          <marker
            id="arrowhead-parallel"
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 10 3, 0 6" fill="#f59e0b" />
          </marker>
          <marker
            id="arrowhead-dream"
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 10 3, 0 6" fill="#ec4899" />
          </marker>
          <marker
            id="arrowhead-flashback"
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 10 3, 0 6" fill="#10b981" />
          </marker>
          <marker
            id="arrowhead-other"
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 10 3, 0 6" fill="#6b7280" />
          </marker>
        </defs>
        <g>
          <path
            v-for="conn in renderedConnections"
            :key="conn.id"
            :d="conn.path"
            :stroke="conn.color"
            :stroke-width="conn.width"
            :stroke-dasharray="conn.dashArray"
            fill="none"
            :marker-end="conn.markerEnd"
            opacity="0.8"
          />
        </g>
        <g>
          <text
            v-for="conn in renderedConnections"
            :key="`label-${conn.id}`"
            :x="conn.labelX"
            :y="conn.labelY"
            :fill="conn.color"
            font-size="13"
            font-weight="bold"
            text-anchor="middle"
            dominant-baseline="middle"
            class="timeline-view__connection-label"
          >
            {{ conn.label }}
          </text>
        </g>
      </svg>
    </div>
  </section>
  <div v-else class="timeline-view__empty">
    <span>暂无可展示的事件</span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';

type KnownTimelineType = 'main' | 'side';
type CustomTimelineType = string & { __customTimelineTypeBrand?: never };

interface TimelineViewEvent {
  id: string;
  title: string;
  date?: string;
  description?: string;
  group?: string;
  type?: KnownTimelineType | CustomTimelineType;
  timeless?: boolean;
}

interface TimelineViewConnection {
  id: string;
  source: string;
  target: string;
  label?: string;
  connectionType?: 'normal' | 'time-travel' | 'reincarnation' | 'parallel' | 'dream' | 'flashback' | 'other';
}

interface NormalizedTimelineItem {
  id: string;
  title: string;
  description?: string | undefined;
  group?: string | undefined;
  statusLabel: string;
  dotColor: string;
  backgroundColor: string;
  cardBg: string;
  textColor: string;
  displayDate: string;
  yearLabel: string;
  isTimeless: boolean;
  sortKey: number;
  rawDate: Date | null;
}

const props = defineProps<{
  events: TimelineViewEvent[];
  connections?: TimelineViewConnection[];
}>();

// 缩放和拖拽状态
const containerRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const timelineRef = ref<HTMLElement | null>(null);
const zoom = ref(1);
const pan = reactive({ x: 0, y: 0 });
const isDragging = ref(false);
const dragStart = reactive({ x: 0, y: 0 });

// 存储卡片元素的引用
const cardRefs = ref<Map<string, HTMLElement>>(new Map());

// 滚轮缩放 - 以鼠标位置为中心
function handleWheel(event: WheelEvent) {
  event.preventDefault();

  if (!containerRef.value) return;

  const delta = event.deltaY * -0.001;
  const newZoom = Math.min(Math.max(0.5, zoom.value + delta), 3);

  // 获取鼠标相对于容器的位置
  const rect = containerRef.value.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  // 计算鼠标在内容坐标系中的位置（缩放前）
  const contentX = (mouseX - pan.x) / zoom.value;
  const contentY = (mouseY - pan.y) / zoom.value;

  // 更新缩放
  zoom.value = newZoom;

  // 调整平移，使鼠标指向的内容点保持不变
  pan.x = mouseX - contentX * newZoom;
  pan.y = mouseY - contentY * newZoom;

  // 立即触发连线重新测量
  scheduleConnectionMeasurement();
}

// 鼠标拖拽
function handleMouseDown(event: MouseEvent) {
  // 只响应左键
  if (event.button !== 0) return;

  isDragging.value = true;
  dragStart.x = event.clientX - pan.x;
  dragStart.y = event.clientY - pan.y;

  if (containerRef.value) {
    containerRef.value.style.cursor = 'grabbing';
  }
}

function handleMouseMove(event: MouseEvent) {
  if (!isDragging.value) return;

  pan.x = event.clientX - dragStart.x;
  pan.y = event.clientY - dragStart.y;

  // 拖拽时实时更新连线位置
  scheduleConnectionMeasurement();
}

function handleMouseUp() {
  isDragging.value = false;
  if (containerRef.value) {
    containerRef.value.style.cursor = 'grab';
  }

  // 拖拽结束后再次更新，确保最终位置准确
  scheduleConnectionMeasurement();
}

// 双击重置视图
function resetView() {
  zoom.value = 1;
  pan.x = 0;
  pan.y = 0;

  // 重置后更新连线
  scheduleConnectionMeasurement();
}

// 设置卡片引用
function setCardRef(id: string, el: HTMLElement | null) {
  if (el) {
    cardRefs.value.set(id, el);
  } else {
    cardRefs.value.delete(id);
  }
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

// 连接线类型的样式配置（与 TimelinePage.vue 的 getConnectionColor 一致）
const CONNECTION_TYPE_STYLES: Record<string, { color: string; width: number; dashArray: string; markerEnd: string }> = {
  'time-travel': { color: '#8b5cf6', width: 3, dashArray: '', markerEnd: 'url(#arrowhead-time-travel)' }, // 紫色
  'reincarnation': { color: '#06b6d4', width: 3, dashArray: '', markerEnd: 'url(#arrowhead-reincarnation)' }, // 青色
  'parallel': { color: '#f59e0b', width: 3, dashArray: '', markerEnd: 'url(#arrowhead-parallel)' }, // 橙色
  'dream': { color: '#ec4899', width: 2, dashArray: '5,5', markerEnd: 'url(#arrowhead-dream)' }, // 粉色，虚线
  'flashback': { color: '#10b981', width: 2, dashArray: '5,5', markerEnd: 'url(#arrowhead-flashback)' }, // 绿色，虚线
  'other': { color: '#6b7280', width: 2, dashArray: '5,5', markerEnd: 'url(#arrowhead-other)' }, // 灰色
  'normal': { color: 'transparent', width: 0, dashArray: '', markerEnd: '' }, // 不显示
};

// 连接线渲染数据接口
interface RenderedConnection {
  id: string;
  path: string;
  color: string;
  width: number;
  dashArray: string;
  markerEnd: string;
  label: string;
  labelX: number;
  labelY: number;
}

// 计算渲染的连接线
const renderedConnections = computed<RenderedConnection[]>(() => {
  if (!props.connections || props.connections.length === 0 || !containerRef.value) {
    return [];
  }

  // 强制依赖 connectionUpdateKey 以触发重新计算
  const _ = connectionUpdateKey.value;

  return props.connections
    .filter(conn => {
      // 只渲染明确标记的特殊连线
      const type = conn.connectionType ?? 'normal';
      return type !== 'normal';
    })
    .map(conn => {
      const sourceEl = cardRefs.value.get(conn.source);
      const targetEl = cardRefs.value.get(conn.target);

      if (!sourceEl || !targetEl || !contentRef.value) {
        return null;
      }

      const scale = zoom.value || 1;

      // 获取 content 容器和卡片的位置（转换为未缩放时的本地坐标）
      const contentRect = contentRef.value.getBoundingClientRect();
      const sourceRect = sourceEl.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();

      // 计算相对于 content 容器的边界和中心坐标
      const sourceBounds = {
        left: (sourceRect.left - contentRect.left) / scale,
        right: (sourceRect.right - contentRect.left) / scale,
        top: (sourceRect.top - contentRect.top) / scale,
        bottom: (sourceRect.bottom - contentRect.top) / scale,
        width: sourceRect.width / scale,
        height: sourceRect.height / scale,
      };
      const targetBounds = {
        left: (targetRect.left - contentRect.left) / scale,
        right: (targetRect.right - contentRect.left) / scale,
        top: (targetRect.top - contentRect.top) / scale,
        bottom: (targetRect.bottom - contentRect.top) / scale,
        width: targetRect.width / scale,
        height: targetRect.height / scale,
      };

      const sourceAnchor = {
        x: sourceBounds.right,
        y: sourceBounds.top + sourceBounds.height / 2,
      };
      const targetAnchor = {
        x: targetBounds.left,
        y: targetBounds.top + targetBounds.height / 2,
      };

      const deltaX = targetAnchor.x - sourceAnchor.x;
      const deltaY = targetAnchor.y - sourceAnchor.y;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

  const horizontalOffset = Math.max(absDeltaX * 0.5, 80);
  const verticalDirection = deltaY === 0 ? 0 : Math.sign(deltaY);
  const verticalOffset = verticalDirection === 0 ? 0 : Math.max(absDeltaY * 0.2, 20);

      const control1 = {
        x: sourceAnchor.x + horizontalOffset,
  y: sourceAnchor.y + verticalDirection * verticalOffset,
      };
      const control2 = {
        x: targetAnchor.x - horizontalOffset,
  y: targetAnchor.y - verticalDirection * verticalOffset,
      };

      const path = `M ${sourceAnchor.x} ${sourceAnchor.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${targetAnchor.x} ${targetAnchor.y}`;

      // 计算标签位置（在贝塞尔曲线的中点）
      // 使用 t=0.5 计算三次贝塞尔曲线上的点
      const t = 0.5;
      const labelX = Math.pow(1-t, 3) * sourceAnchor.x +
                     3 * Math.pow(1-t, 2) * t * control1.x +
                     3 * (1-t) * Math.pow(t, 2) * control2.x +
                     Math.pow(t, 3) * targetAnchor.x;
      const labelY = Math.pow(1-t, 3) * sourceAnchor.y +
                     3 * Math.pow(1-t, 2) * t * control1.y +
                     3 * (1-t) * Math.pow(t, 2) * control2.y +
                     Math.pow(t, 3) * targetAnchor.y;

      // 获取样式（确保总是有默认值）
  const connectionType = conn.connectionType && conn.connectionType !== 'normal' ? conn.connectionType : 'other';
  const styleConfig = (CONNECTION_TYPE_STYLES[connectionType] || CONNECTION_TYPE_STYLES.other) as { color: string; width: number; dashArray: string; markerEnd: string };

      const result: RenderedConnection = {
        id: conn.id,
        path,
        color: styleConfig.color,
        width: styleConfig.width,
        dashArray: styleConfig.dashArray,
        markerEnd: styleConfig.markerEnd,
        label: getConnectionTypeLabel(connectionType),
        labelX,
        labelY,
      };

      return result;
    })
    .filter((conn): conn is RenderedConnection => conn !== null);
});

const TIMELINE_TYPE_META: Record<
  KnownTimelineType | 'default',
  { dotColor: string; backgroundColor: string; label: string; cardBg: string; textColor: string }
> = {
  main: {
    dotColor: 'var(--devui-success)',
    backgroundColor: 'rgba(33, 209, 152, 0.16)',
    label: '主要事件',
    cardBg: '#42b883',
    textColor: '#ffffff',
  },
  side: {
    dotColor: 'var(--devui-info)',
    backgroundColor: 'rgba(53, 133, 255, 0.16)',
    label: '次要事件',
    cardBg: '#64748b',
    textColor: '#ffffff',
  },
  default: {
    dotColor: 'var(--devui-link)',
    backgroundColor: 'rgba(94, 124, 224, 0.12)',
    label: '事件',
    cardBg: '#5e7cc0',
    textColor: '#ffffff',
  },
};

function getTypeMeta(type?: string) {
  if (type && (type === 'main' || type === 'side')) {
    return TIMELINE_TYPE_META[type];
  }
  return TIMELINE_TYPE_META.default;
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDate(event: TimelineViewEvent, fallbackIndex: number) {
  if (event.timeless) {
    return {
      displayDate: '未绑定日期',
      sortKey: Number.MAX_SAFE_INTEGER - 200 + fallbackIndex,
      rawDate: null,
      isTimeless: true,
    };
  }

  if (!event.date) {
    return {
      displayDate: '未设置日期',
      sortKey: Number.MAX_SAFE_INTEGER - 150 + fallbackIndex,
      rawDate: null,
      isTimeless: false,
    };
  }

  const parsed = new Date(event.date);
  if (Number.isNaN(parsed.getTime())) {
    return {
      displayDate: event.date,
      sortKey: Number.MAX_SAFE_INTEGER - 175 + fallbackIndex,
      rawDate: null,
      isTimeless: false,
    };
  }

  return {
    displayDate: formatDate(parsed),
    sortKey: parsed.getTime(),
    rawDate: parsed,
    isTimeless: false,
  };
}

const timelineItems = computed<NormalizedTimelineItem[]>(() => {
  if (!props.events || props.events.length === 0) {
    return [];
  }

  const enriched = props.events.map((event, index) => {
    const meta = getTypeMeta(event.type);
    const { displayDate, sortKey, rawDate, isTimeless } = normalizeDate(event, index);
    return {
      id: event.id ?? `event-${index}`,
      title: event.title || `未命名事件 ${index + 1}`,
      description: event.description?.trim() || undefined,
      group: event.group?.trim() || undefined,
    statusLabel: meta.label,
    dotColor: meta.dotColor,
    backgroundColor: meta.backgroundColor,
    cardBg: meta.cardBg,
    textColor: meta.textColor,
      displayDate,
      yearLabel: '',
      isTimeless,
      sortKey,
      rawDate,
      originalIndex: index,
    };
  });

  enriched.sort((a, b) => {
    if (a.sortKey === b.sortKey) {
      return a.originalIndex - b.originalIndex;
    }
    return a.sortKey - b.sortKey;
  });

  return enriched.map((item, index) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    group: item.group,
    statusLabel: item.statusLabel,
    dotColor: item.dotColor,
    backgroundColor: item.backgroundColor,
    cardBg: item.cardBg,
    textColor: item.textColor,
    displayDate: item.displayDate,
    yearLabel: index === 0 && item.rawDate ? `${item.rawDate.getFullYear()}` : '',
    isTimeless: item.isTimeless,
    sortKey: item.sortKey,
    rawDate: item.rawDate,
  }));
});

// 按日期分组的时间线项
interface GroupedTimelineItem {
  dateKey: string;
  displayDate: string;
  yearLabel: string;
  items: NormalizedTimelineItem[];
}

const groupedTimelineItems = computed<GroupedTimelineItem[]>(() => {
  const items = timelineItems.value;
  if (items.length === 0) {
    return [];
  }

  // 按日期分组
  const groupMap = new Map<string, NormalizedTimelineItem[]>();

  items.forEach((item) => {
    const key = item.displayDate;
    if (!groupMap.has(key)) {
      groupMap.set(key, []);
    }
    const group = groupMap.get(key);
    if (group) {
      group.push(item);
    }
  });

  // 转换为数组并保持时间顺序
  const groups: GroupedTimelineItem[] = [];
  const sortedDates = Array.from(groupMap.keys()).sort((a, b) => {
    const itemsA = groupMap.get(a);
    const itemsB = groupMap.get(b);
    if (!itemsA || !itemsB || !itemsA[0] || !itemsB[0]) return 0;
    return itemsA[0].sortKey - itemsB[0].sortKey;
  });

  sortedDates.forEach((dateKey, index) => {
    const groupItems = groupMap.get(dateKey);
    if (!groupItems || groupItems.length === 0) return;

    const firstItem = groupItems[0];
    if (!firstItem) return;

    groups.push({
      dateKey,
      displayDate: firstItem.displayDate,
      yearLabel: index === 0 && firstItem.rawDate ? `${firstItem.rawDate.getFullYear()}` : '',
      items: groupItems,
    });
  });

  return groups;
});

// 强制重新渲染连接线（当卡片位置变化时）
const connectionUpdateKey = ref(0);
const pendingMeasureFrame = ref<number | null>(null);

function scheduleConnectionMeasurement() {
  void nextTick(() => {
    if (pendingMeasureFrame.value !== null) {
      cancelAnimationFrame(pendingMeasureFrame.value);
    }
    pendingMeasureFrame.value = requestAnimationFrame(() => {
      pendingMeasureFrame.value = null;
      connectionUpdateKey.value++;
    });
  });
}

watch(
  () => props.connections,
  () => {
    scheduleConnectionMeasurement();
  },
  { deep: true }
);

watch(
  () => groupedTimelineItems.value,
  () => {
    scheduleConnectionMeasurement();
  },
  { deep: true }
);

onMounted(() => {
  scheduleConnectionMeasurement();
  window.addEventListener('resize', scheduleConnectionMeasurement, { passive: true });

  // 监听容器滚动事件，确保滚动后重新测量连线位置
  if (containerRef.value) {
    containerRef.value.addEventListener('scroll', scheduleConnectionMeasurement, { passive: true });
  }
});

onBeforeUnmount(() => {
  if (pendingMeasureFrame.value !== null) {
    cancelAnimationFrame(pendingMeasureFrame.value);
  }
  window.removeEventListener('resize', scheduleConnectionMeasurement);

  if (containerRef.value) {
    containerRef.value.removeEventListener('scroll', scheduleConnectionMeasurement);
  }
});
</script>

<style scoped>
.timeline-view {
  width: 100%;
  height: 100%;
  padding: 0;
  overflow: hidden;
  display: block;
  background: var(--q-dark, #1d1d1d);
  position: relative;
  cursor: grab;
  user-select: none;
}

.timeline-view:active {
  cursor: grabbing;
}

/* 内容容器 */
.timeline-view__content {
  padding: 24px 16px;
  transition: transform 0.1s ease-out;
  will-change: transform;
}

/* 美化滚动条 */
.timeline-view::-webkit-scrollbar {
  height: 8px;
}

.timeline-view::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

.timeline-view::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}

.timeline-view::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

.timeline-view__timeline {
  min-width: max-content;
  height: 100%;
  display: inline-flex;
  align-items: center;
  position: relative;
}

/* 连接线层 */
.timeline-view__connections {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
  overflow: visible;
}

/* 连接线标签样式 */
.timeline-view__connection-label {
  pointer-events: none;
  user-select: none;
  paint-order: stroke fill;
  stroke: rgba(0, 0, 0, 0.8);
  stroke-width: 3px;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.timeline-view__time {
  font-size: 14px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.87);
}

/* 卡片组容器 - 垂直排列 */
.timeline-view__card-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 260px;
  pointer-events: auto;
}

.timeline-view__card {
  box-shadow: 0 2px 6px rgba(15, 40, 77, 0.08);
  border-radius: 4px;
  padding: 10px 10px 10px 22px;
  background-color: rgba(255, 255, 255, 0.05);
  width: 100%;
  min-width: 150px;
  box-sizing: border-box;
  transition: box-shadow 0.18s ease, background-color 0.18s ease;
  position: relative;
  cursor: pointer;
  user-select: text;
}

.timeline-view__card:hover {
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
  background-color: rgba(255, 255, 255, 0.08);
}

.timeline-view__card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.timeline-view__card-title {
  font-size: 1.5em;
  font-weight: 700;
  margin: 0;
  color: inherit;
  flex: 1;
}

/* date display in card */
.timeline-view__card-date {
  font-size: 0.9em;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 5px;
}

/* left white stripe like editor node */
.timeline-view__card::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 4px;
  bottom: 4px;
  width: 4px;
  background: #ffffff;
  border-radius: 2px;
}

.timeline-view__card-description {
  font-size: 0.85em;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.85);
  margin: 6px 0 0;
  max-height: 4.5em;
  overflow: hidden;
  text-overflow: ellipsis;
}

.timeline-view__card-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
}

.timeline-view__meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.timeline-view__extra {
  width: 36px;
  height: 36px;
  border-radius: 18px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  color: #1f1f1f;
  margin: 0 auto;
}

/* status tag in timeline: transparent background with colored border/text */
.timeline-status-tag {
  border: 0;
  padding: 4px 8px;
  border-radius: 4px;
  background: #ffffff !important;
  box-shadow: none !important;
  font-weight: 700;
  font-size: 12px;
}

.timeline-view__empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 14px;
}

@media (max-width: 1024px) {
  .timeline-view__timeline {
    min-width: 520px;
  }

  .timeline-view__card-wrapper {
    min-width: 220px;
  }
}
</style>



