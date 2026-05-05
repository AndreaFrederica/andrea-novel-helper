<template>
  <div :class="['widget-page', { 'no-header': !showHeader }]">
    <header v-if="showHeader">
      <div>
        <h1>{{ title }}</h1>
        <span v-if="!backendAvailable">独立调试模式，不持久化</span>
      </div>
      <q-btn dense flat icon="dashboard_customize" label="打开工作台" @click="openDashboard" />
    </header>
    <main>
      <div v-if="isLoading" class="widget-loading">
        <q-spinner size="22px" color="pink-5" />
        <span>正在加载组件数据…</span>
      </div>
      <DashboardWidgetRenderer
        v-else
        :type="type"
        :energy-metrics="state.energyMetrics"
        :tasks="state.tasks"
        :logs="state.logs"
        :profile="state.profile"
        :year-plan="state.yearPlan"
        :plan-markdown="state.planMarkdown"
        :plan-file-path="state.dashboardFiles?.planPath"
        :plan-files="state.planFiles"
        :selected-plan-file="state.selectedPlanFile"
        @update:energy-metrics="saveState({ ...state, energyMetrics: $event })"
        @update:tasks="saveState({ ...state, tasks: $event })"
        @update:logs="saveState({ ...state, logs: $event })"
        @update:profile="saveState({ ...state, profile: $event })"
        @update:year-plan="saveState({ ...state, yearPlan: $event })"
        @update:plan-markdown="saveState({ ...state, planMarkdown: $event })"
        @select-plan-file="selectPlanFile"
        @create-plan-file="createPlanFile"
        @open-plan-file="openPlanFile"
      />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import DashboardWidgetRenderer from './writingDashboard/DashboardWidgetRenderer.vue'
import { widgetTitles, type WidgetType } from './writingDashboard/sampleData'
import { useDashboardState } from './writingDashboard/useDashboardState'

const route = useRoute()
const { state, backendAvailable, isLoading, vscode, saveState, settings } = useDashboardState()

const type = computed<WidgetType>(() => {
  const id = String(route.params.id || 'energy')
  return id in widgetTitles ? id as WidgetType : 'energy'
})
const title = computed(() => widgetTitles[type.value])
const showHeader = computed(() => settings.value.widgetShowHeader)

function openDashboard() {
  vscode?.postMessage({ command: 'dashboard.openCommand', commandId: 'andrea.openWritingDashboard' })
}

function serializableDashboardState() {
  return JSON.parse(JSON.stringify(state.value))
}

function selectPlanFile(fileName: string) {
  if (!fileName || fileName === state.value.selectedPlanFile) return
  if (vscode) {
    vscode.postMessage({ command: 'dashboard.selectPlanFile', fileName, currentState: serializableDashboardState() })
    return
  }
  saveState({ ...state.value, selectedPlanFile: fileName })
}

function createPlanFile(fileName: string) {
  if (!fileName) return
  if (vscode) {
    vscode.postMessage({ command: 'dashboard.createPlanFile', fileName, currentState: serializableDashboardState() })
    return
  }
  saveState({
    ...state.value,
    selectedPlanFile: fileName,
    planFiles: [...(state.value.planFiles || []), { name: fileName, path: fileName }],
    planMarkdown: ''
  })
}

function openPlanFile() {
  vscode?.postMessage({ command: 'dashboard.openPlanFile', fileName: state.value.selectedPlanFile })
}

</script>

<style scoped>
.widget-page {
  height: 100vh;
  display: grid;
  grid-template-rows: 54px 1fr;
  overflow: hidden;
  background: var(--dash-page-bg);
  color: var(--dash-page-fg);
}

.widget-page.no-header {
  grid-template-rows: 1fr;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--dash-toolbar-border);
  background: var(--dash-toolbar-bg);
}

h1 {
  margin: 0;
  color: var(--dash-accent);
  font-size: 18px;
  line-height: 1.2;
}

span {
  color: var(--dash-text-secondary);
  font-size: 12px;
}

main {
  min-height: 0;
  padding: 14px;
  overflow: auto;
}

.widget-loading {
  height: 100%;
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--dash-text-secondary);
  font-size: 12px;
}
</style>
