<template>
  <q-layout view="hHh LpR fFf" class="global-role-panel">
    <q-page-container>
      <q-page class="page-wrapper">
        <!-- 顶栏 -->
        <header class="toolbar">
          <q-btn dense flat round :icon="sidebarCollapsed ? 'menu_open' : 'menu'" @click="sidebarCollapsed = !sidebarCollapsed">
            <q-tooltip>{{ sidebarCollapsed ? '展开角色列表' : '折叠角色列表' }}</q-tooltip>
          </q-btn>
          <q-input v-model="searchQuery" dense outlined clearable class="search-input" placeholder="搜索角色名称、别名、描述…" @update:model-value="onSearchChange">
            <template #prepend><q-icon name="search" /></template>
          </q-input>
          <q-select v-model="typeFilter" dense outlined clearable emit-value map-options class="type-select" :options="typeFilterOptions" label="类型" @update:model-value="onFilterChange" />
          <q-select v-model="packageFilter" dense outlined clearable emit-value map-options class="package-select" :options="packageFilterOptions" label="包" @update:model-value="onFilterChange" />
          <q-btn dense flat round :icon="activeFilterCount > 0 ? 'filter_alt' : 'filter_alt_off'" :color="activeFilterCount > 0 ? 'primary' : 'grey-6'" @click="filterDialog = true">
            <q-tooltip>{{ activeFilterCount > 0 ? `过滤器 (${activeFilterCount} 个生效)` : '过滤器' }}</q-tooltip>
          </q-btn>
          <q-btn dense flat round icon="refresh" @click="requestData">
            <q-tooltip>刷新</q-tooltip>
          </q-btn>
          <span class="stats-badge">共 {{ filteredRoles.length }} / {{ allRoles.length }} 个角色</span>
        </header>

        <!-- 过滤器弹窗 -->
        <q-dialog v-model="filterDialog" position="top">
          <q-card class="filter-dialog">
            <q-card-section>
              <div class="text-h6">过滤器设置</div>
            </q-card-section>
            <q-card-section class="q-pt-none">
              <q-list dense separator>
                <q-item>
                  <q-item-section>
                    <q-toggle v-model="favoritesOnly" dense color="yellow-8" label="仅显示收藏角色" @update:model-value="saveState()" />
                  </q-item-section>
                </q-item>
                <q-item>
                  <q-item-section>
                    <q-toggle v-model="showSensitive" dense label="显示敏感词类型" @update:model-value="saveState()" />
                  </q-item-section>
                </q-item>
                <q-item>
                  <q-item-section>
                    <q-select v-model="filterTypes" dense outlined multiple use-chips clearable emit-value map-options :options="allTypeOptions" label="限制显示类型" hint="不选 = 显示全部（不含敏感词）" />
                  </q-item-section>
                </q-item>
                <q-item>
                  <q-item-section>
                    <q-select v-model="filterPackages" dense outlined multiple use-chips clearable emit-value map-options :options="allPackageOptions" label="限制显示包" hint="不选 = 显示全部" />
                  </q-item-section>
                </q-item>
              </q-list>
            </q-card-section>
            <q-card-actions align="right">
              <q-btn flat label="清空全部" color="negative" @click="clearAllFilters" />
              <q-btn flat label="关闭" @click="filterDialog = false" />
            </q-card-actions>
          </q-card>
        </q-dialog>

        <div v-if="isLoading" class="notice">
          <q-spinner size="24px" color="primary" />
          <span class="q-ml-sm">加载角色数据…</span>
        </div>
        <div v-else-if="lastError" class="notice error">{{ lastError }}</div>
        <div v-else-if="allRoles.length === 0" class="notice">暂无角色数据</div>

        <main v-else class="content">
          <!-- 左侧角色列表 -->
          <aside class="role-list" :class="{ collapsed: sidebarCollapsed }">
            <q-list dense separator>
              <q-item
                v-for="role in displayRoles"
                :key="role.uuid || role.name"
                clickable
                v-ripple
                :active="selectedRole?.uuid === role.uuid"
                @click="selectRole(role)"
                class="role-item"
              >
                <q-item-section avatar>
                  <q-avatar size="36px" :style="{ background: role.color || getTypeColor(role.type) }" text-color="white">
                    <img v-if="role.avatar" :src="role.avatar" class="avatar-img" alt="" />
                    <template v-else>{{ role.name.charAt(0) }}</template>
                  </q-avatar>
                </q-item-section>
                <q-item-section>
                  <q-item-label class="role-name">
                    {{ role.name }}
                    <q-icon
                      v-if="favoriteNames.has(role.name)"
                      name="star"
                      size="14px"
                      color="yellow-8"
                      class="q-ml-xs"
                    />
                    <q-badge v-if="role.aliases?.length" outline color="grey" class="q-ml-xs">
                      {{ role.aliases.length }} 别名
                    </q-badge>
                  </q-item-label>
                  <q-item-label caption class="role-meta">
                    <q-chip dense size="sm" :label="role.type" />
                    <span v-if="role.packagePath" class="q-ml-xs text-grey-6">{{ getPackageName(role.packagePath) }}</span>
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-btn
                    dense
                    flat
                    round
                    size="sm"
                    :icon="favoriteNames.has(role.name) ? 'star' : 'star_outline'"
                    :color="favoriteNames.has(role.name) ? 'yellow-8' : 'grey-6'"
                    @click.stop="toggleFavorite(role.name)"
                  >
                    <q-tooltip>{{ favoriteNames.has(role.name) ? '取消收藏' : '收藏' }}</q-tooltip>
                  </q-btn>
                </q-item-section>
              </q-item>
            </q-list>
            <q-pagination
              v-if="totalPages > 1"
              v-model="currentPage"
              :max="totalPages"
              :max-pages="6"
              direction-links
              dense
              class="q-mt-sm q-mb-sm"
            />
          </aside>

          <!-- 右侧角色详情 -->
          <section class="role-detail" v-if="selectedRole">
            <div class="detail-header">
              <div class="detail-title-row">
                <q-avatar size="48px" :style="{ background: selectedRole.color || getTypeColor(selectedRole.type) }" text-color="white">
                  <img v-if="selectedRole.avatar" :src="selectedRole.avatar" class="avatar-img" alt="" />
                  <template v-else>{{ selectedRole.name.charAt(0) }}</template>
                </q-avatar>
                <div class="q-ml-md">
                  <h2 class="detail-name">
                    {{ selectedRole.name }}
                    <q-btn
                      dense
                      flat
                      round
                      size="sm"
                      :icon="favoriteNames.has(selectedRole.name) ? 'star' : 'star_outline'"
                      :color="favoriteNames.has(selectedRole.name) ? 'yellow-8' : 'grey-6'"
                      class="q-ml-sm"
                      @click="toggleFavorite(selectedRole.name)"
                    >
                      <q-tooltip>{{ favoriteNames.has(selectedRole.name) ? '取消收藏' : '收藏' }}</q-tooltip>
                    </q-btn>
                  </h2>
                  <div class="detail-type-row">
                    <q-chip dense :label="selectedRole.type" :style="{ background: getTypeColor(selectedRole.type), color: '#fff' }" />
                    <q-btn v-if="selectedRole.sourcePath" dense flat size="sm" icon="data_object" label="Raw" class="q-ml-sm" @click="openRawDialog(selectedRole)" />
                    <q-btn v-if="selectedRole.sourcePath" dense flat size="sm" icon="open_in_new" label="打开源文件" class="q-ml-sm" @click="openSource(selectedRole.sourcePath!)" />
                    <q-btn v-if="selectedRole.sourcePath" dense flat size="sm" icon="folder_open" label="所在目录" class="q-ml-xs" @click="openSourceDir(selectedRole.sourcePath!)" />
                  </div>
                </div>
              </div>
              <q-btn dense flat round icon="close" @click="selectedRole = null" />
            </div>

            <q-separator />

            <div class="detail-body">
              <!-- 角色设定图 -->
              <div v-if="selectedRole.illustrations?.length" class="detail-section">
                <h3>设定图 ({{ selectedRole.illustrations.length }})</h3>
                <div class="illustrations-grid">
                  <div v-for="(img, idx) in selectedRole.illustrations" :key="idx" class="illustration-card" @click="openImage(img)">
                    <img :src="img" :alt="`设定图 ${idx + 1}`" class="illustration-img" />
                  </div>
                </div>
              </div>

              <!-- Markdown 描述 -->
              <div v-if="selectedRole.description" class="detail-section">
                <h3>{{ fieldLabel('description') }}</h3>
                <MarkdownRenderer class="md-body" :content="selectedRole.description" />
              </div>

              <!-- 基本信息 -->
              <div class="detail-section">
                <h3>基本信息</h3>
                <q-list dense>
                  <q-item v-if="selectedRole.uuid">
                    <q-item-section side>{{ fieldLabel('uuid') }}</q-item-section>
                    <q-item-section class="text-mono text-caption">{{ selectedRole.uuid }}</q-item-section>
                  </q-item>
                  <q-item v-if="selectedRole.affiliation">
                    <q-item-section side>{{ fieldLabel('affiliation') }}</q-item-section>
                    <q-item-section><MarkdownRenderer :content="selectedRole.affiliation" inline /></q-item-section>
                  </q-item>
                  <q-item>
                    <q-item-section side>{{ fieldLabel('color') }}</q-item-section>
                    <q-item-section>
                      <q-badge :style="{ background: selectedRole.color || getTypeColor(selectedRole.type) }" class="color-swatch" />
                      {{ selectedRole.color || getTypeColor(selectedRole.type) }}
                    </q-item-section>
                  </q-item>
                  <q-item v-if="selectedRole.priority !== undefined">
                    <q-item-section side>{{ fieldLabel('priority') }}</q-item-section>
                    <q-item-section>{{ selectedRole.priority }}</q-item-section>
                  </q-item>
                  <q-item v-if="selectedRole.wordSegmentFilter">
                    <q-item-section side>{{ fieldLabel('wordSegmentFilter') }}</q-item-section>
                    <q-item-section>已启用</q-item-section>
                  </q-item>
                  <q-item v-if="selectedRole.packagePath">
                    <q-item-section side>所属包</q-item-section>
                    <q-item-section>{{ selectedRole.packagePath }}</q-item-section>
                  </q-item>
                  <q-item v-if="selectedRole.sourcePath">
                    <q-item-section side>源文件</q-item-section>
                    <q-item-section class="text-caption">{{ selectedRole.sourcePath }}</q-item-section>
                  </q-item>
                </q-list>
              </div>

              <!-- 别名 -->
              <div v-if="selectedRole.aliases?.length" class="detail-section">
                <h3>{{ fieldLabel('aliases') }} ({{ selectedRole.aliases.length }})</h3>
                <div class="chip-group">
                  <q-chip v-for="alias in selectedRole.aliases" :key="alias" dense outline color="primary" :label="alias" />
                </div>
              </div>

              <!-- 正则 -->
              <div v-if="selectedRole.regex" class="detail-section">
                <h3>{{ fieldLabel('regex') }}</h3>
                <code class="regex-code">{{ selectedRole.regex }}</code>
                <span v-if="selectedRole.regexFlags" class="q-ml-sm text-caption">{{ fieldLabel('regexFlags') }}: {{ selectedRole.regexFlags }}</span>
              </div>

              <!-- 修复候选 -->
              <div v-if="selectedRole.fixes?.length" class="detail-section">
                <h3>{{ fieldLabel('fixes') }}</h3>
                <div class="chip-group">
                  <q-chip v-for="fix in selectedRole.fixes" :key="fix" dense color="green-2" text-color="green-9" :label="fix" />
                </div>
              </div>

              <!-- 自定义字段 -->
              <div v-for="field in customFields" :key="field.key" class="detail-section">
                <h3>{{ field.label }}</h3>
                <MarkdownRenderer v-if="looksLikeMarkdown(field.value)" class="md-body" :content="field.value" />
                <p v-else>{{ field.value }}</p>
              </div>
            </div>
          </section>

          <!-- 未选择角色 -->
          <section v-else class="role-detail empty-detail">
            <q-icon name="person_search" size="64px" color="grey-5" />
            <p class="text-grey-6 q-mt-md">选择一个角色查看详情</p>
          </section>
        </main>

        <q-dialog v-model="rawDialog" maximized persistent>
          <q-card class="raw-dialog-card">
            <q-card-section class="raw-dialog-header">
              <div>
                <div class="text-h6">原始数据</div>
                <div class="text-caption text-grey-6">
                  {{ rawSourcePath || '未绑定源文件' }}
                </div>
                <div class="text-caption text-grey-6 q-mt-xs">
                  这里编辑的是该角色对应源文件的完整原文；如果多个角色共用同一文件，保存会一并改动这个文件。
                </div>
                <div v-if="rawDirty" class="raw-info q-mt-sm">
                  当前编辑区是未保存草稿。只有点击“保存”才会写入源文件。
                </div>
                <div v-if="rawExternalChanged" class="raw-warning q-mt-sm">
                  检测到源文件已被外部修改。为避免覆盖当前草稿，编辑区没有自动替换；点“重新加载”可查看最新版，或继续保存以覆盖源文件。
                </div>
              </div>
            </q-card-section>

            <q-separator />

            <q-card-section class="raw-dialog-body">
              <div v-if="rawError" class="raw-error">{{ rawError }}</div>
              <div v-if="rawLoading" class="notice">
                <q-spinner size="24px" color="primary" />
                <span class="q-ml-sm">加载原始数据…</span>
              </div>
              <textarea
                v-else
                v-model="rawContent"
                class="raw-textarea"
                spellcheck="false"
                placeholder="暂无原始数据"
              />
            </q-card-section>

            <q-separator />

            <q-card-actions align="right" class="raw-dialog-actions">
              <q-btn flat icon="refresh" label="重新加载" :disable="!rawSourcePath || rawLoading || rawSaving" @click="reloadRawContent" />
              <q-btn flat icon="open_in_new" label="打开源文件" :disable="!rawSourcePath || rawLoading || rawSaving" @click="openSource(rawSourcePath)" />
              <q-btn flat label="关闭" :disable="rawSaving" @click="closeRawDialog" />
              <q-btn color="primary" icon="save" label="保存" :loading="rawSaving" :disable="!rawSourcePath || rawLoading || !rawDirty" @click="saveRawContent" />
            </q-card-actions>
          </q-card>
        </q-dialog>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import MarkdownRenderer from '../components/MarkdownRenderer.vue';
