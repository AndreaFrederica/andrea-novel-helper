<!-- src/components/ExplorerTree.vue -->
<template>
  <div class="roles-tree-view">
    <div class="row items-center q-gutter-sm q-mb-sm">
      <q-space />
      <q-input
        v-model="filter"
        dense outlined clearable
        style="max-width: 260px"
        placeholder="筛选…（搜索时隐藏动作节点）"
      />
    </div>

    <q-card>
      <Draggable
        class="q-pa-sm"
        v-model="renderTree"
        textKey="label"
        childrenKey="children"
        treeLine
        :dragOpen="true"
        :dragOpenDelay="220"
        :eachDroppable="allowDrop"
        :eachDraggable="isDraggable"
        @change="onTreeChanged"
      >
        <template #default="{ node, stat }">
          <div
            class="row items-center no-wrap full-width"
            v-show="node.type === 'action'
              ? filterTrim === '' && isActionVisible(node)
              : matchMap.get(node.id) !== false"
            @contextmenu.prevent
          >
            <!-- 普通节点：folder / file -->
            <template v-if="node.type !== 'action'">
              <q-icon
                :name="node.type === 'folder' ? (stat.open ? 'folder_open' : 'folder') : 'description'"
                :color="node.type === 'folder' ? 'amber-7' : 'blue-6'"
                size="20px"
                class="q-mr-sm"
                @click="node.type === 'folder' ? (stat.open = !stat.open) : null"
              />
              <div class="ellipsis">{{ node.label }}</div>

              <q-menu context-menu touch-position>
                <q-list dense style="min-width: 200px">
                  <q-item clickable v-close-popup
                    @click="addNode(node.type === 'folder' ? node.id : parentIdOf(node.id), 'folder')">
                    <q-item-section avatar><q-icon name="create_new_folder" /></q-item-section>
                    <q-item-section>在此处新建文件夹</q-item-section>
                  </q-item>
                  <q-item clickable v-close-popup
                    @click="addNode(node.type === 'folder' ? node.id : parentIdOf(node.id), 'file')">
                    <q-item-section avatar><q-icon name="note_add" /></q-item-section>
                    <q-item-section>在此处新建文件</q-item-section>
                  </q-item>
                  <q-separator />
                  <q-item clickable v-close-popup @click="removeNode(node.id)">
                    <q-item-section avatar><q-icon name="delete" /></q-item-section>
                    <q-item-section>删除</q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </template>

            <!-- 动作节点：＋ 新建文件夹 / ＋ 新建文件 -->
            <template v-else>
              <q-icon name="add" size="20px" class="q-mr-sm" />
              <q-btn
                flat dense no-caps
                :label="node.act === 'add-folder' ? '新建文件夹' : '新建文件'"
                @click="onActionClick(node)"
              />
            </template>
          </div>
        </template>
      </Draggable>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Notify } from 'quasar'
import { Draggable, dragContext } from '@he-tree/vue'
import '@he-tree/vue/style/default.css'
import '@he-tree/vue/style/material-design.css'

/** —— 类型 —— */
type NodeType = 'folder' | 'file' | 'action'
type ActionKind = 'add-folder' | 'add-file'

interface BaseNode {
  id: string
  label: string
  type: NodeType
  children?: TreeEntity[]     // 注意：可选；不要赋 undefined
}
interface ActionNode extends Omit<BaseNode, 'type' | 'children'> {
  type: 'action'
  act: ActionKind
  targetId: string | null     // null => 根级“新建”动作
}
type TreeEntity = (BaseNode & { type: 'folder' | 'file' }) | ActionNode

const props = defineProps<{ initial?: TreeEntity[] }>()
const emit = defineEmits<{ (e: 'change', value: TreeEntity[]): void }>()

/** —— 内部状态（真实树 & 渲染树）——
 * realTree：不包含动作节点的真实结构
 * renderTree：包含动作节点的渲染结构（用于 <Draggable> v-model）
 */
