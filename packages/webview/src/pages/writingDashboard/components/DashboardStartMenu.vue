<template>
  <button class="start-button" type="button" title="创作工作台">
    <q-icon name="dashboard_customize" size="16px" />
    <span>工作台</span>
    <q-menu
      anchor="top left"
      self="bottom left"
      :offset="[0, 8]"
      class="dashboard-start-menu"
    >
      <q-list dense>
        <q-item-label header>创作工作台</q-item-label>
        <q-item-label caption class="start-status">
          {{ backendAvailable ? '工作区存储：novel-helper/dashboard/' : '独立调试模式：仅使用内存默认数据，不持久化' }}
        </q-item-label>
        <q-separator />
        <q-item-label header>添加组件</q-item-label>
        <q-item
          v-for="option in widgetOptions"
          :key="option.type"
          clickable
          v-close-popup
          @click="$emit('addWindow', option.type)"
        >
          <q-item-section>{{ option.title }}</q-item-section>
        </q-item>
        <q-separator />
        <q-item clickable v-close-popup @click="$emit('toggleTiling')">
          <q-item-section avatar>
            <q-icon :name="tilingMode ? 'grid_goldenratio' : 'grid_view'" />
          </q-item-section>
          <q-item-section>{{ tilingMode ? '退出平铺' : '平铺布局' }}</q-item-section>
        </q-item>
        <q-item clickable v-close-popup @click="$emit('save')">
          <q-item-section avatar><q-icon name="save" /></q-item-section>
          <q-item-section>保存</q-item-section>
        </q-item>
        <q-item clickable v-close-popup @click="$emit('resetLayout')">
          <q-item-section avatar><q-icon name="restart_alt" /></q-item-section>
          <q-item-section>重置布局</q-item-section>
        </q-item>
        <q-item clickable v-close-popup @click="$emit('openSettings')">
          <q-item-section avatar><q-icon name="settings" /></q-item-section>
          <q-item-section>工作台设置</q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </button>
</template>

<script setup lang="ts">
import type { WidgetType } from '../sampleData'

defineProps<{
  backendAvailable: boolean
  widgetOptions: Array<{ type: WidgetType; title: string }>
  tilingMode: boolean
}>()

defineEmits<{
  addWindow: [type: WidgetType]
  toggleTiling: []
  save: []
  resetLayout: []
  openSettings: []
}>()
</script>

<style scoped>
.start-button {
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--dash-page-fg);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.start-button:hover {
  background: var(--dash-border-lighter);
  border-color: var(--dash-border-light);
}

.start-button :deep(.q-icon) {
  color: var(--dash-accent);
}

.start-status {
  display: block;
  max-width: 280px;
  padding: 0 16px 8px;
  color: var(--dash-text-secondary);
  white-space: normal;
  line-height: 1.35;
}
</style>
