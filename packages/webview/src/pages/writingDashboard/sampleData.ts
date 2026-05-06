export type WidgetType =
  | 'energy'
  | 'heatmap'
  | 'clock'
  | 'profile'
  | 'gantt'
  | 'quadrant'
  | 'plan'
  | 'tasks'
  | 'yearPlan'
  | 'logs'
  | 'timer'

export interface DashboardWindow {
  id: string
  type: WidgetType
  title: string
  x: number
  y: number
  w: number
  h: number
  /** 是否最小化 */
  minimized?: boolean
  /** 是否最大化到工作台可用区域 */
  maximized?: boolean
  /** 最大化前的窗口尺寸，用于还原 */
  restoreBounds?: {
    x: number
    y: number
    w: number
    h: number
  }
  /** 堆叠层级（点击顺序历史） */
  z?: number
}

export interface EnergyMetric {
  key: string
  label: string
  value: number
  color: string
}

/** 子任务 */
export interface SubTask {
  id: string
  title: string
  done: boolean
}

/** 统一任务模型（甘特图 + 任务清单共用） */
export interface Task {
  id: string
  title: string
  description: string
  status: 'todo' | 'doing' | 'done'
  priority: 'low' | 'medium' | 'high'
  tags: string[]
  group: string
  /** 开始时间戳（毫秒） */
  start: number
  /** 结束时间戳（毫秒） */
  end: number
  progress: number
  color: string
  subtasks: SubTask[]
}

/** @deprecated 旧甘特图任务类型，仅用于数据迁移 */
export interface DashboardTask {
  id: string
  title: string
  group: string
  start: string | number
  end: string | number
  status: 'todo' | 'doing' | 'done'
  progress: number
  color: string
}

/** @deprecated 旧日常任务类型，仅用于数据迁移 */
export interface DailyTask {
  id: string
  title: string
  dateRange: string
  status: 'done' | 'todo'
  note: string
}

export interface DashboardLog {
  id: string
  createdAt: string
  completedAt: string
  title: string
  tag: string
}

export interface DashboardProfile {
  name: string
  role: string
  quote: string
  coverUrl?: string
  coverPath?: string
  tags?: string[]
  noteCount: number
  taskCount: number
  goalCount: number
  roleCount?: number
  wordCount?: number
}

export interface YearPlan {
  year: number
  title: string
  category: string
  progress: number
  completedGoals: number
  totalGoals: number
  tags: string[]
}

export interface DashboardPlanFile {
  name: string
  path: string
}

export interface DashboardState {
  windows: DashboardWindow[]
  energyMetrics: EnergyMetric[]
  heatmapData: Array<[string, number]>
  /** 统一任务列表（甘特图 + 任务清单共用） */
  tasks: Task[]
  logs: DashboardLog[]
  profile: DashboardProfile
  yearPlan: YearPlan
  planMarkdown: string
  selectedPlanFile?: string
  planFiles?: DashboardPlanFile[]
  dashboardFiles?: {
    layoutPath?: string
    tasksPath?: string
    planPath?: string
    planDirPath?: string
  }
}

export const widgetTitles: Record<WidgetType, string> = {
  energy: '能量条形图',
  heatmap: '码字热力图',
  clock: '当前时间',
  profile: '我的小说',
  gantt: '任务甘特图',
  quadrant: '任务四象限',
  plan: '今日计划',
  tasks: '任务清单',
  yearPlan: '年计划',
  logs: '创作记录',
  timer: '计时器'
}

export const defaultWindows: DashboardWindow[] = [
  { id: 'win-energy', type: 'energy', title: widgetTitles.energy, x: 20, y: 20, w: 360, h: 180 },
  { id: 'win-heatmap', type: 'heatmap', title: widgetTitles.heatmap, x: 400, y: 20, w: 360, h: 180 },
  { id: 'win-clock', type: 'clock', title: widgetTitles.clock, x: 780, y: 20, w: 260, h: 180 },
  { id: 'win-profile', type: 'profile', title: widgetTitles.profile, x: 1060, y: 20, w: 280, h: 300 },
  { id: 'win-gantt', type: 'gantt', title: widgetTitles.gantt, x: 20, y: 220, w: 760, h: 330 },
  { id: 'win-plan', type: 'plan', title: widgetTitles.plan, x: 800, y: 220, w: 540, h: 330 },
  { id: 'win-tasks', type: 'tasks', title: widgetTitles.tasks, x: 20, y: 570, w: 760, h: 260 },
  { id: 'win-year', type: 'yearPlan', title: widgetTitles.yearPlan, x: 1060, y: 340, w: 280, h: 260 },
  { id: 'win-logs', type: 'logs', title: widgetTitles.logs, x: 800, y: 570, w: 540, h: 260 }
]

export const energyMetrics: EnergyMetric[] = [
  { key: 'physical', label: 'Physical', value: 25, color: '#5d7bd5' },
  { key: 'mental', label: 'Mental', value: 25, color: '#84c66f' },
  { key: 'mood', label: 'Mood', value: 25, color: '#f7c75c' },
  { key: 'motivation', label: 'Motivation', value: 25, color: '#ef6262' },
  { key: 'longTerm', label: 'LongTerm', value: 7, color: '#65c0bd' }
]

