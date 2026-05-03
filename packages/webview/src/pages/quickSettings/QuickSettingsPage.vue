<template>
  <div class="quick-settings-page">
    <div class="page-container">
      <!-- Header -->
      <div class="header">
        <div class="header-left">
          <h1 class="page-title">图形化快速设置</h1>
          <span class="page-subtitle">可视化调整写作环境</span>
        </div>
        <div class="header-right">
          <div class="scope-toggle">
            <button
              class="scope-btn"
              :class="{ active: currentScope === 'global' }"
              @click="setScope('global')"
            >
              全局
            </button>
            <button
              class="scope-btn"
              :class="{ active: currentScope === 'workspace' }"
              @click="setScope('workspace')"
            >
              工作区
            </button>
          </div>
          <div class="header-actions">
            <button v-if="changedCount > 0" class="btn btn-reset" @click="resetConfig">
              放弃更改（{{ changedCount }}）
            </button>
            <button class="btn btn-save" @click="saveConfig">保存</button>
          </div>
        </div>
      </div>

      <!-- Content -->
      <div class="content">
        <div v-for="group in settingGroups" :key="group.id" class="setting-group">
          <div class="group-header">
            <span class="group-icon" v-html="group.icon"></span>
            <span class="group-name">{{ group.name }}</span>
            <span class="group-count">{{ group.items.length }}</span>
          </div>
          <!-- Status bar group: compact settings + full-width preview -->
          <div v-if="group.id === 'statusBar'" class="statusbar-group">
            <div class="statusbar-settings">
              <div v-for="item in group.items" :key="item.id" class="statusbar-setting-row">
                <span class="setting-name">{{ getStatusBarDisplayName(item.id) }}</span>
                <!-- Select -->
                <select
                  v-if="item.enum"
                  class="config-select"
                  :value="item.value"
                  @change="updateConfigValue(item.id, ($event.target as HTMLSelectElement).value)"
                >
                  <option
                    v-for="(opt, index) in item.enum"
                    :key="opt"
                    :value="opt"
                  >
                    {{ item.enumDescriptions?.[index] || opt }}
                  </option>
                </select>
                <!-- Toggle -->
                <label v-else-if="item.type === 'boolean'" class="toggle-switch">
                  <input
                    type="checkbox"
                    :checked="item.value"
                    @change="updateConfigValue(item.id, ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="slider"></span>
                </label>
              </div>
            </div>
            <div class="statusbar-fullwidth-preview">
              <StatusBarPreview
                :statusBarMode="getStatusItem('AndreaNovelHelper.wordCount.statusBar.mode')?.value ?? 'detailed'"
                :speedUnit="getStatusItem('AndreaNovelHelper.wordCount.statusBar.speedUnit')?.value ?? 'cpm'"
                :primaryUnit="getStatusItem('AndreaNovelHelper.wordCount.primaryUnit')?.value ?? 'excludePunct'"
                :layoutCompact="getStatusItem('andrea.typeset.statusBar.compact')?.value ?? false"
                :autoGitCompact="getStatusItem('AndreaNovelHelper.autoGit.compactStatus')?.value ?? false"
              />
            </div>
          </div>

          <!-- Normal grid for other groups -->
          <div v-else class="group-items">
            <template v-for="item in group.items" :key="item.id">
              <SettingPreviewCard
                v-if="getPreviewComponent(item.id)"
                :item="item"
                :show-preview="true"
                @update:value="updateConfigValue(item.id, $event)"
                @reset="updateConfigValue(item.id, item.defaultValue)"
              >
                <component
                  :is="getPreviewComponent(item.id)"
                  v-bind="getPreviewProps(item.id)"
                />
              </SettingPreviewCard>

              <SettingPreviewCard
                v-else
                :item="item"
                :show-preview="false"
                @update:value="updateConfigValue(item.id, $event)"
                @reset="updateConfigValue(item.id, item.defaultValue)"
              />
            </template>
          </div>
        </div>

        <!-- Empty state -->
        <div v-if="quickSettingsItems.length === 0 && !loading" class="empty-state">
          <p>暂无快速设置项</p>
        </div>

        <!-- Loading state -->
        <div v-if="loading" class="loading-state">
          <div class="spinner"></div>
          <p>加载设置中...</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, defineAsyncComponent } from 'vue'
import SettingPreviewCard from './components/SettingPreviewCard.vue'
import StatusBarPreview from './components/previews/StatusBarPreview.vue'
import { useVsCodeApiStore } from '../../stores/vscode'
import type { ConfigItem } from 'src/types/config'

const vsCodeApiStore = useVsCodeApiStore()

const loading = ref(true)
const currentScope = ref<'global' | 'workspace'>('workspace')
const configItems = ref<ConfigItem[]>([])
const originalSettings = ref<Record<string, any>>({})

