import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  defaultDashboardState,
  defaultWindows,
  type DashboardState,
  type DashboardWindow,
  type Task,
  type DashboardTask,
  type DailyTask,
} from './sampleData'
import { toTimestamp } from './timeSystem'

const LS_WINDOWS_KEY = 'anh-dashboard-windows'
const LS_LAYOUT_KEY = 'anh-dashboard-layout'

function loadWindowsFromLS(): DashboardWindow[] | null {
  try {
    const raw = localStorage.getItem(LS_WINDOWS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return null
}

function saveWindowsToLS(windows: DashboardWindow[]) {
  try {
    localStorage.setItem(LS_WINDOWS_KEY, JSON.stringify(windows))
  } catch { /* ignore */ }
}

export interface LayoutSettings {
  taskbarVisible: boolean
  taskbarAutoHide: boolean
  tilingMode: boolean
  tilingDirection: 'horizontal' | 'vertical' | 'grid'
}

export function loadLayoutSettings(): LayoutSettings {
  try {
    const raw = localStorage.getItem(LS_LAYOUT_KEY)
    if (raw) return { ...defaultLayoutSettings, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...defaultLayoutSettings }
}

export function saveLayoutSettings(settings: LayoutSettings) {
  try {
    localStorage.setItem(LS_LAYOUT_KEY, JSON.stringify(settings))
  } catch { /* ignore */ }
}

const defaultLayoutSettings: LayoutSettings = {
  taskbarVisible: true,
  taskbarAutoHide: false,
  tilingMode: false,
  tilingDirection: 'grid',
}

type VsCodeApi = {
  postMessage: (message: unknown) => void
}

type DashboardMessage =
  | { command: 'dashboard.data'; data: DashboardState }
  | { command: 'dashboard.error'; message: string }

function cloneState(): DashboardState {
  return JSON.parse(JSON.stringify(defaultDashboardState)) as DashboardState
}

function cloneForMessage<T>(value: T): T {
  if (value === undefined || value === null) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function getVsCodeApi(): VsCodeApi | undefined {
  const globalWindow = window as unknown as { acquireVsCodeApi?: () => VsCodeApi }
  try {
    return globalWindow.acquireVsCodeApi?.()
  } catch {
    return undefined
  }
}

export function useDashboardState() {
  const vscode = getVsCodeApi()
  const state = ref<DashboardState>(cloneState())
  const backendAvailable = ref(!!vscode)
  const isLoading = ref(!!vscode)
  const lastError = ref('')

  function post(message: unknown) {
    if (!vscode) return
    try {
      vscode.postMessage(cloneForMessage(message))
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      lastError.value = text
      console.error('[writing-dashboard] postMessage failed:', error)
    }
  }

  function requestData() {
    post({ command: 'dashboard.ready' })
  }

  function saveState(nextState: DashboardState = state.value) {
    const payload = cloneForMessage(normalizeState(cloneForMessage(nextState)))
    state.value = payload
    saveWindowsToLS(payload.windows)
    post({
      command: 'dashboard.save',
      data: payload
    })
  }

  function updateWindows(windows: DashboardWindow[]) {
    saveState({ ...state.value, windows })
  }

  function resetState() {
    saveState(cloneState())
  }

  function handleMessage(event: MessageEvent<DashboardMessage>) {
    const message = event.data
    if (message?.command === 'dashboard.data') {
      state.value = cloneForMessage(normalizeState(message.data))
      lastError.value = ''
      isLoading.value = false
      return
    }
    if (message?.command === 'dashboard.error') {
      lastError.value = message.message
      isLoading.value = false
    }
  }

  onMounted(() => {
    window.addEventListener('message', handleMessage as EventListener)
    requestData()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('message', handleMessage as EventListener)
  })

  return {
    state,
    backendAvailable,
    isLoading,
    lastError,
    vscode,
    saveState,
    updateWindows,
    resetState,
  }
}

function normalizeState(value: DashboardState): DashboardState {
  const fallback = cloneState()

  // 迁移旧数据：ganttTasks / dailyTasks → tasks
  let tasks: Task[] = []
  let hasTaskSource = false
  if (Array.isArray((value as any)?.tasks)) {
    hasTaskSource = true
    tasks = (value as any).tasks.map((t: any) => normalizeTask(t))
  } else {
    // 旧数据兼容
    if (Array.isArray((value as any)?.ganttTasks)) {
      hasTaskSource = true
      tasks.push(...(value as any).ganttTasks.map((t: DashboardTask) => migrateDashboardTask(t)))
    }
    if (Array.isArray((value as any)?.dailyTasks)) {
      hasTaskSource = true
      tasks.push(...(value as any).dailyTasks.map((t: DailyTask) => migrateDailyTask(t)))
    }
  }
  if (!hasTaskSource) tasks = fallback.tasks

  return {
    ...fallback,
    ...value,
    windows: normalizeWindows(
      Array.isArray(value?.windows) && value.windows.length > 0
        ? value.windows
        : loadWindowsFromLS() || defaultWindows.map(item => ({ ...item }))
    ),
    energyMetrics: Array.isArray(value?.energyMetrics) ? value.energyMetrics : fallback.energyMetrics,
    tasks,
    logs: Array.isArray(value?.logs) ? value.logs : [],
    planMarkdown: typeof value?.planMarkdown === 'string' ? value.planMarkdown : fallback.planMarkdown,
    selectedPlanFile: typeof (value as any)?.selectedPlanFile === 'string' ? (value as any).selectedPlanFile : fallback.selectedPlanFile,
    planFiles: Array.isArray((value as any)?.planFiles) ? (value as any).planFiles : fallback.planFiles,
  }
}

function normalizeWindows(windows: DashboardWindow[]): DashboardWindow[] {
  let maxZ = 0
  for (const w of windows) {
    if (typeof w.z === 'number') maxZ = Math.max(maxZ, w.z)
  }
  return windows.map((w, i) => {
    const restoreBounds = normalizeRestoreBounds(w.restoreBounds, w)
    return {
      ...w,
      ...(restoreBounds ? { restoreBounds } : {}),
      maximized: !!w.maximized,
      z: typeof w.z === 'number' ? w.z : maxZ + i + 1,
    }
  })
}

function normalizeRestoreBounds(bounds: DashboardWindow['restoreBounds'], fallback: DashboardWindow): DashboardWindow['restoreBounds'] {
  const source = bounds ?? fallback
  const x = Number(source.x)
  const y = Number(source.y)
  const w = Number(source.w)
  const h = Number(source.h)
  if (![x, y, w, h].every(Number.isFinite)) return undefined
  return {
    x,
    y,
    w: Math.max(240, w),
    h: Math.max(150, h),
  }
}

function normalizeTask(t: any): Task {
  return {
    id: t?.id || `t-${Date.now()}`,
    title: t?.title || '新任务',
    description: t?.description || '',
    status: ['todo', 'doing', 'done'].includes(t?.status) ? t.status : 'todo',
    priority: ['low', 'medium', 'high'].includes(t?.priority) ? t.priority : 'medium',
    tags: Array.isArray(t?.tags) ? t.tags : [],
    group: t?.group || '默认',
    start: toTimestamp(t?.start, '2026-04-21'),
    end: toTimestamp(t?.end, '2026-04-23'),
    progress: typeof t?.progress === 'number' ? t.progress : 0,
    color: t?.color || '#d94a9b',
    subtasks: Array.isArray(t?.subtasks) ? t.subtasks.map((s: any) => ({
      id: s?.id || `s-${Date.now()}`,
      title: s?.title || '',
      done: !!s?.done
    })) : [],
  }
}

function migrateDashboardTask(t: DashboardTask): Task {
  return {
    id: t.id,
    title: t.title,
    description: '',
    status: t.status,
    priority: 'medium',
    tags: [],
    group: t.group,
    start: toTimestamp(t.start, '2026-04-16'),
    end: toTimestamp(t.end, '2026-04-21'),
    progress: t.progress,
    color: t.color,
    subtasks: [],
  }
}

function migrateDailyTask(t: DailyTask): Task {
  return {
    id: t.id,
    title: t.title,
    description: t.note || '',
    status: t.status === 'done' ? 'done' : 'todo',
    priority: 'medium',
    tags: [],
    group: '日常',
    start: new Date('2026-04-21').getTime(),
    end: new Date('2026-04-23').getTime(),
    progress: t.status === 'done' ? 100 : 0,
    color: '#d94a9b',
    subtasks: [],
  }
}
