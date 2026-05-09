<template>
  <div
    class="setting-card"
    :class="{ 'has-preview': showPreview }"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <!-- Preview area -->
    <div v-if="showPreview" class="preview-area">
      <slot />
    </div>

    <!-- Controls area -->
    <div class="controls-area">
      <div class="card-header">
        <div class="card-title">
          <span class="card-name">{{ item.name }}</span>
          <span
            class="scope-badge"
            :class="`scope-${settingSource}`"
            :title="settingSourceTooltip"
          >
            {{ settingSourceLabel }}
          </span>
          <span
            v-if="isType('boolean')"
            class="boolean-state-badge"
            :class="isBooleanActive ? 'boolean-on' : 'boolean-off'"
            :title="booleanStatusTooltip"
          >
            {{ booleanStatusLabel }}
          </span>
        </div>
        <button
          v-if="isHovered && hasChanges"
          class="reset-btn"
          @click="$emit('reset')"
          title="重置为默认值"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <!-- Boolean toggle -->
      <div v-if="isType('boolean')" class="toggle-row">
        <MarkdownDescription class="toggle-label" :content="item.description" />
        <div class="toggle-control">
          <span
            class="explicit-state-badge"
            :class="`explicit-${settingSource}`"
            :title="settingSourceTooltip"
          >
            {{ explicitSettingLabel }}
          </span>
          <label
            class="toggle-switch"
            :class="[`toggle-${settingSource}`, { 'toggle-explicit': isExplicitlyConfigured }]"
            :title="booleanStatusTooltip"
          >
            <input
              type="checkbox"
              :checked="item.value"
              @change="$emit('update:value', ($event.target as HTMLInputElement).checked)"
            />
            <span class="slider"></span>
          </label>
        </div>
      </div>

      <!-- Enum select -->
      <div v-else-if="item.enum" class="select-row">
        <select
          class="config-select"
          :value="item.value"
          @change="$emit('update:value', ($event.target as HTMLSelectElement).value)"
        >
          <option
            v-for="(opt, index) in item.enum"
            :key="opt"
            :value="opt"
          >
            {{ item.enumDescriptions?.[index] || opt }}
          </option>
        </select>
        <MarkdownDescription :content="item.description" />
        <MarkdownDescription v-if="selectedEnumDescription" class="enum-value-description" :content="selectedEnumDescription" />
      </div>

      <!-- Number input -->
      <div v-else-if="isType('number') || isType('integer')" class="number-row">
        <input
          type="number"
          class="config-number"
          :value="item.value"
          :min="item.minimum"
          :max="item.maximum"
          :step="isType('integer') ? 1 : 1"
          @input="$emit('update:value', Number(($event.target as HTMLInputElement).value))"
        />
        <MarkdownDescription :content="item.description" />
      </div>

      <!-- Custom role group editor -->
      <div v-else-if="isCustomGroupsSetting" class="custom-groups-editor">
        <div
          v-for="(group, groupIndex) in customGroups"
          :key="groupIndex"
          class="custom-group-rule"
        >
          <div class="custom-group-rule__top">
            <input
              type="text"
              class="config-text group-name-input"
              :value="group.name"
              placeholder="分组名称"
              @input="updateCustomGroupName(groupIndex, ($event.target as HTMLInputElement).value)"
            />
            <select
              class="config-select match-type-select"
              :value="group.matchType"
              @change="updateCustomGroupMatchType(groupIndex, ($event.target as HTMLSelectElement).value)"
            >
              <option value="type">匹配角色类型</option>
              <option value="affiliation">匹配角色归属</option>
            </select>
            <button
              class="icon-btn danger"
              title="删除规则"
              @click="removeCustomGroup(groupIndex)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M8 6V4h8v2M9 10v8M15 10v8M5 6l1 15h12l1-15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>

          <div class="pattern-list">
            <span v-for="(pattern, patternIndex) in group.patterns" :key="patternIndex" class="pattern-chip">
              {{ pattern }}
              <button title="移除匹配词" @click="removeCustomGroupPattern(groupIndex, patternIndex)">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </button>
            </span>
            <input
              type="text"
              class="pattern-input"
              placeholder="输入匹配词后回车"
              @keydown.enter.prevent="addCustomGroupPattern(groupIndex, ($event.target as HTMLInputElement))"
              @blur="addCustomGroupPattern(groupIndex, ($event.target as HTMLInputElement))"
            />
          </div>
        </div>

        <button class="add-rule-btn" @click="addCustomGroup">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          添加分组规则
        </button>
        <MarkdownDescription :content="item.description" />
      </div>

      <!-- Auto pairs editor -->
      <GraphicalArrayEditor
        v-else-if="isAutoPairsSetting"
        kind="autoPairs"
        :model-value="item.value"
        :default-value="item.defaultValue"
        :description="item.description"
        @update:model-value="emit('update:value', $event)"
      />

      <!-- Milestone targets editor -->
      <GraphicalArrayEditor
        v-else-if="isMilestoneTargetsSetting"
        kind="numberList"
        :model-value="item.value"
        :default-value="item.defaultValue"
        :description="item.description"
        @update:model-value="emit('update:value', $event)"
      />

      <!-- LLM model selector -->
      <div v-else-if="isLlmModelSetting" class="text-row">
        <LlmModelSelector
          :model-value="String(item.value ?? '')"
          :api-base="llmModelApiBase"
          :api-key="llmModelApiKey"
          :models="llmModelState?.models ?? []"
          :loading="llmModelState?.loading ?? false"
          :error="llmModelState?.error ?? ''"
          @update:model-value="emit('update:value', $event)"
          @fetch-models="emit('fetch-llm-models', item.id)"
        />
        <MarkdownDescription :content="item.description" />
      </div>

      <!-- Array editor -->
      <div v-else-if="isType('array')" class="array-row">
        <textarea
          class="config-textarea"
          :value="arrayDraft"
          :placeholder="arrayPlaceholder"
          spellcheck="false"
          @input="handleArrayInput(($event.target as HTMLTextAreaElement).value)"
        />
        <span v-if="arrayError" class="config-error">{{ arrayError }}</span>
        <MarkdownDescription v-else :content="item.description" />
      </div>

      <!-- String input (fallback) -->
      <div v-else class="text-row">
        <input
          :type="isSecretSetting ? 'password' : 'text'"
          class="config-text"
          :value="item.value"
          @input="$emit('update:value', ($event.target as HTMLInputElement).value)"
        />
        <MarkdownDescription :content="item.description" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { ConfigItem } from 'src/types/config'
