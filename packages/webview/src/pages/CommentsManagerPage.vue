<template>
  <q-page class="comments-manager">
    <header class="toolbar">
      <q-input v-model="query" dense outlined clearable class="search" placeholder="搜索批注、文件或标签">
        <template #prepend><q-icon name="search" /></template>
      </q-input>
      <q-select v-model="statusFilter" dense outlined emit-value map-options class="status-select" :options="statusOptions" />
      <q-select
        v-model="tagFilter"
        dense
        outlined
        clearable
        emit-value
        map-options
        class="tag-select"
        :options="tagOptions"
        label="标签"
      />
      <q-btn-toggle
        v-model="viewMode"
        dense
        no-caps
        unelevated
        toggle-color="primary"
        class="mode-toggle"
        :options="viewModeOptions"
      />
      <q-btn dense flat round icon="refresh" @click="requestData">
        <q-tooltip>刷新</q-tooltip>
      </q-btn>
    </header>

    <main class="content">
      <div v-if="lastError" class="notice error">{{ lastError }}</div>
      <div v-else-if="isLoading" class="notice">加载批注...</div>
      <div v-else-if="filteredComments.length === 0" class="notice">没有匹配的批注</div>

      <template v-if="viewMode === 'grouped'">
        <section v-for="group in groupedComments" :key="group.key" class="doc-group">
          <button class="doc-header" type="button" @click="toggleGroup(group.key)">
            <q-icon :name="collapsedGroups.has(group.key) ? 'chevron_right' : 'expand_more'" />
            <q-icon name="description" />
            <span class="doc-title" :title="group.filePath || group.key">{{ group.title }}</span>
            <span class="doc-count">{{ group.openCount }}/{{ group.total }} 未解决</span>
          </button>
          <div v-if="!collapsedGroups.has(group.key)" class="doc-comments">
            <article v-for="comment in group.comments" :key="comment.id" class="comment-row" :class="{ resolved: comment.status === 'resolved' }">
              <div class="row-main">
                <div class="row-title">
                  <q-chip v-if="comment.status === 'resolved'" dense square color="green-1" text-color="green-8">已解决</q-chip>
                  <q-chip v-else dense square color="orange-1" text-color="orange-8">未解决</q-chip>
                  <q-chip v-for="tag in comment.tags" :key="tag" dense square outline color="primary">{{ tag }}</q-chip>
                </div>
                <div class="meta">第 {{ comment.line + 1 }} 行 · {{ formatDate(comment.updatedAt || comment.createdAt) }}</div>
                <div class="message">{{ previewMessage(comment) }}</div>
              </div>

              <div class="row-side">
                <q-select
                  :model-value="comment.tags"
                  dense
                  outlined
                  multiple
                  use-input
                  use-chips
                  hide-dropdown-icon
                  input-debounce="0"
                  class="tag-editor"
                  :options="allTags"
                  new-value-mode="add-unique"
                  @update:model-value="updateTags(comment, $event)"
                  @new-value="createTag"
                />
                <div class="actions">
                  <q-btn dense flat round icon="open_in_new" @click="jumpToComment(comment)">
                    <q-tooltip>跳转</q-tooltip>
                  </q-btn>
                  <q-btn
                    dense
                    flat
                    round
                    :icon="comment.status === 'resolved' ? 'undo' : 'check'"
                    @click="toggleStatus(comment)"
                  >
                    <q-tooltip>{{ comment.status === 'resolved' ? '重开' : '解决' }}</q-tooltip>
                  </q-btn>
                </div>
              </div>
            </article>
          </div>
        </section>
      </template>

      <template v-else>
        <article v-for="comment in filteredComments" :key="comment.id" class="comment-row" :class="{ resolved: comment.status === 'resolved' }">
          <div class="row-main">
            <div class="row-title">
              <q-chip v-if="comment.status === 'resolved'" dense square color="green-1" text-color="green-8">已解决</q-chip>
              <q-chip v-else dense square color="orange-1" text-color="orange-8">未解决</q-chip>
              <q-chip v-for="tag in comment.tags" :key="tag" dense square outline color="primary">{{ tag }}</q-chip>
              <span class="path" :title="comment.filePath || comment.docUuid">{{ comment.relativePath }}</span>
            </div>
            <div class="meta">第 {{ comment.line + 1 }} 行 · {{ formatDate(comment.updatedAt || comment.createdAt) }}</div>
            <div class="message">{{ previewMessage(comment) }}</div>
          </div>

          <div class="row-side">
            <q-select
              :model-value="comment.tags"
              dense
              outlined
              multiple
              use-input
              use-chips
              hide-dropdown-icon
              input-debounce="0"
              class="tag-editor"
              :options="allTags"
              new-value-mode="add-unique"
              @update:model-value="updateTags(comment, $event)"
              @new-value="createTag"
            />
            <div class="actions">
              <q-btn dense flat round icon="open_in_new" @click="jumpToComment(comment)">
                <q-tooltip>跳转</q-tooltip>
              </q-btn>
              <q-btn
                dense
                flat
                round
                :icon="comment.status === 'resolved' ? 'undo' : 'check'"
                @click="toggleStatus(comment)"
              >
                <q-tooltip>{{ comment.status === 'resolved' ? '重开' : '解决' }}</q-tooltip>
              </q-btn>
            </div>
          </div>
        </article>
      </template>
    </main>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

