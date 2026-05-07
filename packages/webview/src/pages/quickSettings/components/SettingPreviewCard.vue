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
        <span class="card-name">{{ item.name }}</span>
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
        <label class="toggle-label">{{ item.description }}</label>
        <label class="toggle-switch">
          <input
            type="checkbox"
            :checked="item.value"
            @change="$emit('update:value', ($event.target as HTMLInputElement).checked)"
          />
          <span class="slider"></span>
        </label>
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
        <span v-if="item.description" class="config-description">{{ item.description }}</span>
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
        <span v-if="item.description" class="config-description">{{ item.description }}</span>
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
        <span v-else-if="item.description" class="config-description">{{ item.description }}</span>
      </div>

      <!-- String input (fallback) -->
      <div v-else class="text-row">
        <input
          type="text"
          class="config-text"
          :value="item.value"
          @input="$emit('update:value', ($event.target as HTMLInputElement).value)"
        />
        <span v-if="item.description" class="config-description">{{ item.description }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { ConfigItem } from 'src/types/config'

const props = defineProps<{
  item: ConfigItem
  showPreview?: boolean
}>()

const emit = defineEmits<{
  'update:value': [value: any]
  'reset': []
}>()

const isHovered = ref(false)
const arrayDraft = ref('')
const arrayError = ref('')
const arrayDraftSource = ref('')

const hasChanges = computed(() => {
  return JSON.stringify(props.item.value) !== JSON.stringify(props.item.defaultValue)
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
  if (props.item.id === 'andrea.typeset.pairs') return 'string'

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
    'andrea.typeset.pairs',
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
}

.card-name {
  font-weight: 600;
  font-size: var(--vscode-font-size, 0.85rem);
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
}

.toggle-label {
  font-size: var(--vscode-font-size, 0.8rem);
  color: var(--vscode-descriptionForeground, #999);
  flex: 1;
  margin-right: 12px;
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
</style>
