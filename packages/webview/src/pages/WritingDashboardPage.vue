<template>
  <div class="dashboard-page">
    <!-- 主舞台 -->
    <main ref="stageRef" class="dashboard-stage">
      <div v-if="isLoading" class="dashboard-loading">
        <q-spinner size="22px" color="pink-5" />
        <span>正在加载工作台数据…</span>
      </div>
      <section
        v-else
        v-for="windowItem in visibleWindows"
        :key="windowItem.id"
        class="dashboard-window"
        :class="{ active: activeId === windowItem.id, maximized: windowItem.maximized }"
        :style="windowStyle(windowItem)"
        @pointerdown="activateWindow(windowItem.id)"
      >
        <div
          class="window-titlebar"
          @pointerdown.stop="startDrag($event, windowItem.id)"
          @dblclick.stop="toggleMaximize(windowItem.id)"
        >
          <div class="title">
            <q-icon :name="widgetIcon(windowItem.type)" size="18px" />
            <span>{{ windowItem.title }}</span>
          </div>
          <div class="window-actions" @pointerdown.stop>
            <q-btn dense flat round icon="remove" @click.stop="minimizeWindow(windowItem.id)">
              <q-tooltip>最小化</q-tooltip>
            </q-btn>
            <q-btn dense flat round icon="open_in_new" @click.stop="openStandalone(windowItem.type)">
              <q-tooltip>独立打开</q-tooltip>
            </q-btn>
            <q-btn
              dense
              flat
              round
              :icon="windowItem.maximized ? 'filter_none' : 'crop_square'"
              @click.stop="toggleMaximize(windowItem.id)"
            >
              <q-tooltip>{{ windowItem.maximized ? '还原' : '最大化' }}</q-tooltip>
            </q-btn>
            <q-btn dense flat round icon="close" @click.stop="removeWindow(windowItem.id)">
              <q-tooltip>从工作台移除</q-tooltip>
            </q-btn>
          </div>
        </div>
        <div class="window-body">
          <DashboardWidgetRenderer
            :type="windowItem.type"
            :window-id="windowItem.id"
            :energy-metrics="state.energyMetrics"
            :tasks="state.tasks"
            :logs="state.logs"
            :profile="state.profile"
            :year-plan="state.yearPlan"
            :plan-markdown="state.planMarkdown"
            :plan-file-path="state.dashboardFiles?.planPath"
            :plan-files="state.planFiles"
            :selected-plan-file="state.selectedPlanFile"
            @update:energy-metrics="onUpdateEnergyMetrics"
            @update:tasks="onUpdateTasks"
            @update:logs="onUpdateLogs"
            @update:profile="onUpdateProfile"
            @update:year-plan="onUpdateYearPlan"
            @update:plan-markdown="onUpdatePlanMarkdown"
            @select-plan-file="selectPlanFile"
            @create-plan-file="createPlanFile"
            @open-plan-file="openPlanFile"
          />
        </div>
        <template v-if="!layoutSettings.tilingMode && !windowItem.maximized">
          <div
            v-for="edge in resizeEdges"
            :key="edge"
            :class="['resize-handle', edge]"
            @pointerdown.stop="startResize($event, windowItem.id, edge)"
          />
        </template>
      </section>
      <div
        v-if="snapPreview && !layoutSettings.tilingMode"
        class="snap-preview"
        :style="snapPreviewStyle"
      />
      <div
        v-for="handle in splitHandles"
        :key="handle.id"
        :class="['split-resizer', handle.orientation]"
        :style="splitHandleStyle(handle)"
        @pointerdown.stop="startSplitResize($event, handle)"
      />
    </main>

    <!-- 任务栏 -->
    <Transition name="taskbar">
      <div
        v-if="layoutSettings.taskbarVisible && !isLoading"
        :class="['dashboard-taskbar', { 'auto-hide': layoutSettings.taskbarAutoHide }]"
        @mouseenter="taskbarHover = true"
        @mouseleave="taskbarHover = false"
      >
        <div class="taskbar-inner">
          <DashboardStartMenu
            :backend-available="backendAvailable"
            :widget-options="widgetOptions"
            :tiling-mode="layoutSettings.tilingMode"
            @add-window="addWindow"
            @toggle-tiling="toggleTiling"
            @save="saveState(state)"
            @reset-layout="resetLayout"
            @open-settings="showPageSettings = true"
          />
          <div class="taskbar-sep" />
          <div class="taskbar-windows">
            <button
              v-for="win in allWindows"
              :key="win.id"
              :class="['taskbar-btn', { active: activeId === win.id && !win.minimized, minimized: win.minimized }]"
              @click="toggleWindowVisibility(win.id)"
            >
              <q-icon :name="widgetIcon(win.type)" size="16px" />
              <span class="taskbar-label">{{ win.title }}</span>
            </button>
          </div>
          <button class="taskbar-btn taskbar-toggle" @click="showPageSettings = true">
            <q-icon name="settings" size="16px" />
          </button>
        </div>
      </div>
    </Transition>

    <!-- 页面设置面板 -->
    <q-dialog v-model="showPageSettings">
      <q-card style="min-width: 300px">
        <q-card-section class="row items-center">
          <div class="text-h6">工作台设置</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>
        <q-separator />
        <q-card-section class="q-gutter-md">
          <q-toggle v-model="layoutSettings.taskbarVisible" label="显示任务栏" />
          <q-toggle v-model="layoutSettings.taskbarAutoHide" label="任务栏自动隐藏" />
          <q-separator />
          <div class="text-caption q-mb-sm">平铺方向</div>
          <q-btn-group spread>
            <q-btn dense :outline="layoutSettings.tilingDirection !== 'horizontal'" color="pink-5" label="左右" @click="layoutSettings.tilingDirection = 'horizontal'; applyTiling()" />
            <q-btn dense :outline="layoutSettings.tilingDirection !== 'vertical'" color="pink-5" label="上下" @click="layoutSettings.tilingDirection = 'vertical'; applyTiling()" />
            <q-btn dense :outline="layoutSettings.tilingDirection !== 'grid'" color="pink-5" label="网格" @click="layoutSettings.tilingDirection = 'grid'; applyTiling()" />
          </q-btn-group>
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from 'vue'
import DashboardWidgetRenderer from './writingDashboard/DashboardWidgetRenderer.vue'
import DashboardStartMenu from './writingDashboard/components/DashboardStartMenu.vue'
import { widgetTitles, type DashboardWindow, type WidgetType, type EnergyMetric, type DashboardLog, type Task, type DashboardProfile, type YearPlan } from './writingDashboard/sampleData'
import { useDashboardState, loadLayoutSettings, saveLayoutSettings, type LayoutSettings } from './writingDashboard/useDashboardState'
import { WindowLayerManager, loadLayerManager, saveLayerManager } from './writingDashboard/windowLayer'

