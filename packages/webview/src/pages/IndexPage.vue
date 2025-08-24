<template>
  <q-layout class="q-pa-md">
    <!-- 右下角悬浮开关按钮 -->
    <q-btn
      round
      dense
      icon="menu"
      class="drawer-toggle br"
      @click="drawerOpen = !drawerOpen"
      :aria-label="drawerOpen ? '关闭角色列表' : '打开角色列表'"
    />

    <!-- 左侧边栏（由 q-layout 管理，框架将自动挤压主内容） -->
    <q-drawer
      v-model="drawerOpen"
      side="left"
      bordered
      :breakpoint="0"
      :class="[isDark ? 'bg-grey-10' : 'bg-grey-1', 'drawer-fullheight']"
      style="height: 100vh"
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
              :header-class="isDark ? 'bg-grey-9' : 'bg-grey-2'"
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
              <template v-for="bucket in ['base', 'extended', 'custom']" :key="bucket">
                <div v-if="hasBucket(r, bucket as any)" class="q-mb-sm">
                  <div class="row items-center q-gutter-xs q-mb-xs">
                    <q-chip
                      dense
                      size="sm"
                      :color="
                        bucket === 'base' ? 'primary' : bucket === 'extended' ? 'teal' : 'orange'
                      "
                      text-color="white"
                    >
                      {{ bucket }}
                    </q-chip>
                    <q-badge
                      outline
                      :color="isDark ? 'grey-4' : 'grey-7'"
                      :label="countKeys(r, bucket as any) + ' 项'"
                    />
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
                          <div
                            :class="[
                              isDark ? 'text-grey-4' : 'text-grey-7',
                              'q-ml-sm',
                              'mono',
                              'value-preview',
                            ]"
                          >
                            {{ entry.preview }}
                          </div>
                        </div>
                      </q-item-section>
                    </q-item>
                    <div
                      v-if="bucketEntries(r, bucket as any).length === 0"
                      :class="[isDark ? 'text-grey-5' : 'text-grey-6', 'q-pa-sm']"
                    >
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
    <q-page-container>
      <div class="main-content">
        <div class="column col q-gutter-md">
          <!-- 用外层 div 承载 ref，避免去摸子组件实例的 $el -->
          <div
            v-for="(r, idx) in roles"
            :key="r.id"
            :ref="(el) => setRoleRef(r.id, el as HTMLElement)"
          >
            <role-card
              v-model="roles[idx]!"
              @changed="(e) => onChanged(idx, e)"
              @type-changed="(e) => onTypeChanged(idx, e)"
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
              <pre style="white-space: pre-wrap">{{ roles }}</pre>
            </q-card-section>
          </q-card>
        </div>
      </div>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, nextTick, computed, onMounted, watch } from 'vue';
import { useQuasar } from 'quasar';

const $q = useQuasar();
const isDark = computed(() => $q.dark.isActive);

import RoleCard from 'components/RoleCard.vue';
import type { RoleCardModel } from '../../types/role';

type RoleWithId = RoleCardModel & { id: string };

const drawerOpen = ref(true);

// 初始数据由扩展提供：先建空数组
const roles = ref<RoleWithId[]>([]);

// VS Code webview API (typed)
const vscodeApi = (window as unknown as { acquireVsCodeApi?: () => { postMessage?: (msg: unknown) => void } }).acquireVsCodeApi?.();

// 避免回环：当应用来自扩展的列表时，不把它再次发送回去
let applyingRemote = false;

// 监听扩展消息，处理 roleCards
window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data;
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'roleCards' && Array.isArray(msg.list)) {
    applyingRemote = true;
    roles.value = (msg.list as RoleWithId[]).map((r) => ({ ...r }));
    void nextTick(() => { applyingRemote = false; });
  }
});

function notifySave() {
  if (applyingRemote) return;
  try {
    const plain = JSON.parse(JSON.stringify(roles.value)); // 深度去 Proxy & 去除不可序列化内容
    vscodeApi?.postMessage?.({ type: 'saveRoleCards', list: plain });
  } catch (e) {
    console.warn('Failed to post saveRoleCards', e);
  }
}


