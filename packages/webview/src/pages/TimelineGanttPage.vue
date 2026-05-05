<template>
  <div class="timeline-gantt-page">
    <header class="timeline-gantt-header">
      <div class="header-actions">
        <q-toggle v-model="showRelations" dense label="关系" />
        <q-btn dense flat round icon="refresh" title="重新加载" @click="requestTimelineData" />
        <q-btn dense flat icon="save" title="保存文件" @click="saveTimelineData" />
      </div>
    </header>

    <main :class="['timeline-gantt-body', { 'with-relations': showRelations }]">
      <div v-if="isLoading" class="loading-state">
        <q-spinner size="22px" color="pink-5" />
        <span>正在读取时间线文件…</span>
      </div>
      <template v-else>
        <TaskGantt
          :tasks="tasks"
          window-id="timeline-gantt-editor"
          @update:tasks="onUpdateTasks"
        />
        <aside v-if="showRelations" class="relations-panel">
          <div class="relations-head">
            <div>
              <div class="panel-title">时间线检查器</div>
              <div class="panel-subtitle">{{ events.length }} 个事件，{{ validConnections.length }} / {{ connections.length }} 条关系</div>
            </div>
            <q-btn dense flat round icon="add" @click="inspectorTab === 'events' ? openEventEditor() : openConnectionEditor()" />
          </div>
          <q-tabs v-model="inspectorTab" dense class="inspector-tabs">
            <q-tab name="events" icon="event_note" label="事件" />
            <q-tab name="relations" icon="device_hub" label="关系" />
          </q-tabs>
          <div v-if="inspectorTab === 'events'" class="relation-list">
            <div
              v-for="event in events"
              :key="event.id"
              class="event-card"
              :style="{ '--event-color': event.color || timelineTypeColor(event) }"
            >
              <div class="event-card-main">
                <div class="event-card-title">
                  <span class="event-color-dot" />
                  <span>{{ event.title || event.id }}</span>
                </div>
                <div class="event-card-meta">
                  <span>{{ event.group || '默认' }}</span>
                  <span>{{ eventTypeLabel(event.type) }}</span>
                  <span v-if="event.data?.type">{{ eventDataTypeLabel(event.data.type) }}</span>
                </div>
                <div class="event-card-date">
                  {{ event.timeless ? '未定时间' : event.date }}
                  <template v-if="event.endDate"> - {{ event.endDate }}</template>
                </div>
                <div class="event-card-foot">
                  <span v-if="event.bindings?.length">{{ event.bindings.length }} 个绑定</span>
                  <span v-if="event.parentNode">子节点</span>
                </div>
              </div>
              <div class="relation-actions">
                <q-btn dense flat round icon="edit" size="sm" @click="openEventEditor(event)" />
                <q-btn dense flat round icon="delete" size="sm" color="negative" @click="removeEvent(event.id)" />
              </div>
            </div>
            <div v-if="events.length === 0" class="empty-relations">
              暂无事件
            </div>
          </div>
          <div v-else class="relation-list">
            <div
              v-for="row in relationRows"
              :key="row.connection.id"
              :class="['relation-card', { invalid: row.invalid }]"
              :style="{ '--relation-color': row.color }"
            >
              <div class="relation-main">
                <div class="relation-type">
                  <span class="relation-dot" />
                  <span>{{ row.typeLabel }}</span>
                </div>
                <div class="relation-path">
                  <span class="relation-event">{{ row.sourceTitle }}</span>
                  <q-icon name="arrow_forward" size="14px" />
                  <span class="relation-event">{{ row.targetTitle }}</span>
                </div>
                <div v-if="row.connection.label || row.invalid" class="relation-note">
                  <span v-if="row.connection.label">{{ row.connection.label }}</span>
                  <span v-if="row.invalid">时间顺序可能反向</span>
                </div>
              </div>
              <div class="relation-actions">
                <q-btn dense flat round icon="edit" size="sm" @click="openConnectionEditor(row.connection)" />
                <q-btn dense flat round icon="delete" size="sm" color="negative" @click="removeConnection(row.connection.id)" />
              </div>
            </div>
            <div v-if="relationRows.length === 0" class="empty-relations">
              暂无事件关系
            </div>
          </div>
        </aside>
      </template>
    </main>

    <footer class="timeline-gantt-status">
      <span>{{ saveStatus }}</span>
      <span v-if="timelessCount > 0">{{ timelessCount }} 个未定时间事件使用临时时间显示，保存时会保留 timeless 标记。</span>
    </footer>

    <q-dialog v-model="connectionEditorOpen">
      <q-card class="connection-dialog">
        <q-card-section class="row items-center">
          <div class="text-h6">{{ editingConnectionId ? '编辑事件关系' : '新增事件关系' }}</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>
        <q-separator />
        <q-card-section class="connection-form">
          <q-select
            v-model="connectionForm.source"
            outlined
            dense
            label="源事件"
            :options="eventOptions"
            emit-value
            map-options
          />
          <q-select
            v-model="connectionForm.target"
            outlined
            dense
            label="目标事件"
            :options="eventOptions"
            emit-value
            map-options
          />
          <q-select
            v-model="connectionForm.connectionType"
            outlined
            dense
            label="关系类型"
            :options="connectionTypeOptions"
            emit-value
            map-options
          />
          <q-input v-model="connectionForm.label" outlined dense label="关系标签" clearable />
          <div class="row q-col-gutter-sm">
            <div class="col">
              <q-input v-model="connectionForm.sourceHandle" outlined dense label="源手柄" clearable />
            </div>
            <div class="col">
              <q-input v-model="connectionForm.targetHandle" outlined dense label="目标手柄" clearable />
            </div>
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="取消" v-close-popup />
          <q-btn color="pink-5" label="保存" @click="saveConnection" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="eventEditorOpen">
      <q-card class="event-dialog">
        <q-card-section class="row items-center">
          <div class="text-h6">{{ editingEventId ? '编辑时间线事件' : '新增时间线事件' }}</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>
        <q-separator />
        <q-card-section class="event-form">
          <q-tabs v-model="eventEditorTab" dense align="left" class="inspector-tabs">
            <q-tab name="basic" label="基础" />
            <q-tab name="meta" label="节点" />
            <q-tab name="bindings" label="绑定" />
          </q-tabs>

          <div v-if="eventEditorTab === 'basic'" class="event-form-grid">
            <q-input v-model="eventForm.id" outlined dense label="ID" :disable="!!editingEventId" />
            <q-input v-model="eventForm.title" outlined dense label="标题" />
            <q-input v-model="eventForm.group" outlined dense label="分组" />
            <q-select v-model="eventForm.type" outlined dense label="事件类型" :options="eventTypeOptions" emit-value map-options />
            <q-select v-model="eventForm.dataType" outlined dense label="节点类型 data.type" :options="eventDataTypeOptions" emit-value map-options clearable />
            <q-input v-model="eventForm.date" outlined dense label="开始时间" hint="YYYY-MM-DD 或 YYYY-MM-DDTHH:mm:ss" />
            <q-input v-model="eventForm.endDate" outlined dense label="结束时间" clearable />
            <q-input v-model="eventForm.color" outlined dense label="颜色" clearable>
              <template #append>
                <span class="color-preview" :style="{ background: eventForm.color || '#d94a9b' }" />
              </template>
            </q-input>
            <q-checkbox v-model="eventForm.timeless" dense label="与时间无关" />
            <q-input v-model="eventForm.description" class="span-2" outlined dense label="描述" type="textarea" autogrow />
          </div>

          <div v-else-if="eventEditorTab === 'meta'" class="event-form-grid">
            <q-select
              v-model="eventForm.parentNode"
              outlined
              dense
              label="父节点"
              :options="parentNodeOptions"
              emit-value
              map-options
              clearable
            />
            <q-select
              v-model="eventForm.extent"
              outlined
              dense
              label="限制范围 extent"
              :options="extentOptions"
              emit-value
              map-options
              clearable
            />
            <q-input v-model.number="eventForm.positionX" outlined dense type="number" label="position.x" />
            <q-input v-model.number="eventForm.positionY" outlined dense type="number" label="position.y" />
            <q-input v-model.number="eventForm.width" outlined dense type="number" label="width" />
            <q-input v-model.number="eventForm.height" outlined dense type="number" label="height" />
            <q-checkbox v-model="eventForm.expandParent" dense label="拖动时自动扩展父节点" />
          </div>

          <div v-else class="bindings-editor">
            <div class="binding-add-row">
              <q-select v-model="newBinding.type" outlined dense label="类型" :options="bindingTypeOptions" emit-value map-options />
              <q-input v-model="newBinding.uuid" outlined dense label="UUID" />
              <q-btn dense unelevated color="pink-5" icon="add" label="添加" @click="addBinding" />
            </div>
            <div class="binding-add-row">
              <q-input v-model="newBinding.label" outlined dense label="显示名" />
              <q-input v-model="newBinding.status" outlined dense label="状态" />
              <q-input v-model="newBinding.documentTitle" outlined dense label="文档标题" />
            </div>
            <div class="binding-list">
              <div v-for="(binding, index) in eventForm.bindings" :key="`${binding.type}-${binding.uuid}-${index}`" class="binding-item">
                <div>
                  <div class="binding-title">{{ binding.label || binding.documentTitle || binding.uuid }}</div>
                  <div class="binding-meta">{{ bindingTypeLabel(binding.type) }} · {{ binding.uuid }}</div>
                </div>
                <q-btn dense flat round icon="open_in_new" size="sm" @click="jumpToDefinition(binding)" />
                <q-btn dense flat round icon="delete" size="sm" color="negative" @click="removeBinding(index)" />
              </div>
              <div v-if="eventForm.bindings.length === 0" class="empty-relations">暂无绑定</div>
            </div>
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn v-if="editingEventId" flat color="negative" label="删除事件" @click="removeEditingEvent" />
          <q-space />
          <q-btn flat label="取消" v-close-popup />
          <q-btn color="pink-5" label="保存" @click="saveEvent" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import TaskGantt from './writingDashboard/components/TaskGantt.vue'
