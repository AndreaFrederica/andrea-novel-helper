<template>
  <div class="tab-size-preview">
    <div class="mock-editor">
      <div class="mock-gutter">
        <span v-for="i in 10" :key="i">{{ i }}</span>
      </div>
      <div class="mock-content">
        <div class="mock-line">
          <span class="keyword">function</span> <span class="func">写小说</span>() {
        </div>
        <div class="mock-line" :style="{ paddingLeft: value * 4 + 'px' }">
          <span class="keyword">const</span> 章节 = [];
        </div>
        <div class="mock-line" :style="{ paddingLeft: value * 4 + 'px' }">
          <span class="keyword">for</span> (<span class="keyword">let</span> i = 0; i &lt; 10; i++) {
        </div>
        <div class="mock-line" :style="{ paddingLeft: value * 8 + 'px' }">
          章节.<span class="func">push</span>(<span class="string">"第一章"</span>);
        </div>
        <div class="mock-line" :style="{ paddingLeft: value * 8 + 'px' }">
          章节.<span class="func">push</span>(<span class="string">"第二章"</span>);
        </div>
        <div class="mock-line" :style="{ paddingLeft: value * 4 + 'px' }">}</div>
        <div class="mock-line">}</div>
        <div class="mock-line">
          <span class="keyword">function</span> <span class="func">保存</span>() {
        </div>
        <div class="mock-line" :style="{ paddingLeft: value * 4 + 'px' }">
          <span class="keyword">return</span> 章节;
        </div>
        <div class="mock-line">}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  value: number
}>()
</script>

<style scoped>
.tab-size-preview {
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
  line-height: 1.5;
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
  white-space: pre;
}

.keyword {
  color: var(--vscode-textLink-foreground, #569cd6);
}

.func {
  color: var(--vscode-charts-yellow, #dcdcaa);
}

.string {
  color: var(--vscode-charts-green, #ce9178);
}
</style>
