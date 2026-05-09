<template>
  <div class="graphical-array-editor">
    <template v-if="kind === 'autoPairs'">
      <div class="preset-list">
        <button
          v-for="preset in autoPairPresets"
          :key="preset.value"
          class="preset-btn pair-preset"
          :class="{ active: hasAutoPair(preset.value) }"
          :title="preset.label"
          @click="toggleAutoPairPreset(preset.value)"
        >
          {{ preset.value }}
        </button>
      </div>

      <div class="editor-table">
        <div class="editor-table__head pair-grid">
          <span>左符号</span>
          <span>右符号</span>
          <span></span>
        </div>
        <div v-for="(pair, index) in autoPairs" :key="index" class="editor-row pair-grid">
          <input
            type="text"
            class="symbol-input"
            :value="pair.open"
            maxlength="2"
            @input="updateAutoPair(index, 'open', ($event.target as HTMLInputElement).value)"
          />
          <input
            type="text"
            class="symbol-input"
            :value="pair.close"
            maxlength="2"
            @input="updateAutoPair(index, 'close', ($event.target as HTMLInputElement).value)"
          />
          <button class="icon-btn danger" title="删除括号对" @click="removeAutoPair(index)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M3 6h18M8 6V4h8v2M9 10v8M15 10v8M5 6l1 15h12l1-15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="editor-actions">
        <button class="add-rule-btn" @click="addAutoPair">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          添加括号对
        </button>
        <button class="secondary-action-btn" @click="emitValue(defaultAutoPairs)">恢复常用默认</button>
      </div>

      <span v-if="autoPairError" class="config-error">{{ autoPairError }}</span>
      <MarkdownDescription v-else :content="description" />
    </template>

    <template v-else-if="kind === 'numberList'">
      <div class="preset-list">
        <button
          v-for="preset in milestonePresets"
          :key="preset"
          class="preset-btn"
          :class="{ active: hasNumber(preset) }"
          @click="toggleNumberPreset(preset)"
        >
          {{ formatNumber(preset) }}
        </button>
      </div>

      <div class="editor-table">
        <div class="editor-table__head number-grid">
          <span>目标字数</span>
          <span></span>
        </div>
        <div v-for="(target, index) in numberItems" :key="`${target}-${index}`" class="editor-row number-grid">
          <input
            type="number"
            class="number-input"
            min="1"
            step="100"
            :value="target"
            @input="updateNumber(index, ($event.target as HTMLInputElement).value)"
          />
          <button class="icon-btn danger" title="删除目标" @click="removeNumber(index)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M3 6h18M8 6V4h8v2M9 10v8M15 10v8M5 6l1 15h12l1-15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="editor-actions">
        <button class="add-rule-btn" @click="addNumber">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          添加目标
        </button>
        <button class="secondary-action-btn" @click="emitNumbers(defaultNumberItems)">恢复默认</button>
      </div>

      <MarkdownDescription :content="description" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import MarkdownDescription from './MarkdownDescription.vue'

type EditorKind = 'autoPairs' | 'numberList'

interface AutoPairRule {
  open: string
  close: string
}

const props = defineProps<{
  kind: EditorKind
  modelValue: any
  defaultValue?: any
  description?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: any]
}>()

const defaultAutoPairs = ['()', '[]', '{}', '“”', '‘’', '「」', '『』', '《》']
const autoPairPresets = [
  { label: '圆括号', value: '()' },
  { label: '方括号', value: '[]' },
  { label: '花括号', value: '{}' },
  { label: '英文双引号', value: '""' },
  { label: '英文单引号', value: "''" },
  { label: '中文双引号', value: '“”' },
  { label: '中文单引号', value: '‘’' },
  { label: '日文引号', value: '「」' },
  { label: '日文双引号', value: '『』' },
  { label: '书名号', value: '《》' },
]

const milestonePresets = [1000, 2000, 5000, 10000, 20000, 50000, 100000]

