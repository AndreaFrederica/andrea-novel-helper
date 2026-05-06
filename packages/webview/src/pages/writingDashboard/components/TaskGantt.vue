<template>
  <div class="gantt-app">
    <!-- 顶部工具栏 -->
    <header class="gantt-header">
      <q-btn-dropdown dense flat :label="layoutLabel" class="view-btn">
        <q-list dense>
          <q-item v-close-popup clickable @click="setLayout('gantt')">
            <q-item-section>甘特图（横向）</q-item-section>
          </q-item>
          <q-item v-close-popup clickable @click="setLayout('timeline')">
            <q-item-section>时间线（纵向）</q-item-section>
          </q-item>
          <q-item v-close-popup clickable @click="setLayout('calendar')">
            <q-item-section>日历（月视图）</q-item-section>
          </q-item>
        </q-list>
      </q-btn-dropdown>
      <div class="sep" />
      <span class="filter-label">任务筛选</span>
      <q-input
        v-model="searchQuery"
        dense
        outlined
        placeholder="搜索任务名称…"
        class="search-input"
        clearable
      >
        <template #prepend><q-icon name="search" size="16px" /></template>
      </q-input>
      <q-input
        dense outlined readonly
        :model-value="dateInputLabel"
        class="date-input"
        :style="dateInputStyle"
      >
        <template #append>
          <q-icon name="event" size="16px" class="date-picker-icon" />
        </template>
        <q-popup-proxy cover transition-show="scale" transition-hide="scale">
          <q-date
            v-model="datePickerValue"
            minimal
            mask="YYYY/MM/DD"
          />
        </q-popup-proxy>
      </q-input>
      <q-btn dense flat icon="chevron_left" @click="navPrev" />
      <q-btn dense flat class="today-btn" label="今天" @click="navToday" />
      <q-btn dense flat icon="chevron_right" @click="navNext" />
      <q-btn dense flat icon="add" class="add-btn" @click="addTask" />
      <q-btn dense flat icon="settings" @click="settingsOpen = true" />
    </header>

    <!-- ========== 横向甘特图 ========== -->
    <template v-if="settings.layout === 'gantt'">
      <div class="gantt-body">
        <!-- 左侧树形列表 -->
        <aside class="task-tree">
          <div class="tree-head">
            <q-icon name="expand_more" size="16px" />
            <span>项目分类</span>
          </div>
          <div class="tree-scroll">
            <div
              v-for="group in visibleGroups"
              :key="group.name"
              class="tree-group"
            >
              <div class="group-title" @click="toggleGroup(group.name)">
                <q-icon
                  :name="expandedGroups.has(group.name) ? 'expand_more' : 'chevron_right'"
                  size="16px"
                />
                <span>{{ group.name }}</span>
              </div>
              <div v-if="expandedGroups.has(group.name)" class="group-tasks">
                <div
                  v-for="task in group.tasks"
                  :key="task.id"
                  class="tree-task"
                  :class="{ active: selectedId === task.id }"
                  @click="openEditor(task)"
                >
                  <q-checkbox
                    dense
                    :model-value="task.status === 'done'"
                    @update:model-value="toggleStatus(task.id)"
                    @click.stop
                  />
                  <span class="task-label">{{ task.title }}</span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <!-- 右侧时间轴 -->
        <main
          class="timeline-wrap"
          ref="timelineRef"
          @scroll="onHorizontalTimelineScroll"
        >
          <div class="timeline-inner" :style="timelineInnerStyle">
            <!-- 刻度头部 -->
            <div class="tick-header">
              <div
                v-for="tick in ticks"
                :key="tick.timestamp"
                :class="['tick-col', { now: tick.isNow, special: tick.isSpecial }]"
                :style="horizontalTickStyle(tick)"
              >
                <div class="tick-main">{{ tick.label }}</div>
                <div v-if="tick.subLabel" class="tick-sub">{{ tick.subLabel }}</div>
              </div>
            </div>

            <!-- 网格与任务条 -->
            <div class="timeline-rows">
              <div
                v-for="group in visibleGroups"
                :key="group.name"
                class="group-block"
              >
                <div class="row-spacer" />
                <div v-if="expandedGroups.has(group.name)" class="task-rows">
                  <div
                    v-for="task in group.tasks"
                    :key="task.id"
                    class="task-row"
                    :class="{ active: selectedId === task.id }"
                    @click="openEditor(task)"
                  >
                    <div class="row-grid">
                      <span
                        v-for="tick in ticks"
                        :key="tick.timestamp"
                        :class="['grid-cell', { now: tick.isNow, special: tick.isSpecial }]"
                        :style="horizontalTickStyle(tick)"
                      />
                    </div>
                    <div
                      v-if="barVisible(task)"
                      class="task-bar"
                      :style="barStyle(task)"
                      @pointerdown.stop="startDrag($event, task)"
                      @click.stop="onTaskBarClick(task)"
                    >
                      <span
                        class="task-resize-handle start"
                        @pointerdown.stop="startHorizontalResize($event, task, 'start')"
                      />
                      <span class="task-bar-label">{{ task.title }}</span>
                      <span
                        class="task-resize-handle end"
                        @pointerdown.stop="startHorizontalResize($event, task, 'end')"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </template>

    <!-- ========== 纵向甘特图 ========== -->
    <template v-else-if="settings.layout === 'timeline'">
      <div class="vg-layout">
        <!-- 顶部：任务名行 -->
        <div class="vg-header-row">
          <div class="vg-corner">时间 \ 任务</div>
          <div class="vg-headers">
            <div
              v-for="task in timelineTasks"
              :key="task.id"
              class="vg-col-header"
              :class="{ active: selectedId === task.id }"
              :style="{ width: `${vgColWidth}px` }"
              @click="openEditor(task)"
            >
              <q-checkbox
                dense
                :model-value="task.status === 'done'"
                @update:model-value="toggleStatus(task.id)"
                @click.stop
              />
              <span class="vg-title" :title="task.title">{{ task.title }}</span>
            </div>
          </div>
        </div>

        <!-- 主体：时间轴 + 纵向任务条 -->
        <div
          class="vg-body"
          ref="vgBodyRef"
          @scroll="onVerticalTimelineScroll"
        >
          <div class="vg-time-axis" :style="vgAxisStyle">
            <div
              v-for="tick in ticks"
              :key="tick.timestamp"
              :class="['vg-tick', { now: tick.isNow, special: tick.isSpecial }]"
              :style="verticalTickStyle(tick)"
            >
              <span class="vg-tick-label">{{ tick.label }}</span>
              <span v-if="tick.subLabel" class="vg-tick-sub">{{ tick.subLabel }}</span>
            </div>
          </div>
          <div class="vg-bars-area" :style="vgBarsAreaStyle">
            <div class="vg-grid-bg">
              <div
                v-for="(_t, i) in ticks"
                :key="ticks[i]?.timestamp"
                :class="['vg-grid-row', { now: ticks[i]?.isNow, special: ticks[i]?.isSpecial }]"
                :style="ticks[i] ? verticalTickStyle(ticks[i]) : undefined"
              />
            </div>
            <div class="vg-cols">
              <div
                v-for="task in timelineTasks"
                :key="task.id"
                class="vg-task-col"
                :class="{ active: selectedId === task.id }"
                :style="{ width: `${vgColWidth}px` }"
                @click="openEditor(task)"
              >
                <div
                  v-if="vgBarVisible(task)"
                  :class="vgBarClass(task)"
                  :style="vgBarStyle(task)"
                  @pointerdown.stop="startVerticalDrag($event, task)"
                  @click.stop="onTaskBarClick(task)"
                >
                  <span
                    class="vg-resize-handle start"
                    @pointerdown.stop="startVerticalResize($event, task, 'start')"
                  />
                  <div class="vg-progress-fill" :style="vgProgressStyle(task)" />
                  <div class="vg-bar-content">
                    <div class="vg-bar-top">
                      <span class="vg-bar-title" :title="task.title">{{ task.title }}</span>
                      <span class="vg-progress-pill">{{ task.progress }}%</span>
                    </div>
                    <div class="vg-bar-meta">
                      <span :class="['vg-status', task.status]">{{ taskStatusLabel(task.status) }}</span>
                      <span>{{ taskPriorityLabel(task.priority) }}</span>
                    </div>
                    <div class="vg-bar-date">{{ taskDateRange(task) }}</div>
                    <div v-if="task.subtasks.length || task.tags.length" class="vg-bar-foot">
                      <span v-if="task.subtasks.length">{{ completedSubtasks(task) }}/{{ task.subtasks.length }}</span>
                      <span v-if="task.tags.length" class="vg-tag">{{ task.tags[0] }}</span>
                    </div>
                  </div>
                  <span
                    class="vg-resize-handle end"
                    @pointerdown.stop="startVerticalResize($event, task, 'end')"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ========== 月历视图 ========== -->
    <template v-else-if="settings.layout === 'calendar'">
      <div class="calendar-layout" @wheel="onCalendarWheel">
        <div class="calendar-weekdays">
          <div v-for="wd in weekDays" :key="wd" class="calendar-wd">{{ wd }}</div>
        </div>
        <div class="calendar-grid">
          <div
            :class="['calendar-track', { animating: calendarAnimating }]"
            :style="calendarTrackStyle"
          >
            <div v-for="week in continuousCalendarWeeks" :key="week.key" class="calendar-week-row">
              <div class="calendar-cells">
                <div
                  v-for="day in week.days"
                  :key="day.timestamp"
                  :class="['calendar-cell', {
                    'other-month': !day.isCurrentMonth,
                    'is-today': day.isToday
                  }]"
                >
                  <div class="calendar-date">
                    <span :class="['date-num', { today: day.isToday }]">{{ day.date.getDate() }}</span>
                  </div>
                </div>
              </div>
              <div class="calendar-week-tasks">
                <div
                  v-for="segment in week.segments"
                  :key="segment.id"
                  :class="calendarSegmentClass(segment)"
                  :style="calendarSegmentStyle(segment)"
                  @click.stop="openEditor(segment.task)"
                >
                  <span class="ct-title">{{ segment.task.title }}</span>
                </div>
                <div
                  v-if="week.hiddenCount > 0"
                  class="calendar-more"
                  :style="calendarMoreStyle"
                >
                  +{{ week.hiddenCount }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ========== 设置面板 ========== -->
    <WindowModal
      v-model="settingsOpen"
      v-bind="settingsModalProps"
    >
      <div class="gantt-settings-body">
        <q-select
          v-model="settings.timeUnit"
          outlined
          dense
          label="时间单位"
          :options="timeUnitOptions"
          emit-value
          map-options
          @update:model-value="onUnitChange"
        />
        <q-select
          v-model="settings.calendar"
          outlined
          dense
          label="纪年法"
          :options="calendarOptions"
          emit-value
          map-options
        />
        <q-select
          v-model="settings.layout"
          outlined
          dense
          label="布局方向"
          :options="layoutOptions"
          emit-value
          map-options
        />
        <q-item tag="label" dense class="q-px-none">
          <q-item-section>
            <q-item-label>当前时间轴中心</q-item-label>
            <q-item-label caption>{{ ts.formatFull(centerTimestamp) }}</q-item-label>
          </q-item-section>
        </q-item>
      </div>
      <template #footer>
        <q-btn flat label="恢复默认" color="grey" @click="resetSettings" />
        <q-btn flat label="关闭" color="primary" @click="settingsOpen = false" />
      </template>
    </WindowModal>

    <!-- 任务编辑器 -->
    <TaskEditor
      v-model="editorOpen"
      :task="editingTask"
      :window-id="windowId"
      @save="onSaveTask"
      @remove="onRemoveTask"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { Task } from '../sampleData'
import {
  type CalendarSystem,
  type GanttLayout,
  type TimeTick,
  type TimeUnit,
  getColWidth,
  getNavStep,
  getTimeSystem,
} from '../timeSystem'
import TaskEditor from './TaskEditor.vue'
import WindowModal from './WindowModal.vue'

/* ── Props & Emits ───────────────────────── */
const props = defineProps<{ tasks: Task[]; windowId?: string }>()
const emit = defineEmits<{ 'update:tasks': [tasks: Task[]] }>()

const settingsModalProps = computed(() => {
  const base: Record<string, unknown> = {
    title: '甘特图设置',
    width: 340,
    modalId: `${props.windowId ?? 'standalone'}-gantt-settings`,
    persistent: true,
  }
  if (props.windowId) base.ownerId = props.windowId
  return base
})

/* ── 设置状态（持久化到 localStorage 方便用户偏好）── */
interface GanttSettings {
  timeUnit: TimeUnit
  calendar: CalendarSystem
  layout: GanttLayout
}

const defaultSettings: GanttSettings = {
  timeUnit: 'day',
  calendar: 'gregorian',
  layout: 'gantt',
}

function loadSettings(): GanttSettings {
  try {
    const raw = localStorage.getItem('anh-gantt-settings')
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...defaultSettings }
}

const settings = reactive<GanttSettings>(loadSettings())
const settingsOpen = ref(false)

watch(settings, (s) => {
  localStorage.setItem('anh-gantt-settings', JSON.stringify(s))
}, { deep: true })

function resetSettings() {
  Object.assign(settings, defaultSettings)
}

function setLayout(l: GanttLayout) {
  settings.layout = l
  requestTimelineCenter()
}

function onUnitChange() {
  // 切换时间单位时，重新以当前中心点对齐到该粒度的起点
  centerTimestamp.value = ts.value.startOf(centerTimestamp.value, settings.timeUnit)
  requestTimelineCenter()
}

/* ── 时间系统 ────────────────────────────── */
const ts = computed(() => getTimeSystem(settings.calendar))

/* ── 视图状态 ────────────────────────────── */
const searchQuery = ref('')
const selectedId = ref('')
const expandedGroups = ref(new Set<string>())
const centerTimestamp = ref(Date.now())
const editorOpen = ref(false)
const editingTask = ref<Task | null>(null)
const recentDraggedTaskId = ref<string | null>(null)
const timelineRef = ref<HTMLElement | null>(null)
const vgBodyRef = ref<HTMLElement | null>(null)
const timelineViewportWidth = ref(0)
const vgViewportHeight = ref(0)
const timelineScrollLeft = ref(0)
const vgScrollTop = ref(0)
const axisCenterTimestamp = ref(Date.now())

const colWidth = computed(() => getColWidth(settings.timeUnit))
const vgColWidth = 132
const vgRowHeight = 36
let timelineCenterPending = true
let timelineResizeObserver: ResizeObserver | undefined
let vgResizeObserver: ResizeObserver | undefined
const VIRTUAL_TICK_COUNT = 400_000
const VIRTUAL_CENTER_INDEX = Math.floor(VIRTUAL_TICK_COUNT / 2)
const VIRTUAL_RENDER_BUFFER = 16

/* ── 刻度计算 ────────────────────────────── */
const visibleTickCount = computed(() => {
  const horizontalVisible = Math.ceil(timelineViewportWidth.value / colWidth.value)
  const verticalVisible = Math.ceil(vgViewportHeight.value / vgRowHeight)
  return Math.max(1, horizontalVisible, verticalVisible)
})

const visibleAxisStartIndex = computed(() => {
  const axis = settings.layout === 'timeline' ? 'y' : 'x'
  const offset = axis === 'x' ? timelineScrollLeft.value : vgScrollTop.value
  const unitPx = getTimelineUnitPixels(axis)
  return clampNumber(Math.floor(offset / unitPx) - VIRTUAL_RENDER_BUFFER, 0, VIRTUAL_TICK_COUNT - 1)
})

const visibleAxisEndIndex = computed(() => {
  return clampNumber(
    visibleAxisStartIndex.value + visibleTickCount.value + VIRTUAL_RENDER_BUFFER * 2,
    visibleAxisStartIndex.value,
    VIRTUAL_TICK_COUNT - 1
  )
})

type VisibleTimeTick = TimeTick & { index: number; offset: number }

const ticks = computed((): VisibleTimeTick[] => {
  const result: VisibleTimeTick[] = []
  for (let index = visibleAxisStartIndex.value; index <= visibleAxisEndIndex.value; index += 1) {
    const timestamp = indexToTimestamp(index)
    result.push({
      ...createTimeTick(timestamp),
      index,
      offset: index,
    })
  }
  return result
})

const timelineInnerStyle = computed(() => ({
  width: `${Math.max(VIRTUAL_TICK_COUNT * colWidth.value, timelineViewportWidth.value)}px`
}))

const vgBarsAreaStyle = computed(() => ({
  width: `${timelineTasks.value.length * vgColWidth}px`,
  height: `${VIRTUAL_TICK_COUNT * vgRowHeight}px`,
  minHeight: `${Math.max(VIRTUAL_TICK_COUNT * vgRowHeight, vgViewportHeight.value)}px`
}))

const vgAxisStyle = computed(() => ({
  height: `${VIRTUAL_TICK_COUNT * vgRowHeight}px`,
  minHeight: `${Math.max(VIRTUAL_TICK_COUNT * vgRowHeight, vgViewportHeight.value)}px`
}))

onMounted(() => {
  timelineResizeObserver = new ResizeObserver(() => updateTimelineViewport())
  vgResizeObserver = new ResizeObserver(() => updateTimelineViewport())
  if (timelineRef.value) timelineResizeObserver.observe(timelineRef.value)
  if (vgBodyRef.value) vgResizeObserver.observe(vgBodyRef.value)
  void nextTick(() => {
    updateTimelineViewport()
    centerTimelineViewportIfNeeded()
  })
})

onBeforeUnmount(() => {
  timelineResizeObserver?.disconnect()
  vgResizeObserver?.disconnect()
})

watch(() => settings.layout, () => {
  requestTimelineCenter()
})

watch(() => settings.timeUnit, () => {
  requestTimelineCenter()
})

function updateTimelineViewport() {
  if (timelineRef.value) timelineResizeObserver?.observe(timelineRef.value)
  if (vgBodyRef.value) vgResizeObserver?.observe(vgBodyRef.value)
  timelineViewportWidth.value = timelineRef.value?.clientWidth ?? 0
  vgViewportHeight.value = vgBodyRef.value?.clientHeight ?? 0
  if (timelineCenterPending) void nextTick(centerTimelineViewportIfNeeded)
}

function requestTimelineCenter() {
  timelineCenterPending = true
  void nextTick(() => {
    updateTimelineViewport()
    centerTimelineViewportIfNeeded()
  })
}

function centerTimelineViewportIfNeeded() {
  if (!timelineCenterPending) return
  const target = settings.layout === 'gantt' ? timelineRef.value : settings.layout === 'timeline' ? vgBodyRef.value : null
  if (!target) return
  timelineCenterPending = false
  axisCenterTimestamp.value = centerTimestamp.value
  if (settings.layout === 'gantt') {
    target.scrollLeft = centeredScrollOffset(target, 'x')
    timelineScrollLeft.value = target.scrollLeft
  } else if (settings.layout === 'timeline') {
    target.scrollTop = centeredScrollOffset(target, 'y')
    vgScrollTop.value = target.scrollTop
  }
  updateCenterTimestampFromScroll()
}

/* ── 分组 ────────────────────────────────── */
const groups = computed(() => {
  const map = new Map<string, Task[]>()
  for (const task of props.tasks) {
    const list = map.get(task.group) || []
    list.push(task)
    map.set(task.group, list)
  }
  return Array.from(map.entries()).map(([name, tasks]) => ({ name, tasks }))
})

const visibleGroups = computed(() => {
  if (!searchQuery.value.trim()) return groups.value
  const q = searchQuery.value.trim().toLowerCase()
  return groups.value.map(g => ({
    name: g.name,
    tasks: g.tasks.filter(t => t.title.toLowerCase().includes(q))
  })).filter(g => g.tasks.length > 0)
})

// 自动展开
watch(groups, (gs) => {
  for (const g of gs) expandedGroups.value.add(g.name)
}, { immediate: true })

function toggleGroup(name: string) {
  const s = new Set(expandedGroups.value)
  if (s.has(name)) s.delete(name)
  else s.add(name)
  expandedGroups.value = s
}

/* ── 操作 ────────────────────────────────── */
function openEditor(task: Task) {
  selectedId.value = task.id
  editingTask.value = task
  editorOpen.value = true
}

function toggleStatus(id: string) {
  emit('update:tasks', props.tasks.map(t =>
    t.id === id ? { ...t, status: t.status === 'done' ? 'todo' : 'done' } : t
  ))
}

function shiftView(dir: number) {
  const step = getNavStep(settings.timeUnit)
  centerTimestamp.value = ts.value.add(centerTimestamp.value, dir * step, settings.timeUnit)
  requestTimelineCenter()
}

function goToday() {
  centerTimestamp.value = ts.value.startOf(Date.now(), settings.timeUnit)
  requestTimelineCenter()
}

/* ── 统一导航（根据布局自动切换）───────────── */
const dateInputLabel = computed(() => {
  if (settings.layout === 'calendar') {
    return `${calendarYear.value}-${pad2(calendarMonth.value + 1)}`
  }
  const d = new Date(centerTimestamp.value)
  if (settings.timeUnit === 'year') return `${d.getFullYear()}`
  if (settings.timeUnit === 'month') return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
  return formatCompactDate(centerTimestamp.value)
})

const dateInputStyle = computed(() => ({
  '--date-input-width': `${Math.max(13, dateInputLabel.value.length + 7)}ch`
}))

const datePickerValue = computed({
  get() {
    if (settings.layout === 'calendar') {
      return formatQDate(new Date(calendarYear.value, calendarMonth.value, 1).getTime())
    }
    return formatQDate(centerTimestamp.value)
  },
  set(value: string) {
    const timestamp = parseQDate(value)
    if (timestamp === null) return
    if (settings.layout === 'calendar') {
      const d = new Date(timestamp)
      setCalendarMonth(d.getFullYear(), d.getMonth())
      return
    }
    centerTimestamp.value = ts.value.startOf(timestamp, settings.timeUnit)
    requestTimelineCenter()
  }
})

function navPrev() {
  if (settings.layout === 'calendar') prevMonth()
  else shiftView(-1)
}

function navNext() {
  if (settings.layout === 'calendar') nextMonth()
  else shiftView(1)
}

function navToday() {
  if (settings.layout === 'calendar') goThisMonth()
  else goToday()
}

function onHorizontalTimelineScroll(event: Event) {
  const el = event.currentTarget instanceof HTMLElement ? event.currentTarget : timelineRef.value
  if (!el) return
  timelineScrollLeft.value = el.scrollLeft
  updateCenterTimestampFromScroll()
}

function onVerticalTimelineScroll(event: Event) {
  const el = event.currentTarget instanceof HTMLElement ? event.currentTarget : vgBodyRef.value
  if (!el) return
  vgScrollTop.value = el.scrollTop
  updateCenterTimestampFromScroll()
}

function getTimelineUnitPixels(axis: 'x' | 'y') {
  return axis === 'x' ? colWidth.value : vgRowHeight
}

function updateCenterTimestampFromScroll() {
  if (settings.layout === 'calendar') return
  const axis = settings.layout === 'timeline' ? 'y' : 'x'
  const viewport = axis === 'x' ? timelineViewportWidth.value : vgViewportHeight.value
  const scrollOffset = axis === 'x' ? timelineScrollLeft.value : vgScrollTop.value
  const centerIndex = offsetToIndex(scrollOffset + viewport / 2, axis)
  centerTimestamp.value = indexToTimestamp(centerIndex)
}

function indexToTimestamp(index: number) {
  return ts.value.add(axisCenterTimestamp.value, index - VIRTUAL_CENTER_INDEX, settings.timeUnit)
}

function timestampToAxisIndex(timestamp: number) {
  return Math.round(timestampToAxisPosition(timestamp))
}

function timestampToAxisPosition(timestamp: number) {
  return clampNumber(
    VIRTUAL_CENTER_INDEX + (timestamp - axisCenterTimestamp.value) / unitDurationMs(settings.timeUnit),
    0,
    VIRTUAL_TICK_COUNT - 1
  )
}

function offsetTimestampByPixels(timestamp: number, deltaPx: number, axis: 'x' | 'y') {
  const unitPx = getTimelineUnitPixels(axis)
  if (unitPx <= 0) return timestamp
  return timestamp + (deltaPx / unitPx) * unitDurationMs(settings.timeUnit)
}

function indexToOffset(index: number, axis: 'x' | 'y') {
  return index * getTimelineUnitPixels(axis)
}

function offsetToIndex(offset: number, axis: 'x' | 'y') {
  return clampNumber(Math.round(offset / getTimelineUnitPixels(axis)), 0, VIRTUAL_TICK_COUNT - 1)
}

function centeredScrollOffset(target: HTMLElement, axis: 'x' | 'y') {
  const viewport = axis === 'x' ? target.clientWidth : target.clientHeight
  return Math.max(0, indexToOffset(VIRTUAL_CENTER_INDEX, axis) - viewport / 2)
}

function horizontalTickStyle(tick: VisibleTimeTick) {
  return {
    left: `${indexToOffset(tick.index, 'x')}px`,
    width: `${colWidth.value}px`,
  }
}

function verticalTickStyle(tick: VisibleTimeTick) {
  return {
    top: `${indexToOffset(tick.index, 'y')}px`,
    height: `${vgRowHeight}px`,
  }
}

function createTimeTick(timestamp: number): TimeTick {
  const d = new Date(timestamp)
  const weekday = d.getDay()
  const now = Date.now()
  let label = ts.value.format(timestamp, settings.timeUnit)
  let subLabel: string | undefined

  if (settings.timeUnit === 'month') {
    label = String(d.getFullYear())
    subLabel = `${d.getMonth() + 1}月`
  } else if (settings.timeUnit === 'week') {
    subLabel = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  } else if (settings.timeUnit === 'day') {
    subLabel = ['日', '一', '二', '三', '四', '五', '六'][weekday]
  } else if (settings.timeUnit === 'hour') {
    subLabel = `${d.getMonth() + 1}/${d.getDate()}`
  } else if (settings.timeUnit === 'minute') {
    subLabel = pad2(d.getSeconds())
  }

  return {
    timestamp,
    label,
    subLabel,
    isNow: isTimestampInCurrentUnit(timestamp, now),
    isSpecial: weekday === 0 || weekday === 6,
  }
}

function isTimestampInCurrentUnit(timestamp: number, now: number) {
  const unitStart = ts.value.startOf(timestamp, settings.timeUnit)
  const unitEnd = ts.value.add(unitStart, 1, settings.timeUnit)
  return now >= unitStart && now < unitEnd
}

function unitDurationMs(unit: TimeUnit) {
  const map: Record<TimeUnit, number> = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
  }
  return map[unit]
}

