<template>
  <div class="q-pa-md row q-gutter-md">
    <!-- 右下角悬浮开关按钮 -->
    <q-btn
      round
      dense
      icon="menu"
      class="drawer-toggle br"
      @click="drawerOpen = !drawerOpen"
      :aria-label="drawerOpen ? '关闭角色列表' : '打开角色列表'"
    />

    <!-- 左侧边栏（覆盖模式，任意宽度可用） -->
    <q-drawer
      v-model="drawerOpen"
      side="left"
      bordered
      overlay
      :breakpoint="0"
      :width="300"
      class="bg-grey-1"
    >
      <q-scroll-area class="fit">
        <div class="q-pa-md">
          <div class="row items-center justify-between q-mb-sm">
            <div class="text-subtitle1">角色（{{ roles.length }}）</div>
            <!-- <q-btn dense flat icon="unfold_less" @click="collapseAll" class="q-ml-sm" />
            <q-btn dense flat icon="unfold_more" @click="expandAll" /> -->
          </div>

          <q-list separator>
            <!-- 一个角色 = 一个可折叠分组 -->
            <q-expansion-item
              v-for="(r, idx) in roles"
              :key="r.id"
              :label="r.base?.name || `未命名角色 ${idx + 1}`"
              expand-separator
              header-class="bg-grey-2"
              :default-opened="opened.has(r.id)"
              @show="open(r.id)"
              @hide="close(r.id)"
            >
              <!-- 快速跳转到该角色卡 -->
              <q-item clickable @click="scrollToRole(r.id)">
                <q-item-section avatar><q-icon name="my_location" /></q-item-section>
                <q-item-section>跳转到卡片</q-item-section>
              </q-item>

              <q-separator spaced />

              <!-- 三段：base / extended / custom -->
              <template v-for="bucket in ['base','extended','custom']" :key="bucket">
                <div v-if="hasBucket(r, bucket as any)" class="q-mb-sm">
                  <div class="row items-center q-gutter-xs q-mb-xs">
                    <q-chip
                      dense
                      size="sm"
                      :color="bucket==='base' ? 'primary' : (bucket==='extended' ? 'teal' : 'orange')"
                      text-color="white"
                    >
                      {{ bucket }}
                    </q-chip>
                    <q-badge outline color="grey-7" :label="countKeys(r, bucket as any) + ' 项'" />
                  </div>

                  <!-- 键值对一览（可点击跳转） -->
                  <q-list dense bordered class="rounded-borders">
                    <q-item
                      v-for="(entry, i) in bucketEntries(r, bucket as any)"
                      :key="bucket + '-' + i"
                      clickable
                      @click="scrollToRole(r.id)"
                    >
                      <q-item-section>
                        <div class="row items-start justify-between">
                          <div class="text-weight-medium ellipsis">{{ entry.key }}</div>
                          <div class="text-grey-7 q-ml-sm mono value-preview">{{ entry.preview }}</div>
                        </div>
                      </q-item-section>
                    </q-item>
                    <div v-if="bucketEntries(r, bucket as any).length === 0" class="text-grey-6 q-pa-sm">
                      （空）
                    </div>
                  </q-list>
                </div>
              </template>
            </q-expansion-item>
          </q-list>
        </div>
      </q-scroll-area>
    </q-drawer>

    <!-- 右侧主体 -->
    <div class="column col q-gutter-md">
      <!-- 用外层 div 承载 ref，避免去摸子组件实例的 $el -->
      <div
        v-for="(r, idx) in roles"
        :key="r.id"
        :ref="el => setRoleRef(r.id, el as HTMLElement)"
      >
        <role-card
          v-model="roles[idx]"
          @changed="e => onChanged(idx, e)"
          @type-changed="e => onTypeChanged(idx, e)"
        />
      </div>

      <!-- 添加角色按钮（位于最后一个角色下面） -->
      <div class="q-mt-sm">
        <q-btn color="primary" icon="add" label="添加角色" @click="addRole" />
      </div>

      <q-separator class="q-my-md" />

      <div class="text-subtitle2">当前数据快照</div>
      <q-card flat bordered>
        <q-card-section>
          <pre style="white-space:pre-wrap">{{ roles }}</pre>
        </q-card-section>
      </q-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import RoleCard from 'components/RoleCard.vue'