const realTree = ref<TreeEntity[]>(
  props.initial ? stripActions(cloneNodes(props.initial)) : [
    { id: '1', label: 'Roles', type: 'folder', children: [
      { id: '2', label: 'Admin', type: 'file' },
      { id: '3', label: 'Editor', type: 'file' },
      { id: '4', label: 'Viewer', type: 'folder', children: [
        { id: '5', label: 'Admin', type: 'file' },
        { id: '6', label: 'Editor', type: 'file' },
        { id: '7', label: 'Viewer', type: 'file' },
      ] }
    ] }
  ]
)
const renderTree = ref<TreeEntity[]>([])

const filter = ref('')
const filterTrim = computed(() => filter.value.trim().toLowerCase())

/** —— 搜索可见性：普通节点匹配自己或后代即可可见；动作节点在搜索时统一隐藏 —— */
const matchMap = computed<Map<string, boolean>>(() => {
  const q = filterTrim.value
  const map = new Map<string, boolean>()
  const dfs = (nodes: readonly TreeEntity[]): boolean => {
    let any = false
    for (const n of nodes) {
      if (n.type === 'action') continue
      const selfHit = q ? n.label.toLowerCase().includes(q) : true
      const kidsHit = n.children ? dfs(n.children) : false
      const visible = selfHit || kidsHit
      map.set(n.id, visible)
      any = any || visible
    }
    return any
  }
  dfs(realTree.value)
  return map
})

/** —— 渲染树构建：在每个容器（根/文件夹）末尾追加“动作节点” —— */
let synchronizing = false
function rebuildRenderTree() {
  const cloned = cloneNodes(realTree.value)
  sanitizeContainers(cloned, null)    // 注入动作节点；额外兜底：修正偶发“文件带 children”
  renderTree.value = cloned
}
watch(realTree, () => { if (!synchronizing) rebuildRenderTree() }, { deep: true, immediate: true })

/** —— 拖拽：v-model 发生变更时，同步回真实树，再重建渲染树 —— */
function onTreeChanged(nextTree: TreeEntity[]) {
  synchronizing = true
  realTree.value = stripActions(cloneNodes(nextTree))  // 去掉动作节点，持久化真实结构
  void nextTick(() => { synchronizing = false; rebuildRenderTree(); emit('change', realTree.value) })
}

/** —— he-tree 钩子：只能 inside 到 folder；action 节点完全不可作为放置目标 —— */
function allowDrop(targetStat: any): boolean {
  const where = (dragContext as any)?.targetInfo?.where as 'before' | 'after' | 'inside' | undefined
  const target = targetStat?.data as TreeEntity | undefined
  if (!target) return false
  if (target.type === 'action') return false
  if (where === 'inside') {
    return target.type === 'folder'
  }
  // before / after：允许对 folder/file，但不允许相对 action
  return true
}

/** —— he-tree 钩子：禁止拖动 action 节点 —— */
function isDraggable(stat: any): boolean {
  return (stat?.data as TreeEntity)?.type !== 'action'
}

