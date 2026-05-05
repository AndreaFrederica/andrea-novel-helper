<template>
  <div class="quadrant-app">
    <header class="quadrant-toolbar">
      <q-input
        v-model="searchQuery"
        dense
        outlined
        placeholder="搜索任务..."
        class="search-input"
        clearable
      >
        <template #prepend><q-icon name="search" size="16px" /></template>
      </q-input>
      <q-select
        v-model="statusFilter"
        dense
        outlined
        :options="statusOptions"
        class="status-select"
      />
      <q-btn dense flat icon="add" class="add-btn" @click="addTask('do')" />
    </header>

    <main class="quadrant-grid">
      <section
        v-for="quadrant in quadrants"
        :key="quadrant.key"
        class="quadrant-panel"
        :class="quadrant.key"
      >
        <header class="quadrant-head">
          <div>
            <div class="quadrant-title">{{ quadrant.title }}</div>
            <div class="quadrant-sub">{{ quadrant.subtitle }}</div>
          </div>
          <div class="quadrant-actions">
            <span class="task-count">{{ quadrantLists[quadrant.key].length }}</span>
            <q-btn dense flat round icon="add" @click="addTask(quadrant.key)" />
          </div>
        </header>

        <VueDraggable
          v-model="quadrantLists[quadrant.key]"
          group="quadrant-tasks"
          item-key="id"
          class="quadrant-list"
          ghost-class="drag-ghost"
          chosen-class="drag-chosen"
          @end="onDragEnd"
        >
          <article
            v-for="task in quadrantLists[quadrant.key]"
            :key="task.id"
            class="quadrant-task"
            :class="{ done: task.status === 'done' }"
            :style="{ '--task-color': task.color }"
            @click="openEditor(task)"
          >
            <div class="task-main-row">
              <q-checkbox
                dense
                :model-value="task.status === 'done'"
                @update:model-value="toggleStatus(task.id)"
                @click.stop
              />
              <span class="task-title">{{ task.title }}</span>
              <span class="priority-pill">{{ priorityLabel(task.priority) }}</span>
            </div>
            <div v-if="task.description" class="task-desc">{{ task.description }}</div>
            <div class="task-meta-row">
              <span>{{ task.group || '默认' }}</span>
              <span>{{ dueLabel(task) }}</span>
              <span v-if="task.subtasks.length">子 {{ completedSubtasks(task) }}/{{ task.subtasks.length }}</span>
            </div>
            <div class="progress-bar">
              <span :style="{ width: `${clampedProgress(task.progress)}%` }" />
            </div>
          </article>
          <div v-if="quadrantLists[quadrant.key].length === 0" class="empty-state">
            暂无任务
          </div>
        </VueDraggable>
      </section>
    </main>

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
import { computed, reactive, ref, watch } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import type { Task } from '../sampleData'
import TaskEditor from './TaskEditor.vue'

type QuadrantKey = 'do' | 'schedule' | 'delegate' | 'archive'

const props = defineProps<{ tasks: Task[]; windowId?: string }>()
const emit = defineEmits<{ 'update:tasks': [tasks: Task[]] }>()

const quadrants: Array<{
  key: QuadrantKey
  title: string
  subtitle: string
  important: boolean
  urgent: boolean
}> = [
  { key: 'do', title: '立即处理', subtitle: '重要且紧急', important: true, urgent: true },
  { key: 'schedule', title: '计划推进', subtitle: '重要不紧急', important: true, urgent: false },
  { key: 'delegate', title: '快速处理', subtitle: '不重要但紧急', important: false, urgent: true },
  { key: 'archive', title: '低优先级', subtitle: '不重要不紧急', important: false, urgent: false },
]

const statusOptions = ['未完成', '全部', '已完成']
const searchQuery = ref('')
const statusFilter = ref('未完成')
const editorOpen = ref(false)
const editingTask = ref<Task | null>(null)

const quadrantLists = reactive<Record<QuadrantKey, Task[]>>({
  do: [],
  schedule: [],
  delegate: [],
  archive: [],
})

