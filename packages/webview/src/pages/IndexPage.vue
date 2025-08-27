<template>
  <q-layout class="layout-no-size">
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

              <!-- 删除角色（停止冒泡，避免触发折叠/跳转） -->
              <q-item clickable @click.stop="removeRole(r.id)">
                <q-item-section avatar>
                  <q-icon name="delete" color="negative" />
                </q-item-section>
                <q-item-section>
                  <div class="text-subtitle2 text-negative">删除角色</div>
                </q-item-section>
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

          <!-- 列表风格的“添加角色”项，和上方条目样式保持一致 -->
          <div class="q-pa-sm">
            <q-item clickable dense class="hoverable" @click="addRole">
              <q-item-section avatar>
                <q-icon name="add" color="primary" />
              </q-item-section>
              <q-item-section>
                <div class="text-subtitle2">添加角色</div>
              </q-item-section>
            </q-item>
          </div>
        </div>
      </q-scroll-area>
    </q-drawer>

    <!-- 右侧主体：100vh 可滚动 -->
    <q-page-container class="layout-no-size" style="height: 100vh; overflow: hidden">
      <!-- <q-page > -->
      <q-scroll-area class="fit">
        <div class="column q-gutter-md">
          <!-- 每个角色卡放入可折叠容器，容器 header 包含删除按钮；默认展开 -->
          <q-expansion-item
            v-for="(r, idx) in roles"
            :key="r.id"
            class="role-panel q-mb-sm"
            expand-separator
            :model-value="mainOpened[r.id] ?? true"
            @update:model-value="(val: boolean | null) => (mainOpened[r.id] = !!val)"
          >
            <template #header>
              <div class="row items-center justify-between" style="width: 100%">
                <div class="text-subtitle1">{{ r.base?.name || `未命名角色 ${idx + 1}` }}</div>
                <div>
                  <q-btn dense flat color="negative" icon="delete" @click.stop="removeRole(r.id)" />
                </div>
              </div>
            </template>

            <div :ref="(el) => setRoleRef(r.id, el as HTMLElement)">
              <role-card
                v-model="roles[idx]!"
                @changed="(e) => onChanged(idx, e)"
                @type-changed="(e) => onTypeChanged(idx, e)"
              />
            </div>
          </q-expansion-item>

          <!-- 列表风格的“添加角色”项，和上方条目样式保持一致 -->
          <div class="q-pa-sm">
            <q-item clickable dense class="hoverable" @click="addRole">
              <q-item-section avatar>
                <q-icon name="add" color="primary" />
              </q-item-section>
              <q-item-section>
                <div class="text-subtitle2">添加角色</div>
              </q-item-section>
            </q-item>
          </div>

          <q-separator class="q-my-md" />

          <q-expansion-item label="当前数据快照" icon="visibility" expand-separator>
            <q-card flat bordered>
              <q-card-section>
                <pre style="white-space: pre-wrap">{{ roles }}</pre>
              </q-card-section>
            </q-card>
          </q-expansion-item>
        </div>
      </q-scroll-area>
      <!-- </q-page> -->
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, nextTick, computed, onMounted, watch, reactive } from 'vue';
import { useQuasar } from 'quasar';

const $q = useQuasar();
const isDark = computed(() => $q.dark.isActive);

import RoleCard from 'components/RoleCard.vue';
import type { RoleCardModel } from '../../types/role';

type RoleWithId = RoleCardModel & { id: string };

const drawerOpen = ref(true);

// 是否已拿到 roleCards（视为就绪）
const rolesReady = ref(false);

// 尚未 ready 时积压的 def 名字
const pendingDefs = ref<string[]>([]);

// 初始数据由扩展提供：先建空数组
const roles = ref<RoleWithId[]>([]);

// 主视图每个角色的展开状态（默认不折叠 -> 即默认展开）
const mainOpened = reactive<Record<string, boolean>>({});