function tsFormat(tsv: number) {
  return getTimeSystem('gregorian').formatDate(tsv)
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function formatCompactDate(timestamp: number) {
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function formatQDate(timestamp: number) {
  const d = new Date(timestamp)
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`
}

function parseQDate(value: string): number | null {
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = new Date(year, month - 1, day).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

/* ── 任务条（横向布局）─────────────────────── */
function barVisible(task: Task) {
  const s = timestampToAxisPosition(Math.min(task.start, task.end))
  const e = timestampToAxisPosition(Math.max(task.start, task.end))
  return e >= 0 && s <= VIRTUAL_TICK_COUNT - 1
}

function barStyle(task: Task) {
  const s = timestampToAxisPosition(Math.min(task.start, task.end))
  const e = Math.max(s, timestampToAxisPosition(Math.max(task.start, task.end)))
  const left = s * colWidth.value + 2
  const width = Math.max(18, (e - s) * colWidth.value - 4)
  return {
    left: `${left}px`,
    width: `${width}px`,
    background: task.color
  }
}

function nearestTickIndex(timestamp: number): number {
  return timestampToAxisIndex(timestamp)
}

/* ── 纵向甘特图（timeline 布局）────────────── */
const timelineTasks = computed(() => {
  let list = props.tasks
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    list = list.filter(t => t.title.toLowerCase().includes(q))
  }
  return list
})

function vgBarVisible(task: Task) {
  const s = timestampToAxisPosition(Math.min(task.start, task.end))
  const e = timestampToAxisPosition(Math.max(task.start, task.end))
  return e >= 0 && s <= VIRTUAL_TICK_COUNT - 1
}

function vgBarStyle(task: Task) {
  const s = timestampToAxisPosition(Math.min(task.start, task.end))
  const e = Math.max(s, timestampToAxisPosition(Math.max(task.start, task.end)))
  const top = s * vgRowHeight + 2
  const height = Math.max(22, (e - s) * vgRowHeight - 4)
  return {
    top: `${top}px`,
    height: `${height}px`,
    '--task-color': task.color
  }
}

function vgBarClass(task: Task) {
  const rows = vgTaskRows(task)
  return [
    'vg-bar',
    `priority-${task.priority}`,
    `status-${task.status}`,
    {
      compact: rows <= 1,
      medium: rows === 2,
      tall: rows >= 3,
      done: task.status === 'done'
    }
  ]
}

function vgTaskRows(task: Task) {
  const s = timestampToAxisPosition(Math.min(task.start, task.end))
  const e = Math.max(s, timestampToAxisPosition(Math.max(task.start, task.end)))
  return Math.max(1, Math.ceil(e - s))
}

function vgProgressStyle(task: Task) {
  return {
    height: `${Math.min(100, Math.max(0, task.progress))}%`,
    background: task.color
  }
}

function taskStatusLabel(status: Task['status']) {
  if (status === 'done') return '完成'
  if (status === 'doing') return '进行中'
  return '待办'
}

function taskPriorityLabel(priority: Task['priority']) {
  if (priority === 'high') return '高'
  if (priority === 'medium') return '中'
  return '低'
}

function taskDateRange(task: Task) {
  return `${formatCompactDate(task.start).slice(5)} - ${formatCompactDate(task.end).slice(5)}`
}

function completedSubtasks(task: Task) {
  return task.subtasks.filter(item => item.done).length
}

function onTaskBarClick(task: Task) {
  if (recentDraggedTaskId.value === task.id) return
  openEditor(task)
}

function markTaskDragHandled(taskId: string) {
  recentDraggedTaskId.value = taskId
  window.setTimeout(() => {
    if (recentDraggedTaskId.value === taskId) recentDraggedTaskId.value = null
  }, 180)
}

function minTaskDurationMs() {
  return Math.max(1000, Math.min(60_000, unitDurationMs(settings.timeUnit) / 24))
}

function resizedTaskRange(task: Task, edge: 'start' | 'end', deltaPx: number, axis: 'x' | 'y') {
  const minDuration = minTaskDurationMs()
  if (edge === 'start') {
    const nextStart = Math.min(task.end - minDuration, offsetTimestampByPixels(task.start, deltaPx, axis))
    return { start: nextStart, end: task.end }
  }
  const nextEnd = Math.max(task.start + minDuration, offsetTimestampByPixels(task.end, deltaPx, axis))
  return { start: task.start, end: nextEnd }
}

function startDrag(event: PointerEvent, task: Task) {
  const el = event.currentTarget as HTMLElement
  const startX = event.clientX

  function onMove(e: PointerEvent) {
    el.style.transform = `translateX(${e.clientX - startX}px)`
  }

  function onUp(e: PointerEvent) {
    const delta = e.clientX - startX
    el.style.transform = ''

    const newStart = offsetTimestampByPixels(task.start, delta, 'x')
    const newEnd = offsetTimestampByPixels(task.end, delta, 'x')
    if (Math.abs(delta) > 1 && Number.isFinite(newStart) && Number.isFinite(newEnd)) {
      markTaskDragHandled(task.id)
      emit('update:tasks', props.tasks.map(t =>
        t.id === task.id ? { ...t, start: newStart, end: newEnd } : t
      ))
    }
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function startHorizontalResize(event: PointerEvent, task: Task, edge: 'start' | 'end') {
  const handle = event.currentTarget
  if (!(handle instanceof HTMLElement)) return
  const parent = handle.parentElement
  if (!(parent instanceof HTMLElement)) return
  const el = parent
  const startX = event.clientX
  const originalLeft = timestampToAxisPosition(Math.min(task.start, task.end)) * colWidth.value + 2
  const originalWidth = Math.max(18, (timestampToAxisPosition(Math.max(task.start, task.end)) - timestampToAxisPosition(Math.min(task.start, task.end))) * colWidth.value - 4)

  function onMove(e: PointerEvent) {
    const delta = e.clientX - startX
    if (edge === 'start') {
      const nextWidth = Math.max(18, originalWidth - delta)
      const nextLeft = originalLeft + originalWidth - nextWidth
      el.style.left = `${nextLeft}px`
      el.style.width = `${nextWidth}px`
    } else {
      el.style.width = `${Math.max(18, originalWidth + delta)}px`
    }
  }

  function onUp(e: PointerEvent) {
    const delta = e.clientX - startX
    el.style.left = ''
    el.style.width = ''

    const next = resizedTaskRange(task, edge, delta, 'x')
    if (Math.abs(delta) > 1 && Number.isFinite(next.start) && Number.isFinite(next.end)) {
      markTaskDragHandled(task.id)
      emit('update:tasks', props.tasks.map(t =>
        t.id === task.id ? { ...t, start: next.start, end: next.end } : t
      ))
    }
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function startVerticalDrag(event: PointerEvent, task: Task) {
  const el = event.currentTarget as HTMLElement
  const startY = event.clientY

  function onMove(e: PointerEvent) {
    el.style.transform = `translateY(${e.clientY - startY}px)`
  }

  function onUp(e: PointerEvent) {
    const delta = e.clientY - startY
    el.style.transform = ''

    const newStart = offsetTimestampByPixels(task.start, delta, 'y')
    const newEnd = offsetTimestampByPixels(task.end, delta, 'y')
    if (Math.abs(delta) > 1 && Number.isFinite(newStart) && Number.isFinite(newEnd)) {
      markTaskDragHandled(task.id)
      emit('update:tasks', props.tasks.map(t =>
        t.id === task.id ? { ...t, start: newStart, end: newEnd } : t
      ))
    }
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function startVerticalResize(event: PointerEvent, task: Task, edge: 'start' | 'end') {
  const handle = event.currentTarget
  if (!(handle instanceof HTMLElement)) return
  const parent = handle.parentElement
  if (!(parent instanceof HTMLElement)) return
  const el = parent
  const startY = event.clientY
  const originalTop = timestampToAxisPosition(Math.min(task.start, task.end)) * vgRowHeight + 2
  const originalHeight = Math.max(22, (timestampToAxisPosition(Math.max(task.start, task.end)) - timestampToAxisPosition(Math.min(task.start, task.end))) * vgRowHeight - 4)

  function onMove(e: PointerEvent) {
    const delta = e.clientY - startY
    if (edge === 'start') {
      const nextHeight = Math.max(22, originalHeight - delta)
      const nextTop = originalTop + originalHeight - nextHeight
      el.style.top = `${nextTop}px`
      el.style.height = `${nextHeight}px`
    } else {
      el.style.height = `${Math.max(22, originalHeight + delta)}px`
    }
  }

  function onUp(e: PointerEvent) {
    const delta = e.clientY - startY
    el.style.top = ''
    el.style.height = ''

    const next = resizedTaskRange(task, edge, delta, 'y')
    if (Math.abs(delta) > 1 && Number.isFinite(next.start) && Number.isFinite(next.end)) {
      markTaskDragHandled(task.id)
      emit('update:tasks', props.tasks.map(t =>
        t.id === task.id ? { ...t, start: next.start, end: next.end } : t
      ))
    }
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

/* ── 新建任务 ────────────────────────────── */
function addTask() {
  const group = props.tasks[0]?.group || '默认'
  const start = centerTimestamp.value
  const end = ts.value.add(start, 2, settings.timeUnit)
  const newTask: Task = {
    id: `t-${Date.now()}`,
    title: '新任务',
    description: '',
    status: 'todo',
    priority: 'medium',
    tags: [],
    group,
    start,
    end,
    progress: 0,
    color: '#d94a9b',
    subtasks: []
  }
  emit('update:tasks', [...props.tasks, newTask])
  openEditor(newTask)
}

function onSaveTask(task: Task) {
  emit('update:tasks', props.tasks.map(t => t.id === task.id ? task : t))
}

function onRemoveTask(id: string) {
  emit('update:tasks', props.tasks.filter(t => t.id !== id))
}

/* ── 日历视图 ────────────────────────────── */
const calendarYear = ref(2026)
const calendarMonth = ref(4) // 0-based, 4 = May
const weekDays = ['日', '一', '二', '三', '四', '五', '六']
const CALENDAR_VISIBLE_WEEKS = 6
const CALENDAR_MAX_LANES = 4
const CALENDAR_LANE_HEIGHT = 22
const CALENDAR_ANIMATION_MS = 220
const calendarTrackOffset = ref(0)
const calendarAnimating = ref(false)
let calendarAnimationTimer: number | undefined
let lastCalendarWheelAt = 0

interface CalendarDay {
  date: Date
  timestamp: number
  isCurrentMonth: boolean
  isToday: boolean
}

interface CalendarSegment {
  id: string
  task: Task
  colStart: number
  colSpan: number
  lane: number
  startsInWeek: boolean
  endsInWeek: boolean
}

interface CalendarWeek {
  key: string
  days: CalendarDay[]
  segments: CalendarSegment[]
  hiddenCount: number
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate()
}

function dayBounds(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  return {
    start,
    end: start + 24 * 60 * 60 * 1000 - 1
  }
}

function normalizedTaskRange(task: Task) {
  return {
    start: Math.min(task.start, task.end),
    end: Math.max(task.start, task.end)
  }
}

function taskOverlapsRange(task: Task, start: number, end: number): boolean {
  const range = normalizedTaskRange(task)
  return range.start <= end && range.end >= start
}

function calendarSegmentClass(segment: CalendarSegment) {
  return [
    'calendar-task',
    'calendar-segment',
    {
      active: selectedId.value === segment.task.id,
      done: segment.task.status === 'done',
      'starts-in-week': segment.startsInWeek,
      'ends-in-week': segment.endsInWeek,
    }
  ]
}

function calendarSegmentStyle(segment: CalendarSegment) {
  return {
    left: `calc(${(segment.colStart / 7) * 100}% + 3px)`,
    width: `calc(${(segment.colSpan / 7) * 100}% - 6px)`,
    top: `${segment.lane * CALENDAR_LANE_HEIGHT}px`,
    background: segment.task.color + '2a',
    borderLeft: `3px solid ${segment.task.color}`,
  }
}

const calendarMoreStyle = {
  top: `${CALENDAR_MAX_LANES * CALENDAR_LANE_HEIGHT}px`
}

const visibleCalendarTasks = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return props.tasks
    .filter(t => !q || t.title.toLowerCase().includes(q))
    .sort((a, b) => Math.min(a.start, a.end) - Math.min(b.start, b.end))
})

const continuousCalendarRange = computed(() => {
  const first = shiftMonth(calendarYear.value, calendarMonth.value, -1)
  const last = shiftMonth(calendarYear.value, calendarMonth.value, 1)
  return {
    start: startOfWeek(new Date(first.year, first.month, 1).getTime()),
    end: endOfWeek(new Date(last.year, last.month + 1, 0).getTime())
  }
})

const continuousCalendarDays = computed((): CalendarDay[] => {
  const range = continuousCalendarRange.value
  return buildCalendarDaysInRange(range.start, range.end, calendarYear.value, calendarMonth.value)
})

const continuousCalendarWeeks = computed((): CalendarWeek[] => buildCalendarWeeks(continuousCalendarDays.value))

const currentCalendarWeekOffset = computed(() => {
  return getCalendarMonthOffset(calendarYear.value, calendarMonth.value)
})

const calendarTrackStyle = computed(() => {
  const weekCount = Math.max(CALENDAR_VISIBLE_WEEKS, continuousCalendarWeeks.value.length)
  return {
    height: `${(weekCount / CALENDAR_VISIBLE_WEEKS) * 100}%`,
    gridTemplateRows: `repeat(${weekCount}, minmax(0, 1fr))`,
    transform: `translateY(${-(calendarTrackOffset.value / weekCount) * 100}%)`
  }
})

watch(
  () => [calendarYear.value, calendarMonth.value, continuousCalendarWeeks.value.length],
  () => {
    if (!calendarAnimating.value) syncCalendarTrackToCurrentMonth()
  },
  { immediate: true }
)

function buildCalendarDaysInRange(start: number, end: number, focusYear: number, focusMonth: number): CalendarDay[] {
  const now = new Date()
  const result: CalendarDay[] = []
  const cursor = new Date(startOfDay(start))
  const last = startOfDay(end)

  while (cursor.getTime() <= last) {
    const date = new Date(cursor)
    result.push({
      date,
      timestamp: date.getTime(),
      isCurrentMonth: date.getFullYear() === focusYear && date.getMonth() === focusMonth,
      isToday: isSameDay(date, now),
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  return result
}

function buildCalendarWeeks(daysSource: CalendarDay[]): CalendarWeek[] {
  const result: CalendarWeek[] = []
  for (let i = 0; i < daysSource.length; i += 7) {
    const days = daysSource.slice(i, i + 7)
    if (days.length !== 7 || !days[0] || !days[6]) continue
    const weekStart = dayBounds(days[0].date).start
    const weekEnd = dayBounds(days[6].date).end
    const allSegments = buildWeekSegments(days, weekStart, weekEnd)
    result.push({
      key: String(weekStart),
      days,
      segments: allSegments.filter(segment => segment.lane < CALENDAR_MAX_LANES),
      hiddenCount: allSegments.filter(segment => segment.lane >= CALENDAR_MAX_LANES).length
    })
  }
  return result
}

function buildWeekSegments(days: CalendarDay[], weekStart: number, weekEnd: number): CalendarSegment[] {
  const laneEnds: number[] = []
  const segments: CalendarSegment[] = []
  for (const task of visibleCalendarTasks.value) {
    if (!taskOverlapsRange(task, weekStart, weekEnd)) continue
    const range = normalizedTaskRange(task)
    const segmentStart = Math.max(startOfDay(range.start), weekStart)
    const segmentEnd = Math.min(startOfDay(range.end), startOfDay(weekEnd))
    const colStart = Math.max(0, Math.min(6, daysBetween(weekStart, segmentStart)))
    const colEnd = Math.max(colStart, Math.min(6, daysBetween(weekStart, segmentEnd)))
    const lane = findCalendarLane(laneEnds, colStart, colEnd)
    laneEnds[lane] = colEnd
    segments.push({
      id: `${task.id}-${weekStart}`,
      task,
      colStart,
      colSpan: colEnd - colStart + 1,
      lane,
      startsInWeek: range.start >= weekStart,
      endsInWeek: range.end <= weekEnd
    })
  }
  return segments
}

function findCalendarLane(laneEnds: number[], colStart: number, colEnd: number) {
  for (let i = 0; i < laneEnds.length; i += 1) {
    if ((laneEnds[i] ?? -1) < colStart) return i
  }
  laneEnds.push(colEnd)
  return laneEnds.length - 1
}

function startOfDay(timestamp: number) {
  const d = new Date(timestamp)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function startOfWeek(timestamp: number) {
  const d = new Date(startOfDay(timestamp))
  d.setDate(d.getDate() - d.getDay())
  return d.getTime()
}

function endOfWeek(timestamp: number) {
  return startOfWeek(timestamp) + 7 * 24 * 60 * 60 * 1000 - 1
}

function daysBetween(start: number, end: number) {
  return Math.round((startOfDay(end) - startOfDay(start)) / (24 * 60 * 60 * 1000))
}

function prevMonth() {
  animateCalendarMonth(-1)
}

function nextMonth() {
  animateCalendarMonth(1)
}

function goThisMonth() {
  const now = new Date()
  setCalendarMonth(now.getFullYear(), now.getMonth())
}

function onCalendarWheel(event: WheelEvent) {
  if (Math.abs(event.deltaY) < 12) return
  event.preventDefault()
  const now = Date.now()
  if (now - lastCalendarWheelAt < CALENDAR_ANIMATION_MS) return
  lastCalendarWheelAt = now
  if (event.deltaY > 0) nextMonth()
  else prevMonth()
}

function shiftMonth(year: number, month: number, delta: number) {
  const date = new Date(year, month + delta, 1)
  return {
    year: date.getFullYear(),
    month: date.getMonth()
  }
}

function setCalendarMonth(year: number, month: number) {
  if (calendarAnimationTimer !== undefined) {
    window.clearTimeout(calendarAnimationTimer)
    calendarAnimationTimer = undefined
  }
  calendarAnimating.value = false
  calendarYear.value = year
  calendarMonth.value = month
  syncCalendarTrackToCurrentMonth()
}

function animateCalendarMonth(delta: -1 | 1) {
  if (calendarAnimating.value) return
  const next = shiftMonth(calendarYear.value, calendarMonth.value, delta)
  const currentOffset = currentCalendarWeekOffset.value
  const targetOffset = getCalendarMonthOffset(next.year, next.month)
  calendarAnimating.value = true
  calendarTrackOffset.value = currentOffset
  window.requestAnimationFrame(() => {
    if (calendarAnimating.value) calendarTrackOffset.value = targetOffset
  })
  calendarAnimationTimer = window.setTimeout(() => {
    calendarAnimating.value = false
    calendarYear.value = next.year
    calendarMonth.value = next.month
    syncCalendarTrackToCurrentMonth()
    calendarAnimationTimer = undefined
  }, CALENDAR_ANIMATION_MS)
}

function getCalendarMonthOffset(year: number, month: number) {
  const rangeStart = continuousCalendarRange.value.start
  const monthStart = startOfWeek(new Date(year, month, 1).getTime())
  const maxOffset = Math.max(0, continuousCalendarWeeks.value.length - CALENDAR_VISIBLE_WEEKS)
  return clampNumber(Math.floor(daysBetween(rangeStart, monthStart) / 7), 0, maxOffset)
}

function syncCalendarTrackToCurrentMonth() {
  calendarTrackOffset.value = currentCalendarWeekOffset.value
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/* ── 选项常量 ────────────────────────────── */
const timeUnitOptions = [
  { label: '年', value: 'year' },
  { label: '月', value: 'month' },
  { label: '周', value: 'week' },
  { label: '日', value: 'day' },
  { label: '时', value: 'hour' },
  { label: '分', value: 'minute' },
  { label: '秒', value: 'second' },
]

const calendarOptions = [
  { label: '公历（公元）', value: 'gregorian' },
  { label: '农历（预留）', value: 'lunar' },
  { label: '自定义纪元（预留）', value: 'custom' },
]

const layoutOptions = [
  { label: '甘特图（横向）', value: 'gantt' },
  { label: '时间线（纵向）', value: 'timeline' },
  { label: '日历（月视图）', value: 'calendar' },
]

const layoutLabel = computed(() => {
  if (settings.layout === 'timeline') return '视图：时间线'
  if (settings.layout === 'calendar') return `视图：日历 · ${calendarYear.value}年${calendarMonth.value + 1}月`
  return `视图：甘特图 · ${timeUnitOptions.find(o => o.value === settings.timeUnit)?.label || ''}`
})
</script>

<style scoped>
.gantt-app {
  height: 100%;
  container: task-gantt / inline-size;
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 6px;
  overflow: hidden;
}

/* ── 顶部工具栏 ──────────────────────────── */
.gantt-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--dash-border-light);
  background: var(--dash-toolbar-bg);
  flex-shrink: 0;
}

.view-btn {
  font-weight: 700;
}

.sep {
  width: 1px;
  height: 16px;
  background: var(--dash-border-lighter);
}

.filter-label {
  font-size: 12px;
  color: var(--dash-text-secondary);
  white-space: nowrap;
}

.search-input {
  flex: 1 1 160px;
  min-width: 120px;
}

.date-input {
  flex: 0 0 auto;
  width: var(--date-input-width, 15ch);
  min-width: var(--date-input-width, 15ch);
  cursor: pointer;
}

.date-input :deep(.q-field__native) {
  overflow: visible;
  text-overflow: clip;
}

.date-picker-icon {
  color: var(--dash-text-secondary);
  cursor: pointer;
}

.today-btn {
  background: var(--dash-accent);
  color: #fff;
  border-radius: 4px;
  padding: 0 10px;
}

.add-btn {
  background: var(--dash-accent);
  color: #fff;
  border-radius: 4px;
}

/* ── 横向甘特图主体 ──────────────────────── */
.gantt-body {
  display: flex;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--dash-border-light);
  border-radius: 6px;
}

/* 左侧树形 */
.task-tree {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--dash-border-light);
  background: var(--dash-panel-bg);
}

.tree-head {
  height: 48px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  font-size: 13px;
  font-weight: 700;
  color: var(--dash-page-fg);
  border-bottom: 1px solid var(--dash-border-light);
  flex-shrink: 0;
}

.tree-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.tree-group {
  border-bottom: 1px solid var(--dash-border-lighter);
}

.group-title {
  height: 32px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--dash-page-fg);
  cursor: pointer;
  user-select: none;
}

.group-title:hover {
  background: var(--dash-border-lighter);
}

.tree-task {
  height: 36px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 28px;
  font-size: 12px;
  color: var(--dash-page-fg);
  cursor: pointer;
}

.tree-task:hover {
  background: var(--dash-border-lighter);
}

.tree-task.active {
  background: var(--dash-today-bg);
}

.task-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 右侧时间轴 */
.timeline-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--dash-window-bg);
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.timeline-wrap::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.timeline-inner {
  position: relative;
}

.tick-header {
  position: sticky;
  top: 0;
  z-index: 2;
  height: 48px;
  background: var(--dash-panel-bg);
  border-bottom: 1px solid var(--dash-border-light);
}

.tick-col {
  position: absolute;
  top: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-right: 1px solid var(--dash-border-lighter);
  font-size: 11px;
  color: var(--dash-text-secondary);
}

.tick-col.now {
  background: var(--dash-accent);
  color: #fff;
}

.tick-col.special {
  background: var(--dash-panel-bg2);
}

.tick-main {
  font-weight: 700;
}

.tick-sub {
  font-size: 10px;
}

/* 时间轴行 */
.timeline-rows {
  position: relative;
}

.group-block {
  border-bottom: 1px solid var(--dash-border-lighter);
}

.row-spacer {
  height: 32px;
  background: var(--dash-panel-bg);
}

.task-row {
  position: relative;
  height: 36px;
  cursor: pointer;
}

.task-row.active {
  background: var(--dash-today-bg);
}

.row-grid {
  position: absolute;
  inset: 0;
}

.grid-cell {
  position: absolute;
  top: 0;
  height: 100%;
  border-right: 1px solid var(--dash-border-lighter);
}

.grid-cell.now {
  background: rgba(195, 63, 150, 0.06);
}

.grid-cell.special {
  background: var(--dash-panel-bg2);
}

/* 任务条 */
.task-bar {
  position: absolute;
  top: 6px;
  height: 24px;
  border-radius: 4px;
  color: #fff;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  cursor: grab;
  z-index: 1;
}

.task-bar-label {
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

.task-resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 10px;
  z-index: 2;
  cursor: ew-resize;
}

.task-resize-handle.start {
  left: 0;
}

.task-resize-handle.end {
  right: 0;
}

.task-resize-handle::after {
  content: '';
  position: absolute;
  top: 5px;
  bottom: 5px;
  width: 2px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  opacity: 0;
}

.task-bar:hover .task-resize-handle::after {
  opacity: 1;
}

.task-resize-handle.start::after {
  left: 3px;
}

.task-resize-handle.end::after {
  right: 3px;
}

/* ── 纵向甘特图 ──────────────────────────── */
.vg-layout {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto 1fr;
  border: 1px solid var(--dash-border-light);
  border-radius: 6px;
  background: var(--dash-window-bg);
}

.vg-header-row {
  display: flex;
  border-bottom: 1px solid var(--dash-border-light);
  background: var(--dash-panel-bg);
  flex-shrink: 0;
  overflow: hidden;
}

.vg-corner {
  width: 90px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--dash-text-secondary);
  border-right: 1px solid var(--dash-border-light);
}

.vg-headers {
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  display: flex;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.vg-headers::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.vg-col-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 6px;
  border-right: 1px solid var(--dash-border-lighter);
  cursor: pointer;
  font-size: 12px;
  color: var(--dash-page-fg);
}

.vg-col-header:hover {
  background: var(--dash-border-lighter);
}

.vg-col-header.active {
  background: var(--dash-today-bg);
}

.vg-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.vg-body {
  display: flex;
  min-height: 0;
  overflow: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.vg-body::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.vg-time-axis {
  position: relative;
  width: 90px;
  flex-shrink: 0;
  background: var(--dash-panel-bg);
  border-right: 1px solid var(--dash-border-light);
}

.vg-tick {
  position: absolute;
  left: 0;
  right: 0;
  height: 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid var(--dash-border-lighter);
  font-size: 11px;
  color: var(--dash-text-secondary);
}

.vg-tick.now {
  background: var(--dash-accent);
  color: #fff;
}

.vg-tick.special {
  background: var(--dash-panel-bg2);
}

.vg-tick-label {
  font-weight: 700;
}

.vg-tick-sub {
  font-size: 10px;
}

.vg-bars-area {
  flex: 1;
  position: relative;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.vg-bars-area::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.vg-grid-bg {
  position: absolute;
  inset: 0;
}

.vg-grid-row {
  position: absolute;
  left: 0;
  right: 0;
  height: 36px;
  border-bottom: 1px solid var(--dash-border-lighter);
}

.vg-grid-row.now {
  background: rgba(195, 63, 150, 0.06);
}

.vg-grid-row.special {
  background: var(--dash-panel-bg2);
}

.vg-cols {
  position: relative;
  display: flex;
  height: 100%;
  z-index: 1;
}

.vg-task-col {
  flex-shrink: 0;
  border-right: 1px solid var(--dash-border-lighter);
  position: relative;
  cursor: pointer;
}

.vg-task-col:hover {
  background: rgba(0, 0, 0, 0.02);
}

.vg-task-col.active {
  background: var(--dash-today-bg);
}

.vg-bar {
  position: absolute;
  left: 8px;
  right: 8px;
  border-radius: 7px;
  color: var(--dash-page-fg);
  display: flex;
  align-items: stretch;
  font-size: 11px;
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--task-color) 18%, var(--dash-window-bg)),
      color-mix(in srgb, var(--task-color) 9%, var(--dash-window-bg))
    );
  border: 1px solid color-mix(in srgb, var(--task-color) 48%, var(--dash-border-light));
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
  overflow: hidden;
  cursor: pointer;
}

.vg-resize-handle {
  position: absolute;
  left: 0;
  right: 0;
  height: 10px;
  z-index: 3;
  cursor: ns-resize;
}

.vg-resize-handle.start {
  top: 0;
}

.vg-resize-handle.end {
  bottom: 0;
}

.vg-resize-handle::after {
  content: '';
  position: absolute;
  left: 22px;
  right: 22px;
  height: 2px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--task-color) 68%, #fff);
  opacity: 0;
}

.vg-resize-handle.start::after {
  top: 3px;
}

.vg-resize-handle.end::after {
  bottom: 3px;
}

.vg-bar:hover .vg-resize-handle::after {
  opacity: 1;
}

.vg-bar::before {
  content: '';
  width: 4px;
  flex-shrink: 0;
  background: var(--task-color);
}

.vg-bar.done {
  opacity: 0.72;
}

.vg-progress-fill {
  position: absolute;
  left: 4px;
  right: 0;
  bottom: 0;
  opacity: 0.12;
  pointer-events: none;
}

.vg-bar-content {
  position: relative;
  z-index: 1;
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 7px 7px 6px;
}

.vg-bar-top {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.vg-bar-title {
  min-width: 0;
  flex: 1;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vg-progress-pill {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 999px;
  color: #fff;
  background: color-mix(in srgb, var(--task-color) 78%, #111);
  font-size: 10px;
  font-weight: 700;
}

.vg-bar-meta,
.vg-bar-date,
.vg-bar-foot {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--dash-text-secondary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.vg-status {
  color: var(--dash-page-fg);
  font-weight: 700;
}

.vg-status.done {
  color: var(--dash-text-secondary);
}

.vg-status.doing {
  color: var(--task-color);
}

.vg-tag {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vg-bar.compact {
  border-radius: 5px;
}

.vg-bar.compact .vg-bar-content {
  padding: 4px 6px;
  justify-content: center;
}

.vg-bar.compact .vg-bar-meta,
.vg-bar.compact .vg-bar-date,
.vg-bar.compact .vg-bar-foot,
.vg-bar.medium .vg-bar-date,
.vg-bar.medium .vg-bar-foot {
  display: none;
}

.vg-bar.medium .vg-bar-content {
  justify-content: center;
}

/* ── 月历视图 ────────────────────────────── */
.calendar-layout {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--dash-border-light);
  border-radius: 6px;
  background: var(--dash-window-bg);
}

.calendar-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  border-bottom: 1px solid var(--dash-border-light);
  flex-shrink: 0;
}

.calendar-wd {
  padding: 8px 4px;
  text-align: center;
  font-size: 12px;
  font-weight: 700;
  color: var(--dash-text-secondary);
}

.calendar-grid {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 14px,
    #000 calc(100% - 14px),
    transparent 100%
  );
}

.calendar-track {
  min-width: 0;
  min-height: 0;
  display: grid;
}

.calendar-track.animating {
  transition: transform 0.22s ease;
}

.calendar-week-row {
  position: relative;
  min-height: 0;
  border-bottom: 1px solid var(--dash-border-lighter);
  overflow: hidden;
}

.calendar-cells {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}

.calendar-cell {
  border-right: 1px solid var(--dash-border-lighter);
  padding: 4px;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.calendar-cell.other-month {
  background: var(--dash-panel-bg2);
  opacity: 0.55;
}

.calendar-cell.is-today {
  background: rgba(195, 63, 150, 0.04);
}

.calendar-date {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  flex-shrink: 0;
}

.date-num {
  font-size: 13px;
  color: var(--dash-page-fg);
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.date-num.today {
  background: var(--dash-accent);
  color: #fff;
  font-weight: 700;
}

.calendar-week-tasks {
  position: absolute;
  left: 0;
  right: 0;
  top: 30px;
  bottom: 4px;
  pointer-events: none;
}

.calendar-task {
  position: absolute;
  height: 19px;
  padding: 2px 5px;
  border-radius: 3px;
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  overflow: hidden;
  pointer-events: auto;
  box-sizing: border-box;
}

.calendar-task:hover {
  filter: brightness(0.95);
}

.calendar-task.active {
  outline: 1px solid var(--dash-accent);
}

.calendar-task.done {
  opacity: 0.68;
}

.calendar-task:not(.starts-in-week) {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}

.calendar-task:not(.ends-in-week) {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.ct-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  color: var(--dash-page-fg);
}

.ct-time {
  font-size: 10px;
  color: var(--dash-text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}

.calendar-more {
  position: absolute;
  right: 6px;
  font-size: 10px;
  color: var(--dash-accent);
  padding: 1px 4px;
  pointer-events: none;
}

.gantt-settings-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@container task-gantt (max-width: 720px) {
  .gantt-header {
    align-items: stretch;
  }

  .search-input {
    flex-basis: 100%;
    width: 100%;
  }

  .date-input {
    flex: 0 0 auto;
    width: var(--date-input-width, 15ch);
    min-width: var(--date-input-width, 15ch);
  }

  .gantt-body {
    flex-direction: column;
  }

  .task-tree {
    width: 100%;
    max-height: 150px;
    border-right: 0;
    border-bottom: 1px solid var(--dash-border-light);
  }

  .tree-head {
    height: 34px;
  }

  .timeline-wrap {
    flex: 1 1 auto;
  }

  .vg-corner,
  .vg-time-axis {
    width: 76px;
  }

  .vg-corner,
  .vg-tick {
    font-size: 10px;
  }

  .calendar-weekdays,
  .calendar-grid {
    min-width: 560px;
  }

  .calendar-cell {
    min-height: 72px;
  }
}

@container task-gantt (max-width: 480px) {
  .gantt-app {
    grid-template-rows: auto minmax(0, 1fr);
  }

  .sep,
  .filter-label {
    display: none;
  }

  .view-btn,
  .search-input,
  .date-input {
    flex-basis: 100%;
    width: 100%;
  }

  .today-btn,
  .add-btn {
    flex: 1 1 0;
  }

  .task-tree {
    max-height: 132px;
  }

  .tree-head {
    height: 30px;
  }

  .group-title {
    height: 28px;
  }

  .tree-task {
    height: 32px;
    padding-left: 22px;
  }

  .tick-header {
    height: 40px;
  }

  .row-spacer {
    height: 28px;
  }

  .task-row {
    height: 32px;
  }

  .task-bar {
    top: 5px;
    height: 22px;
    padding: 0 6px;
  }

  .vg-corner,
  .vg-time-axis {
    width: 64px;
  }

  .vg-col-header {
    padding: 6px 4px;
  }

  .vg-tick {
    height: 32px;
  }

  .calendar-weekdays,
  .calendar-grid {
    min-width: 520px;
  }

  .calendar-wd {
    padding: 6px 4px;
  }

  .calendar-cell {
    min-height: 66px;
    padding: 3px;
  }

  .date-lunar,
  .ct-time {
    display: none;
  }

  .calendar-task {
    padding: 2px 4px;
  }
}
</style>