import type { Task } from './writingDashboard/sampleData'
import type { BindingReference, TimelineConnection, TimelineData, TimelineEvent } from '../types/timeline'
import { useVsCodeApiStore } from '../stores/vscode'

const vscodeApi = useVsCodeApiStore().vscode

const events = ref<TimelineEvent[]>([])
const connections = ref<TimelineConnection[]>([])
const isLoading = ref(true)
const saveStatus = ref('等待加载')
const showRelations = ref(true)
const inspectorTab = ref<'events' | 'relations'>('events')
const connectionEditorOpen = ref(false)
const editingConnectionId = ref<string | null>(null)
const eventEditorOpen = ref(false)
const eventEditorTab = ref<'basic' | 'meta' | 'bindings'>('basic')
const editingEventId = ref<string | null>(null)
const fallbackBase = Date.now()

const tasks = computed(() => events.value.map(eventToTask))
const timelessCount = computed(() => events.value.filter(event => event.timeless).length)
const eventMap = computed(() => new Map(events.value.map(event => [event.id, event])))
const eventOptions = computed(() => events.value.map(event => ({
  label: `${event.title || event.id} · ${event.group || '默认'}`,
  value: event.id
})))
const validConnections = computed(() => connections.value.filter(conn => eventMap.value.has(conn.source) && eventMap.value.has(conn.target)))
const relationRows = computed(() => validConnections.value.map(connection => {
  const source = eventMap.value.get(connection.source)
  const target = eventMap.value.get(connection.target)
  return {
    connection,
    sourceTitle: source?.title || connection.source,
    targetTitle: target?.title || connection.target,
    typeLabel: connectionTypeLabel(connection.connectionType),
    color: connectionColor(connection.connectionType),
    invalid: isConnectionTimeInvalid(connection)
  }
}))

