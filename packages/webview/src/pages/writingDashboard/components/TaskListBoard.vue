<template>
  <div class="report-app">
    <!-- 顶部工具栏 -->
    <header class="report-header">
      <q-btn-dropdown dense flat label="视图：报告" class="view-btn" />
      <div class="sep" />
      <span class="filter-label">任务筛选</span>
      <q-input
        v-model="searchQuery"
        dense
        outlined
        placeholder="搜索任务名称…"
        class="search-input"
        clearable
      >
        <template #prepend><q-icon name="search" size="16px" /></template>
      </q-input>
      <q-input dense outlined :model-value="currentDateLabel" readonly class="date-input">
        <template #append>
          <q-icon name="event" size="16px" class="date-picker-icon" />
        </template>
        <q-popup-proxy cover transition-show="scale" transition-hide="scale">
          <q-date v-model="currentDatePicker" minimal mask="YYYY/MM/DD" />
        </q-popup-proxy>
      </q-input>
      <q-btn dense flat icon="chevron_left" @click="shiftCurrentDate(-1)" />
      <q-btn dense flat class="today-btn" label="今天" @click="goToday" />
      <q-btn dense flat icon="chevron_right" @click="shiftCurrentDate(1)" />
      <q-btn dense flat icon="add" class="add-btn" @click="addTask" />
      <q-btn dense flat icon="settings" />
    </header>

    <!-- 筛选行 -->
    <div class="filter-row">
      <q-input dense outlined :model-value="dateStartLabel" label="开始" readonly class="range-input">
        <template #append>
          <q-icon name="event" size="16px" class="date-picker-icon" />
        </template>
        <q-popup-proxy cover transition-show="scale" transition-hide="scale">
          <q-date v-model="dateStartPicker" minimal mask="YYYY/MM/DD" />
        </q-popup-proxy>
      </q-input>
      <span class="range-sep">-</span>
      <q-input dense outlined :model-value="dateEndLabel" label="结束" readonly class="range-input">
        <template #append>
          <q-icon name="event" size="16px" class="date-picker-icon" />
        </template>
        <q-popup-proxy cover transition-show="scale" transition-hide="scale">
          <q-date v-model="dateEndPicker" minimal mask="YYYY/MM/DD" />
        </q-popup-proxy>
      </q-input>
      <q-select dense outlined v-model="filterStatus" :options="['全部', '已完成', '未完成']" class="status-select" />
      <q-btn dense flat icon="content_copy" label="Copy" class="copy-btn" />
    </div>

    <!-- 双列列表 -->
    <div class="report-body">
      <!-- 已完成 -->
      <section class="report-column">
        <h3 class="done-title">
          已完成任务 ({{ doneTasks.length }})
        </h3>
        <div class="list-wrap">
          <VueDraggable v-model="doneList" group="tasks" class="list-zone" @end="onDragEnd">
            <div
              v-for="task in doneTasks"
              :key="task.id"
              class="task-item"
              @click="openEditor(task)"
            >
              <q-checkbox
                dense
                :model-value="true"
                @update:model-value="toggleStatus(task.id)"
                @click.stop
              />
              <div class="task-meta">
                <div class="task-title-row">
                  <span class="task-color-dot" :style="{ background: task.color }" />
                  <span class="task-title">{{ task.title }}</span>
                  <q-chip v-if="task.priority === 'high'" dense size="sm" color="red-1" text-color="red-8">高</q-chip>
                  <q-chip v-else-if="task.priority === 'low'" dense size="sm" color="grey-3" text-color="grey-8">低</q-chip>
                </div>
                <div v-if="task.description" class="task-description">{{ task.description }}</div>
                <div class="task-extra">
                  <span class="task-group">{{ task.group }}</span>
                  <span class="task-range">{{ ts.formatDate(task.start) }} ~ {{ ts.formatDate(task.end) }}</span>
                  <q-chip
                    v-for="tag in task.tags.slice(0, 2)"
                    :key="tag"
                    dense
                    size="sm"
                    class="task-tag"
                  >
                    {{ tag }}
                  </q-chip>
                  <span v-if="task.subtasks.length > 0" class="subtask-count">
                    子 {{ task.subtasks.filter(s => s.done).length }}/{{ task.subtasks.length }}
                  </span>
                </div>
                <div class="task-progress">
                  <span class="task-progress-fill" :style="{ width: `${task.progress}%`, background: task.color }" />
                </div>
                <div v-if="task.subtasks.length > 0" class="subtask-preview">
                  <div
                    v-for="sub in task.subtasks.slice(0, 2)"
                    :key="sub.id"
                    :class="['subtask-preview-item', { done: sub.done }]"
                  >
                    <q-icon :name="sub.done ? 'check_box' : 'check_box_outline_blank'" size="14px" />
                    <span>{{ sub.title }}</span>
                  </div>
                  <span v-if="task.subtasks.length > 2" class="subtask-more">+{{ task.subtasks.length - 2 }}</span>
                </div>
              </div>
            </div>
          </VueDraggable>
        </div>
      </section>

      <!-- 未完成 -->
      <section class="report-column">
        <h3 class="todo-title">
          未完成任务 ({{ todoTasks.length }})
        </h3>
        <div class="list-wrap">
          <VueDraggable v-model="todoList" group="tasks" class="list-zone" @end="onDragEnd">
            <div
              v-for="task in todoTasks"
              :key="task.id"
              class="task-item"
              @click="openEditor(task)"
            >
              <q-checkbox
                dense
                :model-value="false"
                @update:model-value="toggleStatus(task.id)"
                @click.stop
              />
              <div class="task-meta">
                <div class="task-title-row">
                  <span class="task-color-dot" :style="{ background: task.color }" />
                  <span class="task-title">{{ task.title }}</span>
                  <q-chip v-if="task.priority === 'high'" dense size="sm" color="red-1" text-color="red-8">高</q-chip>
                  <q-chip v-else-if="task.priority === 'low'" dense size="sm" color="grey-3" text-color="grey-8">低</q-chip>
                </div>
                <div v-if="task.description" class="task-description">{{ task.description }}</div>
                <div class="task-extra">
                  <span class="task-group">{{ task.group }}</span>
                  <span class="task-range">{{ ts.formatDate(task.start) }} ~ {{ ts.formatDate(task.end) }}</span>
                  <q-chip
                    v-for="tag in task.tags.slice(0, 2)"
                    :key="tag"
                    dense
                    size="sm"
                    class="task-tag"
                  >
                    {{ tag }}
                  </q-chip>
                  <span v-if="task.subtasks.length > 0" class="subtask-count">
                    子 {{ task.subtasks.filter(s => s.done).length }}/{{ task.subtasks.length }}
                  </span>
                </div>
                <div class="task-progress">
                  <span class="task-progress-fill" :style="{ width: `${task.progress}%`, background: task.color }" />
                </div>
                <div v-if="task.subtasks.length > 0" class="subtask-preview">
                  <div
                    v-for="sub in task.subtasks.slice(0, 2)"
                    :key="sub.id"
                    :class="['subtask-preview-item', { done: sub.done }]"
                  >
                    <q-icon :name="sub.done ? 'check_box' : 'check_box_outline_blank'" size="14px" />
                    <span>{{ sub.title }}</span>
                  </div>
                  <span v-if="task.subtasks.length > 2" class="subtask-more">+{{ task.subtasks.length - 2 }}</span>
                </div>
              </div>
            </div>
          </VueDraggable>
        </div>
      </section>
    </div>

    <!-- 任务编辑器 -->
    <TaskEditor
      v-model="editorOpen"
      :task="editingTask"
      :window-id="windowId"
      @save="onSaveTask"
      @remove="onRemoveTask"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import type { Task } from '../sampleData'