const visibleTasks = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return props.tasks
    .filter(task => {
      if (statusFilter.value === '未完成' && task.status === 'done') return false
      if (statusFilter.value === '已完成' && task.status !== 'done') return false
      if (!q) return true
      return [
        task.title,
        task.description,
        task.group,
        ...task.tags,
      ].some(value => value.toLowerCase().includes(q))
    })
    .sort((a, b) => quadrantSortScore(a) - quadrantSortScore(b))
})

watch(visibleTasks, syncQuadrants, { immediate: true })

function syncQuadrants() {
  for (const quadrant of quadrants) {
    quadrantLists[quadrant.key] = visibleTasks.value
      .filter(task => getQuadrantKey(task) === quadrant.key)
      .map(task => ({ ...task }))
  }
}

function getQuadrantKey(task: Task): QuadrantKey {
  const important = task.priority === 'high'
  const urgent = isUrgent(task)
  if (important && urgent) return 'do'
  if (important) return 'schedule'
  if (urgent) return 'delegate'
  return 'archive'
}

function isUrgent(task: Task) {
  if (task.status === 'done') return false
  return Math.max(task.start, task.end) <= endOfDay(addDays(Date.now(), 3))
}

function onDragEnd() {
  const patchMap = new Map<string, Task>()
  for (const quadrant of quadrants) {
    for (const task of quadrantLists[quadrant.key]) {
      patchMap.set(task.id, applyQuadrant(task, quadrant.key))
    }
  }
  emit('update:tasks', props.tasks.map(task => patchMap.get(task.id) ?? task))
}

function applyQuadrant(task: Task, key: QuadrantKey): Task {
  const quadrant = quadrants.find(item => item.key === key)
  if (!quadrant) return task
  const duration = Math.max(60 * 60 * 1000, Math.abs(task.end - task.start))
  const start = Math.min(task.start, task.end)
  const end = quadrant.urgent
    ? Math.min(Math.max(task.start, task.end), endOfDay(addDays(Date.now(), 3)))
    : Math.max(Math.max(task.start, task.end), endOfDay(addDays(Date.now(), 14)))
  return {
    ...task,
    priority: quadrant.important ? 'high' : task.priority === 'high' ? 'medium' : task.priority,
    start: Math.min(start, end - duration),
    end,
  }
}

function quadrantSortScore(task: Task) {
  const statusScore = task.status === 'done' ? 10_000_000_000 : 0
  const priorityScore = task.priority === 'high' ? 0 : task.priority === 'medium' ? 1_000_000 : 2_000_000
  return statusScore + priorityScore + Math.max(task.start, task.end)
}

function toggleStatus(id: string) {
  emit('update:tasks', props.tasks.map(task =>
    task.id === id
      ? { ...task, status: task.status === 'done' ? 'todo' : 'done', progress: task.status === 'done' ? task.progress : 100 }
      : task
  ))
}

function addTask(key: QuadrantKey) {
  const now = startOfDay(Date.now())
  const quadrant = quadrants.find(item => item.key === key) ?? quadrants[0]!
  const end = quadrant.urgent ? endOfDay(addDays(now, 1)) : endOfDay(addDays(now, 14))
  const task: Task = {
    id: `t-${Date.now()}`,
    title: '新任务',
    description: '',
    status: 'todo',
    priority: quadrant.important ? 'high' : 'medium',
    tags: [],
    group: '默认',
    start: now,
    end,
    progress: 0,
    color: quadrant.important ? '#d94a9b' : '#5d7bd5',
    subtasks: [],
  }
  emit('update:tasks', [...props.tasks, task])
  openEditor(task)
}

function openEditor(task: Task) {
  editingTask.value = task
  editorOpen.value = true
}

function onSaveTask(task: Task) {
  emit('update:tasks', props.tasks.map(item => item.id === task.id ? task : item))
}

function onRemoveTask(id: string) {
  emit('update:tasks', props.tasks.filter(task => task.id !== id))
}

function priorityLabel(priority: Task['priority']) {
  if (priority === 'high') return '重要'
  if (priority === 'medium') return '中'
  return '低'
}

