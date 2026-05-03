<template>
  <div class="wrapping-indent-preview">
    <div class="mock-editor">
      <div class="mock-gutter">
        <span>1</span>
        <span>2</span>
      </div>
      <div class="mock-content">
        <!-- First line has paragraph indent (two spaces = 16px) -->
        <div class="mock-line main-line" style="padding-left: 16px;">
          {{ sampleText }}
        </div>
        <!-- Wrap line: position depends on indent mode -->
        <div class="mock-line wrap-line" :style="wrapLineStyle">
          {{ wrapText }}
        </div>
        <div class="mock-line gap-line"></div>
        <!-- Second paragraph -->
        <div class="mock-line new-para" style="padding-left: 16px;">
          推开那扇木门，屋内陈设一如往昔。
        </div>
        <div class="mock-line wrap-line" :style="wrapLineStyle2">
          桌上那杯茶早已凉透，却没有人来收走。
        </div>
        <div class="mock-line gap-line"></div>
        <!-- Third paragraph -->
        <div class="mock-line new-para" style="padding-left: 16px;">
          窗外的雨渐渐停了。
        </div>
      </div>
    </div>
    <!-- Visual guide line showing where wrap line starts -->
    <div class="indent-guide">
      <div class="guide-line" :style="guideLineStyle"></div>
      <span class="guide-label">{{ guideLabel }}</span>
    </div>
    <div class="preview-label">
      <span v-if="value === 'none'">none — 折行回到最左侧，不保留段首缩进</span>
      <span v-else-if="value === 'same'">same — 折行与首行对齐，保留段首缩进</span>
      <span v-else-if="value === 'indent'">indent — 折行在首行基础上再缩进一层</span>
      <span v-else>deepIndent — 折行在首行基础上再缩进两层</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  value: string
}>()

const sampleText = '她站在窗前，看着远处的山峦在夕阳下渐渐模糊。'
const wrapText = '心中涌起一股说不清的惆怅。'

// Paragraph indent = 2 chars = 16px at 12px font
const PARA_INDENT_PX = 16

function getWrapIndent(value: string): number {
  const map: Record<string, number> = {
    none: 0,          // wrap to column 0, no indent at all
    same: PARA_INDENT_PX,  // wrap to same column as first line (16px)
    indent: PARA_INDENT_PX + 16,  // one extra level (32px)
    deepIndent: PARA_INDENT_PX + 32, // two extra levels (48px)
  }
  return map[value] ?? 0
}

const wrapLineStyle = computed(() => ({
  paddingLeft: getWrapIndent(props.value) + 'px',
}))

const wrapLineStyle2 = computed(() => ({
  paddingLeft: getWrapIndent(props.value) + 'px',
}))

const guideLineStyle = computed(() => ({
  left: getWrapIndent(props.value) + 'px',
}))

const guideLabel = computed(() => {
  const labels: Record<string, string> = {
    none: '折行起始位置（最左侧）',
    same: '折行起始位置（与首行对齐）',
    indent: '折行起始位置（+1 缩进层）',
    deepIndent: '折行起始位置（+2 缩进层）',
  }
  return labels[props.value] || ''
})
</script>

<style scoped>
.wrapping-indent-preview {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mock-editor {
  display: flex;
  height: 220px;
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: 4px;
  overflow: hidden;
  background-color: var(--vscode-editor-background, #1e1e1e);
  font-family: monospace;
  font-size: 12px;
  line-height: 1.6;
}

.mock-gutter {
  display: flex;
  flex-direction: column;
  padding: 4px 6px;
  background-color: rgba(0, 0, 0, 0.2);
  color: var(--vscode-descriptionForeground, #858585);
  border-right: 1px solid var(--vscode-panel-border, #333);
  user-select: none;
}

.mock-content {
  flex: 1;
  padding: 4px 8px;
}

.mock-line {
  color: var(--vscode-foreground, #e0e0e0);
  white-space: nowrap;
}

.main-line {
  color: var(--vscode-foreground, #e0e0e0);
}

.wrap-line {
  color: var(--vscode-textLink-foreground, #3794ff);
  transition: padding-left 0.3s ease;
}

.gap-line {
  height: 6px;
}

.new-para {
  color: var(--vscode-foreground, #e0e0e0);
  opacity: 0.6;
}

.indent-guide {
  position: relative;
  height: 14px;
}

.guide-line {
  position: absolute;
  top: 0;
  width: 2px;
  height: 14px;
  background-color: var(--vscode-textLink-foreground, #3794ff);
  border-radius: 1px;
  transition: left 0.3s ease;
}

.guide-label {
  position: absolute;
  left: 8px;
  top: 0;
  font-size: 10px;
  color: var(--vscode-descriptionForeground, #999);
  line-height: 14px;
}

.preview-label {
  font-size: 11px;
  color: var(--vscode-descriptionForeground, #999);
  text-align: center;
}
</style>