type DragState =
  | { mode: 'move'; id: string; pointerId: number; captureEl: HTMLElement | null; startX: number; startY: number; originalX: number; originalY: number; restoreOnMove?: boolean; restored?: boolean }
  | { mode: 'resize'; id: string; edge: ResizeEdge; pointerId: number; captureEl: HTMLElement | null; startX: number; startY: number; originalX: number; originalY: number; originalW: number; originalH: number }
  | { mode: 'split'; pointerId: number; captureEl: HTMLElement | null; startX: number; startY: number; handle: SplitHandle; originals: Record<string, DashboardWindow> }
type WindowDraftPatch = Partial<Pick<DashboardWindow, 'x' | 'y' | 'w' | 'h'>>
type WindowBounds = Required<WindowDraftPatch>
type StageSize = { width: number; height: number }
type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type SplitOrientation = 'vertical' | 'horizontal'
type SplitHandle = {
  id: string
  orientation: SplitOrientation
  beforeIds: string[]
  afterIds: string[]
  x: number
  y: number
  w: number
  h: number
  boundary: number
  minBoundary: number
  maxBoundary: number
  gap: number
}

const stageRef = ref<HTMLElement | null>(null)
const { state, backendAvailable, isLoading, vscode, saveState, updateWindows, resetState } = useDashboardState()
const windows = computed(() => state.value.windows)
const activeId = ref(windows.value[0]?.id || '')
const dragState = ref<DragState | null>(null)
const dragPreview = ref<{ id: string; patch: WindowDraftPatch } | null>(null)
const splitPreview = ref<Record<string, WindowDraftPatch> | null>(null)
const snapPreview = ref<{ id: string; patch: Required<WindowDraftPatch> } | null>(null)
const lastValidStageSize = ref<StageSize | null>(null)
const showPageSettings = ref(false)
const taskbarHover = ref(false)
const WINDOW_EDGE_INSET = 0
const SNAP_TRIGGER_SIZE = 28
const SNAP_MIN_QUARTER_WIDTH = 520
const SNAP_MIN_QUARTER_HEIGHT = 320
const MIN_WINDOW_WIDTH = 240
const MIN_WINDOW_HEIGHT = 150
const SPLIT_EDGE_TOLERANCE = 8
const SPLIT_HANDLE_SIZE = 14
const SPLIT_MIN_OVERLAP = 72
const SPLIT_GROUP_TOLERANCE = 6
const MIN_STAGE_WIDTH = 320
const MIN_STAGE_HEIGHT = 220
const resizeEdges: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

/* ── 窗口层级管理器（内部 layer → CSS z-index 映射）── */
const layerManager = loadLayerManager()

/* ── 布局设置（localStorage 持久化）────────── */
const layoutSettings = reactive<LayoutSettings>(loadLayoutSettings())
watch(layoutSettings, (s) => saveLayoutSettings(s), { deep: true })

/* ── 同步窗口列表变化到层级管理器 ──────────── */
const layerVersion = ref(0)

watch(windows, (list) => {
  // 注册新窗口
  layerManager.registerAll(list.map(w => w.id))
  // 移除已关闭的窗口
  const ids = new Set(list.map(w => w.id))
  for (const id of Object.keys(layerManager.serialize().layers)) {
    if (!ids.has(id)) {
      layerManager.remove(id)
    }
  }
  layerVersion.value++
  saveLayerManager(layerManager)
}, { deep: true, immediate: true })

/* ── 响应式 z-index 映射 ─── */
const windowZIndexMap = computed(() => {
  // 依赖 layerVersion 和 windows，任一变化时重新计算
  void layerVersion.value
  const map: Record<string, number> = {}
  for (const w of windows.value) {
    map[w.id] = layerManager.getCssZ(w.id)
  }
  return map
})

/* ── 向后代组件提供层级管理 API ──────────── */
provide('layerManager', {
  activateFloating(id: string) {
    layerManager.activateFloating(id)
    layerVersion.value++
  },
  deactivateFloating(id: string) {
    layerManager.deactivateFloating(id)
    layerVersion.value++
  },
  activateModal(modalId: string, ownerId: string) {
    layerManager.activateModal(modalId, ownerId)
    layerVersion.value++
  },
  deactivateModal(modalId: string) {
    const owner = layerManager.deactivateModal(modalId)
    layerVersion.value++
    return owner
  },
  activateWindow,
  getCssZ: (id: string) => layerManager.getCssZ(id),
  getTopId: () => layerManager.getTopId(),
  layerVersion,
})

/* ── 窗口计算属性 ────────────────────────── */
const allWindows = computed(() => windows.value)
const visibleWindows = computed(() => windows.value.filter(w => !w.minimized))
const renderedWindows = computed(() => visibleWindows.value.map(item => windowWithPreview(item)))
const splitHandles = computed(() => {
  if (layoutSettings.tilingMode || dragState.value?.mode === 'move') return []
  return buildSplitHandles(renderedWindows.value.filter(item => !item.maximized))
})
const snapPreviewStyle = computed(() => {
  const patch = snapPreview.value?.patch
  if (!patch) return {}
  return {
    transform: `translate(${patch.x}px, ${patch.y}px)`,
    width: `${patch.w}px`,
    height: `${patch.h}px`
  }
})

