<template>
  <div class="font-size-preview">
    <div class="mock-editor">
      <div class="mock-content" :style="{ fontSize: value + 'px' }">
        <div class="preview-line primary">她站在窗前，看着远处的山峦。</div>
        <div class="preview-line secondary">心中涌起一股说不清的惆怅。</div>
        <div class="preview-line tertiary">那些年少时的誓言，如今看来</div>
        <div class="preview-line tertiary">不过是风中的尘埃。</div>
      </div>
      <div class="size-badge">{{ value }}px</div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  value: number
}>()
</script>

<style scoped>
.font-size-preview {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mock-editor {
  position: relative;
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: 4px;
  overflow: hidden;
  background-color: var(--vscode-editor-background, #1e1e1e);
  min-height: 180px;
  max-height: 260px;
}

.mock-content {
  padding: 12px 16px;
  line-height: 1.6;
  transition: font-size 0.2s ease;
}

.preview-line {
  word-break: break-word;
  overflow-wrap: break-word;
}

.preview-line.primary {
  color: var(--vscode-foreground, #e0e0e0);
}

.preview-line.secondary {
  color: var(--vscode-foreground, #e0e0e0);
  opacity: 0.85;
}

.preview-line.tertiary {
  color: var(--vscode-descriptionForeground, #999);
}

.size-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background-color: var(--vscode-badge-background, #4d4d4d);
  color: var(--vscode-badge-foreground, #fff);
}
</style>