// Preview component map
const previewComponents: Record<string, any> = {
  'editor.wordWrap': defineAsyncComponent(() => import('./components/previews/WordWrapPreview.vue')),
  'editor.wrappingIndent': defineAsyncComponent(() => import('./components/previews/WrappingIndentPreview.vue')),
  'editor.fontSize': defineAsyncComponent(() => import('./components/previews/FontSizePreview.vue')),
  'editor.fontFamily': defineAsyncComponent(() => import('./components/previews/FontFamilyPreview.vue')),
  'editor.minimap.enabled': defineAsyncComponent(() => import('./components/previews/MinimapPreview.vue')),
  'editor.tabSize': defineAsyncComponent(() => import('./components/previews/TabSizePreview.vue')),
  'andrea.typeset.indentFirstTwoSpaces': defineAsyncComponent(() => import('./components/previews/ParagraphPreview.vue')),
  'andrea.typeset.blankLinesBetweenParas': defineAsyncComponent(() => import('./components/previews/ParagraphPreview.vue')),
  'AndreaNovelHelper.wordCount.statusBar.mode': defineAsyncComponent(() => import('./components/previews/StatusBarPreview.vue')),
  'andrea.typeset.enableAutoPairs': defineAsyncComponent(() => import('./components/previews/AutoPairsPreview.vue')),
  'andrea.typeset.enableSmartExit': defineAsyncComponent(() => import('./components/previews/SmartExitPreview.vue')),
  'andrea.typeset.enableSmartEnter': defineAsyncComponent(() => import('./components/previews/SmartEnterPreview.vue')),
  'andrea.typeset.trimTrailingSpaces': defineAsyncComponent(() => import('./components/previews/TrimTrailingSpacesPreview.vue')),
}

const changedCount = computed(() => {
  let count = 0
  configItems.value.forEach(item => {
    if (originalSettings.value[item.id] !== item.value) {
      count++
    }
  })
  return count
})

const quickSettingsItems = computed(() => {
  return configItems.value.filter(item => item.quickSetting === true)
})

const settingGroups = computed(() => {
  const items = quickSettingsItems.value
  const groups = [
    {
      id: 'wrapDisplay',
      name: '换行与显示',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h12M4 18h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
      ids: ['editor.wordWrap', 'editor.wrappingIndent', 'editor.minimap.enabled', 'editor.fontSize', 'editor.fontFamily']
    },
    {
      id: 'paragraph',
      name: '段落排版',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M17 10H3M21 6H3M21 14H3M17 18H3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
      ids: ['andrea.typeset.indentFirstTwoSpaces', 'andrea.typeset.blankLinesBetweenParas', 'editor.tabSize']
    },
    {
      id: 'smartEdit',
      name: '智能编辑',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      ids: ['andrea.typeset.enableAutoPairs', 'andrea.typeset.enableSmartExit', 'andrea.typeset.enableSmartEnter', 'andrea.typeset.trimTrailingSpaces']
    },
    {
      id: 'wordCount',
      name: '字数统计',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
      ids: ['AndreaNovelHelper.timeStats.includePaste']
    },
    {
      id: 'statusBar',
      name: '状态栏',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="2" y="17" width="20" height="3" rx="1" stroke="currentColor" stroke-width="2"/><path d="M5 17v3M9 17v3M15 17v3" stroke="currentColor" stroke-width="2"/></svg>',
      ids: ['AndreaNovelHelper.wordCount.statusBar.mode', 'AndreaNovelHelper.wordCount.statusBar.speedUnit', 'AndreaNovelHelper.wordCount.primaryUnit', 'AndreaNovelHelper.wordCount.statusBar.compact', 'andrea.typeset.statusBar.compact', 'AndreaNovelHelper.autoGit.compactStatus']
    },
    {
      id: 'other',
      name: '其他',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="2"/></svg>',
      ids: ['editor.mouseWheelZoom', 'AndreaNovelHelper.smartTabGroupLock.enabled']
    }
  ]

  return groups.map(g => ({
    ...g,
    items: items.filter(item => g.ids.includes(item.id))
  })).filter(g => g.items.length > 0)
})

function getPreviewComponent(itemId: string) {
  return previewComponents[itemId] || null
}

