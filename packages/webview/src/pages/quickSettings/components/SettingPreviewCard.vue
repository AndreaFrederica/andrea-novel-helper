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
      <div v-if="item.type === 'boolean'" class="toggle-row">
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
      <div v-else-if="item.type === 'number' || item.type === 'integer'" class="number-row">
        <input
          type="number"
          class="config-number"
          :value="item.value"
          :min="item.minimum"
          :max="item.maximum"
          :step="item.type === 'integer' ? 1 : 1"
          @input="$emit('update:value', Number(($event.target as HTMLInputElement).value))"
        />
        <span v-if="item.description" class="config-description">{{ item.description }}</span>
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
import { ref, computed } from 'vue'
import type { ConfigItem } from 'src/types/config'

const props = defineProps<{
  item: ConfigItem
  showPreview?: boolean
}>()

defineEmits<{
  'update:value': [value: any]
  'reset': []
}>()

const isHovered = ref(false)

const hasChanges = computed(() => {
  return props.item.value !== props.item.defaultValue
})
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
</style>