type CommentStatus = 'open' | 'resolved'

interface FlatCommentThread {
  id: string
  docUuid: string
  filePath: string
  relativePath: string
  line: number
  status: CommentStatus
  createdAt: number
  updatedAt: number
  tags: string[]
  messages: Array<{
    id: string
    author: string
    body: string
    createdAt: number
  }>
}

type VsCodeApi = {
  postMessage: (message: unknown) => void
}

type ManagerMessage =
  | { command: 'commentsManager.data'; comments: FlatCommentThread[]; tags: string[] }
  | { command: 'commentsManager.error'; message: string }

const vscode = getVsCodeApi()
const comments = ref<FlatCommentThread[]>([])
const allTags = ref<string[]>([])
const query = ref('')
const statusFilter = ref<'all' | CommentStatus>('all')
const tagFilter = ref('')
const viewMode = ref<'grouped' | 'flat'>('grouped')
const collapsedGroups = ref(new Set<string>())
const lastError = ref('')
const isLoading = ref(!!vscode)

const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '未解决', value: 'open' },
  { label: '已解决', value: 'resolved' },
]
const viewModeOptions = [
  { label: '文档', value: 'grouped' },
  { label: '扁平', value: 'flat' },
]

const tagOptions = computed(() => allTags.value.map(tag => ({ label: tag, value: tag })))
const groupedComments = computed(() => {
  const groups = new Map<string, {
    key: string
    title: string
    filePath: string
    comments: FlatCommentThread[]
    total: number
    openCount: number
  }>()

  for (const comment of filteredComments.value) {
    const key = comment.docUuid || comment.filePath || comment.relativePath
    const group = groups.get(key) ?? {
      key,
      title: comment.relativePath || comment.filePath || comment.docUuid,
      filePath: comment.filePath,
      comments: [],
      total: 0,
      openCount: 0,
    }
    group.comments.push(comment)
    group.total += 1
    if (comment.status === 'open') group.openCount += 1
    groups.set(key, group)
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (b.openCount !== a.openCount) return b.openCount - a.openCount
    return a.title.localeCompare(b.title, 'zh-CN')
  })
})

const filteredComments = computed(() => {
  const q = query.value.trim().toLowerCase()
  return comments.value.filter(comment => {
    if (statusFilter.value !== 'all' && comment.status !== statusFilter.value) return false
    if (tagFilter.value && !comment.tags.includes(tagFilter.value)) return false
    if (!q) return true
    const haystack = [
      comment.relativePath,
      comment.filePath,
      comment.docUuid,
      ...comment.tags,
      ...comment.messages.flatMap(message => [message.author, message.body]),
    ].join('\n').toLowerCase()
    return haystack.includes(q)
  })
})

function getVsCodeApi(): VsCodeApi | undefined {
  const host = window as unknown as { acquireVsCodeApi?: () => VsCodeApi }
  try {
    return host.acquireVsCodeApi?.()
  } catch {
    return undefined
  }
}

function post(message: unknown) {
  vscode?.postMessage(message)
}

function requestData() {
  isLoading.value = true
  post({ command: 'commentsManager.refresh' })
}

function handleMessage(event: MessageEvent<ManagerMessage>) {
  const message = event.data
  if (message?.command === 'commentsManager.data') {
    comments.value = Array.isArray(message.comments) ? message.comments.map(normalizeComment) : []
    allTags.value = normalizeTags(message.tags)
    lastError.value = ''
    isLoading.value = false
    return
  }
  if (message?.command === 'commentsManager.error') {
    lastError.value = message.message
    isLoading.value = false
  }
}