function getPreviewProps(itemId: string) {
  const item = configItems.value.find(i => i.id === itemId)
  if (!item) return {}

  switch (itemId) {
    case 'editor.wordWrap':
      return { value: item.value }
    case 'editor.wrappingIndent':
      return { value: item.value }
    case 'editor.fontSize':
      return { value: item.value }
    case 'editor.fontFamily':
      return { value: item.value }
    case 'editor.minimap.enabled':
      return { value: item.value }
    case 'editor.tabSize':
      return { value: item.value }
    case 'andrea.typeset.indentFirstTwoSpaces':
      return {
        indentFirstTwoSpaces: item.value,
        blankLinesBetweenParas: configItems.value.find(i => i.id === 'andrea.typeset.blankLinesBetweenParas')?.value ?? 1
      }
    case 'andrea.typeset.blankLinesBetweenParas':
      return {
        indentFirstTwoSpaces: configItems.value.find(i => i.id === 'andrea.typeset.indentFirstTwoSpaces')?.value ?? true,
        blankLinesBetweenParas: item.value
      }
    case 'AndreaNovelHelper.wordCount.statusBar.mode':
      return {
        statusBarMode: item.value,
        speedUnit: configItems.value.find(i => i.id === 'AndreaNovelHelper.wordCount.statusBar.speedUnit')?.value ?? 'cpm',
        primaryUnit: configItems.value.find(i => i.id === 'AndreaNovelHelper.wordCount.primaryUnit')?.value ?? 'excludePunct'
      }
    case 'andrea.typeset.enableAutoPairs':
    case 'andrea.typeset.enableSmartExit':
    case 'andrea.typeset.enableSmartEnter':
    case 'andrea.typeset.trimTrailingSpaces':
      return { value: item.value }
    default:
      return {}
  }
}

function getStatusItem(id: string) {
  return configItems.value.find(i => i.id === id)
}

// Override display names for status bar settings — config anhName is ambiguous
const statusBarDisplayNames: Record<string, string> = {
  'AndreaNovelHelper.wordCount.statusBar.mode': '字数统计显示模式',
  'AndreaNovelHelper.wordCount.statusBar.speedUnit': '速度单位',
  'AndreaNovelHelper.wordCount.primaryUnit': '字数单位',
  'AndreaNovelHelper.wordCount.statusBar.compact': '字数统计精简模式',
  'andrea.typeset.statusBar.compact': '版式状态栏简略',
  'AndreaNovelHelper.autoGit.compactStatus': 'ANH:Sync 简略模式',
}

function getStatusBarDisplayName(itemId: string): string {
  return statusBarDisplayNames[itemId] || itemId
}

function updateConfigValue(itemId: string, newValue: any) {
  const item = configItems.value.find(i => i.id === itemId)
  if (item) {
    item.value = newValue
    if (vsCodeApiStore.vscode) {
      vsCodeApiStore.vscode.postMessage({
        command: 'updateSetting',
        key: itemId,
        value: newValue
      })
    }
  }
}

function resetConfig() {
  configItems.value.forEach(item => {
    if (originalSettings.value[item.id] !== item.value) {
      updateConfigValue(item.id, originalSettings.value[item.id])
    }
  })
}

function saveConfig() {
  const changedSettings: Record<string, any> = {}
  let hasChanges = false

  configItems.value.forEach(item => {
    if (originalSettings.value[item.id] !== item.value) {
      changedSettings[item.id] = item.value
      hasChanges = true
    }
  })

  if (!hasChanges) return

  if (vsCodeApiStore.vscode) {
    vsCodeApiStore.vscode.postMessage({
      command: 'saveSettings',
      settings: changedSettings
    })

    Object.keys(changedSettings).forEach(key => {
      originalSettings.value[key] = changedSettings[key]
    })
  }
}

function setScope(scope: 'global' | 'workspace') {
  currentScope.value = scope
  if (vsCodeApiStore.vscode) {
    vsCodeApiStore.vscode.postMessage({
      command: 'setScope',
      scope
    })
  }
}

onMounted(() => {
  if (vsCodeApiStore.vscode) {
    vsCodeApiStore.vscode.postMessage({ command: 'getSettings' })
  }

  const handleMessage = (event: MessageEvent) => {
    const message = event.data

    switch (message.command) {
      case 'settingsData':
        if (message.data) {
          const { configItems: newConfigItems, currentScope: scope } = message.data
          configItems.value = newConfigItems
          currentScope.value = scope || 'workspace'

          originalSettings.value = {}
          newConfigItems.forEach((item: ConfigItem) => {
            originalSettings.value[item.id] = item.value
          })

          loading.value = false
        }
        break

      case 'settingUpdated':
        break

      case 'settingsSaved':
        break

      case 'error':
        console.error('Settings error:', message.message)
        break
    }
  }

  window.addEventListener('message', handleMessage)

  onBeforeUnmount(() => {
    window.removeEventListener('message', handleMessage)
  })
})
</script>