type KV = Record<string, any>
type Role = {
  id: string
  base?: KV
  extended?: KV
  custom?: KV
}

const drawerOpen = ref(true)

// 用 Set 存已展开的角色 id；克隆再赋值以触发更新
const opened = ref<Set<string>>(new Set())

// 初始示例
const roles = ref<Role[]>([
  {
    id: genId(),
    base: {
      name: '中文对话',
      type: '正则表达式',
      regex: '“[^”]*”',
      regexFlags: 'g',
      color: '#fbdc98ff',
      priority: 100,
      description: '匹配中文引号内的对话内容'
    },
    extended: { 说明: '此规则用于标注中文引号中的对白。' },
    custom: { tags: ['dialogue','zh-CN'] }
  }
])

// refs for scrollToRole（直接存 DOM 元素）
const roleRefs = new Map<string, HTMLElement>()
function setRoleRef (id: string, el: HTMLElement | null) {
  if (el) roleRefs.set(id, el)
}

function scrollToRole (id: string) {
  const el = roleRefs.get(id)
  if (el?.scrollIntoView) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  // 保持侧栏开启
  drawerOpen.value = true
}

// 展开/收起单个（用克隆触发更新）
function open (id: string) {
  const s = new Set(opened.value)
  s.add(id)
  opened.value = s
}
function close (id: string) {
  const s = new Set(opened.value)
  s.delete(id)
  opened.value = s
}

// 展开/收起全部
function expandAll () {
  opened.value = new Set(roles.value.map(r => r.id))
}
function collapseAll () {
  opened.value = new Set()
}

function onChanged (index: number, e: any) {}
function onTypeChanged (index: number, e: any) {}

// 添加角色
function addRole () {
  const newRole: Role = {
    id: genId(),
    base: {
      name: `新角色 ${roles.value.length + 1}`,
      type: '正则表达式',
      regex: '',
      regexFlags: 'g',
      color: '#e0e0e0',
      priority: 100 + roles.value.length,
      description: ''
    },
    extended: {},
    custom: {}
  }
  roles.value.push(newRole)
  nextTick(() => {
    open(newRole.id)            // 新增的在边栏默认展开
    scrollToRole(newRole.id)    // 并滚动过去
  })
}

function hasBucket (r: Role, bucket: 'base'|'extended'|'custom') {
  const obj = r[bucket]
  return obj && typeof obj === 'object'
}
function countKeys (r: Role, bucket: 'base'|'extended'|'custom') {
  const obj = r[bucket] as KV|undefined
  return obj ? Object.keys(obj).length : 0
}
function bucketEntries (r: Role, bucket: 'base'|'extended'|'custom') {
  const obj = r[bucket] as KV|undefined
  if (!obj) return []
  return Object.keys(obj).map(k => {
    const v = obj[k]
    return { key: k, preview: toPreview(v) }
  })
}
function toPreview (v: any): string {
  if (Array.isArray(v)) return `[${v.map(x => stringifyShort(x)).join(', ')}]`
  if (typeof v === 'object' && v !== null) return '{…}'
  return stringifyShort(v)
}
function stringifyShort (v: any): string {
  const s = String(v ?? '')
  return s.length > 36 ? s.slice(0, 33) + '…' : s
}

function genId () {
  return 'r_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}
</script>

<style scoped>
/* 右下角：br = bottom-right */
.drawer-toggle.br {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2000;
  box-shadow: 0 2px 8px rgba(0,0,0,.25);
}

/* 值预览区域等宽字体 + 截断 */
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
.value-preview { max-width: 55%; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }

/* 列表圆角 */
.rounded-borders { border-radius: 8px; }
</style>