const widgetOptions = computed(() => Object.entries(widgetTitles).map(([type, title]) => ({
  type: type as WidgetType,
  title
})))

/* ── 基础操作 ────────────────────────────── */
function resetLayout() {
  layoutSettings.tilingMode = false
  resetState()
}

function activateWindow(id: string) {
  if (dragState.value) {
    cancelPointerAction()
  }
  activeId.value = id
  layerManager.activate(id)
  layerVersion.value++
  saveLayerManager(layerManager)
}

function addWindow(type: WidgetType) {
  const count = windows.value.length
  const stageSize = getStageSize()
  const preferredW = type === 'gantt' || type === 'tasks' ? 720 : type === 'timer' ? 320 : 360
  const preferredH = type === 'gantt' ? 330 : type === 'timer' ? 360 : 240
  const size = fitWindowSize(preferredW, preferredH, stageSize)
  const pos = clampWindowPosition(
    40 + (count % 4) * 36,
    40 + (count % 5) * 36,
    size.w,
    size.h,
    stageSize
  )
  const item: DashboardWindow = {
    id: `win-${type}-${Date.now()}`,
    type,
    title: widgetTitles[type],
    x: pos.x,
    y: pos.y,
    w: size.w,
    h: size.h,
  }
  updateWindows([...windows.value, item])
  // 注册到层级管理器并激活
  layerManager.activate(item.id)
  layerVersion.value++
  saveLayerManager(layerManager)
  activeId.value = item.id
}

function removeWindow(id: string) {
  updateWindows(windows.value.filter(item => item.id !== id))
  layerManager.remove(id)
  saveLayerManager(layerManager)
  if (activeId.value === id) {
    activeId.value = windows.value[0]?.id || ''
  }
}

function minimizeWindow(id: string) {
  updateWindowItem(id, { minimized: true })
}

function restoreWindow(id: string) {
  updateWindowItem(id, { minimized: false })
}

function toggleMaximize(id: string) {
  const item = windows.value.find(entry => entry.id === id)
  if (!item) return
  if (item.maximized) {
    restoreMaximizedWindow(item)
    return
  }
  maximizeWindow(item)
}

function maximizeWindow(item: DashboardWindow) {
  const bounds = getMaximizedBounds()
  updateWindowItem(item.id, {
    ...bounds,
    minimized: false,
    maximized: true,
    restoreBounds: currentWindowBounds(item)
  })
  activateWindow(item.id)
}

function restoreMaximizedWindow(item: DashboardWindow, pointerEvent?: PointerEvent): WindowBounds {
  const restoreBounds = fitRestoreBounds(item.restoreBounds ?? currentWindowBounds(item))
  const nextBounds = pointerEvent
    ? restoredDragStartBounds(restoreBounds, pointerEvent)
    : restoreBounds
  updateWindowItem(item.id, {
    ...nextBounds,
    maximized: false,
    restoreBounds
  })
  return nextBounds
}

function toggleWindowVisibility(id: string) {
  const win = windows.value.find(w => w.id === id)
  if (!win) return
  if (win.minimized) {
    restoreWindow(id)
    activateWindow(id)
  } else if (activeId.value === id) {
    minimizeWindow(id)
  } else {
    activateWindow(id)
  }
}

function windowStyle(item: DashboardWindow) {
  const maxBounds = item.maximized ? getMaximizedBounds() : null
  const splitPatch = splitPreview.value?.[item.id] ?? null
  const patch = dragPreview.value?.id === item.id ? dragPreview.value.patch : null
  const x = splitPatch?.x ?? patch?.x ?? maxBounds?.x ?? item.x
  const y = splitPatch?.y ?? patch?.y ?? maxBounds?.y ?? item.y
  const w = splitPatch?.w ?? patch?.w ?? maxBounds?.w ?? item.w
  const h = splitPatch?.h ?? patch?.h ?? maxBounds?.h ?? item.h
  return {
    transform: `translate(${x}px, ${y}px)`,
    width: `${w}px`,
    height: `${h}px`,
    zIndex: windowZIndexMap.value[item.id] ?? 1
  }
}

function windowWithPreview(item: DashboardWindow): DashboardWindow {
  const maxBounds = item.maximized ? getMaximizedBounds() : null
  const splitPatch = splitPreview.value?.[item.id] ?? null
  const patch = dragPreview.value?.id === item.id ? dragPreview.value.patch : null
  return {
    ...item,
    x: splitPatch?.x ?? patch?.x ?? maxBounds?.x ?? item.x,
    y: splitPatch?.y ?? patch?.y ?? maxBounds?.y ?? item.y,
    w: splitPatch?.w ?? patch?.w ?? maxBounds?.w ?? item.w,
    h: splitPatch?.h ?? patch?.h ?? maxBounds?.h ?? item.h,
  }
}

function currentWindowBounds(item: DashboardWindow): WindowBounds {
  return {
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h
  }
}

function getMaximizedBounds(stageSize = getStageSize()): WindowBounds {
  return {
    x: 0,
    y: 0,
    w: Math.floor(stageSize.width),
    h: Math.floor(stageSize.height)
  }
}

function fitRestoreBounds(bounds: WindowBounds): WindowBounds {
  const stageSize = getStageSize()
  const size = fitWindowSize(bounds.w, bounds.h, stageSize)
  const pos = clampWindowPosition(bounds.x, bounds.y, size.w, size.h, stageSize)
  return { ...pos, ...size }
}

function restoredDragStartBounds(bounds: WindowBounds, event: PointerEvent): WindowBounds {
  const stage = stageRef.value
  const stageRect = stage?.getBoundingClientRect()
  const localX = stageRect ? event.clientX - stageRect.left : event.clientX
  const localY = stageRect ? event.clientY - stageRect.top : event.clientY
  const stageWidth = stageRect?.width || getStageSize().width
  const ratio = clamp(localX / Math.max(1, stageWidth), 0.15, 0.85)
  const x = localX - bounds.w * ratio
  const y = localY - 17
  const pos = clampWindowPosition(x, y, bounds.w, bounds.h)
  return { ...bounds, ...pos }
}

