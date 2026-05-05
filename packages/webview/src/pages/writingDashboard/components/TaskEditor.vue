<template>
  <WindowModal
    v-model="dialogOpen"
    v-bind="modalProps"
  >
    <div class="editor-body-inner">
        <div class="form-grid">
          <!-- 标题 -->
          <q-input v-model="form.title" outlined label="标题" dense />

          <!-- 描述 -->
          <q-input v-model="form.description" outlined label="描述" type="textarea" autogrow dense />

          <!-- 状态 & 优先级 -->
          <div class="row gap">
            <q-select v-model="form.status" outlined label="状态" :options="statusOptions" dense class="col" emit-value map-options />
            <q-select v-model="form.priority" outlined label="优先级" :options="priorityOptions" dense class="col" emit-value map-options />
          </div>

          <!-- 日期范围（支持时分秒） -->
          <div class="row gap">
            <q-input
              :model-value="toDateTimeLocal(form.start)"
              outlined
              label="开始时间"
              dense
              type="datetime-local"
              class="col"
              @update:model-value="v => form.start = fromDateTimeLocal(String(v || ''))"
            />
            <q-input
              :model-value="toDateTimeLocal(form.end)"
              outlined
              label="结束时间"
              dense
              type="datetime-local"
              class="col"
              @update:model-value="v => form.end = fromDateTimeLocal(String(v || ''))"
            />
          </div>

          <!-- 标签 -->
          <div class="tag-section">
            <div class="tag-list">
              <q-chip
                v-for="(tag, i) in form.tags"
                :key="tag"
                dense
                removable
                color="pink-1"
                text-color="pink-8"
                @remove="removeTag(i)"
              >
                {{ tag }}
              </q-chip>
            </div>
            <q-input
              v-model="newTag"
              dense
              outlined
              placeholder="输入标签按回车添加"
              @keydown.enter.prevent="addTag"
            >
              <template #append>
                <q-btn dense flat icon="add" @click="addTag" />
              </template>
            </q-input>
          </div>

          <!-- 颜色 -->
          <div class="color-section">
            <span class="label">任务颜色</span>
            <div class="color-options">
              <span
                v-for="c in colorPresets"
                :key="c"
                :class="['color-dot', { active: form.color === c }]"
                :style="{ background: c }"
                @click="form.color = c"
              />
            </div>
          </div>

          <!-- 进度 -->
          <div class="progress-section">
            <span class="label">进度 {{ form.progress }}%</span>
            <q-slider v-model="form.progress" :min="0" :max="100" label color="pink-5" />
          </div>

          <!-- 子任务 -->
          <div class="subtask-section">
            <div class="subtask-header">
              <span class="label">子任务</span>
              <q-btn dense flat icon="add" label="添加" size="sm" @click="addSubtask" />
            </div>
            <div class="subtask-list">
              <div v-for="(sub, i) in form.subtasks" :key="sub.id" class="subtask-item">
                <q-checkbox v-model="sub.done" dense />
                <q-input v-model="sub.title" dense borderless class="subtask-input" />
                <q-btn dense flat round icon="delete" size="sm" color="negative" @click="removeSubtask(i)" />
              </div>
              <div v-if="form.subtasks.length === 0" class="empty-subtask">暂无子任务</div>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <q-btn flat color="negative" icon="delete" label="删除任务" @click="removeTask" />
        <q-space />
        <q-btn flat label="关闭" @click="close" />
        <q-btn color="pink-5" label="保存" @click="save" />
      </template>
    </WindowModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Task } from '../sampleData'
import { toDateTimeLocal, fromDateTimeLocal } from '../timeSystem'
import WindowModal from './WindowModal.vue'

const props = defineProps<{
  modelValue: boolean
  task: Task | null
  windowId?: string | undefined
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'save': [task: Task]
  'remove': [id: string]
}>()

const modalProps = computed(() => {
  const base: Record<string, unknown> = {
    title: '编辑任务',
    width: 560,
    modalId: `${props.windowId ?? 'standalone'}-task-editor`,
    persistent: true,
    maximizable: true,
    closable: true,
  }
  if (props.windowId) base.ownerId = props.windowId
  return base
})

const dialogOpen = ref(props.modelValue)
watch(() => props.modelValue, v => { dialogOpen.value = v })
watch(dialogOpen, v => { emit('update:modelValue', v) })

const statusOptions = [
  { label: '待办', value: 'todo' },
  { label: '进行中', value: 'doing' },
  { label: '已完成', value: 'done' }
]

const priorityOptions = [
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' }
]

const colorPresets = ['#d94a9b', '#db4ba5', '#f0b83a', '#c43aa0', '#e04a91', '#5d7bd5', '#84c66f', '#ef6262', '#65c0bd']

const newTag = ref('')

function makeForm(t: Task | null): Task {
  if (!t) {
    return {
      id: `t-${Date.now()}`,
      title: '新任务',
      description: '',
      status: 'todo',
      priority: 'medium',
      tags: [],
      group: '默认',
      start: new Date('2026-04-21T00:00:00').getTime(),
      end: new Date('2026-04-23T23:59:59').getTime(),
      progress: 0,
      color: '#d94a9b',
      subtasks: []
    }
  }
  return JSON.parse(JSON.stringify(t)) as Task
}

const form = ref<Task>(makeForm(props.task))

watch(() => props.task, (t) => {
  form.value = makeForm(t)
})

function close() {
  dialogOpen.value = false
}

function save() {
  emit('save', form.value)
  close()
}

function removeTask() {
  if (!props.task) return
  emit('remove', props.task.id)
  close()
}

function addTag() {
  const tag = newTag.value.trim()
  if (tag && !form.value.tags.includes(tag)) {
    form.value.tags.push(tag)
  }
  newTag.value = ''
}

function removeTag(i: number) {
  form.value.tags.splice(i, 1)
}

function addSubtask() {
  form.value.subtasks.push({
    id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: '新子任务',
    done: false
  })
}

function removeSubtask(i: number) {
  form.value.subtasks.splice(i, 1)
}
</script>

<style scoped>
.editor-body-inner {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-grid {
  display: grid;
  gap: 14px;
}

.row.gap {
  display: flex;
  gap: 12px;
}

.col {
  flex: 1;
  min-width: 0;
}

.tag-section {
  display: grid;
  gap: 6px;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.color-section {
  display: grid;
  gap: 6px;
}

.label {
  font-size: 12px;
  color: var(--dash-text-secondary);
}

.color-options {
  display: flex;
  gap: 8px;
}

.color-dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  transition: transform 0.15s;
}

.color-dot.active {
  border-color: var(--dash-page-fg);
  transform: scale(1.15);
}

.progress-section {
  display: grid;
  gap: 4px;
}

.subtask-section {
  border: 1px solid var(--dash-border-lighter);
  border-radius: 6px;
  padding: 10px;
}

.subtask-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.subtask-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.subtask-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border-radius: 4px;
  background: var(--dash-panel-bg2);
}

.subtask-input {
  flex: 1;
  min-width: 0;
}

.empty-subtask {
  color: var(--dash-text-secondary);
  font-size: 12px;
  text-align: center;
  padding: 8px;
}

</style>
