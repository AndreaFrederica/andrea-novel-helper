<template>
  <div class="year-card">
    <header class="year-head">
      <div class="year-title">
        <q-icon name="track_changes" color="pink-5" size="18px" />
        <q-input
          dense
          borderless
          class="title-input"
          :model-value="plan.title"
          @update:model-value="update({ title: String($event) })"
        />
      </div>
      <div class="year-controls">
        <q-input
          v-if="!yearOptions.length"
          dense
          outlined
          type="number"
          class="year-input"
          :model-value="plan.year"
          @update:model-value="update({ year: Number($event) || plan.year })"
        />
        <q-select
          v-else
          dense
          outlined
          class="year-select"
          :model-value="selectedYear || plan.year"
          :options="yearOptions"
          emit-value
          map-options
          @update:model-value="$emit('selectYear', Number($event))"
        />
        <q-btn dense flat round icon="add" @click="openYearDialog">
          <q-tooltip>新建年份</q-tooltip>
        </q-btn>
      </div>
    </header>

    <div class="summary-row">
      <q-input
        dense
        outlined
        class="category-input"
        :model-value="plan.category"
        @update:model-value="update({ category: String($event) })"
      />
      <q-input
        dense
        outlined
        autogrow
        class="summary-input"
        :model-value="plan.summary || ''"
        @update:model-value="update({ summary: String($event) })"
      />
    </div>

    <section class="progress-strip">
      <div class="ring">
        <q-circular-progress
          show-value
          :value="progressPercent"
          size="72px"
          color="pink-5"
          track-color="pink-1"
        >
          {{ progressPercent }}%
        </q-circular-progress>
      </div>
      <div class="progress-main">
        <div class="progress-meta">
          <b>{{ completedGoals }}/{{ totalGoals }} 目标</b>
          <span>{{ activeQuarterLabel }}</span>
        </div>
        <q-slider
          dense
          :model-value="progressPercent"
          :min="0"
          :max="100"
          color="pink-5"
          @update:model-value="update({ progress: Number($event) / 100 })"
        />
      </div>
    </section>

    <section class="tag-editor">
      <q-chip
        v-for="tag in plan.tags"
        :key="tag"
        dense
        removable
        color="pink-1"
        text-color="pink-8"
        @remove="removeTag(tag)"
      >
        {{ tag }}
      </q-chip>
      <q-input
        dense
        borderless
        class="tag-input"
        placeholder="添加标签"
        v-model="tagDraft"
        @keyup.enter="addTag"
      >
        <template #append>
          <q-btn dense flat round icon="add" @click="addTag" />
        </template>
      </q-input>
    </section>

    <section class="goal-list">
      <div class="goal-list-head">
        <span>年度目标</span>
        <q-btn dense flat round icon="add_task" @click="addGoal">
          <q-tooltip>添加目标</q-tooltip>
        </q-btn>
      </div>
      <div class="goal-scroll">
        <div
          v-for="goal in goals"
          :key="goal.id"
          class="goal-row"
          :class="goal.status"
        >
          <q-select
            dense
            outlined
            class="quarter-select"
            :model-value="goal.quarter"
            :options="quarterOptions"
            emit-value
            map-options
            @update:model-value="patchGoal(goal.id, { quarter: $event })"
          />
          <q-input
            dense
            outlined
            class="goal-title"
            :model-value="goal.title"
            @update:model-value="patchGoal(goal.id, { title: String($event) })"
          />
          <q-select
            dense
            outlined
            class="status-select"
            :model-value="goal.status"
            :options="statusOptions"
            emit-value
            map-options
            @update:model-value="patchGoal(goal.id, { status: $event })"
          />
          <q-slider
            dense
            class="goal-progress"
            :model-value="goal.progress"
            :min="0"
            :max="100"
            color="pink-5"
            @update:model-value="patchGoal(goal.id, { progress: Number($event) })"
          />
          <q-btn dense flat round icon="close" @click="removeGoal(goal.id)">
            <q-tooltip>移除目标</q-tooltip>
          </q-btn>
        </div>
      </div>
    </section>

    <WindowModal
      v-model="yearDialogOpen"
      title="新建年计划"
      icon="event"
      modal-id="year-plan-create"
      :width="320"
      modal
    >
        <div class="year-dialog-body">
          <q-input
            v-model.number="yearDraft"
            dense
            outlined
            autofocus
            type="number"
            label="年份"
            @keyup.enter="createYear"
          />
        </div>
        <template #footer>
          <q-btn flat label="取消" @click="yearDialogOpen = false" />
          <q-btn unelevated color="pink-5" label="创建" @click="createYear" />
        </template>
    </WindowModal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DashboardYearPlanFile, YearPlan, YearPlanGoal } from '../sampleData'
import WindowModal from './WindowModal.vue'

const props = defineProps<{
  plan: YearPlan
  files?: DashboardYearPlanFile[] | undefined
  selectedYear?: number | undefined
}>()

const emit = defineEmits<{
  'update:plan': [plan: YearPlan]
  selectYear: [year: number]
}>()

const tagDraft = ref('')
const yearDialogOpen = ref(false)
const yearDraft = ref(new Date().getFullYear())
const quarterOptions = [
  { label: 'Q1', value: 'Q1' },
  { label: 'Q2', value: 'Q2' },
  { label: 'Q3', value: 'Q3' },
  { label: 'Q4', value: 'Q4' }
]
const statusOptions = [
  { label: '未开始', value: 'todo' },
  { label: '进行中', value: 'doing' },
  { label: '完成', value: 'done' }
]