/** —— 工具 —— */
function cloneNodes(nodes: TreeEntity[]): TreeEntity[] {
  return nodes.map(n => {
    const base: any = { id: n.id, label: n.label, type: n.type }
    if (n.type === 'action') {
      base.act = (n as ActionNode).act
      base.targetId = (n as ActionNode).targetId
      return base as ActionNode
    }
    if (n.children?.length) base.children = cloneNodes(n.children)
    return base as TreeEntity
  })
}
function stripActions(nodes: TreeEntity[]): TreeEntity[] {
  const out: TreeEntity[] = []
  for (const n of nodes) {
    if (n.type === 'action') continue
    const m: any = { id: n.id, label: n.label, type: n.type }
    if (n.children?.length) m.children = stripActions(n.children)
    out.push(m as TreeEntity)
  }
  return out
}
function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
function uniqueName(siblings: TreeEntity[], base: string): string {
  const names = new Set(siblings.filter(s => s.type !== 'action').map(s => s.label))
  if (!names.has(base)) return base
  let i = 1
  while (names.has(`${base} ${i}`)) i++
  return `${base} ${i}`
}
function findNode(arr: TreeEntity[], id: string): TreeEntity | null {
  for (const n of arr) {
    if (n.id === id) return n
    if (n.type !== 'action' && n.children) {
      const r = findNode(n.children, id)
      if (r) return r
    }
  }
  return null
}
function parentIdOf(id: string): string | null {
  let found: string | null = null
  const dfs = (arr: TreeEntity[], parent: string | null) => {
    for (const n of arr) {
      if (n.id === id) { found = parent; return }
      if (n.type !== 'action' && n.children) dfs(n.children, n.id)
      if (found) return
    }
  }
  dfs(realTree.value, null)
  return found
}
function makeActionId(targetId: string | null, act: ActionKind) {
  return `_action_${targetId ?? 'root'}_${act}`
}
function makeActionNode(targetId: string | null, act: ActionKind): ActionNode {
  return {
    id: makeActionId(targetId, act),
    label: act === 'add-folder' ? '＋ 新建文件夹' : '＋ 新建文件',
    type: 'action',
    act,
    targetId
  }
}
function isActionVisible(n: TreeEntity) {
  if (n.type !== 'action') return true
  const target = n.targetId ? findNode(realTree.value, n.targetId) : null
  return n.targetId === null || !!target
}

/** —— 结构整理：注入动作节点；兜底修复“文件带 children” —— */
function sanitizeContainers(nodes: TreeEntity[], parentId: string | null) {
  // 兜底：若文件节点带 children，把其 children 平铺到该文件之后
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      if (!n) continue
      if (n.type === 'file' && (n as BaseNode).children?.length) {
        const moved = (n as BaseNode).children!
        delete (n as any).children
        nodes.splice(i + 1, 0, ...moved)
        i += moved.length
      }
    }
  // 递归处理子容器
  for (const n of nodes) {
    if (n.type === 'folder') {
      if (!n.children) (n as any).children = []
      sanitizeContainers(n.children!, n.id)
    }
  }
  // 移除旧动作节点，末尾追加两条
    const real = nodes.filter(n => n.type !== 'action')
    for (let i = nodes.length - 1; i >= 0; i--) {
      const cur = nodes[i]
      if (cur?.type === 'action') nodes.splice(i, 1)
    }
    nodes.splice(real.length, 0,
      makeActionNode(parentId, 'add-folder'),
      makeActionNode(parentId, 'add-file')
    )
}

/** —— 动作实现 —— */
function addNode(parentId: string | null, type: 'folder' | 'file') {
  const container = parentId ? findNode(realTree.value, parentId) : null
  const arr = container ? ((container as any).children ?? ((container as any).children = [])) : realTree.value
  const base = type === 'folder' ? '新建文件夹' : '新建文件'
  const node: TreeEntity = type === 'folder'
    ? { id: newId(), label: uniqueName(arr, base), type, children: [] }
    : { id: newId(), label: uniqueName(arr, base), type }
  arr.push(node)
  rebuildRenderTree()
}
function removeNode(id: string) {
  const dfs = (arr: TreeEntity[]): boolean => {
    const i = arr.findIndex(n => n.id === id)
    if (i >= 0) {
      const r = arr.splice(i, 1)[0]
      if (r && r.type !== 'action') Notify.create({ type: 'positive', message: `已删除：${r.label}` })
      return true
    }
    return arr.some(n => n.type !== 'action' && n.children && dfs(n.children))
  }
  dfs(realTree.value)
  rebuildRenderTree()
}
function onActionClick(n: TreeEntity) {
  if (n.type !== 'action') return
  addNode(n.targetId, n.act === 'add-folder' ? 'folder' : 'file')
}

/** —— 暴露（可选）—— */
function getTree(): TreeEntity[] { return cloneNodes(realTree.value) }
function setTree(v: TreeEntity[]): void { realTree.value = stripActions(cloneNodes(v)); rebuildRenderTree() }
defineExpose({ getTree, setTree, addNode, removeNode })

// 初次构建渲染树
rebuildRenderTree()
</script>

<style scoped>
.roles-tree-view { min-height: 100vh; padding: 16px; box-sizing: border-box; }
</style>
