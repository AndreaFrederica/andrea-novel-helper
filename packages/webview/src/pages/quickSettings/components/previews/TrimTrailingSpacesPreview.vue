<template>
  <div class="trim-preview">
    <div class="mock-editor">
      <div class="mock-gutter">
        <span v-for="n in 6" :key="n">{{ n }}</span>
      </div>
      <div class="mock-content">
        <div class="mock-line">
          <span class="line-text">她站在窗前</span>
          <span class="trailing-spaces" :class="{ removing: isRemoving, 'always-show': !enabled }">   </span>
        </div>
        <div class="mock-line">
          <span class="line-text">看着远处的山峦</span>
          <span class="trailing-spaces" :class="{ removing: isRemoving, 'always-show': !enabled }">&nbsp;&nbsp;</span>
        </div>
        <div class="mock-line">
          <span class="line-text">在夕阳下渐渐模糊</span>
          <span class="trailing-spaces" :class="{ removing: isRemoving, 'always-show': !enabled }">&nbsp;</span>
        </div>
        <div class="mock-line">
          <span class="line-text">心中涌起一股惆怅</span>
          <span class="trailing-spaces" :class="{ removing: isRemoving, 'always-show': !enabled }">&nbsp;&nbsp;&nbsp;</span>
        </div>
        <div class="mock-line">
          <span class="line-text">那些年少时的誓言</span>
          <span class="trailing-spaces" :class="{ removing: isRemoving, 'always-show': !enabled }">&nbsp;</span>
        </div>
        <div class="mock-line">
          <span class="line-text">看来不过是风中的尘埃</span>
          <span class="trailing-spaces" :class="{ removing: isRemoving, 'always-show': !enabled }">&nbsp;&nbsp;</span>
        </div>
      </div>
    </div>
    <div class="preview-label">
      {{ enabled ? '自动清除行尾多余空格' : '关闭后行尾空格保留' }}
      <span class="step-label">{{ stepLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{ value: boolean }>()

const enabled = ref(props.value)
const isRemoving = ref(false)
const stepLabel = ref('')

let timers: ReturnType<typeof setTimeout>[] = []

function clearTimers() {
  timers.forEach(t => clearTimeout(t))
  timers = []
}

function schedule(fn: () => void, ms: number) {
  timers.push(setTimeout(fn, ms))
}

function runDemo() {
  clearTimers()
  isRemoving.value = false

  if (enabled.value) {
    stepLabel.value = '行尾有多余空格'

    schedule(() => {
      isRemoving.value = true
      stepLabel.value = '自动清除中...'
    }, 1200)

    schedule(() => {
      stepLabel.value = '空格已清除'
    }, 2000)

    schedule(() => {
      runDemo()
    }, 3200)
  } else {
    stepLabel.value = '行尾空格保留，不会被清除'

    schedule(() => {
      runDemo()
    }, 3200)
  }
}

watch(() => props.value, (v) => {
  enabled.value = v
  runDemo()
})

onMounted(() => {
  runDemo()
})

onBeforeUnmount(() => {
  clearTimers()
})
</script>

<style scoped>
.trim-preview {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mock-editor {
  display: flex;
  height: 180px;
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
  overflow: hidden;
}

.mock-line {
  color: var(--vscode-foreground, #e0e0e0);
  white-space: pre;
  min-height: 1.6em;
}

.trailing-spaces {
  color: var(--vscode-terminal-ansiRed, #e06c75);
  background-color: rgba(224, 108, 117, 0.15);
  border-radius: 2px;
  display: inline;
  transition: opacity 0.5s ease, max-width 0.5s ease;
  opacity: 1;
  max-width: 40px;
}

.trailing-spaces.removing {
  opacity: 0;
  max-width: 0;
  overflow: hidden;
}

.trailing-spaces.always-show {
  transition: none;
  opacity: 1;
  max-width: 40px;
}

.preview-label {
  font-size: 11px;
  color: var(--vscode-descriptionForeground, #999);
  text-align: center;
}

.step-label {
  display: inline-block;
  margin-left: 6px;
  color: var(--vscode-textLink-foreground, #3794ff);
  font-size: 10px;
}
</style>