const connectionTypeOptions = [
  { label: '正常顺序', value: 'normal' },
  { label: '时间穿越', value: 'time-travel' },
  { label: '轮回转世', value: 'reincarnation' },
  { label: '平行时空', value: 'parallel' },
  { label: '梦境/幻觉', value: 'dream' },
  { label: '回忆/闪回', value: 'flashback' },
  { label: '其他', value: 'other' },
]
const eventTypeOptions = [
  { label: '主要事件', value: 'main' },
  { label: '次要事件', value: 'side' },
]
const eventDataTypeOptions = [
  { label: '主要节点', value: 'main' },
  { label: '次要节点', value: 'side' },
  { label: '条件节点', value: 'condition' },
]
const extentOptions = [
  { label: '限制在父节点内', value: 'parent' },
]
const bindingTypeOptions = [
  { label: '角色', value: 'character' },
  { label: '文章/章节', value: 'article' },
]
const parentNodeOptions = computed(() => events.value
  .filter(event => event.id !== editingEventId.value && !event.parentNode)
  .map(event => ({
    label: `${event.title || event.id} · ${event.id}`,
    value: event.id
  })))

const connectionForm = reactive<{
  source: string
  target: string
  label: string
  connectionType: NonNullable<TimelineConnection['connectionType']>
  sourceHandle: string
  targetHandle: string
}>({
  source: '',
  target: '',
  label: '',
  connectionType: 'normal',
  sourceHandle: '',
  targetHandle: '',
})
const eventForm = reactive<{
  id: string
  title: string
  group: string
  type: TimelineEvent['type']
  dataType: NonNullable<TimelineEvent['data']>['type'] | ''
  date: string
  endDate: string
  description: string
  timeless: boolean
  color: string
  parentNode: string
  extent: TimelineEvent['extent'] | ''
  expandParent: boolean
  positionX: number | null
  positionY: number | null
  width: number | null
  height: number | null
  bindings: BindingReference[]
}>({
  id: '',
  title: '',
  group: '',
  type: 'main',
  dataType: '',
  date: '',
  endDate: '',
  description: '',
  timeless: false,
  color: '',
  parentNode: '',
  extent: '',
  expandParent: false,
  positionX: null,
  positionY: null,
  width: null,
  height: null,
  bindings: [],
})
const newBinding = reactive<BindingReference>({
  uuid: '',
  type: 'character',
  label: '',
  status: '',
  documentTitle: '',
})