const defaultTasks: Task[] = [
  {
    id: 't1',
    title: '思路整理：重构角色分组逻辑',
    description: '梳理现有角色分组的问题，设计新的分组策略',
    status: 'done',
    priority: 'high',
    tags: ['设定', '重构'],
    group: '设定',
    start: new Date('2026-04-16T00:00:00').getTime(),
    end: new Date('2026-04-21T23:59:59').getTime(),
    progress: 100,
    color: '#d94a9b',
    subtasks: [
      { id: 's1-1', title: '分析现有分组', done: true },
      { id: 's1-2', title: '设计新方案', done: true },
      { id: 's1-3', title: '编写文档', done: true }
    ]
  },
  {
    id: 't2',
    title: '第一阶段：系统原型与任务视图',
    description: '搭建工作台原型，实现甘特图和任务清单',
    status: 'doing',
    priority: 'high',
    tags: ['开发', '原型'],
    group: '开发',
    start: new Date('2026-04-18T00:00:00').getTime(),
    end: new Date('2026-04-29T23:59:59').getTime(),
    progress: 58,
    color: '#db4ba5',
    subtasks: [
      { id: 's2-1', title: '窗口管理器', done: true },
      { id: 's2-2', title: '甘特图组件', done: true },
      { id: 's2-3', title: '任务清单组件', done: false }
    ]
  },
  {
    id: 't3',
    title: '接入 copilot agent',
    description: '将 copilot agent 接入创作工作台',
    status: 'todo',
    priority: 'medium',
    tags: ['开发', 'AI'],
    group: '开发',
    start: new Date('2026-04-22T00:00:00').getTime(),
    end: new Date('2026-04-24T23:59:59').getTime(),
    progress: 20,
    color: '#f0b83a',
    subtasks: []
  },
  {
    id: 't4',
    title: '完成个人资料卡',
    description: '优化个人资料卡的交互和样式',
    status: 'todo',
    priority: 'low',
    tags: ['体验', 'UI'],
    group: '体验',
    start: new Date('2026-04-27T00:00:00').getTime(),
    end: new Date('2026-04-29T23:59:59').getTime(),
    progress: 35,
    color: '#c43aa0',
    subtasks: []
  },
  {
    id: 't5',
    title: 'system design 学习',
    description: '学习系统设计相关知识',
    status: 'doing',
    priority: 'medium',
    tags: ['学习', '系统设计'],
    group: '学习',
    start: new Date('2026-04-14T00:00:00').getTime(),
    end: new Date('2026-04-30T23:59:59').getTime(),
    progress: 64,
    color: '#e04a91',
    subtasks: [
      { id: 's5-1', title: '阅读 DDIA', done: true },
      { id: 's5-2', title: '做练习题', done: false }
    ]
  }
]

export const logs: DashboardLog[] = [
  { id: 'l1', createdAt: '2026/04/14 23:42', completedAt: '2026/04/14 23:58', title: 'Java 语法学习', tag: '学习' },
  { id: 'l2', createdAt: '2026/04/18 00:42', completedAt: '2026/04/21 00:42', title: '构建个人修炼系统', tag: '项目' },
  { id: 'l3', createdAt: '2026/04/20 12:57', completedAt: '2026/04/24 12:42', title: '角色卡体验优化', tag: '开发' },
  { id: 'l4', createdAt: '2026/04/21 01:57', completedAt: '2026/04/24 12:59', title: '公开 API 设计草案', tag: '设计' }
]

export const defaultProfile: DashboardProfile = {
  name: '未命名项目',
  role: '未设置作者',
  quote: '未填写项目简介',
  coverUrl: '',
  coverPath: '',
  tags: [],
  noteCount: 0,
  taskCount: 0,
  goalCount: 0,
  roleCount: 0
}

export const defaultYearPlan: YearPlan = {
  year: 2026,
  title: '专注成长，拥抱变化',
  category: '学习',
  progress: 0.72,
  completedGoals: 0,
  totalGoals: 2,
  tags: ['阅读', '工作', '健康', '写作']
}

export const defaultPlanMarkdown = `---
tags: 未知
date: 2026-04-21 星期二 19:06
update: 2026-04-21 星期二 19:58
---

## 2026计划

深化模型治理、构建读写质量闭环，推进设定管理与监督描述系统化。
升级主动风控体系，强化矩阵支持，提升数据资产化水平与自助服务体验。

1. 完成平台核心功能的需求评审与设计。
2. 整理 oceanbase、dws 的语法支持和易错点。
3. 建立每日计划、年计划和任务甘特图之间的映射。
`

export const defaultDashboardState: DashboardState = {
  windows: defaultWindows,
  energyMetrics,
  heatmapData: [],
  tasks: defaultTasks,
  logs,
  profile: defaultProfile,
  yearPlan: defaultYearPlan,
  planMarkdown: defaultPlanMarkdown,
  selectedPlanFile: 'plan.md',
  planFiles: []
}

export function buildHeatmapData(): Array<[string, number]> {
  const data: Array<[string, number]> = []
  const start = new Date('2026-01-01T00:00:00')
  for (let i = 0; i < 150; i += 1) {
    const day = new Date(start)
    day.setDate(start.getDate() + i)
    const value = Math.max(0, Math.round((Math.sin(i / 7) + 1) * 4 + (i % 11 === 0 ? 9 : 0)))
    data.push([day.toISOString().slice(0, 10), value])
  }
  return data
}