import GraphicalArrayEditor from './GraphicalArrayEditor.vue'
import LlmModelSelector from './LlmModelSelector.vue'
import MarkdownDescription from './MarkdownDescription.vue'

interface LlmModelOption {
  id: string
  label?: string
}

interface LlmModelState {
  models: LlmModelOption[]
  loading: boolean
  error: string
}

const props = defineProps<{
  item: ConfigItem
  showPreview?: boolean
  configValues?: Record<string, any>
  llmModelStates?: Record<string, LlmModelState>
}>()

const emit = defineEmits<{
  'update:value': [value: any]
  'reset': []
  'fetch-llm-models': [itemId: string]
}>()

const isHovered = ref(false)
const arrayDraft = ref('')
const arrayError = ref('')
const arrayDraftSource = ref('')

const hasChanges = computed(() => {
  return JSON.stringify(props.item.value) !== JSON.stringify(props.item.defaultValue)
})

const isCustomGroupsSetting = computed(() => props.item.id.endsWith('.customGroups'))
const isSecretSetting = computed(() => /apiKey|token|secret|password/i.test(props.item.id))
const isAutoPairsSetting = computed(() => props.item.id === 'andrea.typeset.pairs')
const isMilestoneTargetsSetting = computed(() => props.item.id === 'AndreaNovelHelper.timeStats.milestone.targets')
const isLlmModelSetting = computed(() => [
  'AndreaNovelHelper.typo.clientLLM.model',
  'AndreaNovelHelper.typo.llm.model',
].includes(props.item.id))
const llmModelPrefix = computed(() => props.item.id === 'AndreaNovelHelper.typo.clientLLM.model'
  ? 'AndreaNovelHelper.typo.clientLLM'
  : 'AndreaNovelHelper.typo.llm')