function requestTimelineData() {
  isLoading.value = true
  saveStatus.value = '正在请求时间线数据'
  vscodeApi?.postMessage({ type: 'requestTimelineData' })
  vscodeApi?.postMessage({ type: 'requestRolesAndArticles' })
}

function onUpdateTasks(nextTasks: Task[]) {
  const originalMap = new Map(events.value.map(event => [event.id, event]))
  const nextEvents = nextTasks.map(task => taskToEvent(task, originalMap.get(task.id)))
  const aliveIds = new Set(nextEvents.map(event => event.id))
  const nextConnections = connections.value.filter(conn => aliveIds.has(conn.source) && aliveIds.has(conn.target))

  events.value = nextEvents
  connections.value = nextConnections
  syncTimelineData()
}

function buildTimelinePayload(): TimelineData {
  return {
    events: toPlainEvents(events.value),
    connections: connections.value.map(conn => ({ ...conn }))
  }
}

function syncTimelineData() {
  const data = buildTimelinePayload()
  if (!vscodeApi?.postMessage) {
    saveStatus.value = '当前不在 VS Code Webview 中，无法写回文件'
    return
  }

  vscodeApi.postMessage({
    type: 'dataChanged',
    data
  })
  saveStatus.value = `已同步到编辑器：${data.events.length} 个事件，${data.connections.length} 条连接`
}

function saveTimelineData() {
  const data = buildTimelinePayload()
  if (!vscodeApi?.postMessage) {
    saveStatus.value = '当前不在 VS Code Webview 中，无法保存文件'
    return
  }

  vscodeApi.postMessage({
    type: 'saveTimelineData',
    data
  })
  saveStatus.value = '正在保存文件'
}

function openConnectionEditor(connection?: TimelineConnection) {
  editingConnectionId.value = connection?.id ?? null
  const fallbackSource = events.value[0]?.id ?? ''
  const fallbackTarget = events.value.find(event => event.id !== fallbackSource)?.id ?? fallbackSource
  connectionForm.source = connection?.source ?? fallbackSource
  connectionForm.target = connection?.target ?? fallbackTarget
  connectionForm.label = connection?.label ?? ''
  connectionForm.connectionType = connection?.connectionType ?? 'normal'
  connectionForm.sourceHandle = connection?.sourceHandle ?? ''
  connectionForm.targetHandle = connection?.targetHandle ?? ''
  connectionEditorOpen.value = true
}