import { formatRoleKeyInline, getCurrentRoleKeyLanguage } from '../utils/roleKeyLabels';

// ========== 类型 ==========
interface RoleData {
  name: string; type: string; uuid?: string; affiliation?: string;
  aliases?: string[]; description?: string; color?: string;
  wordSegmentFilter?: boolean; packagePath?: string; sourcePath?: string;
  regex?: string; regexFlags?: string; priority?: number;
  fixes?: string[]; avatar?: string; illustrations?: string[];
  [key: string]: unknown;
}

interface RoleMessage {
  command: string;
  added?: RoleData[]; removed?: { uuid?: string; name: string }[];
  modified?: RoleData[]; allRoles?: RoleData[]; error?: string;
  sourcePath?: string; content?: string;
  roleEditorSettings?: Partial<RoleEditorSettings>;
}

interface RoleEditorSettings {
  localizedKeyLabels: boolean;
  displayLanguage: string;
}

declare const acquireVsCodeApi: () => {
  postMessage: (d: unknown) => void; getState: () => unknown; setState: (s: unknown) => void;
};
const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;

// ========== 持久化 ==========
interface PanelState {
  showSensitive?: boolean; typeFilter?: string | null; packageFilter?: string | null;
  favoritesOnly?: boolean; favoriteNames?: string[]; sidebarCollapsed?: boolean;
  filterTypes?: string[]; filterPackages?: string[];
}
function loadState(): PanelState {
  try { return (vscode?.getState() as PanelState) ?? {}; } catch { return {}; }
}
function saveState() {
  vscode?.setState({
    showSensitive: showSensitive.value, typeFilter: typeFilter.value,
    packageFilter: packageFilter.value, favoritesOnly: favoritesOnly.value,
    favoriteNames: [...favoriteNames.value], sidebarCollapsed: sidebarCollapsed.value,
    filterTypes: filterTypes.value, filterPackages: filterPackages.value,
  });
}

