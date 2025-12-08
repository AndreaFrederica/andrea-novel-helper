<template>
  <div class="config-section">
    <div class="config-title">{{ item.name }}</div>
    
    <!-- 字符串类型（带枚举的单选） -->
    <div v-if="item.type === 'string' && item.enum" class="config-item">
      <select class="config-input" :value="item.value" @change="handleValueChange(($event.target as HTMLSelectElement).value)">
        <option v-for="(option, index) in item.enum" :key="option" :value="option">
          {{ item.enumDescriptions?.[index] || option }}
        </option>
      </select>
      <div class="config-description">{{ item.markdownDescription }}</div>
    </div>
    
    <!-- 字符串类型（普通文本输入） -->
    <div v-else-if="item.type === 'string' && !item.enum" class="config-item">
      <input type="text" class="config-input" :value="item.value" @input="handleValueChange(($event.target as HTMLInputElement).value)">
      <div class="config-description">{{ item.markdownDescription }}</div>
    </div>
    
    <!-- 布尔类型 -->
    <div v-else-if="item.type === 'boolean'" class="config-item">
      <div class="switch-container">
        <span class="switch-label">{{ item.markdownDescription }}</span>
        <label class="switch">
          <input type="checkbox" class="switch-input" :checked="item.value" @change="handleValueChange(($event.target as HTMLInputElement).checked)">
          <span class="slider"></span>
        </label>
      </div>
    </div>
    
    <!-- 数字类型（带范围的数字输入） -->
    <div v-else-if="item.type === 'number'" class="config-item">
      <input 
        type="number" 
        class="config-input" 
        :value="item.value" 
        v-bind="{
          ...(item.minimum !== undefined && { min: item.minimum }),
          ...(item.maximum !== undefined && { max: item.maximum })
        }"
        @input="handleValueChange(parseFloat(($event.target as HTMLInputElement).value))"
      >
      <div class="config-description">{{ item.markdownDescription }}</div>
    </div>
    
    <!-- 整数类型（带范围的整数输入） -->
    <div v-else-if="item.type === 'integer'" class="config-item">
      <input 
        type="number" 
        class="config-input" 
        :value="item.value" 
        v-bind="{
          ...(item.minimum !== undefined && { min: item.minimum }),
          ...(item.maximum !== undefined && { max: item.maximum }),
          step: 1
        }"
        @input="handleValueChange(parseInt(($event.target as HTMLInputElement).value))"
      >
      <div class="config-description">{{ item.markdownDescription }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface ConfigItem {
  id: string
  type: 'string' | 'boolean' | 'number' | 'integer' | 'array'
  name: string
  markdownDescription: string
  value: any
  enum?: string[]
  enumDescriptions?: string[]
  minimum?: number
  maximum?: number
}

interface Props {
  item: ConfigItem
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:value': [value: any]
}>()

const handleValueChange = (newValue: any) => {
  emit('update:value', newValue)
}
</script>

<style scoped>
.config-section {
  margin-bottom: var(--spacing-xxlarge, 22px);
}

.config-title {
  font-weight: 600;
  margin-bottom: var(--spacing-small, 7px);
  font-size: var(--vscode-font-size, 0.9rem);
  color: var(--vscode-foreground, #e0e0e0);
}

.config-item {
  margin-bottom: var(--spacing-medium, 14px);
}

.config-input {
  width: 100%;
  padding: var(--spacing-medium, 2px) var(--spacing-large, 5px);
  background-color: var(--vscode-input-background, #2c2c2c);
  border: 1px solid var(--vscode-input-border, #444);
  border-radius: var(--border-radius, 7px);
  color: var(--vscode-input-foreground, #e0e0e0);
  font-size: var(--vscode-font-size, 0.9rem);
  margin-bottom: var(--spacing-xsmall, 4px);
  min-height: var(--input-height, 30px);
  transition: border-color 0.2s;
}

select.config-input {
  appearance: none;
  background-image: url('data:image/svg+xml;charset=UTF-8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>');
  background-repeat: no-repeat;
  background-position: right 9px center;
  background-size: 14px;
  color: var(--vscode-descriptionForeground, #aaa);
}

.config-input:focus {
  outline: none;
  border-color: var(--vscode-focusBorder, #1976d2);
}

.config-description {
  font-size: var(--vscode-font-size-sm, 0.8rem);
  color: var(--vscode-descriptionForeground, #aaa);
  margin-top: var(--spacing-xsmall, 5px);
  line-height: 1.4;
}

/* 复选框样式 */
.checkbox-container {
  display: flex;
  align-items: center;
  gap: var(--spacing-small, 7px);
  margin-top: var(--spacing-xsmall, 4px);
}

.checkbox-label {
  display: flex;
  align-items: center;
  cursor: pointer;
  font-size: var(--vscode-font-size, 0.9rem);
}

.checkbox-input {
  display: none;
}

.checkbox-custom {
  width: 18px;
  height: 18px;
  border: 1px solid var(--vscode-checkbox-border, #444);
  border-radius: var(--border-radius-small, 4px);
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--vscode-checkbox-background, #2c2c2c);
  transition: background-color 0.2s;
}

.checkbox-input:checked + .checkbox-custom::after {
  content: '✓';
  color: var(--vscode-checkbox-foreground, #1976d2);
  font-size: 13px;
  font-weight: bold;
}

/* 开关样式 */
.switch-container {
  display: flex;
  align-items: center;
  gap: var(--spacing-medium, 11px);
  margin-top: var(--spacing-xsmall, 4px);
  justify-content: space-between;
}

.switch-label {
  font-size: var(--vscode-font-size, 0.9rem);
  cursor: pointer;
  color: var(--vscode-foreground, #e0e0e0);
}

.switch {
  position: relative;
  display: inline-block;
  width: 43px;
  height: 22px;
  flex-shrink: 0;
}

.switch-input {
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
  transition: .4s;
  border-radius: 22px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 3px;
  bottom: 3px;
  background-color: var(--vscode-checkbox-foreground, #e0e0e0);
  transition: .4s;
  border-radius: 50%;
}

.switch-input:checked + .slider {
  background-color:  #1976d2;
}

.switch-input:checked + .slider:before {
  transform: translateX(21px);
}

@media (max-width: 768px) {
  .config-input {
    font-size: var(--vscode-font-size-mobile, 14px);
  }
  
  .config-title {
    font-size: var(--vscode-font-size-title-mobile, 1rem);
  }
  
  .config-description {
    font-size: var(--vscode-font-size-mobile-sm, 14px);
  }
}
</style>