function saveConnection() {
  if (!connectionForm.source || !connectionForm.target) return
  if (connectionForm.source === connectionForm.target) {
    saveStatus.value = '关系保存失败：源事件和目标事件不能相同'
    return
  }

  const next: TimelineConnection = {
    id: editingConnectionId.value ?? `conn-${Date.now()}`,
    source: connectionForm.source,
    target: connectionForm.target,
    connectionType: connectionForm.connectionType,
  }
  if (connectionForm.label.trim()) next.label = connectionForm.label.trim()
  if (connectionForm.sourceHandle.trim()) next.sourceHandle = connectionForm.sourceHandle.trim()
  if (connectionForm.targetHandle.trim()) next.targetHandle = connectionForm.targetHandle.trim()

  connections.value = editingConnectionId.value
    ? connections.value.map(conn => conn.id === editingConnectionId.value ? next : conn)
    : [...connections.value, next]
  connectionEditorOpen.value = false
  syncTimelineData()
}

function removeConnection(id: string) {
  connections.value = connections.value.filter(conn => conn.id !== id)
  syncTimelineData()
}

function openEventEditor(event?: TimelineEvent) {
  editingEventId.value = event?.id ?? null
  eventEditorTab.value = 'basic'
  const now = formatTimelineDate(Date.now())
  eventForm.id = event?.id ?? `event-${Date.now()}`
  eventForm.title = event?.title ?? '新事件'
  eventForm.group = event?.group ?? '默认'
  eventForm.type = event?.type ?? 'main'
  eventForm.dataType = event?.data?.type ?? ''
  eventForm.date = event?.date ?? now
  eventForm.endDate = event?.endDate ?? ''
  eventForm.description = event?.description ?? ''
  eventForm.timeless = !!event?.timeless
  eventForm.color = event?.color ?? ''
  eventForm.parentNode = event?.parentNode ?? ''
  eventForm.extent = event?.extent ?? ''
  eventForm.expandParent = !!event?.expandParent
  eventForm.positionX = event?.position?.x ?? null
  eventForm.positionY = event?.position?.y ?? null
  eventForm.width = event?.width ?? null
  eventForm.height = event?.height ?? null
  eventForm.bindings = event?.bindings ? JSON.parse(JSON.stringify(event.bindings)) as BindingReference[] : []
  resetNewBinding()
  eventEditorOpen.value = true
}

function saveEvent() {
  if (!eventForm.id.trim() || !eventForm.title.trim()) {
    saveStatus.value = '事件保存失败：ID 和标题不能为空'
    return
  }
  if (!editingEventId.value && events.value.some(event => event.id === eventForm.id.trim())) {
    saveStatus.value = '事件保存失败：ID 已存在'
    return
  }

  const original = editingEventId.value ? eventMap.value.get(editingEventId.value) : undefined
  const next: TimelineEvent = {
    ...(original ?? {}),
    id: eventForm.id.trim(),
    title: eventForm.title.trim(),
    group: eventForm.group.trim() || '默认',
    type: eventForm.type,
    date: eventForm.date.trim() || formatTimelineDate(Date.now()),
    description: eventForm.description,
  }

  applyOptionalEventFields(next)
  const previousId = editingEventId.value
  events.value = previousId
    ? events.value.map(event => event.id === previousId ? next : event)
    : [...events.value, next]
  if (previousId && previousId !== next.id) {
    connections.value = connections.value.map(conn => ({
      ...conn,
      source: conn.source === previousId ? next.id : conn.source,
      target: conn.target === previousId ? next.id : conn.target,
    }))
  }
  eventEditorOpen.value = false
  syncTimelineData()
}

function applyOptionalEventFields(event: TimelineEvent) {
  delete event.endDate
  delete event.timeless
  delete event.color
  delete event.data
  delete event.parentNode
  delete event.extent
  delete event.expandParent
  delete event.position
  delete event.width
  delete event.height
  delete event.bindings

  if (eventForm.endDate.trim()) event.endDate = eventForm.endDate.trim()
  if (eventForm.timeless) event.timeless = true
  if (eventForm.color.trim()) event.color = eventForm.color.trim()
  if (eventForm.dataType) event.data = { type: eventForm.dataType }
  if (eventForm.parentNode) event.parentNode = eventForm.parentNode
  if (eventForm.extent) event.extent = eventForm.extent
  if (eventForm.expandParent) event.expandParent = true
  if (eventForm.positionX !== null || eventForm.positionY !== null) {
    event.position = {
      x: Number(eventForm.positionX ?? 0),
      y: Number(eventForm.positionY ?? 0)
    }
  }
  if (eventForm.width !== null) event.width = Number(eventForm.width)
  if (eventForm.height !== null) event.height = Number(eventForm.height)
  if (eventForm.bindings.length > 0) {
    event.bindings = eventForm.bindings.map(binding => {
      const next: BindingReference = { uuid: binding.uuid, type: binding.type }
      if (binding.label) next.label = binding.label
      if (binding.status) next.status = binding.status
      if (binding.documentTitle) next.documentTitle = binding.documentTitle
      return next
    })
  }
}