function dueLabel(task: Task) {
  const end = Math.max(task.start, task.end)
  const today = startOfDay(Date.now())
  const days = Math.ceil((startOfDay(end) - today) / (24 * 60 * 60 * 1000))
  if (task.status === 'done') return '已完成'
  if (days < 0) return `逾期 ${Math.abs(days)} 天`
  if (days === 0) return '今天截止'
  if (days === 1) return '明天截止'
  return `${days} 天后`
}

function completedSubtasks(task: Task) {
  return task.subtasks.filter(item => item.done).length
}

function clampedProgress(value: number) {
  return Math.min(100, Math.max(0, value))
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
</script>

<style scoped>
.quadrant-app {
  container: task-quadrant / inline-size;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: var(--dash-page-fg);
}

.quadrant-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.search-input {
  flex: 1 1 220px;
  min-width: 0;
}

.status-select {
  width: 112px;
}

.add-btn {
  width: 34px;
  height: 34px;
  color: #fff;
  background: var(--dash-accent);
  border-radius: 6px;
}

.quadrant-grid {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
}

.quadrant-panel {
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--dash-border-light);
  border-radius: 8px;
  background: color-mix(in srgb, var(--dash-window-bg) 94%, var(--quadrant-color));
  overflow: hidden;
}

.quadrant-panel.do {
  --quadrant-color: #d94a9b;
}

.quadrant-panel.schedule {
  --quadrant-color: #5d7bd5;
}

.quadrant-panel.delegate {
  --quadrant-color: #f0b83a;
}

.quadrant-panel.archive {
  --quadrant-color: #7b8794;
}

.quadrant-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--dash-border-lighter);
  background: color-mix(in srgb, var(--quadrant-color) 10%, transparent);
}

.quadrant-title {
  font-size: 13px;
  font-weight: 800;
  color: var(--dash-title-fg);
}

.quadrant-sub {
  margin-top: 2px;
  font-size: 11px;
  color: var(--dash-text-secondary);
}

.quadrant-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.task-count {
  min-width: 24px;
  height: 22px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--quadrant-color) 22%, transparent);
  color: var(--dash-page-fg);
  font-size: 12px;
  font-weight: 800;
}

.quadrant-list {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  overflow: auto;
  scrollbar-width: thin;
}

.quadrant-task {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid color-mix(in srgb, var(--task-color) 45%, var(--dash-border-light));
  border-left: 4px solid var(--task-color);
  border-radius: 7px;
  background: color-mix(in srgb, var(--task-color) 12%, var(--dash-panel-bg));
  cursor: pointer;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.14);
}

.quadrant-task:hover {
  border-color: color-mix(in srgb, var(--task-color) 68%, var(--dash-border-light));
  transform: translateY(-1px);
}

.quadrant-task.done {
  opacity: 0.62;
}

.task-main-row,
.task-meta-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.task-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 800;
}

.priority-pill {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--task-color) 28%, transparent);
  font-size: 11px;
  font-weight: 700;
}

.task-desc {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--dash-text-secondary);
  font-size: 12px;
  line-height: 1.35;
}

.task-meta-row {
  flex-wrap: wrap;
  color: var(--dash-text-muted2);
  font-size: 11px;
}

.progress-bar {
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dash-page-fg) 9%, transparent);
}

.progress-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--task-color);
}

.empty-state {
  min-height: 72px;
  display: grid;
  place-items: center;
  border: 1px dashed var(--dash-border-light);
  border-radius: 7px;
  color: var(--dash-text-muted2);
  font-size: 12px;
}

.drag-ghost {
  opacity: 0.42;
}

.drag-chosen {
  cursor: grabbing;
}

@container task-quadrant (max-width: 720px) {
  .quadrant-grid {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: repeat(4, minmax(180px, 1fr));
  }
}

@container task-quadrant (max-width: 460px) {
  .quadrant-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .search-input,
  .status-select {
    width: 100%;
    flex-basis: auto;
  }

  .add-btn {
    width: 100%;
  }
}
</style>