const autoPairs = computed<AutoPairRule[]>(() => parseAutoPairValue(props.modelValue))
const autoPairError = computed(() => {
  const invalid = autoPairs.value.find(pair => countChars(pair.open) !== 1 || countChars(pair.close) !== 1)
  return invalid ? '每个括号对都需要 1 个左符号和 1 个右符号' : ''
})

const numberItems = computed(() => parseNumberList(props.modelValue))
const defaultNumberItems = computed(() => {
  const parsed = parseNumberList(props.defaultValue)
  return parsed.length ? parsed : milestonePresets
})

function emitValue(value: any) {
  emit('update:modelValue', value)
}

function parseAutoPairValue(value: any): AutoPairRule[] {
  const rawPairs: string[] = []
  if (Array.isArray(value)) {
    rawPairs.push(...value.map(pair => String(pair ?? '')))
  } else if (typeof value === 'string') {
    const chars = Array.from(value)
    for (let i = 0; i + 1 < chars.length; i += 2) {
      rawPairs.push(`${chars[i]}${chars[i + 1]}`)
    }
  }

  return rawPairs
    .map(pair => {
      const chars = Array.from(pair)
      return {
        open: chars[0] ?? '',
        close: chars[1] ?? '',
      }
    })
    .filter(pair => pair.open || pair.close)
}

function emitAutoPairs(pairs: AutoPairRule[]) {
  const seen = new Set<string>()
  const next: string[] = []
  for (const pair of pairs) {
    const open = firstChar(pair.open)
    const close = firstChar(pair.close)
    if (!open || !close) continue
    const value = `${open}${close}`
    if (seen.has(value)) continue
    seen.add(value)
    next.push(value)
  }
  emitValue(next)
}

function updateAutoPair(index: number, side: 'open' | 'close', value: string) {
  const pairs = autoPairs.value.map(pair => ({ ...pair }))
  if (!pairs[index]) return
  pairs[index][side] = firstChar(value)
  emitAutoPairs(pairs)
}

function addAutoPair() {
  const pairs = autoPairs.value.map(pair => ({ ...pair }))
  const nextPreset = autoPairPresets.find(preset => !hasAutoPair(preset.value))?.value ?? '〈〉'
  const chars = Array.from(nextPreset)
  pairs.push({ open: chars[0] ?? '(', close: chars[1] ?? ')' })
  emitAutoPairs(pairs)
}

function removeAutoPair(index: number) {
  const pairs = autoPairs.value.map(pair => ({ ...pair }))
  pairs.splice(index, 1)
  emitAutoPairs(pairs)
}

function hasAutoPair(value: string) {
  return autoPairs.value.some(pair => `${pair.open}${pair.close}` === value)
}

function toggleAutoPairPreset(value: string) {
  const chars = Array.from(value)
  const pair = { open: chars[0] ?? '', close: chars[1] ?? '' }
  const pairs = autoPairs.value.map(item => ({ ...item }))
  const index = pairs.findIndex(item => item.open === pair.open && item.close === pair.close)
  if (index >= 0) {
    pairs.splice(index, 1)
  } else {
    pairs.push(pair)
  }
  emitAutoPairs(pairs)
}

function parseNumberList(value: any) {
  if (!Array.isArray(value)) return []
  return value
    .map(item => Number(item))
    .filter(item => Number.isFinite(item) && item > 0)
    .map(item => Math.round(item))
    .sort((a, b) => a - b)
}

function emitNumbers(values: number[]) {
  const next = [...new Set(values)]
    .filter(value => Number.isFinite(value) && value > 0)
    .map(value => Math.round(value))
    .sort((a, b) => a - b)
  emitValue(next)
}

function updateNumber(index: number, rawValue: string) {
  const value = Number(rawValue)
  if (!Number.isFinite(value) || value <= 0) return
  const values = [...numberItems.value]
  if (!values[index]) return
  values[index] = value
  emitNumbers(values)
}