function removeEvent(id: string) {
  events.value = events.value.filter(event => event.id !== id)
  connections.value = connections.value.filter(conn => conn.source !== id && conn.target !== id)
  syncTimelineData()
}

function removeEditingEvent() {
  if (!editingEventId.value) return
  removeEvent(editingEventId.value)
  eventEditorOpen.value = false
}

function addBinding() {
  if (!newBinding.uuid.trim()) return
  const binding: BindingReference = {
    uuid: newBinding.uuid.trim(),
    type: newBinding.type
  }
  if (newBinding.label?.trim()) binding.label = newBinding.label.trim()
  if (newBinding.status?.trim()) binding.status = newBinding.status.trim()
  if (newBinding.documentTitle?.trim()) binding.documentTitle = newBinding.documentTitle.trim()
  eventForm.bindings.push(binding)
  resetNewBinding()
}

function removeBinding(index: number) {
  eventForm.bindings.splice(index, 1)
}

function resetNewBinding() {
  newBinding.uuid = ''
  newBinding.type = 'character'
  newBinding.label = ''
  newBinding.status = ''
  newBinding.documentTitle = ''
}

function jumpToDefinition(binding: BindingReference) {
  vscodeApi?.postMessage({
    type: 'jumpToDefinition',
    resourceType: binding.type,
    resourceUuid: binding.uuid
  })
}

function handleMessage(event: MessageEvent) {
  const message = event.data
  if (!message || typeof message.type !== 'string') return

  if (message.type === 'timelineData') {
    const data = normalizeTimelineData(message.data)
    events.value = data.events
    connections.value = data.connections
    isLoading.value = false
    saveStatus.value = `已加载：${data.events.length} 个事件，${data.connections.length} 条连接`
    return
  }

  if (message.type === 'dataChangeAck') {
    saveStatus.value = message.ok ? '文件已同步' : '文件同步失败'
    return
  }

  if (message.type === 'saveAck') {
    saveStatus.value = message.ok ? '文件已保存' : `保存失败：${message.error ?? '未知错误'}`
  }
}

function normalizeTimelineData(value: unknown): TimelineData {
  const data = value as Partial<TimelineData> | null
  return {
    events: Array.isArray(data?.events) ? data.events.map(event => ({ ...event })) : [],
    connections: Array.isArray(data?.connections) ? data.connections.map(conn => ({ ...conn })) : []
  }
}

function eventToTask(event: TimelineEvent, index: number): Task {
  const start = parseTimelineDate(event.date, fallbackBase + index * 24 * 60 * 60 * 1000)
  const end = parseTimelineDate(event.endDate, start)
  const bindings = event.bindings ?? []
  return {
    id: event.id || `event-${index}`,
    title: event.title || `未命名事件 ${index + 1}`,
    description: event.description || '',
    status: event.timeless ? 'todo' : 'doing',
    priority: event.type === 'main' ? 'high' : 'medium',
    tags: [
      event.type === 'main' ? '主线' : '支线',
      ...(event.timeless ? ['未定时间'] : []),
      ...bindings.slice(0, 3).map(binding => binding.label || binding.documentTitle || binding.uuid)
    ],
    group: event.group || '默认',
    start: Math.min(start, end),
    end: Math.max(start, end),
    progress: timelineProgress(start, end),
    color: event.color || timelineTypeColor(event),
    subtasks: bindings.map(binding => ({
      id: `${event.id}-${binding.uuid}`,
      title: binding.label || binding.documentTitle || binding.uuid,
      done: binding.status === 'done'
    }))
  }
}

