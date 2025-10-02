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
      :style="{
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        transformOrigin: 'left top'
      }"
    >
      <d-timeline direction="horizontal" class="timeline-view__timeline">
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
    </div>
  </section>
  <div v-else class="timeline-view__empty">
    <span>暂无可展示的事件</span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive } from 'vue';

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

const props = defineProps<{ events: TimelineViewEvent[] }>();

// 缩放和拖拽状态
const containerRef = ref<HTMLElement | null>(null);
const zoom = ref(1);
const pan = reactive({ x: 0, y: 0 });
const isDragging = ref(false);
const dragStart = reactive({ x: 0, y: 0 });

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
}

function handleMouseUp() {
  isDragging.value = false;
  if (containerRef.value) {
    containerRef.value.style.cursor = 'grab';
  }
}

// 双击重置视图
function resetView() {
  zoom.value = 1;
  pan.x = 0;
  pan.y = 0;
}

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