const llmModelApiBase = computed(() => String(props.configValues?.[`${llmModelPrefix.value}.apiBase`] ?? ''))
const llmModelApiKey = computed(() => String(props.configValues?.[`${llmModelPrefix.value}.apiKey`] ?? ''))
const llmModelState = computed(() => props.llmModelStates?.[props.item.id])
const selectedEnumDescription = computed(() => {
  if (!props.item.enum || !props.item.enumDescriptions) return ''
  const index = props.item.enum.indexOf(props.item.value)
  return index >= 0 ? props.item.enumDescriptions[index] ?? '' : ''
})
const settingSource = computed(() => props.item.valueSource ?? 'default')
const settingSourceLabel = computed(() => {
  if (settingSource.value === 'workspace') return '工作区'
  if (settingSource.value === 'global') return '全局'
  return '默认'
})
const isExplicitlyConfigured = computed(() => settingSource.value !== 'default')
const explicitSettingLabel = computed(() => isExplicitlyConfigured.value ? '已设置' : '未设置')
const isBooleanActive = computed(() => props.item.value === true)
const booleanStatusLabel = computed(() => isBooleanActive.value ? '已启用' : '已停用')
const settingSourceTooltip = computed(() => {
  const sourceText = (() => {
    if (settingSource.value === 'workspace') {
      return props.item.hasGlobalValue
        ? '当前生效值来自工作区设置。工作区设置只影响当前工作区，并会覆盖已有的全局设置。'
        : '当前生效值来自工作区设置。工作区设置只影响当前工作区。'
    }
    if (settingSource.value === 'global') {
      return '当前生效值来自全局设置。除非当前工作区单独覆盖，否则所有工作区都会使用这个值。'
    }
    return '当前生效值来自扩展或 VS Code 的默认值。当前工作区和全局设置都没有覆盖它。'
  })()
  return [
    sourceText,
    `当前实际值：${formatConfigValue(props.item.value)}`,
    `默认值：${formatConfigValue(props.item.defaultValue)}`,
    `显式设置状态：${explicitSettingLabel.value}`,
  ].join('\n')
})
const booleanStatusTooltip = computed(() => {
  return [
    `当前开关状态：${booleanStatusLabel.value}`,
    isExplicitlyConfigured.value
      ? '该值已经在 VS Code 设置中显式写入。'
      : '该值未在 VS Code 设置中显式写入，开关停在中间表示当前正在使用默认值；点击开关会写入当前选择的作用域。',
    `当前实际值：${formatConfigValue(props.item.value)}`,
    `默认值：${formatConfigValue(props.item.defaultValue)}`,
    `显式设置状态：${explicitSettingLabel.value}`,
    settingSourceTooltip.value,
  ].join('\n')
})

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

interface CustomGroupRule {
  name: string
  matchType: 'affiliation' | 'type'
  patterns: string[]
}

const customGroups = computed<CustomGroupRule[]>(() => {
  if (!Array.isArray(props.item.value)) return []
  return props.item.value.map(normalizeCustomGroup)
})

const arrayPlaceholder = computed(() => {
  const mode = getArrayEditMode()
  if (mode === 'string') return '每行一个值，也可以用逗号分隔'
  if (mode === 'number') return '每行一个数字，也可以用逗号分隔'
  return '请输入 JSON 数组'
})

watch(
  () => props.item.value,
  (value) => {
    const formatted = formatArrayValue(value)
    if (formatted !== arrayDraftSource.value) {
      arrayDraft.value = formatted
      arrayDraftSource.value = formatted
      arrayError.value = ''
    }
  },
  { immediate: true, deep: true }
)