// 确保新加入角色默认展开
watch(roles, (v) => {
  for (const r of v) {
    if (mainOpened[r.id] === undefined) mainOpened[r.id] = true;
  }
});

// VS Code webview API (typed)
const vscodeApi = (
  window as unknown as { acquireVsCodeApi?: () => { postMessage?: (msg: unknown) => void } }
).acquireVsCodeApi?.();

// 避免回环：当应用来自扩展的列表时，不把它再次发送回去
let applyingRemote = false;

// ===== 稳定签名与静音窗口：只在“确有变更且不属于回声”时才更新 =====

// 稳定序列化（键排序，避免顺序噪声）
function stableStringify(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return '[' + x.map(stableStringify).join(',') + ']';
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
}
// 只取业务字段（忽略 id）
function normalizeRoleForSig(r: RoleWithId) {
  return { base: r.base ?? {}, extended: r.extended ?? {}, custom: r.custom ?? {} };
}
function listSignature(list: RoleWithId[]): string {
  const sorted = [...list].sort((a, b) => (a.base?.name || '').localeCompare(b.base?.name || ''));
  return stableStringify(sorted.map(normalizeRoleForSig));
}
function roleSig(r: RoleWithId): string {
  return stableStringify(normalizeRoleForSig(r));
}
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return stableStringify(a) === stableStringify(b);
}

// 保存时记录的签名（用来识别“回声”）
let lastSentSig = '';
// 保存后的静音窗口（毫秒时间戳）。窗口内收到的“回声”不触发更新
let saveEchoMuteUntil = 0;

// 仅在确有变更时，对对象做最小化写入；返回是否发生变更
function assignLike(dst: Record<string, any>, src: Record<string, any>): boolean {
  let changed = false;

  // 写/改
  for (const k of Object.keys(src)) {
    const v = src[k];
    // 深等判断避免无意义写入
    if (!deepEqual((dst as any)[k], v)) {
      (dst as any)[k] = Array.isArray(v) ? v.slice() : v && typeof v === 'object' ? { ...v } : v;
      changed = true;
    }
  }

  // 删
  for (const k of Object.keys(dst)) {
    if (!(k in src)) {
      delete (dst as any)[k];
      changed = true;
    }
  }

  return changed;
}

function mergeRoleIntoExisting(exist: RoleWithId, incoming: RoleWithId): boolean {
  let any = false;
  if (!deepEqual(exist.base ?? {}, incoming.base ?? {})) {
    exist.base ??= {} as any;
    any = assignLike(exist.base as any, (incoming.base ?? {}) as any) || any;
  }
  if (!deepEqual(exist.extended ?? {}, incoming.extended ?? {})) {
    exist.extended ??= {};
    any = assignLike(exist.extended as any, (incoming.extended ?? {}) as any) || any;
  }
  if (!deepEqual(exist.custom ?? {}, incoming.custom ?? {})) {
    exist.custom ??= {};
    any = assignLike(exist.custom as any, (incoming.custom ?? {}) as any) || any;
  }
  return any;
}

// —— 就地合并（逐卡片签名比对：相同对象完全不动；仅处理真实变更） ——
function applyIncomingRolesInPlace(incoming: RoleWithId[]) {
  const byName = new Map<string, RoleWithId>();
  for (const r of incoming) byName.set(r.base?.name || '', r);

  const next: RoleWithId[] = [];
  for (const r of incoming) {
    const name = r.base?.name || '';
    const existIdx = roles.value.findIndex((x) => (x.base?.name || '') === name);

    if (existIdx >= 0) {
      const exist = roles.value[existIdx]!;
      if (roleSig(exist) !== roleSig(r)) {
        mergeRoleIntoExisting(exist, r); // 仅对差异做写入
      }
      next.push(exist); // 保持对象引用，不打断输入
    } else {
      next.push({ ...r }); // 新卡片
    }
  }
  // 删除 incoming 中已不存在的卡
  const namesIncoming = new Set([...byName.keys()]);
  for (const old of roles.value) {
    const name = old.base?.name || '';
    if (!namesIncoming.has(name)) {
      // 不加入 next 即删除
    }
  }
  // 以 splice 替换数组（DOM 只移动，不重建）
  roles.value.splice(0, roles.value.length, ...next);
}