import { getTimeSystem } from '../timeSystem'
import TaskEditor from './TaskEditor.vue'

const props = defineProps<{ tasks: Task[]; windowId?: string }>()
const emit = defineEmits<{ 'update:tasks': [tasks: Task[]] }>()

const searchQuery = ref('')
const filterStatus = ref('全部')
const ts = getTimeSystem('gregorian')
const currentDate = ref(startOfDay(Date.now()))
const dateStartPicker = ref(formatQDate(new Date('2026-01-01').getTime()))
const dateEndPicker = ref(formatQDate(new Date('2026-12-31').getTime()))
const editorOpen = ref(false)
const editingTask = ref<Task | null>(null)

const todoList = ref<Task[]>([])
const doneList = ref<Task[]>([])

const currentDateLabel = computed(() => formatCompactDate(currentDate.value))
const currentDatePicker = computed({
  get: () => formatQDate(currentDate.value),
  set(value: string) {
    const timestamp = parseQDate(value)
    if (timestamp !== null) currentDate.value = timestamp
  }
})
const dateStartLabel = computed(() => formatCompactDate(parseQDate(dateStartPicker.value) ?? Date.now()))
const dateEndLabel = computed(() => formatCompactDate(parseQDate(dateEndPicker.value) ?? Date.now()))
const rangeStart = computed(() => parseQDate(dateStartPicker.value) ?? 0)
const rangeEnd = computed(() => endOfDay(parseQDate(dateEndPicker.value) ?? Date.now()))