// ========== 状态 ==========
const allRoles = ref<RoleData[]>([]);
const isLoading = ref(true);
const lastError = ref('');
const searchQuery = ref('');
const selectedRole = ref<RoleData | null>(null);
const currentPage = ref(1);
const pageSize = 50;

const saved = loadState();
const showSensitive = ref(saved.showSensitive ?? false);
const typeFilter = ref<string | null>(saved.typeFilter ?? null);
const packageFilter = ref<string | null>(saved.packageFilter ?? null);
const favoritesOnly = ref(saved.favoritesOnly ?? false);
const favoriteNames = ref<Set<string>>(new Set(saved.favoriteNames ?? []));
const sidebarCollapsed = ref(saved.sidebarCollapsed ?? false);
const filterDialog = ref(false);
const filterTypes = ref<string[]>(saved.filterTypes ?? []);
const filterPackages = ref<string[]>(saved.filterPackages ?? []);
const rawDialog = ref(false);
const rawSourcePath = ref('');
const rawContent = ref('');
const rawOriginalContent = ref('');
const rawLoading = ref(false);
const rawSaving = ref(false);
const rawError = ref('');
const rawExternalChanged = ref(false);
const roleEditorSettings = ref<RoleEditorSettings>({
  localizedKeyLabels: true,
  displayLanguage: getCurrentRoleKeyLanguage(),
});
const rawDirty = computed(() => rawContent.value !== rawOriginalContent.value);