function taskToEvent(task: Task, original?: TimelineEvent): TimelineEvent {
  const next: TimelineEvent = {
    ...(original ?? {
      id: task.id,
      title: task.title,
      group: task.group,
      type: task.priority === 'high' ? 'main' : 'side',
      date: formatTimelineDate(task.start),
      description: task.description,
    }),
    id: task.id,
    title: task.title,
    group: task.group || original?.group || '默认',
    type: original?.type ?? (task.priority === 'high' ? 'main' : 'side'),
    date: formatTimelineDate(task.start),
    description: task.description,
  }
  const color = task.color || original?.color
  if (color) {
    next.color = color
  }

  if (task.end !== task.start) {
    next.endDate = formatTimelineDate(task.end)
  } else if (original?.endDate) {
    delete next.endDate
  }

  return next
}

function toPlainEvents(list: TimelineEvent[]): TimelineEvent[] {
  return JSON.parse(JSON.stringify(list)) as TimelineEvent[]
}

function parseTimelineDate(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : fallback
}

function formatTimelineDate(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function timelineProgress(start: number, end: number): number {
  const now = Date.now()
  if (end <= start) return now >= start ? 100 : 0
  return Math.round(Math.min(1, Math.max(0, (now - start) / (end - start))) * 100)
}

function timelineTypeColor(event: TimelineEvent) {
  if (event.data?.type === 'condition') return '#e0a82e'
  return event.type === 'main' ? '#d94a9b' : '#66a6d9'
}

function eventTypeLabel(type: TimelineEvent['type']) {
  return type === 'main' ? '主要事件' : '次要事件'
}

function eventDataTypeLabel(type: NonNullable<TimelineEvent['data']>['type']) {
  if (type === 'condition') return '条件节点'
  return type === 'main' ? '主要节点' : '次要节点'
}

function bindingTypeLabel(type: BindingReference['type']) {
  return type === 'character' ? '角色' : '文章/章节'
}

function connectionTypeLabel(type: TimelineConnection['connectionType']) {
  const map: Record<NonNullable<TimelineConnection['connectionType']>, string> = {
    normal: '正常顺序',
    'time-travel': '时间穿越',
    reincarnation: '轮回转世',
    parallel: '平行时空',
    dream: '梦境/幻觉',
    flashback: '回忆/闪回',
    other: '其他'
  }
  return map[type ?? 'normal']
}

function connectionColor(type: TimelineConnection['connectionType']) {
  const map: Record<NonNullable<TimelineConnection['connectionType']>, string> = {
    normal: '#8b8f98',
    'time-travel': '#8b5cf6',
    reincarnation: '#06b6d4',
    parallel: '#f59e0b',
    dream: '#ec4899',
    flashback: '#10b981',
    other: '#64748b'
  }
  return map[type ?? 'normal']
}

function isConnectionTimeInvalid(connection: TimelineConnection) {
  if ((connection.connectionType ?? 'normal') !== 'normal') return false
  const source = eventMap.value.get(connection.source)
  const target = eventMap.value.get(connection.target)
  if (!source || !target || source.timeless || target.timeless) return false
  const sourceTime = parseTimelineDate(source.date, 0)
  const targetTime = parseTimelineDate(target.date, 0)
  return sourceTime > targetTime
}

onMounted(() => {
  window.addEventListener('message', handleMessage)
  requestTimelineData()
})

onBeforeUnmount(() => {
  window.removeEventListener('message', handleMessage)
})
</script>

<style scoped>
.timeline-gantt-page {
  height: 100vh;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: var(--dash-page-bg);
  color: var(--dash-page-fg);
}

.timeline-gantt-header,
.timeline-gantt-status {
  background: var(--dash-toolbar-bg);
  border-color: var(--dash-toolbar-border);
}

.timeline-gantt-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-height: 34px;
  padding: 3px 8px;
  border-bottom: 1px solid var(--dash-toolbar-border);
}

.title-block {
  min-width: 0;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--dash-accent);
  font-size: 15px;
  font-weight: 700;
}

.subtitle {
  margin-top: 2px;
  color: var(--dash-text-secondary);
  font-size: 11px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.timeline-gantt-body {
  min-width: 0;
  min-height: 0;
  padding: 8px;
  overflow: hidden;
}

.timeline-gantt-body.with-relations {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 8px;
}

.loading-state {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--dash-text-secondary);
}

.relations-panel {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  border: 1px solid var(--dash-border-light);
  border-radius: 6px;
  overflow: hidden;
  background: var(--dash-window-bg);
}