function splitHandleStyle(handle: SplitHandle) {
  return {
    transform: `translate(${handle.x}px, ${handle.y}px)`,
    width: `${handle.w}px`,
    height: `${handle.h}px`
  }
}

function readVisibleStageSize(): StageSize | null {
  const stage = stageRef.value
  if (!stage?.isConnected) return null
  const rect = stage.getBoundingClientRect()
  if (
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width < MIN_STAGE_WIDTH ||
    rect.height < MIN_STAGE_HEIGHT
  ) {
    return null
  }
  const size = { width: rect.width, height: rect.height }
  lastValidStageSize.value = size
  return size
}

function getStageSize(): StageSize {
  const visibleSize = readVisibleStageSize()
  if (visibleSize) return visibleSize
  if (lastValidStageSize.value) return lastValidStageSize.value
  return {
    width: Math.max(1000, window.innerWidth),
    height: Math.max(520, window.innerHeight - 64)
  }
}

function fitWindowSize(w: number, h: number, stageSize = getStageSize()) {
  return {
    w: Math.max(MIN_WINDOW_WIDTH, Math.min(w, stageSize.width - WINDOW_EDGE_INSET * 2)),
    h: Math.max(MIN_WINDOW_HEIGHT, Math.min(h, stageSize.height - WINDOW_EDGE_INSET * 2))
  }
}

function clampWindowPosition(
  x: number,
  y: number,
  w: number,
  h: number,
  stageSize = getStageSize()
) {
  const minX = WINDOW_EDGE_INSET
  const minY = WINDOW_EDGE_INSET
  const maxX = Math.max(WINDOW_EDGE_INSET, stageSize.width - w - WINDOW_EDGE_INSET)
  const maxY = Math.max(WINDOW_EDGE_INSET, stageSize.height - h - WINDOW_EDGE_INSET)
  return {
    x: Math.min(Math.max(minX, x), maxX),
    y: Math.min(Math.max(minY, y), maxY)
  }
}

function getSnapPatch(event: PointerEvent): Required<WindowDraftPatch> | null {
  const stage = stageRef.value
  if (!stage?.isConnected) return null
  const rect = stage.getBoundingClientRect()
  if (rect.width < MIN_STAGE_WIDTH || rect.height < MIN_STAGE_HEIGHT) return null

  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const nearLeft = x <= SNAP_TRIGGER_SIZE
  const nearRight = x >= rect.width - SNAP_TRIGGER_SIZE
  const nearTop = y <= SNAP_TRIGGER_SIZE
  const nearBottom = y >= rect.height - SNAP_TRIGGER_SIZE
  const width = Math.floor(rect.width)
  const height = Math.floor(rect.height)
  const leftW = Math.floor(width / 2)
  const rightW = width - leftW
  const topH = Math.floor(height / 2)
  const bottomH = height - topH
  const canQuarter = width >= SNAP_MIN_QUARTER_WIDTH && height >= SNAP_MIN_QUARTER_HEIGHT

  if (canQuarter && nearLeft && nearTop) return { x: 0, y: 0, w: leftW, h: topH }
  if (canQuarter && nearRight && nearTop) return { x: leftW, y: 0, w: rightW, h: topH }
  if (canQuarter && nearLeft && nearBottom) return { x: 0, y: topH, w: leftW, h: bottomH }
  if (canQuarter && nearRight && nearBottom) return { x: leftW, y: topH, w: rightW, h: bottomH }
  if (nearLeft) return { x: 0, y: 0, w: leftW, h: height }
  if (nearRight) return { x: leftW, y: 0, w: rightW, h: height }
  if (nearTop) return { x: 0, y: 0, w: width, h: height }
  return null
}

function normalizeWindowsToStage(stageSize: StageSize | null = readVisibleStageSize()) {
  if (layoutSettings.tilingMode) return
  if (!stageSize) return
  let changed = false
  const next = windows.value.map(item => {
    if (item.maximized) {
      const bounds = getMaximizedBounds(stageSize)
      if (item.x === bounds.x && item.y === bounds.y && item.w === bounds.w && item.h === bounds.h) {
        return item
      }
      changed = true
      return { ...item, ...bounds }
    }
    const size = fitWindowSize(item.w, item.h, stageSize)
    const pos = clampWindowPosition(item.x, item.y, size.w, size.h, stageSize)
    if (size.w === item.w && size.h === item.h && pos.x === item.x && pos.y === item.y) {
      return item
    }
    changed = true
    return { ...item, ...size, ...pos }
  })
  if (changed) updateWindows(next)
}

function buildSplitHandles(list: DashboardWindow[]): SplitHandle[] {
  const candidates: SplitHandle[] = []
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i]
      const b = list[j]
      if (!a || !b) continue
      const vertical = buildVerticalSplitHandle(a, b)
      if (vertical) candidates.push(vertical)
      const horizontal = buildHorizontalSplitHandle(a, b)
      if (horizontal) candidates.push(horizontal)
    }
  }
  return mergeSplitHandles(candidates)
}