function getArrayEditMode(): 'string' | 'number' | 'json' {
  if (props.item.id.endsWith('.customGroups')) return 'json'

  const value = props.item.value
  if (typeof value === 'string') return 'string'

  if (Array.isArray(value) && value.length > 0) {
    if (value.every(item => typeof item === 'string')) return 'string'
    if (value.every(item => typeof item === 'number')) return 'number'
    return 'json'
  }

  const defaultValue = props.item.defaultValue
  if (Array.isArray(defaultValue) && defaultValue.length > 0) {
    if (defaultValue.every(item => typeof item === 'string')) return 'string'
    if (defaultValue.every(item => typeof item === 'number')) return 'number'
    return 'json'
  }

  if ([
    'AndreaNovelHelper.completion.symbolPrefixes',
    'AndreaNovelHelper.defaultRoleLookupKeys',
    'AndreaNovelHelper.extendedLookupKeyPrefixes',
  ].includes(props.item.id)) {
    return 'string'
  }

  if (props.item.id === 'AndreaNovelHelper.timeStats.milestone.targets') {
    return 'number'
  }

  return 'json'
}

function formatArrayValue(value: any) {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''

  if (getArrayEditMode() !== 'json') {
    return value.join('\n')
  }

  return JSON.stringify(value, null, 2)
}

function handleArrayInput(rawValue: string) {
  arrayDraft.value = rawValue

  const mode = getArrayEditMode()
  if (mode === 'string') {
    const values = splitArrayLines(rawValue)
    arrayError.value = ''
    arrayDraftSource.value = formatArrayValue(values)
    emit('update:value', values)
    return
  }

  if (mode === 'number') {
    const rawNumbers = splitArrayLines(rawValue)
    const values = rawNumbers.map(value => Number(value))
    if (values.some(value => Number.isNaN(value))) {
      arrayError.value = '只能填写数字'
      return
    }
    arrayError.value = ''
    arrayDraftSource.value = formatArrayValue(values)
    emit('update:value', values)
    return
  }

  try {
    const parsed = rawValue.trim() ? JSON.parse(rawValue) : []
    if (!Array.isArray(parsed)) {
      arrayError.value = '必须是 JSON 数组'
      return
    }
    arrayError.value = ''
    arrayDraftSource.value = formatArrayValue(parsed)
    emit('update:value', parsed)
  } catch {
    arrayError.value = 'JSON 格式无效'
  }
}

function splitArrayLines(rawValue: string) {
  return rawValue
    .split(/\r?\n|,/)
    .map(value => value.trim())
    .filter(Boolean)
}

function normalizeCustomGroup(value: any): CustomGroupRule {
  const matchType = value?.matchType === 'affiliation' ? 'affiliation' : 'type'
  const patterns = Array.isArray(value?.patterns)
    ? value.patterns.map((pattern: any) => String(pattern ?? '').trim()).filter(Boolean)
    : []
  return {
    name: String(value?.name ?? ''),
    matchType,
    patterns,
  }
}

function emitCustomGroups(groups: CustomGroupRule[]) {
  emit('update:value', groups.map(group => ({
    name: group.name,
    matchType: group.matchType,
    patterns: group.patterns,
  })))
}

function updateCustomGroupName(index: number, name: string) {
  const groups = customGroups.value.map(group => ({ ...group, patterns: [...group.patterns] }))
  if (!groups[index]) return
  groups[index].name = name
  emitCustomGroups(groups)
}

function updateCustomGroupMatchType(index: number, matchType: string) {
  const groups = customGroups.value.map(group => ({ ...group, patterns: [...group.patterns] }))
  if (!groups[index]) return
  groups[index].matchType = matchType === 'affiliation' ? 'affiliation' : 'type'
  emitCustomGroups(groups)
}

function addCustomGroupPattern(index: number, input: HTMLInputElement) {
  const value = input.value.trim()
  if (!value) return
  const groups = customGroups.value.map(group => ({ ...group, patterns: [...group.patterns] }))
  const group = groups[index]
  if (!group) return
  if (!group.patterns.includes(value)) {
    group.patterns.push(value)
    emitCustomGroups(groups)
  }
  input.value = ''
}