function updateTags(comment: FlatCommentThread, value: unknown) {
  const tags = normalizeTags(value)
  comment.tags = tags
  allTags.value = normalizeTags([...allTags.value, ...tags])
  post({ command: 'commentsManager.updateTags', threadId: comment.id, tags })
}

function toggleGroup(key: string) {
  const next = new Set(collapsedGroups.value)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  collapsedGroups.value = next
}

function createTag(value: string, done: (value?: string, mode?: 'add' | 'add-unique' | 'toggle') => void) {
  const tag = value.trim()
  if (!tag) {
    done()
    return
  }
  allTags.value = normalizeTags([...allTags.value, tag])
  done(tag, 'add-unique')
}

function toggleStatus(comment: FlatCommentThread) {
  const status: CommentStatus = comment.status === 'resolved' ? 'open' : 'resolved'
  comment.status = status
  post({ command: 'commentsManager.updateStatus', threadId: comment.id, status })
}

function jumpToComment(comment: FlatCommentThread) {
  post({
    command: 'commentsManager.jumpToComment',
    threadId: comment.id,
    docUuid: comment.docUuid,
    line: comment.line,
  })
}

function previewMessage(comment: FlatCommentThread): string {
  const body = comment.messages[0]?.body?.trim()
  if (!body) return '无批注内容'
  return body.length > 160 ? `${body.slice(0, 157)}...` : body
}

function formatDate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  return new Date(value).toLocaleString()
}

function normalizeComment(value: FlatCommentThread): FlatCommentThread {
  return {
    ...value,
    tags: normalizeTags(value.tags),
    messages: Array.isArray(value.messages) ? value.messages : [],
    line: Math.max(0, Number(value.line) || 0),
    status: value.status === 'resolved' ? 'resolved' : 'open',
  }
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value.map(tag => typeof tag === 'string' ? tag.trim() : '').filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

onMounted(() => {
  window.addEventListener('message', handleMessage as EventListener)
  post({ command: 'commentsManager.ready' })
})

onBeforeUnmount(() => {
  window.removeEventListener('message', handleMessage as EventListener)
})
</script>

<style scoped>
.comments-manager {
  height: 100vh;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--vscode-sideBar-background, var(--q-dark));
  color: var(--vscode-sideBar-foreground, inherit);
}

.toolbar {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) 112px 128px auto auto;
  gap: 8px;
  align-items: center;
  padding: 8px;
  border-bottom: 1px solid var(--vscode-sideBar-border, rgba(127, 127, 127, 0.24));
}

.mode-toggle {
  min-width: 104px;
}

.content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.notice {
  padding: 18px 8px;
  color: var(--vscode-descriptionForeground, #888);
  text-align: center;
}

.notice.error {
  color: var(--vscode-errorForeground, #f48771);
}

.comment-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(180px, 34%);
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--vscode-sideBar-border, rgba(127, 127, 127, 0.18));
}

.doc-group {
  border-bottom: 1px solid var(--vscode-sideBar-border, rgba(127, 127, 127, 0.18));
}

.doc-header {
  width: 100%;
  min-height: 34px;
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  padding: 6px 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.doc-header:hover {
  background: var(--vscode-list-hoverBackground, rgba(127, 127, 127, 0.12));
}

.doc-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}

.doc-count {
  color: var(--vscode-descriptionForeground, #888);
  font-size: 12px;
  white-space: nowrap;
}

.doc-comments {
  padding-left: 22px;
}

.comment-row.resolved {
  opacity: 0.68;
}

.row-main,
.row-side {
  min-width: 0;
}

.row-title {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}

.meta {
  margin-top: 4px;
  color: var(--vscode-descriptionForeground, #888);
  font-size: 12px;
}

.message {
  margin-top: 6px;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.55;
}

.tag-editor {
  width: 100%;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 6px;
}

:deep(.q-field__control) {
  min-height: 32px;
}

@media (max-width: 520px) {
  .toolbar {
    grid-template-columns: 1fr auto;
  }

  .status-select,
  .tag-select,
  .mode-toggle {
    min-width: 0;
  }

  .comment-row {
    grid-template-columns: 1fr;
  }
}
</style>
