<template>
  <div class="word-wrap-preview">
    <div class="mock-editor">
      <div class="mock-lines">
        <div v-for="(line, i) in lines" :key="i" class="mock-row">
          <span class="line-number">{{ i + 1 }}</span>
          <span class="line-content" :class="{ 'wrap-on': isWrap, 'dim': line.dim }">{{ line.text }}</span>
        </div>
      </div>
    </div>
    <div class="preview-label">
      <span v-if="!isWrap">不折行 - 长文本超出编辑器宽度</span>
      <span v-else-if="value === 'on'">按编辑器窗口宽度折行 - 折行不计入行号</span>
      <span v-else-if="value === 'wordWrapColumn'">按列宽折行</span>
      <span v-else>bounded 折行</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  value: string
}>()

const isWrap = computed(() => props.value !== 'off')

const lines = [
  { text: '她站在窗前，看着远处的山峦在夕阳下渐渐模糊，心中涌起一股说不清的惆怅。', dim: false },
  { text: '那些年少时的誓言，如今看来不过是风中的尘埃，轻轻一吹便散了。', dim: true },
  { text: '推开那扇木门，屋内陈设一如往昔。', dim: false },
  { text: '桌上那杯茶早已凉透，却没有人来收走，雨声敲打着屋檐，节奏渐渐慢了下来。', dim: false },
  { text: '窗外的雨渐渐停了。', dim: false },
  { text: '空气中弥漫着泥土的清香。', dim: false },
]
</script>

<style scoped>
.word-wrap-preview {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mock-editor {
  height: 180px;
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: 4px;
  overflow: hidden;
  background-color: var(--vscode-editor-background, #1e1e1e);
  font-family: monospace;
  font-size: 12px;
  line-height: 1.6;
}

.mock-lines {
  padding: 4px 0;
}

.mock-row {
  display: flex;
  align-items: baseline;
}

.line-number {
  display: inline-block;
  width: 28px;
  text-align: right;
  padding-right: 8px;
  color: var(--vscode-descriptionForeground, #858585);
  background-color: rgba(0, 0, 0, 0.2);
  user-select: none;
  flex-shrink: 0;
}

.line-content {
  color: var(--vscode-foreground, #e0e0e0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 8px;
}

.line-content.wrap-on {
  white-space: normal;
  word-break: break-all;
  overflow: visible;
}

.line-content.dim {
  color: var(--vscode-descriptionForeground, #999);
}

.preview-label {
  font-size: 11px;
  color: var(--vscode-descriptionForeground, #999);
  text-align: center;
}
</style>