onMounted(() => {
  if (vscodeApi?.postMessage) vscodeApi.postMessage({ type: 'requestRoleCards' });
});

// 深度监听 roles，去抖后发送保存
let saveTimer: number | undefined;
watch(roles, () => {
  if (applyingRemote) return;
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    notifySave();
    saveTimer = undefined;
  }, 150);
}, { deep: true });

// 用 Set 存已展开的角色 id；克隆再赋值以触发更新
const opened = ref<Set<string>>(new Set());

// refs for scrollToRole（直接存 DOM 元素）
const roleRefs = new Map<string, HTMLElement>();
function setRoleRef(id: string, el: HTMLElement | null) {
  if (el) roleRefs.set(id, el);
}

function scrollToRole(id: string) {
  const el = roleRefs.get(id);
  if (el?.scrollIntoView) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // 保持侧栏开启
  drawerOpen.value = true;
}

// 展开/收起单个（用克隆触发更新）
function open(id: string) {
  const s = new Set(opened.value);
  s.add(id);
  opened.value = s;
}
function close(id: string) {
  const s = new Set(opened.value);
  s.delete(id);
  opened.value = s;
}

// 展开/收起全部
function _expandAll() {
  opened.value = new Set(roles.value.map((r: RoleWithId) => r.id));
}
function _collapseAll() {
  opened.value = new Set();
}

function onChanged(_index: number, _e: unknown) {}
function onTypeChanged(_index: number, _e: unknown) {}

// 添加角色
function addRole() {
  const newRole: RoleWithId = {
    id: genId(),
    base: {
      name: `新角色 ${roles.value.length + 1}`,
      type: '正则表达式',
      regex: '',
      regexFlags: 'g',
      color: '#e0e0e0',
      priority: 100 + roles.value.length,
      description: '',
    },
    extended: {},
    custom: {},
  };
  roles.value.push(newRole);
  void nextTick(() => {
    open(newRole.id); // 新增的在边栏默认展开
    scrollToRole(newRole.id); // 并滚动过去
  });
}
function hasBucket(r: RoleWithId, bucket: 'base' | 'extended' | 'custom') {
  const obj = (r as unknown as Record<string, unknown>)[bucket];
  return obj && typeof obj === 'object';
}
function countKeys(r: RoleWithId, bucket: 'base' | 'extended' | 'custom') {
  const obj = (r as unknown as Record<string, unknown>)[bucket];
  return obj ? Object.keys(obj).length : 0;
}
function bucketEntries(r: RoleWithId, bucket: 'base' | 'extended' | 'custom') {
  const obj = (r as unknown as Record<string, unknown>)[bucket];
  if (!obj) return [];
  const rec = obj as Record<string, unknown>;
  return Object.keys(rec).map((k) => {
    const v = rec[k];
    return { key: k, preview: toPreview(v) };
  });
}
function toPreview(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => stringifyShort(x)).join(', ')}]`;
  if (typeof v === 'object' && v !== null) return '{…}';
  return stringifyShort(v);
}
function stringifyShort(v: unknown): string {
  let s: string;
  if (typeof v === 'string') s = v;
  else if (v == null) s = '';
  else if (typeof v === 'object') s = '[object]';
  else s = String(v as number | boolean | symbol | bigint);
  return s.length > 36 ? s.slice(0, 33) + '…' : s;
}

function genId() {
  return 'r_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
</script>

<style scoped>
/* 右下角：br = bottom-right */
.drawer-toggle.br {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2000;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}

/* 值预览区域等宽字体 + 截断 */
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
}
.value-preview {
  max-width: 55%;
  min-width: 0; /* allow flex children to shrink correctly */
  /* allow wrapping and break long words when necessary */
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

/* 列表圆角 */
.rounded-borders {
  border-radius: 8px;
}

/* 主内容区独立滚动，避免与侧边栏共享滚动 */
.main-content {
  height: 95vh;
  overflow: auto;
}

/* 让抽屉内部滚动区独立占满视口，从而有自己的滚动条 */
.drawer-fullheight .q-scrollarea__container,
.drawer-fullheight .q-scrollarea__scrollbar {
  height: 95vh;
}
</style>