// ========== 收藏 ==========
function toggleFavorite(name: string) {
  const next = new Set(favoriteNames.value);
  if (next.has(name)) { next.delete(name); } else { next.add(name); }
  favoriteNames.value = next;
  saveState();
}

// ========== 颜色 ==========
const TYPE_COLORS: Record<string, string> = {
  '主角': '#E60033', '配角': '#0099CC', '联动角色': '#9966CC',
  '敏感词': '#FF6600', '词汇': '#33AA55', '正则表达式': '#CC6600',
};
function getTypeColor(type: string): string { return TYPE_COLORS[type] || '#888888'; }

// ========== 过滤选项 ==========
const typeFilterOptions = computed(() =>
  [...new Set(allRoles.value.map(r => r.type))].sort().map(t => ({ label: t, value: t }))
);
const allTypeOptions = computed(() =>
  [...new Set(allRoles.value.map(r => r.type))].sort().map(t => ({ label: t, value: t }))
);
const packageFilterOptions = computed(() =>
  [...new Set(allRoles.value.map(r => r.packagePath).filter(Boolean))].sort().map(p => ({ label: getPackageName(p!), value: p! }))
);
const allPackageOptions = computed(() =>
  [...new Set(allRoles.value.map(r => r.packagePath).filter(Boolean))].sort().map(p => ({ label: getPackageName(p!), value: p! }))
);
const activeFilterCount = computed(() => {
  let n = 0;
  if (favoritesOnly.value) n++;
  if (!showSensitive.value) n++;
  if (filterTypes.value.length > 0) n++;
  if (filterPackages.value.length > 0) n++;
  if (typeFilter.value) n++;
  if (packageFilter.value) n++;
  return n;
});
function getPackageName(pkg: string): string {
  const parts = pkg.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || pkg;
}

