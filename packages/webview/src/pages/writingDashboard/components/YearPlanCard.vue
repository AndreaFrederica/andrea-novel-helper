<template>
  <div class="year-card">
    <div class="head">
      <q-icon name="track_changes" color="pink-5" />
      <span>年计划</span>
      <q-input dense borderless class="year-input" :model-value="plan.year" @update:model-value="update({ year: Number($event) || plan.year })" />
    </div>
    <q-input dense borderless class="title-input" :model-value="plan.title" @update:model-value="update({ title: String($event) })" />
    <div class="tags">
      <q-chip v-for="tag in plan.tags" :key="tag" dense color="pink-1" text-color="pink-8">{{ tag }}</q-chip>
    </div>
    <div class="progress-line">
      <q-input dense borderless :model-value="plan.category" @update:model-value="update({ category: String($event) })" />
      <q-slider dense :model-value="Math.round(plan.progress * 100)" :min="0" :max="100" color="pink-4" @update:model-value="update({ progress: Number($event) / 100 })" />
      <b>{{ plan.completedGoals }}/{{ plan.totalGoals }} 已完成</b>
    </div>
    <div class="ring">
      <q-circular-progress show-value :value="Math.round(plan.progress * 100)" size="72px" color="pink-4" track-color="pink-1">{{ Math.round(plan.progress * 100) }}%</q-circular-progress>
      <div>
        <strong>目标进度</strong>
        <span>已完成 {{ plan.completedGoals }} / 共 {{ plan.totalGoals }} 个目标</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { YearPlan } from '../sampleData'

const props = defineProps<{
  plan: YearPlan
}>()

const emit = defineEmits<{
  'update:plan': [plan: YearPlan]
}>()

function update(patch: Partial<YearPlan>) {
  emit('update:plan', { ...props.plan, ...patch })
}
</script>

<style scoped>
.year-card {
  height: 100%;
  display: grid;
  align-content: start;
  gap: 12px;
  color: var(--dash-page-fg);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-weight: 700;
}

.title-input {
  color: var(--dash-accent);
  font-size: 16px;
  font-weight: 800;
}

.year-input {
  width: 62px;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.progress-line {
  display: grid;
  gap: 6px;
  color: var(--dash-text-secondary);
  font-size: 12px;
}

.ring {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  background: var(--dash-panel-bg2);
}

.ring div {
  display: grid;
  gap: 4px;
}

.ring span {
  color: var(--dash-text-muted2);
  font-size: 12px;
}
</style>