<style scoped>
.quick-settings-page {
  height: 100vh;
  background-color: var(--vscode-editor-background, #1e1e1e);
  color: var(--vscode-foreground, #e0e0e0);
  overflow: hidden;
}

.page-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px;
  border-bottom: 1px solid var(--vscode-panel-border, #333);
  background-color: var(--vscode-sideBar-background, #252526);
  flex-shrink: 0;
  box-sizing: border-box;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1;
}

.page-title {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
  padding: 0;
  line-height: 1;
}

.page-subtitle {
  font-size: 18px;
  color: var(--vscode-descriptionForeground, #999);
  line-height: 1;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  line-height: 1;
}

.scope-toggle {
  display: flex;
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: 6px;
  overflow: hidden;
}

.scope-btn {
  padding: 3px 10px;
  border: none;
  background: transparent;
  color: var(--vscode-foreground, #e0e0e0);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  line-height: 1;
}

.scope-btn:hover {
  background-color: var(--vscode-toolbar-hoverBackground, #333);
}

.scope-btn.active {
  background-color: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
}

.header-actions {
  display: flex;
  gap: 8px;
}

.btn {
  padding: 3px 12px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
  line-height: 1;
}

.btn-save {
  background-color: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
}

.btn-save:hover {
  background-color: var(--vscode-button-hoverBackground, #1177bb);
}

.btn-reset {
  background-color: var(--vscode-button-secondaryBackground, #3a3d41);
  color: var(--vscode-button-secondaryForeground, #e0e0e0);
}

.btn-reset:hover {
  background-color: var(--vscode-button-secondaryHoverBackground, #45494e);
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px;
}

.setting-group {
  margin-bottom: 28px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--vscode-panel-border, #333);
}

.group-icon {
  display: flex;
  align-items: center;
  color: var(--vscode-textLink-foreground, #3794ff);
}

.group-name {
  font-size: var(--vscode-font-size-large, 1rem);
  font-weight: 600;
}

.group-count {
  font-size: var(--vscode-font-size, 0.75rem);
  color: var(--vscode-descriptionForeground, #999);
  background-color: var(--vscode-badge-background, #4d4d4d);
  color: var(--vscode-badge-foreground, #fff);
  padding: 1px 6px;
  border-radius: 10px;
  margin-left: auto;
}

.group-items {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}

.statusbar-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.statusbar-settings {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 8px;
}

.statusbar-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  background-color: var(--vscode-editor-background, #1e1e1e);
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: 6px;
}

.setting-name {
  font-size: var(--vscode-font-size, 0.85rem);
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}

.statusbar-setting-row .config-select {
  flex: 1;
  max-width: 260px;
  padding: 3px 8px;
  border: 1px solid var(--vscode-input-border, #3c3c3c);
  border-radius: 4px;
  background-color: var(--vscode-input-background, #3c3c3c);
  color: var(--vscode-input-foreground, #cccccc);
  font-size: var(--vscode-font-size, 0.85rem);
  font-family: var(--vscode-font-family, inherit);
  outline: none;
  cursor: pointer;
  appearance: auto;
  -webkit-appearance: auto;
}

.statusbar-setting-row .config-select:focus {
  border-color: var(--vscode-focusBorder, #007acc);
}

.statusbar-setting-row .config-select:hover {
  border-color: var(--vscode-input-border, #3c3c3c);
}

.statusbar-setting-row .toggle-switch {
  position: relative;
  display: inline-block;
  width: 43px;
  height: 22px;
  flex-shrink: 0;
}

.statusbar-setting-row .toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.statusbar-setting-row .slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--vscode-checkbox-background, #444);
  border: 1px solid var(--vscode-checkbox-border, #555);
  border-radius: 22px;
  transition: 0.4s;
}

.statusbar-setting-row .slider::before {
  content: '';
  position: absolute;
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  background-color: var(--vscode-foreground, #e0e0e0);
  border-radius: 50%;
  transition: 0.4s;
}

.statusbar-setting-row input:checked + .slider {
  background-color: var(--vscode-button-background, #0e639c);
  border-color: var(--vscode-button-background, #0e639c);
}

.statusbar-setting-row input:checked + .slider::before {
  transform: translateX(21px);
}

.statusbar-fullwidth-preview {
  background-color: var(--vscode-editor-background, #1e1e1e);
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: 8px;
  padding: 14px;
  transition: border-color 0.2s ease;
}

.statusbar-fullwidth-preview:hover {
  border-color: var(--vscode-focusBorder, #007acc);
}

.empty-state,
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--vscode-descriptionForeground, #999);
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--vscode-panel-border, #333);
  border-top-color: var(--vscode-focusBorder, #007acc);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Scrollbar */
.content::-webkit-scrollbar {
  width: 8px;
}

.content::-webkit-scrollbar-track {
  background: transparent;
}

.content::-webkit-scrollbar-thumb {
  background-color: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, 0.4));
  border-radius: 4px;
}

@media (max-width: 768px) {
  .header {
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;
  }

  .header-right {
    width: 100%;
    justify-content: space-between;
  }

  .group-items {
    grid-template-columns: 1fr;
  }
}
</style>