watch(() => props.tasks, (tasks) => {
  todoList.value = tasks.filter(t => t.status !== 'done').map(t => ({ ...t }))
  doneList.value = tasks.filter(t => t.status === 'done').map(t => ({ ...t }))
}, { immediate: true, deep: true })

const todoTasks = computed(() => {
  let list = filterByDateRange(todoList.value)
  if (filterStatus.value === '已完成') return []
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    list = list.filter(t => t.title.toLowerCase().includes(q))
  }
  return list
})

const doneTasks = computed(() => {
  let list = filterByDateRange(doneList.value)
  if (filterStatus.value === '未完成') return []
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    list = list.filter(t => t.title.toLowerCase().includes(q))
  }
  return list
})

function onDragEnd() {
  const merged = [
    ...todoList.value.map(t => ({ ...t, status: 'todo' as const })),
    ...doneList.value.map(t => ({ ...t, status: 'done' as const }))
  ]
  emit('update:tasks', merged)
}

function toggleStatus(id: string) {
  emit('update:tasks', props.tasks.map(t =>
    t.id === id ? { ...t, status: t.status === 'done' ? 'todo' : 'done' } : t
  ))
}

function openEditor(task: Task) {
  editingTask.value = task
  editorOpen.value = true
}

function addTask() {
  const start = currentDate.value
  const newTask: Task = {
    id: `t-${Date.now()}`,
    title: '新任务',
    description: '',
    status: 'todo',
    priority: 'medium',
    tags: [],
    group: '默认',
    start,
    end: endOfDay(addDays(start, 2)),
    progress: 0,
    color: '#d94a9b',
    subtasks: []
  }
  emit('update:tasks', [...props.tasks, newTask])
  openEditor(newTask)
}

function onSaveTask(task: Task) {
  emit('update:tasks', props.tasks.map(t => t.id === task.id ? task : t))
}

function onRemoveTask(id: string) {
  emit('update:tasks', props.tasks.filter(t => t.id !== id))
}

function filterByDateRange(tasks: Task[]) {
  return tasks.filter(task => taskOverlapsRange(task, rangeStart.value, rangeEnd.value))
}

function taskOverlapsRange(task: Task, start: number, end: number) {
  const taskStart = Math.min(task.start, task.end)
  const taskEnd = Math.max(task.start, task.end)
  return taskStart <= end && taskEnd >= start
}

function shiftCurrentDate(days: number) {
  currentDate.value = addDays(currentDate.value, days)
}

function goToday() {
  currentDate.value = startOfDay(Date.now())
}

