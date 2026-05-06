import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  defaultDashboardState,
  defaultWindows,
  widgetTitles,
  type DashboardState,
  type DashboardWindow,
  type Task,
  type DashboardTask,
  type DailyTask,
  type YearPlan,
  type YearPlanGoal,
  type ClockSettings,
  type ClockExtraZone,
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
  tilingDirection: 'horizontal' | 'vertical' | 'grid' | 'free'
}

export function loadLayoutSettings(): LayoutSettings {
  try {
    const raw = localStorage.getItem(LS_LAYOUT_KEY)
    if (raw) return normalizeLayoutSettings(JSON.parse(raw))
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

function normalizeLayoutSettings(value: Partial<LayoutSettings> | undefined): LayoutSettings {
  const direction = value?.tilingDirection
  return {
    ...defaultLayoutSettings,
    ...value,
    tilingDirection: direction === 'horizontal' || direction === 'vertical' || direction === 'grid' || direction === 'free'
      ? direction
      : defaultLayoutSettings.tilingDirection
  }
}

type VsCodeApi = {
  postMessage: (message: unknown) => void
}

type DashboardMessage =
  | { command: 'dashboard.data'; data: DashboardState; settings?: DashboardWebviewSettings }
  | { command: 'dashboard.error'; message: string }

export interface DashboardWebviewSettings {
  widgetShowHeader: boolean
}

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
  const settings = ref<DashboardWebviewSettings>({
    widgetShowHeader: true
  })

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
      settings.value = normalizeSettings(message.settings)
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
    settings,
  }
}

function normalizeSettings(value: DashboardWebviewSettings | undefined): DashboardWebviewSettings {
  return {
    widgetShowHeader: value?.widgetShowHeader !== false
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
      Array.isArray(value?.windows)
        ? value.windows
        : loadWindowsFromLS() || defaultWindows.map(item => ({ ...item }))
    ),
    energyMetrics: Array.isArray(value?.energyMetrics) ? value.energyMetrics : fallback.energyMetrics,
    heatmapData: normalizeHeatmapData((value as any)?.heatmapData),
    tasks,
    logs: Array.isArray(value?.logs) ? value.logs : [],
    yearPlan: normalizeYearPlan(value?.yearPlan, fallback.yearPlan),
    selectedYearPlanYear: normalizeYear(value?.selectedYearPlanYear, normalizeYearPlan(value?.yearPlan, fallback.yearPlan).year),
    yearPlanFiles: Array.isArray((value as any)?.yearPlanFiles) ? (value as any).yearPlanFiles : fallback.yearPlanFiles,
    clockSettings: normalizeClockSettings(value?.clockSettings, fallback.clockSettings),
    planMarkdown: typeof value?.planMarkdown === 'string' ? value.planMarkdown : fallback.planMarkdown,
    selectedPlanFile: typeof (value as any)?.selectedPlanFile === 'string' ? (value as any).selectedPlanFile : fallback.selectedPlanFile,
    planFiles: Array.isArray((value as any)?.planFiles) ? (value as any).planFiles : fallback.planFiles,
  }
}

function normalizeYear(value: unknown, fallback: number): number {
  const year = Number(value)
  return Number.isFinite(year) && year >= 1900 && year <= 3000 ? Math.round(year) : fallback
}

function normalizeClockSettings(value: ClockSettings | undefined, fallback: ClockSettings): ClockSettings {
  const source = value && typeof value === 'object' ? value : fallback
  const preset = source.preset === 'compact' || source.preset === 'minimal' || source.preset === 'analog' || source.preset === 'standard'
    ? source.preset
    : fallback.preset
  const secondsStyle = source.secondsStyle === 'colon' || source.secondsStyle === 'plain' || source.secondsStyle === 'suffix'
    ? source.secondsStyle
    : fallback.secondsStyle
  const dateStyle = source.dateStyle === 'short' || source.dateStyle === 'numeric' || source.dateStyle === 'long'
    ? source.dateStyle
    : fallback.dateStyle
  const align = source.align === 'left' || source.align === 'center' ? source.align : fallback.align
  return {
    ...fallback,
    ...source,
    preset,
    title: typeof source.title === 'string' ? source.title : fallback.title,
    customLabel: typeof source.customLabel === 'string' ? source.customLabel : fallback.customLabel,
    showTitle: source.showTitle !== false,
    timeZone: typeof source.timeZone === 'string' ? source.timeZone : fallback.timeZone,
    hour12: !!source.hour12,
    showSeconds: source.showSeconds !== false,
    secondsStyle,
    showDate: source.showDate !== false,
    showWeekday: source.showWeekday !== false,
    showPeriod: source.showPeriod !== false,
    showProgress: source.showProgress !== false,
    showTimezone: source.showTimezone !== false,
    dateStyle,
    align,
    extraClocks: normalizeExtraClocks(source.extraClocks, fallback.extraClocks)
  }
}