function mergeSplitHandles(candidates: SplitHandle[]): SplitHandle[] {
  const groups: SplitHandle[][] = []
  for (const candidate of candidates) {
    const group = groups.find(items => {
      const first = items[0]
      return first &&
        first.orientation === candidate.orientation &&
        Math.abs(first.boundary - candidate.boundary) <= SPLIT_GROUP_TOLERANCE
    })
    if (group) {
      group.push(candidate)
    } else {
      groups.push([candidate])
    }
  }

  return groups.map(group => {
    const first = group[0]!
    const beforeIds = uniqueStrings(group.flatMap(item => item.beforeIds))
    const afterIds = uniqueStrings(group.flatMap(item => item.afterIds))
    const boundary = Math.round(group.reduce((sum, item) => sum + item.boundary, 0) / group.length)
    const minBoundary = Math.max(...group.map(item => item.minBoundary))
    const maxBoundary = Math.min(...group.map(item => item.maxBoundary))
    const gap = group.reduce((sum, item) => sum + item.gap, 0) / group.length

    if (first.orientation === 'vertical') {
      const y = Math.min(...group.map(item => item.y))
      const bottom = Math.max(...group.map(item => item.y + item.h))
      return {
        ...first,
        id: `split-v-${beforeIds.join('+')}-${afterIds.join('+')}`,
        beforeIds,
        afterIds,
        x: boundary - SPLIT_HANDLE_SIZE / 2,
        y,
        w: SPLIT_HANDLE_SIZE,
        h: bottom - y,
        boundary,
        minBoundary,
        maxBoundary,
        gap
      }
    }

    const x = Math.min(...group.map(item => item.x))
    const right = Math.max(...group.map(item => item.x + item.w))
    return {
      ...first,
      id: `split-h-${beforeIds.join('+')}-${afterIds.join('+')}`,
      beforeIds,
      afterIds,
      x,
      y: boundary - SPLIT_HANDLE_SIZE / 2,
      w: right - x,
      h: SPLIT_HANDLE_SIZE,
      boundary,
      minBoundary,
      maxBoundary,
      gap
    }
  }).filter(handle => handle.maxBoundary > handle.minBoundary)
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values))
}

function buildVerticalSplitHandle(a: DashboardWindow, b: DashboardWindow): SplitHandle | null {
  const [before, after] = a.x <= b.x ? [a, b] : [b, a]
  const beforeRight = before.x + before.w
  const afterLeft = after.x
  const edgeGap = afterLeft - beforeRight
  if (Math.abs(edgeGap) > SPLIT_EDGE_TOLERANCE) return null
  const overlapStart = Math.max(before.y, after.y)
  const overlapEnd = Math.min(before.y + before.h, after.y + after.h)
  const overlap = overlapEnd - overlapStart
  if (overlap < SPLIT_MIN_OVERLAP) return null
  const boundary = (beforeRight + afterLeft) / 2
  const halfGap = edgeGap / 2
  const minBoundary = before.x + MIN_WINDOW_WIDTH + halfGap
  const maxBoundary = after.x + after.w - MIN_WINDOW_WIDTH - halfGap
  if (maxBoundary <= minBoundary) return null
  return {
    id: `split-v-${before.id}-${after.id}`,
    orientation: 'vertical',
    beforeIds: [before.id],
    afterIds: [after.id],
    x: boundary - SPLIT_HANDLE_SIZE / 2,
    y: overlapStart,
    w: SPLIT_HANDLE_SIZE,
    h: overlap,
    boundary,
    minBoundary,
    maxBoundary,
    gap: edgeGap
  }
}

function buildHorizontalSplitHandle(a: DashboardWindow, b: DashboardWindow): SplitHandle | null {
  const [before, after] = a.y <= b.y ? [a, b] : [b, a]
  const beforeBottom = before.y + before.h
  const afterTop = after.y
  const edgeGap = afterTop - beforeBottom
  if (Math.abs(edgeGap) > SPLIT_EDGE_TOLERANCE) return null
  const overlapStart = Math.max(before.x, after.x)
  const overlapEnd = Math.min(before.x + before.w, after.x + after.w)
  const overlap = overlapEnd - overlapStart
  if (overlap < SPLIT_MIN_OVERLAP) return null
  const boundary = (beforeBottom + afterTop) / 2
  const halfGap = edgeGap / 2
  const minBoundary = before.y + MIN_WINDOW_HEIGHT + halfGap
  const maxBoundary = after.y + after.h - MIN_WINDOW_HEIGHT - halfGap
  if (maxBoundary <= minBoundary) return null
  return {
    id: `split-h-${before.id}-${after.id}`,
    orientation: 'horizontal',
    beforeIds: [before.id],
    afterIds: [after.id],
    x: overlapStart,
    y: boundary - SPLIT_HANDLE_SIZE / 2,
    w: overlap,
    h: SPLIT_HANDLE_SIZE,
    boundary,
    minBoundary,
    maxBoundary,
    gap: edgeGap
  }
}

/* ── 拖拽 ────────────────────────────────── */
function startDrag(event: PointerEvent, id: string) {
  if (layoutSettings.tilingMode) return
  if (event.button !== 0 || !event.isPrimary) return
  const item = windows.value.find(entry => entry.id === id)
  if (!item) return
  event.preventDefault()
  const captureEl = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  cancelPointerAction()
  activateWindow(id)
  capturePointer(captureEl, event.pointerId)
  dragState.value = {
    mode: 'move',
    id,
    pointerId: event.pointerId,
    captureEl,
    startX: event.clientX,
    startY: event.clientY,
    originalX: item.x,
    originalY: item.y,
    restoreOnMove: !!item.maximized
  }
  addPointerActionListeners(captureEl)
}

function startResize(event: PointerEvent, id: string, edge: ResizeEdge) {
  if (layoutSettings.tilingMode) return
  if (event.button !== 0 || !event.isPrimary) return
  const item = windows.value.find(entry => entry.id === id)
  if (!item) return
  if (item.maximized) return
  event.preventDefault()
  const captureEl = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  cancelPointerAction()
  activateWindow(id)
  capturePointer(captureEl, event.pointerId)
  dragState.value = {
    mode: 'resize',
    id,
    edge,
    pointerId: event.pointerId,
    captureEl,
    startX: event.clientX,
    startY: event.clientY,
    originalX: item.x,
    originalY: item.y,
    originalW: item.w,
    originalH: item.h
  }
  addPointerActionListeners(captureEl)
}

function startSplitResize(event: PointerEvent, handle: SplitHandle) {
  if (event.button !== 0 || !event.isPrimary) return
  const ids = uniqueStrings([...handle.beforeIds, ...handle.afterIds])
  const originals = Object.fromEntries(
    ids
      .map(id => windows.value.find(entry => entry.id === id))
      .filter((item): item is DashboardWindow => !!item)
      .map(item => [item.id, { ...item }])
  )
  if (Object.keys(originals).length !== ids.length) return
  event.preventDefault()
  const captureEl = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  cancelPointerAction()
  capturePointer(captureEl, event.pointerId)
  dragState.value = {
    mode: 'split',
    pointerId: event.pointerId,
    captureEl,
    startX: event.clientX,
    startY: event.clientY,
    handle,
    originals
  }
  addPointerActionListeners(captureEl)
}