// ========== 过滤 ==========
const filteredRoles = computed(() => {
  let result = allRoles.value;
  // 多选类型过滤
  if (filterTypes.value.length > 0) {
    result = result.filter(r => filterTypes.value.includes(r.type));
  } else if (!showSensitive.value) {
    result = result.filter(r => r.type !== '敏感词');
  }
  // 多选包过滤
  if (filterPackages.value.length > 0) {
    result = result.filter(r => r.packagePath && filterPackages.value.includes(r.packagePath));
  }
  if (favoritesOnly.value) result = result.filter(r => favoriteNames.value.has(r.name));
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.aliases?.some(a => a.toLowerCase().includes(q)) ||
      r.description?.toLowerCase().includes(q) ||
      r.affiliation?.toLowerCase().includes(q) ||
      r.type.toLowerCase().includes(q)
    );
  }
  if (typeFilter.value) result = result.filter(r => r.type === typeFilter.value);
  if (packageFilter.value) result = result.filter(r => r.packagePath === packageFilter.value);
  return result;
});
const totalPages = computed(() => Math.ceil(filteredRoles.value.length / pageSize));
const displayRoles = computed(() => {
  const start = (currentPage.value - 1) * pageSize;
  return filteredRoles.value.slice(start, start + pageSize);
});