const goals = computed(() => props.plan.goals || [])
const yearOptions = computed(() => (props.files || [])
  .map(file => ({ label: String(file.year), value: file.year }))
  .sort((a, b) => b.value - a.value)
)
const completedGoals = computed(() => goals.value.filter(goal => goal.status === 'done').length)
const totalGoals = computed(() => Math.max(1, goals.value.length || props.plan.totalGoals || 1))
const progressPercent = computed(() => Math.round(Math.min(1, Math.max(0, props.plan.progress || 0)) * 100))
const activeQuarterLabel = computed(() => {
  const active = goals.value.find(goal => goal.status === 'doing') || goals.value.find(goal => goal.status === 'todo')
  return active ? `${active.quarter} · ${active.title}` : '年度目标已完成'
})

function update(patch: Partial<YearPlan>) {
  const nextGoals = patch.goals || props.plan.goals || []
  const done = nextGoals.filter(goal => goal.status === 'done').length
  emit('update:plan', {
    ...props.plan,
    ...patch,
    completedGoals: done,
    totalGoals: nextGoals.length || patch.totalGoals || props.plan.totalGoals,
  })
}

function patchGoal(id: string, patch: Partial<YearPlanGoal>) {
  const nextGoals = goals.value.map(goal => goal.id === id
    ? { ...goal, ...patch, progress: patch.status === 'done' ? 100 : patch.progress ?? goal.progress }
    : goal
  )
  update({ goals: nextGoals, progress: averageProgress(nextGoals) })
}

function addGoal() {
  const nextGoals: YearPlanGoal[] = [
    ...goals.value,
    {
      id: `yg-${Date.now()}`,
      title: '新年度目标',
      quarter: `Q${Math.min(4, goals.value.length + 1)}` as YearPlanGoal['quarter'],
      status: 'todo',
      progress: 0
    }
  ]
  update({ goals: nextGoals, progress: averageProgress(nextGoals) })
}

function removeGoal(id: string) {
  const nextGoals = goals.value.filter(goal => goal.id !== id)
  update({ goals: nextGoals, progress: averageProgress(nextGoals) })
}

function addTag() {
  const tag = tagDraft.value.trim()
  if (!tag || props.plan.tags.includes(tag)) return
  update({ tags: [...props.plan.tags, tag] })
  tagDraft.value = ''
}

function removeTag(tag: string) {
  update({ tags: props.plan.tags.filter(item => item !== tag) })
}

function openYearDialog() {
  yearDraft.value = (props.selectedYear || props.plan.year || new Date().getFullYear()) + 1
  yearDialogOpen.value = true
}

function createYear() {
  const year = Number(yearDraft.value)
  if (!Number.isFinite(year) || year < 1900 || year > 3000) return
  yearDialogOpen.value = false
  emit('selectYear', Math.round(year))
}

function averageProgress(items: YearPlanGoal[]) {
  if (items.length === 0) return 0
  return items.reduce((sum, item) => sum + Math.min(100, Math.max(0, item.progress)), 0) / items.length / 100
}
</script>

<style scoped>
.year-card {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto auto auto minmax(0, 1fr);
  gap: 10px;
  color: var(--dash-page-fg);
  overflow: hidden;
}

.year-head,
.year-title,
.progress-strip,
.progress-meta,
.tag-editor,
.goal-list-head,
.goal-row {
  min-width: 0;
  display: flex;
  align-items: center;
}

.year-head {
  justify-content: space-between;
  gap: 10px;
}

.year-title {
  flex: 1;
  gap: 6px;
}

.title-input {
  flex: 1;
  color: var(--dash-accent);
  font-size: 16px;
  font-weight: 800;
}

.year-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.year-input,
.year-select {
  width: 124px;
  flex-shrink: 0;
}

.year-dialog-body {
  display: grid;
  gap: 12px;
}

.summary-row {
  display: grid;
  grid-template-columns: minmax(92px, 0.32fr) 1fr;
  gap: 8px;
}

.category-input,
.summary-input {
  font-size: 12px;
}

.progress-strip {
  gap: 12px;
  padding: 10px;
  border: 1px solid var(--dash-window-border);
  border-radius: 8px;
  background: var(--dash-panel-bg2);
}

.ring {
  flex-shrink: 0;
}

.progress-main {
  min-width: 0;
  flex: 1;
}

.progress-meta {
  justify-content: space-between;
  gap: 10px;
  color: var(--dash-text-secondary);
  font-size: 12px;
}

.progress-meta span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-editor {
  flex-wrap: wrap;
  gap: 4px;
}

.tag-input {
  min-width: 112px;
  flex: 1;
}

.goal-list {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 6px;
  overflow: hidden;
}

.goal-scroll {
  min-height: 0;
  overflow: auto;
  display: grid;
  align-content: start;
  gap: 6px;
  padding-right: 2px;
}

.goal-list-head {
  justify-content: space-between;
  color: var(--dash-text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.goal-row {
  gap: 6px;
  min-height: 48px;
  padding: 6px;
  border: 1px solid var(--dash-window-border);
  border-radius: 7px;
  background: var(--dash-window-bg);
}

.goal-row.done {
  opacity: 0.72;
}

.quarter-select {
  width: 82px;
  flex-shrink: 0;
}

.goal-title {
  min-width: 120px;
  flex: 1;
}

.status-select {
  width: 82px;
  flex-shrink: 0;
}

.goal-progress {
  width: 88px;
  flex-shrink: 0;
}

@media (max-width: 720px) {
  .summary-row {
    grid-template-columns: 1fr;
  }

  .goal-row {
    flex-wrap: wrap;
    padding: 6px;
  }

  .goal-progress {
    width: 100%;
  }
}
</style>