function removeCustomGroupPattern(groupIndex: number, patternIndex: number) {
  const groups = customGroups.value.map(group => ({ ...group, patterns: [...group.patterns] }))
  const group = groups[groupIndex]
  if (!group) return
  group.patterns.splice(patternIndex, 1)
  emitCustomGroups(groups)
}

function addCustomGroup() {
  const groups = customGroups.value.map(group => ({ ...group, patterns: [...group.patterns] }))
  groups.push({
    name: `新分组 ${groups.length + 1}`,
    matchType: 'type',
    patterns: [],
  })
  emitCustomGroups(groups)
}

function removeCustomGroup(index: number) {
  const groups = customGroups.value.map(group => ({ ...group, patterns: [...group.patterns] }))
  groups.splice(index, 1)
  emitCustomGroups(groups)
}

function isType(type: string) {
  return Array.isArray(props.item.type)
    ? props.item.type.includes(type)
    : props.item.type === type
}
</script>

<style scoped>
.setting-card {
  background-color: var(--vscode-editor-background, #1e1e1e);
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.2s ease;
}

.setting-card:hover {
  border-color: var(--vscode-focusBorder, #007acc);
}

.preview-area {
  padding: 12px;
  border-bottom: 1px solid var(--vscode-panel-border, #333);
  background-color: rgba(0, 0, 0, 0.15);
  height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.controls-area {
  padding: 10px 14px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  gap: 8px;
}

.card-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.card-name {
  font-weight: 600;
  font-size: var(--vscode-font-size, 0.85rem);
  min-width: 0;
}

.scope-badge {
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

.scope-workspace {
  color: var(--vscode-textLink-foreground, #3794ff);
  border-color: color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 55%, transparent);
}

.scope-global {
  color: var(--vscode-charts-green, #89d185);
  border-color: color-mix(in srgb, var(--vscode-charts-green, #89d185) 55%, transparent);
}

.scope-default {
  color: var(--vscode-descriptionForeground, #999);
}

.boolean-state-badge,
.explicit-state-badge {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border: 1px solid var(--vscode-badge-background, #4d4d4d);
  border-radius: 999px;
  background-color: rgba(127, 127, 127, 0.08);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}

.boolean-on {
  color: var(--vscode-charts-green, #89d185);
  border-color: color-mix(in srgb, var(--vscode-charts-green, #89d185) 55%, transparent);
}

.boolean-off {
  color: var(--vscode-descriptionForeground, #999);
  border-color: var(--vscode-panel-border, #333);
}

.reset-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--vscode-descriptionForeground, #999);
  cursor: pointer;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.2s ease, background-color 0.2s ease;
}

.setting-card:hover .reset-btn {
  opacity: 1;
}

.reset-btn:hover {
  background-color: var(--vscode-toolbar-hoverBackground, #333);
  color: var(--vscode-foreground, #e0e0e0);
}

/* Toggle switch */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.toggle-label {
  font-size: var(--vscode-font-size, 0.8rem);
  color: var(--vscode-descriptionForeground, #999);
  flex: 1;
}

.toggle-control {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
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

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 43px;
  height: 22px;
  flex-shrink: 0;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
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

.slider::before {
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

input:checked + .slider {
  background-color: var(--vscode-button-background, #0e639c);
  border-color: var(--vscode-button-background, #0e639c);
}

input:checked + .slider::before {
  transform: translateX(21px);
}

.toggle-default .slider {
  border-style: dashed;
  background-color: var(--vscode-checkbox-background, #444);
  border-color: var(--vscode-descriptionForeground, #999);
}

.toggle-default .slider::before,
.toggle-default input:checked + .slider::before {
  transform: translateX(10.5px);
}

.toggle-workspace .slider {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 22%, transparent);
}

.toggle-global .slider {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-charts-green, #89d185) 20%, transparent);
}

/* Select */
.select-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.config-select {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--vscode-input-border, #444);
  border-radius: 6px;
  background-color: var(--vscode-input-background, #2a2a2a);
  color: var(--vscode-input-foreground, #e0e0e0);
  font-size: var(--vscode-font-size, 0.85rem);
  font-family: var(--vscode-font-family, inherit);
  outline: none;
  cursor: pointer;
  appearance: auto;
  -webkit-appearance: auto;
}

.config-select:focus {
  border-color: var(--vscode-focusBorder, #007acc);
}

.config-description {
  font-size: var(--vscode-font-size, 0.75rem);
  color: var(--vscode-descriptionForeground, #999);
}

.enum-value-description {
  color: var(--vscode-textLink-foreground, #3794ff);
}

/* Number */
.number-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.config-number {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--vscode-input-border, #444);
  border-radius: 6px;
  background-color: var(--vscode-input-background, #2a2a2a);
  color: var(--vscode-input-foreground, #e0e0e0);
  font-size: var(--vscode-font-size, 0.85rem);
  outline: none;
}

.config-number:focus {
  border-color: var(--vscode-focusBorder, #007acc);
}

/* Text */
.text-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.config-text {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--vscode-input-border, #444);
  border-radius: 6px;
  background-color: var(--vscode-input-background, #2a2a2a);
  color: var(--vscode-input-foreground, #e0e0e0);
  font-size: var(--vscode-font-size, 0.85rem);
  outline: none;
}

.config-text:focus {
  border-color: var(--vscode-focusBorder, #007acc);
}

/* Array */
.array-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.config-textarea {
  width: 100%;
  min-height: 96px;
  padding: 6px 10px;
  border: 1px solid var(--vscode-input-border, #444);
  border-radius: 6px;
  background-color: var(--vscode-input-background, #2a2a2a);
  color: var(--vscode-input-foreground, #e0e0e0);
  font-size: var(--vscode-font-size, 0.85rem);
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family, inherit));
  outline: none;
  resize: vertical;
  box-sizing: border-box;
}

.config-textarea:focus {
  border-color: var(--vscode-focusBorder, #007acc);
}

.config-error {
  font-size: var(--vscode-font-size, 0.75rem);
  color: var(--vscode-errorForeground, #f48771);
}

/* Custom group rules */
.custom-groups-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.custom-group-rule {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: 6px;
  background-color: var(--vscode-sideBar-background, rgba(127, 127, 127, 0.08));
}

.custom-group-rule__top {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) minmax(128px, 0.8fr) 28px;
  gap: 6px;
  align-items: center;
}

.group-name-input,
.match-type-select {
  min-width: 0;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--vscode-descriptionForeground, #999);
  cursor: pointer;
}

.icon-btn:hover {
  border-color: var(--vscode-panel-border, #333);
  background-color: var(--vscode-toolbar-hoverBackground, #333);
  color: var(--vscode-foreground, #e0e0e0);
}

.icon-btn.danger:hover {
  color: var(--vscode-errorForeground, #f48771);
}

.pattern-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 5px 6px;
  border: 1px solid var(--vscode-input-border, #444);
  border-radius: 6px;
  background-color: var(--vscode-input-background, #2a2a2a);
}

.pattern-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 2px 6px;
  border-radius: 4px;
  background-color: var(--vscode-badge-background, #4d4d4d);
  color: var(--vscode-badge-foreground, #fff);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.pattern-chip button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.pattern-input {
  flex: 1;
  min-width: 116px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--vscode-input-foreground, #e0e0e0);
  font-size: var(--vscode-font-size, 0.8rem);
}

.add-rule-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 100%;
  padding: 6px 10px;
  border: 1px dashed var(--vscode-input-border, #444);
  border-radius: 6px;
  background: transparent;
  color: var(--vscode-textLink-foreground, #3794ff);
  cursor: pointer;
}

.add-rule-btn:hover {
  background-color: var(--vscode-toolbar-hoverBackground, #333);
}

@media (max-width: 520px) {
  .custom-group-rule__top {
    grid-template-columns: 1fr 28px;
  }

  .match-type-select {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}
</style>