function handlePointerMove(event: PointerEvent) {
  const s = dragState.value
  if (!s) return
  if (event.pointerId !== s.pointerId) return
  event.preventDefault()
  if (s.mode === 'split') {
    splitPreview.value = buildSplitResizePatch(s, event)
    return
  }

  let item = windows.value.find(entry => entry.id === s.id)
  if (!item) return

  if (s.mode === 'move') {
    if (s.restoreOnMove && !s.restored) {
      const restored = restoreMaximizedWindow(item, event)
      s.originalX = restored.x
      s.originalY = restored.y
      s.startX = event.clientX
      s.startY = event.clientY
      s.restored = true
      item = { ...item, ...restored, maximized: false }
    }
    const nextX = s.originalX + event.clientX - s.startX
    const nextY = s.originalY + event.clientY - s.startY
    const pos = clampWindowPosition(nextX, nextY, item.w, item.h)
    const snapPatch = getSnapPatch(event)
    snapPreview.value = snapPatch ? { id: item.id, patch: snapPatch } : null
    dragPreview.value = {
      id: item.id,
      patch: {
        x: pos.x,
        y: pos.y
      }
    }
    return
  }

  snapPreview.value = null
  const patch = buildWindowResizePatch(s, event)
  dragPreview.value = {
    id: item.id,
    patch
  }
}

function buildWindowResizePatch(s: Extract<DragState, { mode: 'resize' }>, event: PointerEvent): WindowBounds {
  const dx = event.clientX - s.startX
  const dy = event.clientY - s.startY
  const stageSize = getStageSize()
  const originalRight = s.originalX + s.originalW
  const originalBottom = s.originalY + s.originalH
  let x = s.originalX
  let y = s.originalY
  let w = s.originalW
  let h = s.originalH

  if (s.edge.includes('e')) {
    w = s.originalW + dx
  }
  if (s.edge.includes('s')) {
    h = s.originalH + dy
  }
  if (s.edge.includes('w')) {
    x = s.originalX + dx
    w = s.originalW - dx
  }
  if (s.edge.includes('n')) {
    y = s.originalY + dy
    h = s.originalH - dy
  }

  if (w < MIN_WINDOW_WIDTH) {
    w = MIN_WINDOW_WIDTH
    if (s.edge.includes('w')) x = originalRight - w
  }
  if (h < MIN_WINDOW_HEIGHT) {
    h = MIN_WINDOW_HEIGHT
    if (s.edge.includes('n')) y = originalBottom - h
  }

  if (x < 0) {
    if (s.edge.includes('w')) w += x
    x = 0
  }
  if (y < 0) {
    if (s.edge.includes('n')) h += y
    y = 0
  }
  if (x + w > stageSize.width) {
    if (s.edge.includes('e')) w = stageSize.width - x
    else x = stageSize.width - w
  }
  if (y + h > stageSize.height) {
    if (s.edge.includes('s')) h = stageSize.height - y
    else y = stageSize.height - h
  }

  w = Math.max(MIN_WINDOW_WIDTH, Math.min(w, stageSize.width))
  h = Math.max(MIN_WINDOW_HEIGHT, Math.min(h, stageSize.height))
  x = clamp(x, 0, Math.max(0, stageSize.width - w))
  y = clamp(y, 0, Math.max(0, stageSize.height - h))

  return { x, y, w, h }
}

function stopPointerAction(event?: Event) {
  if (!isActivePointerEvent(event)) return
  finishPointerAction(true)
}

function cancelPointerAction(event?: Event) {
  if (!isActivePointerEvent(event)) return
  finishPointerAction(false)
}

function finishPointerAction(commit: boolean) {
  const s = dragState.value
  const preview = dragPreview.value
  const split = splitPreview.value
  const snap = snapPreview.value
  dragState.value = null
  dragPreview.value = null
  splitPreview.value = null
  snapPreview.value = null
  removePointerActionListeners(s)

  if (s?.mode === 'split' && commit && split) {
    const next = windows.value.map(entry => split[entry.id] ? { ...entry, ...split[entry.id] } : entry)
    updateWindows(next)
    return
  }

  if (s && commit) {
    if (s.mode === 'split') return
    const patch = s.mode === 'move' && snap?.id === s.id ? snap.patch : preview?.id === s.id ? preview.patch : null
    if (!patch) return
    const next = windows.value.map(entry => entry.id === s.id ? { ...entry, ...patch } : entry)
    updateWindows(next)
  }
}