function addDays(timestamp: number, days: number) {
  const d = new Date(timestamp)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

function startOfDay(timestamp: number) {
  const d = new Date(timestamp)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function endOfDay(timestamp: number) {
  return startOfDay(timestamp) + 24 * 60 * 60 * 1000 - 1
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function formatCompactDate(timestamp: number) {
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function formatQDate(timestamp: number) {
  const d = new Date(timestamp)
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`
}

function parseQDate(value: string): number | null {
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = new Date(year, month - 1, day).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}
</script>

<style scoped>
.report-app {
  height: 100%;
  container: task-list-board / inline-size;
  display: grid;
  grid-template-rows: auto auto 1fr;
  gap: 8px;
  overflow: hidden;
}

/* 顶部工具栏 */
.report-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--dash-border-light);
  background: var(--dash-toolbar-bg);
  flex-shrink: 0;
}

.view-btn {
  font-weight: 700;
}

.sep {
  width: 1px;
  height: 16px;
  background: var(--dash-border-lighter);
}

.filter-label {
  font-size: 12px;
  color: var(--dash-text-secondary);
  white-space: nowrap;
}

.search-input {
  flex: 1 1 160px;
  min-width: 120px;
}

.date-input {
  width: 108px;
  cursor: pointer;
}

.date-picker-icon {
  color: var(--dash-text-secondary);
  cursor: pointer;
}

.today-btn {
  background: var(--dash-accent);
  color: #fff;
  border-radius: 4px;
  padding: 0 10px;
}

.add-btn {
  background: var(--dash-accent);
  color: #fff;
  border-radius: 4px;
}

/* 筛选行 */
.filter-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 6px;
  flex-shrink: 0;
}

.range-input {
  width: 108px;
  cursor: pointer;
}

.range-sep {
  color: var(--dash-text-secondary);
}

.status-select {
  width: 100px;
}

.copy-btn {
  margin-left: auto;
}

/* 双列主体 */
.report-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  min-height: 0;
  overflow: hidden;
}

.report-column {
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.done-title {
  margin: 0 0 8px;
  padding-bottom: 5px;
  border-bottom: 2px solid var(--dash-done-bg);
  color: var(--dash-done);
  font-size: 14px;
  text-align: center;
}

.todo-title {
  margin: 0 0 8px;
  padding-bottom: 5px;
  border-bottom: 2px solid var(--dash-todo-bg);
  color: var(--dash-todo);
  font-size: 14px;
  text-align: center;
}

.list-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.list-zone {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.task-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  position: relative;
  padding: 8px;
  border-radius: 4px;
  background: var(--dash-window-bg);
  border: 1px solid var(--dash-border-lighter);
  cursor: pointer;
}

.task-item:hover {
  border-color: var(--dash-accent-light);
}

.task-meta {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 4px;
}

.task-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.task-color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px var(--dash-panel-bg);
}

.task-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dash-page-fg);
  font-size: 13px;
}

.task-description {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dash-text-secondary);
  font-size: 11px;
  line-height: 1.35;
}

.task-extra {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.task-group {
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--dash-panel-bg2);
  color: var(--dash-page-fg);
  font-size: 11px;
}

.task-range {
  color: var(--dash-text-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.task-tag {
  font-size: 10px;
}

.subtask-count {
  font-size: 11px;
  color: var(--dash-accent);
}

.task-progress {
  height: 4px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--dash-border-lighter);
}

.task-progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
}

.subtask-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}

.subtask-preview-item {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--dash-text-secondary);
  font-size: 11px;
}

.subtask-preview-item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subtask-preview-item.done {
  opacity: 0.65;
  text-decoration: line-through;
}

.subtask-more {
  flex-shrink: 0;
  color: var(--dash-accent);
  font-size: 11px;
}

@container task-list-board (max-width: 620px) {
  .report-app {
    gap: 10px;
  }

  .report-header,
  .filter-row {
    align-items: stretch;
  }

  .view-btn {
    flex: 0 0 auto;
  }

  .search-input {
    flex-basis: 100%;
    width: 100%;
  }

  .date-input {
    flex: 0 1 108px;
    width: auto;
    min-width: 0;
  }

  .filter-row {
    padding-bottom: 2px;
  }

  .range-input {
    flex: 0 1 108px;
    width: auto;
    min-width: 0;
  }

  .status-select {
    flex: 1 1 100px;
    width: auto;
    min-width: 0;
  }

  .copy-btn {
    margin-left: 0;
  }

  .report-body {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
  }

  .done-title,
  .todo-title {
    text-align: left;
  }
}

@container task-list-board (max-width: 420px) {
  .report-app {
    grid-template-rows: auto auto minmax(0, 1fr);
  }

  .sep,
  .filter-label,
  .range-sep {
    display: none;
  }

  .view-btn,
  .search-input,
  .date-input,
  .range-input,
  .status-select,
  .copy-btn {
    flex-basis: 100%;
    width: 100%;
  }

  .today-btn,
  .add-btn {
    flex: 1 1 0;
  }

  .task-item {
    padding: 7px;
  }

  .task-extra {
    align-items: flex-start;
  }

  .task-range {
    flex-basis: 100%;
    white-space: normal;
  }

  .subtask-preview {
    flex-wrap: wrap;
    overflow: visible;
  }
}
</style>