// ========== 自定义字段 ==========
const KNOWN_KEYS = new Set([
  'name','type','uuid','affiliation','aliases','description','color',
  'wordSegmentFilter','packagePath','sourcePath','regex','regexFlags',
  'priority','fixes','fixs','avatar','illustrations',
]);
const customFields = computed(() => {
  if (!selectedRole.value) return [];
  return Object.entries(selectedRole.value)
    .filter(([k]) => !KNOWN_KEYS.has(k))
    .map(([key, value]) => ({ key, label: fieldLabel(key), value: formatUnknownValue(value) }));
});
function formatUnknownValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return v.toString();
  try { return JSON.stringify(v); } catch { return ''; }
}
function looksLikeMarkdown(s: string): boolean {
  return /[*_#>\\[\]!`-]/.test(s);
}

function fieldLabel(key: string): string {
  return formatRoleKeyInline(
    key,
    roleEditorSettings.value.localizedKeyLabels,
    roleEditorSettings.value.displayLanguage,
  );
}

// ========== 操作 ==========
function selectRole(role: RoleData) { selectedRole.value = role; }
function requestData() { isLoading.value = true; lastError.value = ''; vscode?.postMessage({ command: 'globalRolePanel.ready' }); }
function openSource(path: string) { vscode?.postMessage({ command: 'globalRolePanel.openSource', sourcePath: path }); }
function openRawDialog(role: RoleData) {
  if (!role.sourcePath) return;
  if (rawDialog.value && rawDirty.value && rawSourcePath.value && rawSourcePath.value !== role.sourcePath) {
    const confirmed = window.confirm('当前 Raw 窗口里有未保存草稿，切换到其他源文件会丢失草稿。确定继续吗？');
    if (!confirmed) {
      return;
    }
  }
  rawDialog.value = true;
  rawSourcePath.value = role.sourcePath;
  rawError.value = '';
  rawExternalChanged.value = false;
  loadRawContent(role.sourcePath);
}
function openSourceDir(sourcePath: string) {
  const dir = sourcePath.replace(/[/\\][^/\\]+$/, '');
  if (dir) vscode?.postMessage({ command: 'globalRolePanel.openSource', sourcePath: dir });
}
function openImage(src: string) { vscode?.postMessage({ command: 'globalRolePanel.openSource', sourcePath: src }); }
function closeRawDialog() {
  if (rawDirty.value) {
    const confirmed = window.confirm('当前 Raw 窗口里有未保存草稿。确定关闭并丢弃草稿吗？');
    if (!confirmed) {
      return;
    }
  }
  rawDialog.value = false;
  rawSourcePath.value = '';
  rawContent.value = '';
  rawOriginalContent.value = '';
  rawLoading.value = false;
  rawSaving.value = false;
  rawError.value = '';
  rawExternalChanged.value = false;
  vscode?.postMessage({ command: 'globalRolePanel.closeRaw' });
}
function reloadRawContent() {
  if (!rawSourcePath.value) return;
  rawExternalChanged.value = false;
  loadRawContent(rawSourcePath.value);
}
function loadRawContent(sourcePath: string) {
  rawLoading.value = true;
  rawError.value = '';
  vscode?.postMessage({ command: 'globalRolePanel.requestRaw', sourcePath });
}
function saveRawContent() {
  if (!rawSourcePath.value || rawSaving.value) return;
  rawSaving.value = true;
  rawError.value = '';
  vscode?.postMessage({
    command: 'globalRolePanel.saveRaw',
    sourcePath: rawSourcePath.value,
    content: rawContent.value,
  });
}
function onSearchChange() { currentPage.value = 1; selectedRole.value = null; }
function onFilterChange() { currentPage.value = 1; selectedRole.value = null; saveState(); }
function clearAllFilters() {
  favoritesOnly.value = false;
  showSensitive.value = false;
  typeFilter.value = null;
  packageFilter.value = null;
  filterTypes.value = [];
  filterPackages.value = [];
  onFilterChange();
}

// ========== 消息 ==========
function handleMessage(event: MessageEvent) {
  const msg = event.data as RoleMessage;
  if (!msg?.command) return;
  switch (msg.command) {
    case 'globalRolePanel.data':
      allRoles.value = msg.allRoles || [];
      applyRoleEditorSettings(msg.roleEditorSettings);
      isLoading.value = false;
      lastError.value = msg.error || '';
      break;
    case 'globalRolePanel.sync':
      applyDiff(msg);
      break;
    case 'globalRolePanel.error':
      isLoading.value = false;
      lastError.value = msg.error || '未知错误';
      break;
    case 'globalRolePanel.rawData':
      if (msg.sourcePath && msg.sourcePath === rawSourcePath.value) {
        rawLoading.value = false;
        rawSaving.value = false;
        rawError.value = '';
        rawExternalChanged.value = false;
        rawContent.value = msg.content || '';
        rawOriginalContent.value = msg.content || '';
      }
      break;
    case 'globalRolePanel.rawExternalUpdate':
      if (msg.sourcePath && msg.sourcePath === rawSourcePath.value) {
        rawLoading.value = false;
        rawSaving.value = false;
        rawError.value = '';
        if (rawDirty.value) {
          rawExternalChanged.value = true;
        } else {
          rawExternalChanged.value = false;
          rawContent.value = msg.content || '';
          rawOriginalContent.value = msg.content || '';
        }
      }
      break;
    case 'globalRolePanel.rawSaved':
      if (!msg.sourcePath || msg.sourcePath === rawSourcePath.value) {
        rawLoading.value = false;
        rawSaving.value = false;
        rawError.value = '';
        rawExternalChanged.value = false;
        rawOriginalContent.value = rawContent.value;
      }
      break;
    case 'globalRolePanel.rawError':
      if (!msg.sourcePath || msg.sourcePath === rawSourcePath.value) {
        rawLoading.value = false;
        rawSaving.value = false;
        rawError.value = msg.error || '原始数据操作失败';
      }
      break;
  }
}

function applyRoleEditorSettings(settings: Partial<RoleEditorSettings> | undefined) {
  if (!settings) return;
  roleEditorSettings.value = {
    localizedKeyLabels: settings.localizedKeyLabels !== false,
    displayLanguage: typeof settings.displayLanguage === 'string'
      ? settings.displayLanguage
      : getCurrentRoleKeyLanguage(),
  };
}

function applyDiff(msg: RoleMessage) {
  if (msg.removed?.length) {
    const removedNames = new Set(msg.removed.map(r => r.name));
    allRoles.value = allRoles.value.filter(r => !removedNames.has(r.name));
    if (selectedRole.value && removedNames.has(selectedRole.value.name)) selectedRole.value = null;
  }
  if (msg.modified?.length) {
    for (const mod of msg.modified) {
      const idx = allRoles.value.findIndex(r => r.name === mod.name);
      if (idx >= 0) { allRoles.value[idx] = { ...allRoles.value[idx], ...mod }; }
      else { allRoles.value.push(mod); }
      if (selectedRole.value?.name === mod.name) selectedRole.value = { ...selectedRole.value, ...mod };
    }
  }
  if (msg.added?.length) {
    for (const add of msg.added) {
      if (!allRoles.value.some(r => r.name === add.name)) allRoles.value.push(add);
    }
  }
}

onMounted(() => {
  window.addEventListener('message', handleMessage);
  requestData();
});
</script>

<style scoped>
.global-role-panel {
  background: var(--vscode-editor-background, #1e1e1e);
  color: var(--vscode-editor-foreground, #d4d4d4);
}
.page-wrapper { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
.toolbar {
  display: flex; gap: 8px; align-items: center; padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.25));
  flex-shrink: 0; flex-wrap: wrap;
}
.search-input { flex: 1; min-width: 120px; }
.type-select { width: 120px; }
.package-select { width: 130px; }
.stats-badge { font-size: 12px; color: var(--vscode-descriptionForeground); white-space: nowrap; }
.notice { display: flex; align-items: center; justify-content: center; padding: 40px 20px; color: var(--vscode-descriptionForeground); }
.notice.error { color: var(--vscode-errorForeground); }

.content { display: flex; flex: 1; overflow: hidden; }

/* 左侧角色列表 */
.role-list {
  width: 320px; min-width: 200px;
  border-right: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.25));
  overflow-y: auto; display: flex; flex-direction: column;
  transition: width 0.25s ease, min-width 0.25s ease, opacity 0.2s ease, padding 0.25s ease;
}
.role-list.collapsed {
  width: 0; min-width: 0; opacity: 0; padding: 0; overflow: hidden; border-right-width: 0;
}
.role-item .role-name { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.role-item .role-meta { display: flex; align-items: center; gap: 4px; margin-top: 2px; }

.avatar-img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }

/* 右侧详情 */
.role-detail { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
.empty-detail { display: flex; flex-direction: column; align-items: center; justify-content: center; }
.detail-header { display: flex; justify-content: space-between; align-items: flex-start; padding: 16px 20px; }
.detail-title-row { display: flex; align-items: center; }
.detail-name { margin: 0; font-size: 20px; font-weight: 700; display: flex; align-items: center; }
.detail-type-row { display: flex; align-items: center; margin-top: 4px; }
.detail-body { padding: 0 20px 20px; }
.detail-section { margin-top: 16px; }
.detail-section h3 {
  margin: 0 0 8px; font-size: 13px; font-weight: 600;
  color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.5px;
}
.chip-group { display: flex; flex-wrap: wrap; gap: 4px; }
.color-swatch { display: inline-block; width: 14px; height: 14px; border-radius: 3px; margin-right: 6px; vertical-align: middle; }
.regex-code {
  background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.15));
  padding: 2px 8px; border-radius: 4px;
  font-family: var(--vscode-editor-font-family, monospace); font-size: 12px;
}
.text-mono { font-family: var(--vscode-editor-font-family, monospace); }

/* Markdown 渲染区域 */
.md-body { line-height: 1.7; word-break: break-word; }
.md-body :deep(h1) { font-size: 1.4em; margin: 0.6em 0 0.3em; }
.md-body :deep(h2) { font-size: 1.25em; margin: 0.6em 0 0.3em; }
.md-body :deep(h3) { font-size: 1.1em; margin: 0.5em 0 0.2em; }
.md-body :deep(h4) { font-size: 1em; margin: 0.4em 0 0.1em; }
.md-body :deep(p) { margin: 0.5em 0; }
.md-body :deep(ul) { margin: 0.3em 0; padding-left: 1.5em; }
.md-body :deep(li) { margin: 0.15em 0; }
.md-body :deep(code) {
  background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.15));
  padding: 1px 5px; border-radius: 3px;
  font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em;
}
.md-body :deep(pre) {
  background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.12));
  padding: 10px 14px; border-radius: 6px; overflow-x: auto;
  font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85em;
  line-height: 1.5; margin: 0.5em 0;
}
.md-body :deep(pre code) { background: none; padding: 0; }
.md-body :deep(hr) {
  border: none; border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.25)); margin: 1em 0;
}
.md-body :deep(a) { color: var(--vscode-textLink-foreground, #3794ff); }
.md-body :deep(img) { max-width: 100%; height: auto; border-radius: 6px; margin: 0.5em 0; }

/* 设定图网格 */
.illustrations-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
.illustration-card {
  border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.25));
  border-radius: 8px; overflow: hidden; cursor: pointer;
  transition: transform 0.15s ease; aspect-ratio: 3/4;
}
.illustration-card:hover { transform: scale(1.03); border-color: var(--vscode-focusBorder, #007acc); }
.illustration-img { width: 100%; height: 100%; object-fit: cover; }

.raw-dialog-card {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-height: 100vh;
}
.raw-dialog-header {
  flex: 0 0 auto;
}
.raw-dialog-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-top: 12px;
}
.raw-dialog-actions {
  flex: 0 0 auto;
}
.raw-textarea {
  width: 100%;
  height: 100%;
  min-height: 320px;
  resize: none;
  border: 1px solid var(--vscode-input-border, rgba(127,127,127,0.35));
  border-radius: 6px;
  padding: 12px;
  background: var(--vscode-input-background, rgba(127,127,127,0.08));
  color: var(--vscode-input-foreground, inherit);
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 12px;
  line-height: 1.6;
}
.raw-textarea:focus {
  outline: 1px solid var(--vscode-focusBorder, #007acc);
}
.raw-error {
  margin-bottom: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  color: var(--vscode-errorForeground);
  background: color-mix(in srgb, var(--vscode-errorForeground) 10%, transparent);
}
.raw-info {
  padding: 8px 10px;
  border-radius: 6px;
  color: var(--vscode-descriptionForeground);
  background: color-mix(in srgb, var(--vscode-descriptionForeground) 12%, transparent);
}
.raw-warning {
  padding: 8px 10px;
  border-radius: 6px;
  color: var(--vscode-editorWarning-foreground, #cca700);
  background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700) 14%, transparent);
}

/* 过滤弹窗 */
.filter-dialog { width: 420px; max-width: 90vw; }
</style>
