<template>
  <div class="plan">
    <header class="plan-toolbar">
      <q-select
        dense
        outlined
        emit-value
        map-options
        class="plan-select"
        :model-value="selectedPlanFile"
        :options="planOptions"
        @update:model-value="emit('selectFile', String($event || ''))"
      />
      <q-btn dense flat icon="add" @click="createPlanFile">
        <q-tooltip>新建计划文件</q-tooltip>
      </q-btn>
      <q-btn dense flat icon="open_in_new" @click="emit('openFile')">
        <q-tooltip>在 VS Code 编辑器打开</q-tooltip>
      </q-btn>
    </header>
    <span class="file-path" :title="filePath">{{ filePath || 'novel-helper/dashboard/plan/plan.md' }}</span>
    <q-input
      class="editor"
      type="textarea"
      filled
      autogrow
      :model-value="markdown"
      @update:model-value="emit('update:markdown', String($event))"
    />

    <WindowModal
      v-model="createDialogOpen"
      v-bind="createModalProps"
    >
      <div class="create-plan-body">
        <q-input
          v-model="newPlanName"
          dense
          outlined
          autofocus
          label="计划文件名"
          hint="保存在 novel-helper/dashboard/plan/，会自动补 .md"
          @keydown.enter.prevent="submitCreatePlanFile"
        />
      </div>
      <template #footer>
        <q-btn flat label="取消" @click="createDialogOpen = false" />
        <q-btn color="pink-5" label="创建" :disable="!newPlanName.trim()" @click="submitCreatePlanFile" />
      </template>
    </WindowModal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DashboardPlanFile } from '../sampleData'
import WindowModal from './WindowModal.vue'

const props = defineProps<{
  markdown: string
  filePath?: string | undefined
  planFiles?: DashboardPlanFile[] | undefined
  selectedPlanFile?: string | undefined
  windowId?: string | undefined
}>()

const emit = defineEmits<{
  'update:markdown': [markdown: string]
  selectFile: [fileName: string]
  createFile: [fileName: string]
  openFile: []
}>()

const selectedPlanFile = computed(() => props.selectedPlanFile || props.planFiles?.[0]?.name || 'plan.md')
const createDialogOpen = ref(false)
const newPlanName = ref('')
const createModalProps = computed(() => {
  const base: Record<string, unknown> = {
    title: '新建计划文件',
    icon: 'note_add',
    width: 380,
    modalId: `${props.windowId || 'standalone'}-plan-create`,
  }
  if (props.windowId) base.ownerId = props.windowId
  return base
})
const planOptions = computed(() => {
  const files = props.planFiles?.length
    ? props.planFiles
    : [{ name: selectedPlanFile.value, path: props.filePath || '' }]
  return files.map(file => ({
    label: file.name,
    value: file.name
  }))
})

function createPlanFile() {
  const fallback = `plan-${new Date().toISOString().slice(0, 10)}.md`
  newPlanName.value = fallback
  createDialogOpen.value = true
}

function submitCreatePlanFile() {
  const name = newPlanName.value.trim()
  if (!name) return
  createDialogOpen.value = false
  emit('createFile', name)
}
</script>

<style scoped>
.plan {
  height: 100%;
  display: grid;
  grid-template-rows: auto auto 1fr;
  gap: 8px;
  overflow: hidden;
  color: var(--dash-page-fg);
}

.plan-toolbar {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--dash-text-secondary);
  font-size: 11px;
}

.plan-select {
  min-width: 0;
  flex: 1;
}

.plan-select :deep(.q-field__control) {
  min-height: 32px;
  height: 32px;
}

.plan-select :deep(.q-field__native),
.plan-select :deep(.q-field__append) {
  min-height: 32px;
}

.file-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dash-text-secondary);
  font-size: 11px;
}

.editor,
.editor :deep(.q-field__control),
.editor :deep(.q-field__native) {
  height: 100%;
  min-height: 100%;
}

.editor :deep(textarea) {
  resize: none;
  font-family: Consolas, 'Courier New', monospace;
  line-height: 1.6;
}

.create-plan-body {
  display: grid;
  gap: 10px;
}
</style>
