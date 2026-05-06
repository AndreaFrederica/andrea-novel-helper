<template>
  <div class="about-card">
    <section>
      <div class="about-title">
        <q-icon name="info" size="20px" />
        <span>Andrea Novel Helper</span>
      </div>
      <p>创作工作台用于集中管理写作热力、计划、任务、计时、年计划和项目概览。</p>
    </section>

    <section class="info-grid">
      <div>
        <span>工作台数据</span>
        <b>{{ fileCount }} 个路径</b>
      </div>
      <div>
        <span>布局存储</span>
        <b>{{ layoutFileName }}</b>
      </div>
      <div>
        <span>年计划</span>
        <b>{{ yearPlanFileName }}</b>
      </div>
      <div>
        <span>计划文件</span>
        <b>{{ planFileName }}</b>
      </div>
    </section>

    <section class="path-list">
      <div v-for="item in fileItems" :key="item.key" class="path-row">
        <span>{{ item.label }}</span>
        <code>{{ item.value }}</code>
      </div>
      <div v-if="!fileItems.length" class="empty">当前没有工作区数据路径。</div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  dashboardFiles?: Record<string, string> | undefined
}>()

const labels: Record<string, string> = {
  layoutPath: '布局',
  tasksPath: '任务',
  planDirPath: '计划目录',
  planPath: '当前计划',
  yearPlanDirPath: '年计划目录',
  yearPlanPath: '当前年计划',
}

const fileItems = computed(() => Object.entries(props.dashboardFiles || {})
  .filter(([, value]) => !!value)
  .map(([key, value]) => ({ key, label: labels[key] || key, value }))
)
const fileCount = computed(() => fileItems.value.length)
const layoutFileName = computed(() => basename(props.dashboardFiles?.layoutPath) || 'layout.json')
const yearPlanFileName = computed(() => basename(props.dashboardFiles?.yearPlanPath) || '<year>.json')
const planFileName = computed(() => basename(props.dashboardFiles?.planPath) || 'plan.md')

function basename(value?: string) {
  if (!value) return ''
  const parts = value.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || value
}
</script>

<style scoped>
.about-card {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 14px;
  color: var(--dash-page-fg);
}

.about-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--dash-accent-light);
  font-size: 18px;
  font-weight: 800;
}

p {
  margin: 8px 0 0;
  color: var(--dash-text-secondary);
  line-height: 1.6;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.info-grid > div {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--dash-window-border);
  border-radius: 8px;
  background: var(--dash-panel-bg2);
}

.info-grid span,
.path-row span {
  display: block;
  color: var(--dash-text-muted2);
  font-size: 12px;
}

.info-grid b {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  color: var(--dash-title-fg);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.path-list {
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 8px;
  overflow: auto;
}

.path-row {
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--dash-window-border);
  border-radius: 8px;
  background: var(--dash-window-bg);
}

code {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  color: var(--dash-accent-light);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  color: var(--dash-text-muted2);
  font-size: 12px;
}
</style>
