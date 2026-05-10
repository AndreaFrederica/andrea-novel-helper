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
            <button class="btn btn-secondary" @click="isWizardOpen = true">
              设置向导
            </button>
            <button class="btn btn-secondary" @click="openFullSettings">
              完整设置
            </button>
            <button v-if="changedCount > 0" class="btn btn-reset" @click="resetConfig">
              放弃更改（{{ changedCount }}）
            </button>
            <button class="btn btn-save" :disabled="isSaving" @click="saveConfig">
              {{ isSaving ? '保存中...' : '保存' }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="statusMessage" class="status-message" :class="statusType">
        {{ statusMessage }}
      </div>

      <SettingWizardModal
        v-if="isWizardOpen"
        :config-items="quickSettingsItems"
        :current-scope="currentScope"
        @close="closeSettingsWizard"
        @apply="applyWizardSettings"
        @save="saveWizardSettings"
      />

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
                <div class="statusbar-setting-label">
                  <span class="setting-name">{{ getStatusBarDisplayName(item.id) }}</span>
                  <span
                    class="setting-source-badge"
                    :class="`source-${getSettingSource(item)}`"
                    :title="getSettingSourceTooltip(item)"
                  >
                    {{ getSettingSourceLabel(item) }}
                  </span>
                  <span
                    v-if="item.type === 'boolean'"
                    class="setting-boolean-badge"
                    :class="item.value === true ? 'boolean-on' : 'boolean-off'"
                    :title="getBooleanSettingTooltip(item)"
                  >
                    {{ getBooleanStateLabel(item) }}
                  </span>
                  <span
                    v-if="item.type === 'boolean'"
                    class="setting-explicit-badge"
                    :class="`explicit-${getSettingSource(item)}`"
                    :title="getSettingSourceTooltip(item)"
                  >
                    {{ getExplicitSettingLabel(item) }}
                  </span>
                </div>
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
                <label
                  v-else-if="item.type === 'boolean'"
                  class="toggle-switch"
                  :class="[`toggle-${getSettingSource(item)}`, { 'toggle-explicit': getSettingSource(item) !== 'default' }]"
                  :title="getBooleanSettingTooltip(item)"
                >
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

          <!-- Paragraph group: preview cards + compact vertical controls -->
          <div v-else-if="group.id === 'paragraph'" class="paragraph-group-layout">
            <div class="paragraph-preview-items">
              <SettingPreviewCard
                v-for="item in getPreviewItems(group.items)"
                :key="item.id"
                :item="item"
                :show-preview="true"
                :config-values="configValueMap"
                :llm-model-states="llmModelStates"
                @update:value="updateConfigValue(item.id, $event)"
                @reset="updateConfigValue(item.id, item.defaultValue)"
                @fetch-llm-models="fetchLlmModels"
              >
                <component
                  :is="getPreviewComponent(item.id)"
                  v-bind="getPreviewProps(item.id)"
                />
              </SettingPreviewCard>
            </div>

            <div v-if="getPlainItems(group.items).length" class="paragraph-plain-stack">
              <SettingPreviewCard
                v-for="item in getPlainItems(group.items)"
                :key="item.id"
                :item="item"
                :show-preview="false"
                :config-values="configValueMap"
                :llm-model-states="llmModelStates"
                @update:value="updateConfigValue(item.id, $event)"
                @reset="updateConfigValue(item.id, item.defaultValue)"
                @fetch-llm-models="fetchLlmModels"
              />
            </div>
          </div>

          <!-- Role list group: doc roles and all roles use separated settings -->
          <div v-else-if="group.id === 'roleLists'" class="role-list-group-layout">
            <div class="role-list-section">
              <div class="role-list-section__header">
                <span>当前文章角色</span>
                <span>{{ getRoleListItems(group.items, 'docRoles').length }}</span>
              </div>
              <RoleListPreview
                scope="docRoles"
                title="当前文章角色预览"
                :settings="getRoleListPreviewSettings('docRoles')"
              />
              <div class="role-list-controls">
                <SettingPreviewCard
                  v-for="item in getRoleListItems(group.items, 'docRoles')"
                  :key="item.id"
                  :item="item"
                  :show-preview="false"
                  :config-values="configValueMap"
                  :llm-model-states="llmModelStates"
                  @update:value="updateConfigValue(item.id, $event)"
                  @reset="updateConfigValue(item.id, item.defaultValue)"
                  @fetch-llm-models="fetchLlmModels"
                />
              </div>
            </div>

            <div class="role-list-section">
              <div class="role-list-section__header">
                <span>全部角色</span>
                <span>{{ getRoleListItems(group.items, 'allRoles').length }}</span>
              </div>
              <RoleListPreview
                scope="allRoles"
                title="全部角色预览"
                :settings="getRoleListPreviewSettings('allRoles')"
                :doc-settings="getRoleListPreviewSettings('docRoles')"
              />
              <div class="role-list-controls">
                <SettingPreviewCard
                  v-for="item in getRoleListItems(group.items, 'allRoles')"
                  :key="item.id"
                  :item="item"
                  :show-preview="false"
                  :config-values="configValueMap"
                  :llm-model-states="llmModelStates"
                  @update:value="updateConfigValue(item.id, $event)"
                  @reset="updateConfigValue(item.id, item.defaultValue)"
                  @fetch-llm-models="fetchLlmModels"
                />
              </div>
            </div>
          </div>

          <!-- Normal grid for other groups -->
          <div v-else class="group-items">
            <template v-for="item in group.items" :key="item.id">
              <SettingPreviewCard
                v-if="getPreviewComponent(item.id)"
                :item="item"
                :show-preview="true"
                :config-values="configValueMap"
                :llm-model-states="llmModelStates"
                @update:value="updateConfigValue(item.id, $event)"
                @reset="updateConfigValue(item.id, item.defaultValue)"
                @fetch-llm-models="fetchLlmModels"
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
                :config-values="configValueMap"
                :llm-model-states="llmModelStates"
                @update:value="updateConfigValue(item.id, $event)"
                @reset="updateConfigValue(item.id, item.defaultValue)"
                @fetch-llm-models="fetchLlmModels"
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
import SettingWizardModal from './components/SettingWizardModal.vue'
import StatusBarPreview from './components/previews/StatusBarPreview.vue'
import RoleListPreview from './components/previews/RoleListPreview.vue'
import { useVsCodeApiStore } from '../../stores/vscode'
import type { ConfigItem } from 'src/types/config'

interface LlmModelOption {
  id: string
  label?: string
}

interface LlmModelState {
  models: LlmModelOption[]
  loading: boolean
  error: string
  requestId?: string
}

const vsCodeApiStore = useVsCodeApiStore()

const loading = ref(true)
const currentScope = ref<'global' | 'workspace'>('workspace')
const configItems = ref<ConfigItem[]>([])
const originalSettings = ref<Record<string, any>>({})
const isSaving = ref(false)
const statusMessage = ref('')
const statusType = ref<'info' | 'success' | 'error'>('info')
const pendingSavedSettings = ref<Record<string, any>>({})
const llmModelStates = ref<Record<string, LlmModelState>>({})
const isWizardOpen = ref(false)
const pendingWizardOpenScope = ref<'global' | 'workspace' | null>(null)

const configValueMap = computed(() => {
  const values: Record<string, any> = {}
  for (const item of configItems.value) {
    values[item.id] = item.value
  }
  return values
})

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
    if (!areValuesEqual(originalSettings.value[item.id], item.value)) {
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
      ids: ['andrea.typeset.indentFirstTwoSpaces', 'andrea.typeset.blankLinesBetweenParas', 'editor.insertSpaces', 'editor.tabSize', 'editor.detectIndentation']
    },
    {
      id: 'smartEdit',
      name: '智能编辑',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      ids: ['andrea.typeset.enableAutoPairs', 'andrea.typeset.pairs', 'andrea.typeset.enableSmartExit', 'andrea.typeset.enableSmartEnter', 'andrea.typeset.trimTrailingSpaces']
    },
    {
      id: 'wordCount',
      name: '字数统计',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
      ids: ['AndreaNovelHelper.timeStats.includePaste', 'AndreaNovelHelper.timeStats.milestone.enabled', 'AndreaNovelHelper.timeStats.milestone.targets', 'AndreaNovelHelper.timeStats.milestone.notificationType']
    },
    {
      id: 'completion',
      name: '补全与查询键',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 6h10M4 12h16M4 18h7M17 4l3 3-3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      ids: ['AndreaNovelHelper.completion.triggerMode', 'AndreaNovelHelper.completion.symbolPrefixes', 'AndreaNovelHelper.completion.segmenterType', 'AndreaNovelHelper.lookupKeys.treatPinyinAsAlias', 'AndreaNovelHelper.lookupKeys.autoGeneratePinyin', 'AndreaNovelHelper.lookupKeys.treatRomanizedAsAlias', 'AndreaNovelHelper.lookupKeys.autoGenerateRomanized', 'AndreaNovelHelper.lookupKeys.useLlmRomanization', 'AndreaNovelHelper.defaultRoleLookupKeys', 'AndreaNovelHelper.extendedLookupKeyPrefixes', 'AndreaNovelHelper.debug.completionLog']
    },
    {
      id: 'roleLists',
      name: '角色列表显示',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M8 7a4 4 0 118 0 4 4 0 01-8 0zM4 21a8 8 0 0116 0M3 4h3M3 9h3M18 4h3M18 9h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
      ids: ['AndreaNovelHelper.docRoles.groupBy', 'AndreaNovelHelper.docRoles.respectAffiliation', 'AndreaNovelHelper.docRoles.respectType', 'AndreaNovelHelper.docRoles.primaryGroup', 'AndreaNovelHelper.docRoles.typeOrder', 'AndreaNovelHelper.docRoles.useCustomGroups', 'AndreaNovelHelper.docRoles.display.useRoleSvgIfPresent', 'AndreaNovelHelper.docRoles.display.colorizeRoleName', 'AndreaNovelHelper.docRoles.customGroups', 'AndreaNovelHelper.allRoles.syncWithDocRoles', 'AndreaNovelHelper.allRoles.groupBy', 'AndreaNovelHelper.allRoles.respectAffiliation', 'AndreaNovelHelper.allRoles.respectType', 'AndreaNovelHelper.allRoles.primaryGroup', 'AndreaNovelHelper.allRoles.typeOrder', 'AndreaNovelHelper.allRoles.useCustomGroups', 'AndreaNovelHelper.allRoles.display.colorizeRoleName', 'AndreaNovelHelper.allRoles.customGroups']
    },
    {
      id: 'roleDetails',
      name: '角色详情',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M8 7h8M8 12h8M8 17h5M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
      ids: ['AndreaNovelHelper.roles.details.enableRoleExpansion', 'AndreaNovelHelper.roles.details.alwaysExpandable', 'AndreaNovelHelper.roles.details.enableWrapping', 'AndreaNovelHelper.roles.details.wrapColumn']
    },
    {
      id: 'packageManager',
      name: '包管理器',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      ids: ['AndreaNovelHelper.package.dragDefaultAction', 'AndreaNovelHelper.package.iconStyle', 'AndreaNovelHelper.package.roleNodes.display.useRoleSvgIfPresent', 'AndreaNovelHelper.package.roleNodes.display.colorizeRoleName', 'AndreaNovelHelper.package.roleNodes.details.showColorOnValue', 'AndreaNovelHelper.package.roleNodes.details.alwaysExpandable', 'AndreaNovelHelper.package.roleNodes.details.enableRoleExpansion', 'AndreaNovelHelper.package.roleNodes.details.enableWrapping', 'AndreaNovelHelper.package.roleNodes.details.wrapColumn']
    },
    {
      id: 'typoSystem',
      name: '错别字检查',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 5h16M4 12h10M4 19h8M17 14l2 2 4-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      ids: ['AndreaNovelHelper.typo.enabled', 'AndreaNovelHelper.typo.mode', 'AndreaNovelHelper.typo.service.baseUrl', 'AndreaNovelHelper.typo.autoIdentifyOnOpen', 'AndreaNovelHelper.typo.autoScanOnChange', 'AndreaNovelHelper.typo.suppressRolesMode', 'AndreaNovelHelper.typo.batchSize', 'AndreaNovelHelper.typo.docConcurrency', 'AndreaNovelHelper.typo.docGroupSize', 'AndreaNovelHelper.typo.timeoutMs', 'AndreaNovelHelper.typo.enableHighlight', 'AndreaNovelHelper.typo.highlightColor', 'AndreaNovelHelper.typo.warningLevel', 'AndreaNovelHelper.typo.applyPartialDecorationsImmediately', 'AndreaNovelHelper.typo.persistence.enabled', 'AndreaNovelHelper.typo.persistence.autoCleanup', 'AndreaNovelHelper.typo.persistence.maxAgeDays', 'AndreaNovelHelper.typo.keepCacheOnClose', 'AndreaNovelHelper.typo.maxDocs', 'AndreaNovelHelper.timeStats.typoDelay.enabled', 'AndreaNovelHelper.timeStats.typoDelay.windowMs']
    },
    {
      id: 'typoAI',
      name: 'AI 与 LLM',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3l2.2 4.8L19 10l-4.8 2.2L12 17l-2.2-4.8L5 10l4.8-2.2L12 3zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15zM5 15l.9 2.1L8 18l-2.1.9L5 21l-.9-2.1L2 18l2.1-.9L5 15z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
      ids: ['AndreaNovelHelper.typo.clientLLM.enabled', 'AndreaNovelHelper.typo.clientLLM.apiBase', 'AndreaNovelHelper.typo.clientLLM.apiKey', 'AndreaNovelHelper.typo.clientLLM.model', 'AndreaNovelHelper.typo.clientLLM.temperature', 'AndreaNovelHelper.typo.clientLLM.enableThinking', 'AndreaNovelHelper.typo.clientLLM.thinkingProvider', 'AndreaNovelHelper.typo.clientLLM.customThinkingEnabled', 'AndreaNovelHelper.typo.clientLLM.customThinkingEnabledValue', 'AndreaNovelHelper.typo.clientLLM.customThinkingDisabledValue', 'AndreaNovelHelper.typo.clientLLM.qwenThinkingMethod', 'AndreaNovelHelper.typo.clientLLM.geminiThinkingBudget', 'AndreaNovelHelper.typo.clientLLM.geminiApiFormat', 'AndreaNovelHelper.typo.llm.model', 'AndreaNovelHelper.typo.llm.apiBase', 'AndreaNovelHelper.typo.llm.apiKey', 'AndreaNovelHelper.typo.debug.llmTrace', 'AndreaNovelHelper.typo.debug.serverTrace', 'AndreaNovelHelper.typo.debug.compactTrace', 'AndreaNovelHelper.typo.debug.traceMaxLen']
    },
    {
      id: 'translation',
      name: 'AI 翻译',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 5h9M9 3v2m0 0c-.8 3-2.2 5.2-5 7m5-7c.8 2.3 2 4.1 4 5.5M13 21l5-11 5 11M15 17h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      ids: ['AndreaNovelHelper.translate.targets', 'AndreaNovelHelper.translate.defaultTarget', 'AndreaNovelHelper.translate.alwaysUseDefaultTarget', 'AndreaNovelHelper.translate.defaultAction', 'AndreaNovelHelper.translate.alwaysUseDefaultAction']
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
      ids: ['AndreaNovelHelper.useVsCodeManagedDisabling', 'editor.mouseWheelZoom', 'AndreaNovelHelper.smartTabGroupLock.enabled', 'markdown.extension.onEnterKey', 'andrea.smartEnter']
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

function getPreviewItems(items: ConfigItem[]) {
  return items.filter(item => Boolean(getPreviewComponent(item.id)))
}

function getPlainItems(items: ConfigItem[]) {
  return items.filter(item => !getPreviewComponent(item.id))
}

function getRoleListItems(items: ConfigItem[], scope: 'docRoles' | 'allRoles') {
  const prefix = `AndreaNovelHelper.${scope}.`
  return items.filter(item => item.id.startsWith(prefix))
}

function getConfigValue<T>(id: string, fallback: T): T {
  const item = configItems.value.find(i => i.id === id)
  return (item?.value ?? fallback) as T
}

function getRoleListPreviewSettings(scope: 'docRoles' | 'allRoles') {
  const base = `AndreaNovelHelper.${scope}`
  return {
    groupBy: getConfigValue(`${base}.groupBy`, 'affiliation'),
    respectAffiliation: getConfigValue(`${base}.respectAffiliation`, true),
    respectType: getConfigValue(`${base}.respectType`, true),
    primaryGroup: getConfigValue(`${base}.primaryGroup`, 'affiliation'),
    typeOrder: getConfigValue(`${base}.typeOrder`, []),
    useCustomGroups: getConfigValue(`${base}.useCustomGroups`, false),
    customGroups: getConfigValue(`${base}.customGroups`, []),
    syncWithDocRoles: scope === 'allRoles'
      ? getConfigValue('AndreaNovelHelper.allRoles.syncWithDocRoles', true)
      : false,
  }
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

function getSettingSource(item: ConfigItem) {
  return item.valueSource ?? 'default'
}

function getSettingSourceLabel(item: ConfigItem): string {
  const source = getSettingSource(item)
  if (source === 'workspace') return '工作区'
  if (source === 'global') return '全局'
  return '默认'
}

function getSettingSourceTooltip(item: ConfigItem): string {
  const source = getSettingSource(item)
  const sourceText = (() => {
    if (source === 'workspace') {
      return item.hasGlobalValue
        ? '当前生效值来自工作区设置。工作区设置只影响当前工作区，并会覆盖已有的全局设置。'
        : '当前生效值来自工作区设置。工作区设置只影响当前工作区。'
    }
    if (source === 'global') {
      return '当前生效值来自全局设置。除非当前工作区单独覆盖，否则所有工作区都会使用这个值。'
    }
    return '当前生效值来自扩展或 VS Code 的默认值。当前工作区和全局设置都没有覆盖它。'
  })()
  return [
    sourceText,
    `当前实际值：${formatConfigValue(item.value)}`,
    `默认值：${formatConfigValue(item.defaultValue)}`,
    `显式设置状态：${getExplicitSettingLabel(item)}`,
  ].join('\n')
}

function getExplicitSettingLabel(item: ConfigItem): string {
  return getSettingSource(item) === 'default' ? '未设置' : '已设置'
}

function getBooleanStateLabel(item: ConfigItem): string {
  return item.value === true ? '已启用' : '已停用'
}

function getBooleanSettingTooltip(item: ConfigItem): string {
  return [
    `当前开关状态：${getBooleanStateLabel(item)}`,
    getSettingSource(item) === 'default'
      ? '该值未在 VS Code 设置中显式写入，开关停在中间表示当前正在使用默认值；点击开关会写入当前选择的作用域。'
      : '该值已经在 VS Code 设置中显式写入。',
    getSettingSourceTooltip(item),
  ].join('\n')
}

function formatConfigValue(value: any): string {
  if (typeof value === 'boolean') return value ? '启用 / true' : '停用 / false'
  if (value === undefined) return '未定义'
  if (value === null) return 'null'
  if (typeof value === 'string') return value.trim() ? value : '空字符串'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.length ? `${value.length} 项：${JSON.stringify(value)}` : '空数组'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function updateConfigValue(itemId: string, newValue: any) {
  setLocalConfigValue(itemId, newValue)
  if (vsCodeApiStore.vscode) {
    vsCodeApiStore.vscode.postMessage({
      command: 'updateSetting',
      key: itemId,
      value: newValue
    })
  }
}

function setLocalConfigValue(itemId: string, newValue: any) {
  const item = configItems.value.find(i => i.id === itemId)
  if (item) {
    item.value = newValue
    item.valueSource = currentScope.value
    if (currentScope.value === 'workspace') {
      item.hasWorkspaceValue = true
    } else {
      item.hasGlobalValue = true
    }
  }
}

function areValuesEqual(a: any, b: any) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function resetConfig() {
  configItems.value.forEach(item => {
    if (!areValuesEqual(originalSettings.value[item.id], item.value)) {
      updateConfigValue(item.id, originalSettings.value[item.id])
    }
  })
  showStatus('已恢复到进入页面时的值', 'info')
}

function saveConfig() {
  const changedSettings: Record<string, any> = {}
  let hasChanges = false

  configItems.value.forEach(item => {
    if (!areValuesEqual(originalSettings.value[item.id], item.value)) {
      changedSettings[item.id] = item.value
      hasChanges = true
    }
  })

  if (!hasChanges) {
    showStatus('没有待保存的更改', 'info')
    return
  }

  if (vsCodeApiStore.vscode) {
    isSaving.value = true
    pendingSavedSettings.value = changedSettings
    showStatus(`正在保存 ${Object.keys(changedSettings).length} 项设置...`, 'info')
    vsCodeApiStore.vscode.postMessage({
      command: 'saveSettings',
      settings: changedSettings
    })
  }
}

function notifySettingsWizardHandled(reason: 'close' | 'apply' | 'save') {
  vsCodeApiStore.vscode?.postMessage({
    command: 'settingsWizardHandled',
    reason,
  })
}

function closeSettingsWizard() {
  isWizardOpen.value = false
  notifySettingsWizardHandled('close')
}

function applyWizardSettings(settings: Record<string, any>) {
  const entries = Object.entries(settings)
  if (!entries.length) {
    showStatus('向导没有需要应用的变更', 'info')
    isWizardOpen.value = false
    notifySettingsWizardHandled('apply')
    return
  }

  for (const [key, value] of entries) {
    setLocalConfigValue(key, value)
  }
  isWizardOpen.value = false
  notifySettingsWizardHandled('apply')
  showStatus(`设置向导已暂存 ${entries.length} 项变更，当前还没有写入 VS Code 设置；确认后请点击保存。`, 'info')
}

function saveWizardSettings(settings: Record<string, any>) {
  const entries = Object.entries(settings)
  if (!entries.length) {
    showStatus('向导没有需要保存的变更', 'info')
    isWizardOpen.value = false
    notifySettingsWizardHandled('save')
    return
  }

  for (const [key, value] of entries) {
    setLocalConfigValue(key, value)
  }

  if (vsCodeApiStore.vscode) {
    isSaving.value = true
    pendingSavedSettings.value = settings
    showStatus(`正在保存向导设置 ${entries.length} 项...`, 'info')
    vsCodeApiStore.vscode.postMessage({
      command: 'saveSettings',
      settings
    })
  }
  isWizardOpen.value = false
  notifySettingsWizardHandled('save')
}

function fetchLlmModels(itemId: string) {
  const item = configItems.value.find(i => i.id === itemId)
  if (!item) return

  const prefix = itemId === 'AndreaNovelHelper.typo.clientLLM.model'
    ? 'AndreaNovelHelper.typo.clientLLM'
    : 'AndreaNovelHelper.typo.llm'
  const apiBase = String(getConfigValue(`${prefix}.apiBase`, '') ?? '').trim()
  const apiKey = String(getConfigValue(`${prefix}.apiKey`, '') ?? '').trim()

  if (!apiBase) {
    llmModelStates.value[itemId] = {
      models: llmModelStates.value[itemId]?.models ?? [],
      loading: false,
      error: '请先填写 API Base',
    }
    return
  }

  const requestId = `${itemId}:${Date.now()}:${Math.random().toString(36).slice(2)}`
  llmModelStates.value[itemId] = {
    models: llmModelStates.value[itemId]?.models ?? [],
    loading: true,
    error: '',
    requestId,
  }

  vsCodeApiStore.vscode?.postMessage({
    command: 'fetchLlmModels',
    requestId,
    itemId,
    apiBase,
    apiKey,
  })
}

function showStatus(message: string, type: 'info' | 'success' | 'error') {
  statusMessage.value = message
  statusType.value = type
  if (type !== 'error') {
    window.setTimeout(() => {
      if (statusMessage.value === message) {
        statusMessage.value = ''
      }
    }, 3000)
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

function openFullSettings() {
  if (vsCodeApiStore.vscode) {
    vsCodeApiStore.vscode.postMessage({
      command: 'openFullSettings'
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

          if (pendingWizardOpenScope.value && pendingWizardOpenScope.value === currentScope.value) {
            pendingWizardOpenScope.value = null
            isWizardOpen.value = true
          }
        }
        break

      case 'settingUpdated':
        break

      case 'settingsSaved':
        Object.keys(pendingSavedSettings.value).forEach(key => {
          originalSettings.value[key] = pendingSavedSettings.value[key]
        })
        pendingSavedSettings.value = {}
        isSaving.value = false
        showStatus(message.message || '设置已保存', 'success')
        break

      case 'llmModelsFetched': {
        const state = llmModelStates.value[message.itemId]
        if (!state || state.requestId !== message.requestId) break
        llmModelStates.value[message.itemId] = {
          models: Array.isArray(message.models) ? message.models : [],
          loading: false,
          error: '',
          requestId: message.requestId,
        }
        break
      }

      case 'llmModelsFetchFailed': {
        const state = llmModelStates.value[message.itemId]
        if (!state || state.requestId !== message.requestId) break
        llmModelStates.value[message.itemId] = {
          models: state.models,
          loading: false,
          error: message.message || '模型列表获取失败',
          requestId: message.requestId,
        }
        break
      }

      case 'openSettingsWizard': {
        const targetScope = message.scope === 'global' ? 'global' : 'workspace'
        pendingWizardOpenScope.value = targetScope
        if (currentScope.value !== targetScope) {
          setScope(targetScope)
        } else {
          pendingWizardOpenScope.value = null
          isWizardOpen.value = true
        }
        break
      }

      case 'error':
        isSaving.value = false
        showStatus(message.message || '设置操作失败', 'error')
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

.btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.btn-reset:hover {
  background-color: var(--vscode-button-secondaryHoverBackground, #45494e);
}

.btn-secondary {
  background-color: var(--vscode-button-secondaryBackground, #3a3d41);
  color: var(--vscode-button-secondaryForeground, #e0e0e0);
}

.btn-secondary:hover {
  background-color: var(--vscode-button-secondaryHoverBackground, #45494e);
}

.status-message {
  flex-shrink: 0;
  padding: 6px 16px;
  border-bottom: 1px solid var(--vscode-panel-border, #333);
  font-size: 12px;
  color: var(--vscode-foreground, #e0e0e0);
  background-color: var(--vscode-inputValidation-infoBackground, rgba(55, 148, 255, 0.16));
}

.status-message.success {
  background-color: rgba(46, 160, 67, 0.18);
}

.status-message.error {
  background-color: var(--vscode-inputValidation-errorBackground, rgba(244, 135, 113, 0.18));
  color: var(--vscode-errorForeground, #f48771);
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

.paragraph-group-layout {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(280px, 0.75fr);
  gap: 12px;
  align-items: start;
}

.paragraph-preview-items {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 12px;
}

.paragraph-plain-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.role-list-group-layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.role-list-section {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: 8px;
  background-color: var(--vscode-editor-background, #1e1e1e);
}

.role-list-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: var(--vscode-font-size, 0.9rem);
  font-weight: 600;
}

.role-list-section__header span:last-child {
  font-size: 11px;
  font-weight: 500;
  color: var(--vscode-descriptionForeground, #999);
}

.role-list-controls {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 8px;
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

.statusbar-setting-label {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  flex: 1;
}

.setting-name {
  font-size: var(--vscode-font-size, 0.85rem);
  font-weight: 500;
  white-space: nowrap;
}

.setting-source-badge,
.setting-boolean-badge,
.setting-explicit-badge {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border: 1px solid var(--vscode-badge-background, #4d4d4d);
  border-radius: 999px;
  color: var(--vscode-descriptionForeground, #999);
  background-color: rgba(127, 127, 127, 0.08);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}

.source-workspace {
  color: var(--vscode-textLink-foreground, #3794ff);
  border-color: color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 55%, transparent);
}

.source-global {
  color: var(--vscode-charts-green, #89d185);
  border-color: color-mix(in srgb, var(--vscode-charts-green, #89d185) 55%, transparent);
}

.source-default {
  color: var(--vscode-descriptionForeground, #999);
}

.boolean-on {
  color: var(--vscode-charts-green, #89d185);
  border-color: color-mix(in srgb, var(--vscode-charts-green, #89d185) 55%, transparent);
}

.boolean-off {
  color: var(--vscode-descriptionForeground, #999);
  border-color: var(--vscode-panel-border, #333);
}

.explicit-workspace {
  color: var(--vscode-textLink-foreground, #3794ff);
  border-color: color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 55%, transparent);
}

.explicit-global {
  color: var(--vscode-charts-green, #89d185);
  border-color: color-mix(in srgb, var(--vscode-charts-green, #89d185) 55%, transparent);
}

.explicit-default {
  color: var(--vscode-descriptionForeground, #999);
  border-style: dashed;
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

.statusbar-setting-row .toggle-default .slider {
  border-style: dashed;
  background-color: var(--vscode-checkbox-background, #444);
  border-color: var(--vscode-descriptionForeground, #999);
}

.statusbar-setting-row .toggle-default .slider::before,
.statusbar-setting-row .toggle-default input:checked + .slider::before {
  transform: translateX(10.5px);
}

.statusbar-setting-row .toggle-workspace .slider {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 22%, transparent);
}

.statusbar-setting-row .toggle-global .slider {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-charts-green, #89d185) 20%, transparent);
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

  .paragraph-group-layout {
    grid-template-columns: 1fr;
  }

  .role-list-group-layout {
    grid-template-columns: 1fr;
  }
}
</style>
