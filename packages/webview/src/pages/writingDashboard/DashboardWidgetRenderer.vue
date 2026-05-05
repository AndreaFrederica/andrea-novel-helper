<template>
  <!-- 各 widget 只接收自己需要的数据片段，不共享全局 state，避免联动重渲染 -->
  <EnergyBars
    v-if="type === 'energy'"
    :metrics="energyMetrics"
    @update:metrics="$emit('update:energyMetrics', $event)"
  />
  <LifeHeatmap
    v-else-if="type === 'heatmap'"
    :data="heatmapData"
  />
  <ClockCard
    v-else-if="type === 'clock'"
  />
  <ProfileCard
    v-else-if="type === 'profile'"
    :profile="profile"
    @update:profile="$emit('update:profile', $event)"
  />
  <TaskGantt
    v-else-if="type === 'gantt'"
    :tasks="tasks"
    :window-id="windowId ?? ''"
    @update:tasks="$emit('update:tasks', $event)"
  />
  <TaskQuadrant
    v-else-if="type === 'quadrant'"
    :tasks="tasks"
    :window-id="windowId ?? ''"
    @update:tasks="$emit('update:tasks', $event)"
  />
  <MarkdownPlanCard
    v-else-if="type === 'plan'"
    :markdown="planMarkdown"
    :file-path="planFilePath"
    :plan-files="planFiles"
    :selected-plan-file="selectedPlanFile"
    :window-id="windowId ?? ''"
    @update:markdown="$emit('update:planMarkdown', $event)"
    @select-file="$emit('selectPlanFile', $event)"
    @create-file="$emit('createPlanFile', $event)"
    @open-file="$emit('openPlanFile')"
  />
  <TaskListBoard
    v-else-if="type === 'tasks'"
    :tasks="tasks"
    :window-id="windowId ?? ''"
    @update:tasks="$emit('update:tasks', $event)"
  />
  <YearPlanCard
    v-else-if="type === 'yearPlan'"
    :plan="yearPlan"
    @update:plan="$emit('update:yearPlan', $event)"
  />
  <LogTable
    v-else-if="type === 'logs'"
    :logs="logs"
  />
  <TimerCard
    v-else-if="type === 'timer'"
    :window-id="windowId ?? ''"
  />
  <div v-else class="missing">未知组件：{{ type }}</div>
</template>

<script setup lang="ts">
import type {
  EnergyMetric,
  DashboardProfile,
  DashboardLog,
  Task,
  YearPlan,
  WidgetType,
  DashboardPlanFile,
} from './sampleData'
import { buildHeatmapData } from './sampleData'
import EnergyBars from './components/EnergyBars.vue'
import LifeHeatmap from './components/LifeHeatmap.vue'
import ClockCard from './components/ClockCard.vue'
import ProfileCard from './components/ProfileCard.vue'
import TaskGantt from './components/TaskGantt.vue'
import TaskQuadrant from './components/TaskQuadrant.vue'
import MarkdownPlanCard from './components/MarkdownPlanCard.vue'
import TaskListBoard from './components/TaskListBoard.vue'
import YearPlanCard from './components/YearPlanCard.vue'
import LogTable from './components/LogTable.vue'
import TimerCard from './components/TimerCard.vue'

/* ── Props：每个 widget 只订阅自己需要的数据片段 ─── */
defineProps<{
  type: WidgetType
  windowId?: string
  energyMetrics: EnergyMetric[]
  tasks: Task[]
  logs: DashboardLog[]
  profile: DashboardProfile
  yearPlan: YearPlan
  planMarkdown: string
  planFilePath?: string | undefined
  planFiles?: DashboardPlanFile[] | undefined
  selectedPlanFile?: string | undefined
}>()

/* ── Emits：独立的数据更新通道 ─────────────── */
defineEmits<{
  'update:energyMetrics': [metrics: EnergyMetric[]]
  'update:tasks': [tasks: Task[]]
  'update:logs': [logs: DashboardLog[]]
  'update:profile': [profile: DashboardProfile]
  'update:yearPlan': [plan: YearPlan]
  'update:planMarkdown': [markdown: string]
  selectPlanFile: [fileName: string]
  createPlanFile: [fileName: string]
  openPlanFile: []
}>()

const heatmapData = buildHeatmapData()
</script>

<style scoped>
.missing {
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--dash-text-secondary);
}
</style>
