<template>
  <div class="minimap-preview">
    <div class="mock-editor">
      <div class="main-area">
        <div class="mock-line" v-for="(text, i) in lineTexts" :key="i">
          <span class="line-text">{{ text }}</span>
        </div>
      </div>
      <div class="minimap-area" :class="{ hidden: !value }">
        <div class="minimap-line" v-for="n in lineTexts.length" :key="n"></div>
      </div>
    </div>
    <div class="preview-label">
      {{ value ? 'Minimap 开启 - 右侧显示缩略预览' : 'Minimap 关闭 - 更多写作空间' }}
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  value: boolean
}>()

const lineTexts = [
  '她站在窗前，看着远处的山峦',
  '在夕阳下渐渐模糊，心中',
  '涌起一股说不清的惆怅。',
  '那些年少时的誓言，如今',
  '看来不过是风中的尘埃。',
  '轻轻一吹便散了，推开',
  '那扇木门，屋内陈设一如往昔。',
  '桌上那杯茶早已凉透，',
  '却没有人来收走。',
  '窗外的雨渐渐停了，',
  '空气中弥漫着泥土的清香。',
  '她深吸一口气，转身走向远方。',
]
</script>

<style scoped>
.minimap-preview {
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
}

.main-area {
  flex: 1;
  padding: 6px 10px;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.4;
  overflow: hidden;
}

.mock-line {
  color: var(--vscode-foreground, #e0e0e0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.minimap-area {
  width: 40px;
  background-color: rgba(0, 0, 0, 0.3);
  border-left: 1px solid var(--vscode-panel-border, #333);
  padding: 4px 3px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: width 0.3s ease, opacity 0.3s ease;
}

.minimap-area.hidden {
  width: 0;
  opacity: 0;
  padding: 0;
  border: none;
}

.minimap-line {
  height: 3px;
  background-color: var(--vscode-descriptionForeground, #555);
  border-radius: 1px;
  opacity: 0.6;
}

.minimap-line:nth-child(odd) {
  width: 80%;
}

.minimap-line:nth-child(even) {
  width: 60%;
}

.minimap-line:nth-child(3n) {
  width: 70%;
}

.preview-label {
  font-size: 11px;
  color: var(--vscode-descriptionForeground, #999);
  text-align: center;
}
</style>