function normalizeExtraClocks(value: ClockExtraZone[] | undefined, fallback: ClockExtraZone[]): ClockExtraZone[] {
  const source = Array.isArray(value) ? value : fallback
  return source
    .filter(item => item && typeof item === 'object')
    .map((item, index) => ({
      id: typeof item.id === 'string' && item.id ? item.id : `clock-zone-${index}`,
      label: typeof item.label === 'string' && item.label ? item.label : '其他时区',
      timeZone: typeof item.timeZone === 'string' && item.timeZone ? item.timeZone : 'UTC',
      showDate: item.showDate !== false
    }))
}

function normalizeYearPlan(value: YearPlan | undefined, fallback: YearPlan): YearPlan {
  const source = value && typeof value === 'object' ? value : fallback
  const goals = Array.isArray(source.goals) && source.goals.length > 0
    ? source.goals.map((goal, index) => normalizeYearPlanGoal(goal, index))
    : fallback.goals?.map((goal, index) => normalizeYearPlanGoal(goal, index)) || []
  const completedGoals = goals.filter(goal => goal.status === 'done').length
  return {
    ...fallback,
    ...source,
    year: Number.isFinite(Number(source.year)) ? Number(source.year) : fallback.year,
    title: source.title || fallback.title,
    category: source.category || fallback.category,
    summary: typeof source.summary === 'string' ? source.summary : fallback.summary,
    progress: clamp01(typeof source.progress === 'number' ? source.progress : fallback.progress),
    completedGoals,
    totalGoals: goals.length || Math.max(1, Number(source.totalGoals) || fallback.totalGoals),
    tags: Array.isArray(source.tags) ? source.tags.filter(Boolean).map(String) : fallback.tags,
    goals
  }
}

function normalizeYearPlanGoal(goal: Partial<YearPlanGoal>, index: number): YearPlanGoal {
  const status = goal.status === 'done' || goal.status === 'doing' || goal.status === 'todo' ? goal.status : 'todo'
  const quarter = goal.quarter === 'Q1' || goal.quarter === 'Q2' || goal.quarter === 'Q3' || goal.quarter === 'Q4'
    ? goal.quarter
    : (['Q1', 'Q2', 'Q3', 'Q4'][index % 4] as YearPlanGoal['quarter'])
  return {
    id: goal.id || `yg-${Date.now()}-${index}`,
    title: goal.title || '年度目标',
    quarter,
    status,
    progress: clampPercent(Number(goal.progress))
  }
}

function normalizeHeatmapData(value: unknown): Array<[string, number]> {
  if (!Array.isArray(value)) return []
  const result: Array<[string, number]> = []
  for (const item of value) {
    if (!Array.isArray(item) || item.length < 2 || typeof item[0] !== 'string') continue
    const count = Number(item[1])
    if (!Number.isFinite(count) || count <= 0) continue
    result.push([item[0], count])
  }
  return result
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
      title: normalizeWindowTitle(w),
      ...(restoreBounds ? { restoreBounds } : {}),
      maximized: !!w.maximized,
      z: typeof w.z === 'number' ? w.z : maxZ + i + 1,
    }
  })
}

function normalizeWindowTitle(windowItem: DashboardWindow): string {
  if (windowItem.type === 'heatmap' && (!windowItem.title || windowItem.title === '生命热力图')) {
    return widgetTitles.heatmap
  }
  return windowItem.title || widgetTitles[windowItem.type]
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

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
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