function addNumber() {
  const values = [...numberItems.value]
  const max = values.length ? Math.max(...values) : 0
  const nextPreset = milestonePresets.find(preset => !hasNumber(preset) && preset > max)
    ?? milestonePresets.find(preset => !hasNumber(preset))
    ?? Math.max(1000, Math.ceil((max + 1000) / 1000) * 1000)
  values.push(nextPreset)
  emitNumbers(values)
}

function removeNumber(index: number) {
  const values = [...numberItems.value]
  values.splice(index, 1)
  emitNumbers(values)
}

function hasNumber(value: number) {
  return numberItems.value.includes(value)
}

function toggleNumberPreset(value: number) {
  const values = [...numberItems.value]
  const index = values.indexOf(value)
  if (index >= 0) {
    values.splice(index, 1)
  } else {
    values.push(value)
  }
  emitNumbers(values)
}

function firstChar(value: string) {
  return Array.from(value.trim())[0] ?? ''
}

function countChars(value: string) {
  return Array.from(value).length
}

function formatNumber(value: number) {
  return value.toLocaleString()
}
</script>

<style scoped>
.graphical-array-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preset-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.preset-btn {
  min-width: 50px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--vscode-input-border, #444);
  border-radius: 5px;
  background-color: var(--vscode-input-background, #2a2a2a);
  color: var(--vscode-input-foreground, #e0e0e0);
  font-size: 12px;
  font-family: var(--vscode-font-family, inherit);
  cursor: pointer;
}

.pair-preset {
  min-width: 34px;
  font-size: 13px;
  font-family: var(--vscode-editor-font-family, monospace);
}

.preset-btn:hover {
  border-color: var(--vscode-focusBorder, #007acc);
}

.preset-btn.active {
  background-color: var(--vscode-button-background, #0e639c);
  border-color: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
}

.editor-table {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.editor-table__head,
.editor-row {
  display: grid;
  gap: 6px;
  align-items: center;
}

.pair-grid {
  grid-template-columns: minmax(70px, 1fr) minmax(70px, 1fr) 28px;
}

.number-grid {
  grid-template-columns: minmax(120px, 1fr) 28px;
}

.editor-table__head {
  color: var(--vscode-descriptionForeground, #999);
  font-size: 11px;
}

.symbol-input,
.number-input {
  width: 100%;
  min-width: 0;
  height: 30px;
  padding: 4px 8px;
  border: 1px solid var(--vscode-input-border, #444);
  border-radius: 6px;
  background-color: var(--vscode-input-background, #2a2a2a);
  color: var(--vscode-input-foreground, #e0e0e0);
  outline: none;
  box-sizing: border-box;
}

.symbol-input {
  font-size: 15px;
  font-family: var(--vscode-editor-font-family, monospace);
  text-align: center;
}

.number-input {
  font-size: var(--vscode-font-size, 0.85rem);
}

.symbol-input:focus,
.number-input:focus {
  border-color: var(--vscode-focusBorder, #007acc);
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

.editor-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
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

.add-rule-btn:hover,
.secondary-action-btn:hover {
  background-color: var(--vscode-toolbar-hoverBackground, #333);
}

.secondary-action-btn {
  height: 29px;
  padding: 0 9px;
  border: 1px solid var(--vscode-button-border, #444);
  border-radius: 6px;
  background: transparent;
  color: var(--vscode-textLink-foreground, #3794ff);
  cursor: pointer;
  font-size: 12px;
}

.config-description {
  font-size: var(--vscode-font-size, 0.75rem);
  color: var(--vscode-descriptionForeground, #999);
}

.config-error {
  font-size: var(--vscode-font-size, 0.75rem);
  color: var(--vscode-errorForeground, #f48771);
}

@media (max-width: 520px) {
  .editor-actions {
    grid-template-columns: 1fr;
  }
}
</style>