function buildSplitResizePatch(s: Extract<DragState, { mode: 'split' }>, event: PointerEvent): Record<string, WindowDraftPatch> {
  const delta = s.handle.orientation === 'vertical'
    ? event.clientX - s.startX
    : event.clientY - s.startY
  const boundary = clamp(s.handle.boundary + delta, s.handle.minBoundary, s.handle.maxBoundary)
  const halfGap = s.handle.gap / 2
  const patches: Record<string, WindowDraftPatch> = {}

  if (s.handle.orientation === 'vertical') {
    const beforeRight = boundary - halfGap
    const afterLeft = boundary + halfGap
    for (const id of s.handle.beforeIds) {
      const before = s.originals[id]
      if (!before) continue
      patches[id] = { w: Math.max(MIN_WINDOW_WIDTH, beforeRight - before.x) }
    }
    for (const id of s.handle.afterIds) {
      const after = s.originals[id]
      if (!after) continue
      patches[id] = {
        x: afterLeft,
        w: Math.max(MIN_WINDOW_WIDTH, after.x + after.w - afterLeft)
      }
    }
    return patches
  }

  const beforeBottom = boundary - halfGap
  const afterTop = boundary + halfGap
  for (const id of s.handle.beforeIds) {
    const before = s.originals[id]
    if (!before) continue
    patches[id] = { h: Math.max(MIN_WINDOW_HEIGHT, beforeBottom - before.y) }
  }
  for (const id of s.handle.afterIds) {
    const after = s.originals[id]
    if (!after) continue
    patches[id] = {
      y: afterTop,
      h: Math.max(MIN_WINDOW_HEIGHT, after.y + after.h - afterTop)
    }
  }
  return patches
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function addPointerActionListeners(captureEl: HTMLElement | null) {
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', stopPointerAction)
  window.addEventListener('pointercancel', cancelPointerAction)
  captureEl?.addEventListener('lostpointercapture', stopPointerAction)
}

function removePointerActionListeners(s: DragState | null) {
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', stopPointerAction)
  window.removeEventListener('pointercancel', cancelPointerAction)
  s?.captureEl?.removeEventListener('lostpointercapture', stopPointerAction)
  releasePointer(s?.captureEl ?? null, s?.pointerId)
}

function isActivePointerEvent(event?: Event) {
  const s = dragState.value
  if (!event || !s || !('pointerId' in event)) return true
  return event.pointerId === s.pointerId
}

function capturePointer(el: HTMLElement | null, pointerId: number) {
  try {
    el?.setPointerCapture(pointerId)
  } catch { /* ignore unsupported capture */ }
}

function releasePointer(el: HTMLElement | null, pointerId?: number) {
  if (pointerId === undefined) return
  try {
    if (el?.hasPointerCapture(pointerId)) {
      el.releasePointerCapture(pointerId)
    }
  } catch { /* ignore stale capture */ }
}

function openStandalone(type: WidgetType) {
  if (vscode) {
    vscode.postMessage({ command: 'dashboard.openWidget', widgetId: type })
    return
  }
  window.open(`/#/writing-dashboard-widget/${type}`, '_blank')
}

function widgetIcon(type: WidgetType) {
  const icons: Record<WidgetType, string> = {
    energy: 'bar_chart',
    heatmap: 'grid_view',
    clock: 'schedule',
    profile: 'person',
    gantt: 'timeline',
    plan: 'article',
    tasks: 'checklist',
    yearPlan: 'track_changes',
    logs: 'table_rows',
    timer: 'timer'
  }
  return icons[type]
}

function updateWindowItem(id: string, patch: Partial<DashboardWindow>) {
  const next = windows.value.map(entry => entry.id === id ? { ...entry, ...patch } : entry)
  updateWindows(next)
}

/* ── 独立数据更新回调（解耦窗口联动重渲染）── */
function onUpdateEnergyMetrics(metrics: EnergyMetric[]) {
  saveState({ ...state.value, energyMetrics: metrics })
}
function onUpdateTasks(tasks: Task[]) {
  saveState({ ...state.value, tasks })
}
function onUpdateLogs(logs: DashboardLog[]) {
  saveState({ ...state.value, logs })
}
function onUpdateProfile(profile: DashboardProfile) {
  saveState({ ...state.value, profile })
}
function onUpdateYearPlan(plan: YearPlan) {
  saveState({ ...state.value, yearPlan: plan })
}
function onUpdatePlanMarkdown(markdown: string) {
  saveState({ ...state.value, planMarkdown: markdown })
}

function serializableDashboardState() {
  return JSON.parse(JSON.stringify(state.value))
}

function selectPlanFile(fileName: string) {
  if (!fileName || fileName === state.value.selectedPlanFile) return
  if (vscode) {
    vscode.postMessage({
      command: 'dashboard.selectPlanFile',
      fileName,
      currentState: serializableDashboardState()
    })
    return
  }
  saveState({ ...state.value, selectedPlanFile: fileName })
}

function createPlanFile(fileName: string) {
  if (!fileName) return
  if (vscode) {
    vscode.postMessage({
      command: 'dashboard.createPlanFile',
      fileName,
      currentState: serializableDashboardState()
    })
    return
  }
  saveState({
    ...state.value,
    selectedPlanFile: fileName,
    planFiles: [...(state.value.planFiles || []), { name: fileName, path: fileName }],
    planMarkdown: ''
  })
}

/* ── 平铺窗口管理 ────────────────────────── */
function toggleTiling() {
  layoutSettings.tilingMode = !layoutSettings.tilingMode
  if (layoutSettings.tilingMode) {
    applyTiling()
  }
}

function applyTiling() {
  const stageSize = readVisibleStageSize()
  if (!stageSize) return
  const availW = stageSize.width
  const availH = stageSize.height
  const list = visibleWindows.value
  const n = list.length
  if (n === 0) return

  const next = windows.value.map(w => ({ ...w }))

  if (layoutSettings.tilingDirection === 'horizontal') {
    const w = Math.floor(availW / n)
    const h = availH
    for (let i = 0; i < n; i++) {
      const win = list[i]
      if (!win) continue
      const item = next.find(w => w.id === win.id)
      if (item) {
        item.x = i * w
        item.y = 0
        item.w = w - 4
        item.h = h - 4
        item.maximized = false
      }
    }
  } else if (layoutSettings.tilingDirection === 'vertical') {
    const w = availW
    const h = Math.floor(availH / n)
    for (let i = 0; i < n; i++) {
      const win = list[i]
      if (!win) continue
      const item = next.find(w => w.id === win.id)
      if (item) {
        item.x = 0
        item.y = i * h
        item.w = w - 4
        item.h = h - 4
        item.maximized = false
      }
    }
  } else {
    // grid
    const cols = Math.ceil(Math.sqrt(n))
    const rows = Math.ceil(n / cols)
    const w = Math.floor(availW / cols)
    const h = Math.floor(availH / rows)
    for (let i = 0; i < n; i++) {
      const win = list[i]
      if (!win) continue
      const item = next.find(w => w.id === win.id)
      if (item) {
        const col = i % cols
        const row = Math.floor(i / cols)
        item.x = col * w
        item.y = row * h
        item.w = w - 4
        item.h = h - 4
        item.maximized = false
      }
    }
  }

  updateWindows(next)
}

/* ── 生命周期 ────────────────────────────── */
onMounted(() => {
  window.addEventListener('resize', onStageResize)
})

onBeforeUnmount(() => {
  stopPointerAction()
  window.removeEventListener('resize', onStageResize)
})

function onStageResize() {
  const stageSize = readVisibleStageSize()
  if (!stageSize) return
  if (layoutSettings.tilingMode) {
    applyTiling()
    return
  }
  normalizeWindowsToStage(stageSize)
}

function openPlanFile() {
  vscode?.postMessage({ command: 'dashboard.openPlanFile', fileName: state.value.selectedPlanFile })
}
</script>

<style scoped>
.dashboard-page {
  height: 100vh;
  min-width: 1000px;
  overflow: hidden;
  display: grid;
  grid-template-rows: 1fr auto;
  background:
    linear-gradient(90deg, var(--dash-border-lighter) 1px, transparent 1px),
    linear-gradient(var(--dash-border-lighter) 1px, transparent 1px),
    var(--dash-page-bg);
  background-size: 24px 24px;
  color: var(--dash-page-fg);
}

/* 主舞台 */
.dashboard-stage {
  position: relative;
  width: 100%;
  overflow: hidden;
}

.dashboard-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--dash-text-secondary);
  font-size: 12px;
  background: var(--dash-page-bg);
}

