<template>
  <div class="paragraph-preview">
    <div class="mock-editor">
      <div class="mock-content">
        <div
          v-for="(para, index) in paragraphs"
          :key="index"
          class="mock-para"
          :style="{
            textIndent: indentFirstTwoSpaces ? '2em' : '0',
            marginBottom: index < paragraphs.length - 1 ? (blankLinesBetweenParas * 12) + 'px' : '0'
          }"
        >
          {{ para }}
        </div>
      </div>
    </div>
    <div class="preview-label">
      段首缩进 {{ indentFirstTwoSpaces ? '开启' : '关闭' }} · 段间距 {{ blankLinesBetweenParas }} 行
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  indentFirstTwoSpaces: boolean
  blankLinesBetweenParas: number
}>()

const paragraphs = [
  '她站在窗前，看着远处的山峦在夕阳下渐渐模糊。那些年少时的誓言，如今看来不过是风中的尘埃。',
  '推开那扇吱呀作响的木门，屋内陈设一如往昔。桌上那杯茶早已凉透，却没有人来收走。',
  '窗外的雨渐渐停了，空气中弥漫着泥土的清香。她深吸一口气，转身走向了远方。',
  '那些曾经以为永远不会忘记的事，终究还是在岁月里慢慢褪了色。',
]
</script>

<style scoped>
.paragraph-preview {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mock-editor {
  min-height: 200px;
  max-height: 260px;
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: 4px;
  overflow: hidden;
  background-color: var(--vscode-editor-background, #1e1e1e);
}

.mock-content {
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.6;
}

.mock-para {
  color: var(--vscode-foreground, #e0e0e0);
  transition: text-indent 0.3s ease, margin-bottom 0.3s ease;
}

.preview-label {
  font-size: 11px;
  color: var(--vscode-descriptionForeground, #999);
  text-align: center;
}
</style>