// —— 唯一的 message 监听器（带签名校验 + 静音窗口） ——
window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data;
  if (!msg || typeof msg.type !== 'string') return;

  if (msg.type === 'roleCards' && Array.isArray(msg.list)) {
    const incoming = (msg.list as RoleWithId[]).map((r) => ({ ...r }));
    const recvSig = listSignature(incoming);
    const curSig = listSignature(roles.value);
    const now = Date.now();

    // 1) 完全一致 → 忽略
    if (recvSig === curSig) {
      rolesReady.value = true;
      flushPendingDefs();
      return;
    }

    // 2) 回声且在静音窗口内 → 忽略
    if (recvSig === lastSentSig && now < saveEchoMuteUntil) {
      rolesReady.value = true;
      flushPendingDefs();
      return;
    }

    // 3) 应用更新（若仍在静音窗口内，则延后到窗口结束）
    const apply = () => {
      applyingRemote = true;
      applyIncomingRolesInPlace(incoming);
      void nextTick(() => {
        applyingRemote = false;
        rolesReady.value = true;
        flushPendingDefs();
      });
    };

    if (now < saveEchoMuteUntil) {
      window.setTimeout(
        () => {
          // 静音结束再比一次，防止期间本地又有变更
          const latestSig = listSignature(roles.value);
          if (latestSig !== recvSig) apply();
        },
        Math.max(0, saveEchoMuteUntil - now + 10),
      );
    } else {
      apply();
    }
    return;
  }

  if (msg.type === 'def' && typeof msg.name === 'string') {
    if (!rolesReady.value) {
      pendingDefs.value.push(msg.name);
    } else {
      focusRoleByName(msg.name);
    }
    return;
  }
});

function notifySave() {
  if (applyingRemote) return;
  try {
    const plain = JSON.parse(JSON.stringify(roles.value)); // 去 Proxy
    lastSentSig = listSignature(plain);
    saveEchoMuteUntil = Date.now() + 1200; // 1.2s 静音窗口（可按需 800~2000）
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
watch(
  roles,
  () => {
    if (applyingRemote) return;
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      notifySave();
      saveTimer = undefined;
    }, 150);
  },
  { deep: true },
);

// 用 Set 存已展开的角色 id；克隆再赋值以触发更新
const opened = ref<Set<string>>(new Set());

// refs for scrollToRole（直接存 DOM 元素）
const roleRefs = new Map<string, HTMLElement>();
function setRoleRef(id: string, el: HTMLElement | null) {
  if (el) roleRefs.set(id, el);
  else roleRefs.delete(id);
}

function findScrollContainer(el: HTMLElement | null): HTMLElement | null {
  let p: HTMLElement | null = el;
  while (p) {
    if (p.classList && p.classList.contains('q-scrollarea__container')) return p;
    p = p.parentElement;
  }
  // fallback to document scrolling element
  return document.scrollingElement as HTMLElement | null;
}