.dashboard-window {
  position: absolute;
  left: 0;
  top: 0;
  box-sizing: border-box;
  min-width: 240px;
  min-height: 150px;
  display: grid;
  grid-template-rows: 34px 1fr;
  border: 1px solid var(--dash-window-border);
  border-radius: 8px;
  background: var(--dash-window-bg);
  box-shadow: 0 10px 28px var(--dash-shadow);
  overflow: hidden;
}

.snap-preview {
  position: absolute;
  left: 0;
  top: 0;
  box-sizing: border-box;
  border: 2px solid var(--dash-accent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--dash-accent) 18%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dash-accent) 45%, transparent);
  pointer-events: none;
  z-index: 9900;
}

.split-resizer {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 9800;
  border-radius: 999px;
  touch-action: none;
  user-select: none;
}

.split-resizer::after {
  content: '';
  position: absolute;
  border-radius: 999px;
  background: transparent;
  transition: background 0.12s ease, box-shadow 0.12s ease;
}

.split-resizer.vertical {
  cursor: col-resize;
}

.split-resizer.vertical::after {
  left: 5px;
  top: 8px;
  width: 4px;
  height: calc(100% - 16px);
}

.split-resizer.horizontal {
  cursor: row-resize;
}

.split-resizer.horizontal::after {
  left: 8px;
  top: 5px;
  width: calc(100% - 16px);
  height: 4px;
}

.split-resizer:hover::after,
.split-resizer:active::after {
  background: var(--dash-accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--dash-accent) 42%, transparent);
}

.dashboard-window.active {
  border-color: var(--dash-accent);
  box-shadow: 0 14px 34px var(--dash-shadow-active);
}

.dashboard-window.maximized {
  border-radius: 0;
  box-shadow: none;
}

.window-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--dash-titlebar-border);
  background: var(--dash-titlebar-bg);
  cursor: move;
  touch-action: none;
  user-select: none;
}

.title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--dash-title-fg);
  font-size: 13px;
  font-weight: 700;
}

.title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.window-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.window-body {
  min-height: 0;
  padding: 12px;
  overflow: hidden;
}

.resize-handle {
  position: absolute;
  touch-action: none;
  z-index: 3;
}

.resize-handle.n {
  top: -4px;
  left: 12px;
  right: 12px;
  height: 8px;
  cursor: ns-resize;
}

.resize-handle.s {
  left: 12px;
  right: 12px;
  bottom: -4px;
  height: 8px;
  cursor: ns-resize;
}

.resize-handle.e {
  top: 12px;
  right: -4px;
  bottom: 12px;
  width: 8px;
  cursor: ew-resize;
}

.resize-handle.w {
  top: 12px;
  left: -4px;
  bottom: 12px;
  width: 8px;
  cursor: ew-resize;
}

.resize-handle.ne,
.resize-handle.nw,
.resize-handle.se,
.resize-handle.sw {
  width: 16px;
  height: 16px;
}

.resize-handle.ne {
  top: -4px;
  right: -4px;
  cursor: nesw-resize;
}

.resize-handle.nw {
  top: -4px;
  left: -4px;
  cursor: nwse-resize;
}

.resize-handle.se {
  right: -4px;
  bottom: -4px;
  cursor: nwse-resize;
}

.resize-handle.sw {
  left: -4px;
  bottom: -4px;
  cursor: nesw-resize;
}

.resize-handle.se::after {
  content: '';
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 8px;
  height: 8px;
  border-right: 2px solid var(--dash-accent);
  border-bottom: 2px solid var(--dash-accent);
}

/* 任务栏 */
.dashboard-taskbar {
  background: var(--dash-toolbar-bg);
  border-top: 1px solid var(--dash-toolbar-border);
  backdrop-filter: blur(8px);
  flex-shrink: 0;
  z-index: 10;
}

.dashboard-taskbar.auto-hide {
  height: 4px;
  overflow: hidden;
  opacity: 0.3;
  transition: height 0.25s, opacity 0.25s;
}

.dashboard-taskbar.auto-hide:hover {
  height: auto;
  opacity: 1;
  overflow: visible;
}

.taskbar-inner {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
}

.taskbar-windows {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  overflow-x: auto;
}

.taskbar-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dash-page-fg);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}

.taskbar-btn:hover {
  background: var(--dash-border-lighter);
}

.taskbar-btn.active {
  background: var(--dash-accent);
  color: #fff;
}

.taskbar-btn.minimized {
  opacity: 0.5;
}

.taskbar-btn.minimized:hover {
  opacity: 1;
}

.taskbar-label {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.taskbar-sep {
  width: 1px;
  height: 20px;
  background: var(--dash-border-light);
}

.taskbar-toggle {
  flex-shrink: 0;
}

/* 动画 */
.taskbar-enter-active,
.taskbar-leave-active {
  transition: transform 0.25s ease;
}

.taskbar-enter-from,
.taskbar-leave-to {
  transform: translateY(100%);
}
</style>
