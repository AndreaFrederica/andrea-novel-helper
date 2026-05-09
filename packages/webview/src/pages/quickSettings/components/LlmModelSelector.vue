<template>
  <div class="llm-model-selector">
    <div class="model-row">
      <select
        class="config-select"
        :value="selectedValue"
        :disabled="loading"
        @change="handleSelect(($event.target as HTMLSelectElement).value)"
      >
        <option value="__custom__">自定义模型名称</option>
        <option v-for="model in models" :key="model.id" :value="model.id">
          {{ model.label || model.id }}
        </option>
      </select>
      <button class="secondary-action-btn" :disabled="loading || !apiBase" @click="requestModels">
        {{ loading ? '获取中...' : '获取模型' }}
      </button>
    </div>

    <input
      type="text"
      class="config-text"
      :value="modelValue"
      placeholder="输入模型名称，或从上方列表选择"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />

    <div class="model-status" :class="{ error: !!error }">
      <span v-if="error">{{ error }}</span>
      <span v-else-if="models.length">已获取 {{ models.length }} 个模型，可从列表选择；仍可手动输入自定义模型。</span>
      <span v-else-if="apiBase">默认会尝试从 API Base 获取模型列表，也可以直接手动填写。</span>
      <span v-else>需要先填写 API Base；未填写时只能使用自定义模型名称。</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

interface LlmModelOption {
  id: string
  label?: string
}

const props = defineProps<{
  modelValue: string
  apiBase?: string
  apiKey?: string
  models?: LlmModelOption[]
  loading?: boolean
  error?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'fetch-models': []
}>()

const requestedOnce = ref(false)

const models = computed(() => props.models ?? [])
const selectedValue = computed(() => {
  return models.value.some(model => model.id === props.modelValue) ? props.modelValue : '__custom__'
})

watch(
  () => props.apiBase,
  () => {
    requestedOnce.value = false
    autoRequestModels()
  }
)

onMounted(() => {
  autoRequestModels()
})

function autoRequestModels() {
  if (requestedOnce.value || !props.apiBase || props.loading) return
  requestedOnce.value = true
  requestModels()
}

function requestModels() {
  if (!props.apiBase || props.loading) return
  emit('fetch-models')
}

function handleSelect(value: string) {
  if (value === '__custom__') return
  emit('update:modelValue', value)
}
</script>

<style scoped>
.llm-model-selector {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.model-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
}

.config-select,
.config-text {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--vscode-input-border, #444);
  border-radius: 6px;
  background-color: var(--vscode-input-background, #2a2a2a);
  color: var(--vscode-input-foreground, #e0e0e0);
  font-size: var(--vscode-font-size, 0.85rem);
  font-family: var(--vscode-font-family, inherit);
  outline: none;
  box-sizing: border-box;
}

.config-select:focus,
.config-text:focus {
  border-color: var(--vscode-focusBorder, #007acc);
}

.secondary-action-btn {
  height: 31px;
  padding: 0 9px;
  border: 1px solid var(--vscode-button-border, #444);
  border-radius: 6px;
  background: transparent;
  color: var(--vscode-textLink-foreground, #3794ff);
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
}

.secondary-action-btn:hover:not(:disabled) {
  background-color: var(--vscode-toolbar-hoverBackground, #333);
}

.secondary-action-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.model-status {
  font-size: var(--vscode-font-size, 0.75rem);
  color: var(--vscode-descriptionForeground, #999);
}

.model-status.error {
  color: var(--vscode-errorForeground, #f48771);
}

@media (max-width: 520px) {
  .model-row {
    grid-template-columns: 1fr;
  }
}
</style>