function scrollToRole(id: string) {
  const el = roleRefs.get(id) ?? null;
  // 保持侧栏开启，先展开再滚动（等待布局稳定）
  drawerOpen.value = true;
  // 确保主视图对应的面板展开
  mainOpened[id] = true;
  if (!el) return;
  void nextTick(() => {
    const container = findScrollContainer(el);
    if (container) {
      const elRect = el.getBoundingClientRect();
      const contRect = container.getBoundingClientRect();
      const offset = elRect.top - contRect.top + container.scrollTop;
      container.scrollTo({ top: offset, behavior: 'smooth' });
    } else if ((el as any).scrollIntoView) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
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
      type: '主角',
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
  return s.length > 36 ? s.slice(33) + '…' : s; // 保持简短
}

function genId() {
  return 'r_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function removeRole(id: string) {
  const idx = roles.value.findIndex((r) => r.id === id);
  if (idx >= 0) {
    roles.value.splice(idx, 1);
    // 清理展开状态与 refs
    const s = new Set(opened.value);
    s.delete(id);
    opened.value = s;
    roleRefs.delete(id);
  }
}

// —— def 聚焦：以 name 匹配，返回 id ——
function findRoleIdByName(name: string): string | null {
  const target = (name ?? '').trim();
  if (!target) return null;
  const r = roles.value.find((x) => x.base?.name?.trim?.() === target);
  return r ? r.id : null;
}

const _flashTimers = new Map<string, number>();
function flashRoleCard(id: string) {
  const el = roleRefs.get(id);
  if (!el) return;
  el.classList.add('flash-target');
  const old = _flashTimers.get(id);
  if (old) window.clearTimeout(old);
  const t = window.setTimeout(() => el.classList.remove('flash-target'), 1500);
  _flashTimers.set(id, t);
}

function focusRoleByName(name: string) {
  const id = findRoleIdByName(name);
  if (!id) {
    $q.notify({ type: 'warning', message: `未找到角色：${name}` });
    return;
  }
  drawerOpen.value = true; // 打开左侧列表
  mainOpened[id] = true; // 确保右侧该卡片展开
  scrollToRole(id); // 滚过去
  void nextTick(() => flashRoleCard(id)); // 闪烁高亮
}

function flushPendingDefs() {
  if (!rolesReady.value || pendingDefs.value.length === 0) return;
  const uniq = Array.from(new Set(pendingDefs.value));
  pendingDefs.value = [];
  for (const nm of uniq) focusRoleByName(nm);
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

/* 让主视图中的角色面板以卡片形式堆叠，更易区分 */
.role-panel {
  border-radius: 10px;
  overflow: visible; /* 允许内部阴影/溢出效果 */
  background: var(--q-card-bg, rgba(255, 255, 255, 0.02));
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 4px 5px rgba(16, 24, 40, 0.04);
}

/* 缩小堆叠卡片之间的垂直间距，覆盖 q-mb-sm 提供的较大外边距 */
.role-panel {
  margin-bottom: 0px !important;
}

/* 为内容区添加内边距，使卡片之间视觉上更分离 */
.role-panel .q-expansion__content {
  padding: 12px 16px;
}

/* 标题栏略微分离，固定圆角 */
.role-panel .q-expansion__header {
  border-top-left-radius: 10px;
  border-top-right-radius: 10px;
  padding: 12px 16px;
}

/* Dark mode tweaks */
.q-dark .role-panel {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.6);
}

/* 让抽屉内部滚动区独立占满视口，从而有自己的滚动条 */
.drawer-fullheight .q-scrollarea__container,
.drawer-fullheight .q-scrollarea__scrollbar {
  height: 100vh;
}

.flash-target {
  animation: flashOutline 1.5s ease-out 1;
  box-shadow:
    0 0 0 3px rgba(25, 118, 210, 0.35) inset,
    0 0 0 2px rgba(25, 118, 210, 0.6);
  border-radius: 8px;
}
@keyframes flashOutline {
  0% {
    box-shadow:
      0 0 0 8px rgba(25, 118, 210, 0.45) inset,
      0 0 0 4px rgba(25, 118, 210, 0.8);
  }
  100% {
    box-shadow:
      0 0 0 0 rgba(25, 118, 210, 0) inset,
      0 0 0 0 rgba(25, 118, 210, 0);
  }
}
</style>

/* 不占用布局体积的布局容器（display: contents 会让容器自身不生成 box） */ .layout-no-size {
display: contents; }