.inspector-tabs {
  min-height: 32px;
  color: var(--dash-text-secondary);
  background: var(--dash-panel-bg);
  border-bottom: 1px solid var(--dash-border-light);
}

.inspector-tabs :deep(.q-tabs__content) {
  min-height: 32px;
}

.inspector-tabs :deep(.q-tab) {
  min-height: 32px;
  padding: 0 10px;
}

.relations-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--dash-border-light);
  background: var(--dash-panel-bg);
}

.panel-title {
  color: var(--dash-title-fg);
  font-size: 13px;
  font-weight: 700;
}

.panel-subtitle {
  margin-top: 2px;
  color: var(--dash-text-secondary);
  font-size: 11px;
}

.relation-list {
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.event-card,
.relation-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  border-radius: 6px;
}

.event-card {
  --event-color: #d94a9b;
  padding: 8px;
  border: 1px solid color-mix(in srgb, var(--event-color) 38%, var(--dash-border-light));
  border-left: 4px solid var(--event-color);
  background: color-mix(in srgb, var(--event-color) 8%, var(--dash-window-bg));
}

.event-card + .event-card,
.relation-card + .relation-card {
  margin-top: 8px;
}

.event-card-main {
  min-width: 0;
}

.event-card-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--dash-page-fg);
  font-size: 12px;
  font-weight: 700;
}

.event-card-title span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-color-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--event-color);
  flex-shrink: 0;
}

.event-card-meta,
.event-card-date,
.event-card-foot {
  min-width: 0;
  margin-top: 5px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--dash-text-secondary);
  font-size: 11px;
}

.relation-card {
  --relation-color: #8b8f98;
  padding: 8px;
  border: 1px solid color-mix(in srgb, var(--relation-color) 42%, var(--dash-border-light));
  border-left: 4px solid var(--relation-color);
  background: color-mix(in srgb, var(--relation-color) 9%, var(--dash-window-bg));
}

.relation-card.invalid {
  border-style: dashed;
  background: color-mix(in srgb, #ff5a5f 10%, var(--dash-window-bg));
}

.relation-main {
  min-width: 0;
}

.relation-type {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--relation-color);
  font-size: 11px;
  font-weight: 700;
}

.relation-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--relation-color);
}

.relation-path {
  min-width: 0;
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--dash-page-fg);
  font-size: 12px;
}

.relation-event {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.relation-note {
  margin-top: 5px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--dash-text-secondary);
  font-size: 11px;
}

.relation-card.invalid .relation-note {
  color: #ff6b6b;
}

.relation-actions {
  display: flex;
  align-items: start;
  gap: 2px;
}

.empty-relations {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--dash-text-secondary);
  font-size: 12px;
}

.connection-dialog {
  width: min(560px, calc(100vw - 32px));
  background: var(--dash-window-bg);
  color: var(--dash-page-fg);
}

.event-dialog {
  width: min(760px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  background: var(--dash-window-bg);
  color: var(--dash-page-fg);
}

.connection-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.event-form {
  max-height: calc(100vh - 160px);
  overflow: auto;
}

.event-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding-top: 10px;
}

.span-2 {
  grid-column: 1 / -1;
}

.color-preview {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--dash-border-light);
}

.bindings-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 10px;
}

.binding-add-row {
  display: grid;
  grid-template-columns: minmax(96px, 0.8fr) minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
}

.binding-list {
  min-height: 120px;
  border: 1px solid var(--dash-border-light);
  border-radius: 6px;
  overflow: hidden;
}

.binding-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-bottom: 1px solid var(--dash-border-lighter);
}

.binding-item:last-child {
  border-bottom: 0;
}

.binding-title {
  min-width: 0;
  color: var(--dash-page-fg);
  font-size: 12px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.binding-meta {
  margin-top: 2px;
  color: var(--dash-text-secondary);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timeline-gantt-status {
  min-height: 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 10px;
  border-top: 1px solid var(--dash-toolbar-border);
  color: var(--dash-text-secondary);
  font-size: 11px;
}

@media (max-width: 720px) {
  .timeline-gantt-status {
    flex-direction: column;
  }

  .timeline-gantt-header {
    align-items: center;
  }

  .header-actions {
    justify-content: flex-end;
    width: 100%;
  }

  .timeline-gantt-body.with-relations {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) 260px;
  }

  .event-form-grid,
  .binding-add-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
