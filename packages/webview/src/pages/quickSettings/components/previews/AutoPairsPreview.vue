<template>
  <div class="auto-pairs-preview">
    <div class="mock-editor">
      <div class="mock-gutter"><span v-for="n in 4" :key="n">{{ n }}</span></div>
      <div class="mock-content">
        <div class="mock-line">
          <span class="typed-text">{{ displayText }}</span>
          <span class="closing-char" :class="{ visible: showClosing }">{{ closingChar }}</span>
          <span class="cursor" :class="{ visible: showCursor }">|</span>
        </div>
        <div v-if="secondLine" class="mock-line second-line">{{ secondLine }}</div>
        <div v-if="thirdLine" class="mock-line third-line">{{ thirdLine }}</div>
      </div>
    </div>
    <div class="preview-label">
      {{ enabled ? '输入左括号，自动补全右括号' : '关闭后需手动输入右括号' }}
      <span class="step-label">{{ stepLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{ value: boolean }>()

const demos = [
  { base: '她望着远方', open: '(', close: ')', second: '心中涌起一股说不清的惆怅。', third: '' },
  { base: '书名', open: '《', close: '》', second: '那些年少时的誓言，如今', third: '看来不过是风中的尘埃。' },
  { base: '她轻声说', open: '"', close: '"', second: '"再见了，我的朋友。"', third: '' },
  { base: '回忆', open: '「', close: '」', second: '推开那扇木门，屋内陈设一如往昔。', third: '' },
]

const displayText = ref('')
const closingChar = ref('')
const showCursor = ref(true)
const showClosing = ref(false)
const stepLabel = ref('')
const enabled = ref(props.value)
const secondLine = ref('')
const thirdLine = ref('')

let demoIndex = 0
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
  const demo = demos[demoIndex]!

  if (enabled.value) {
    displayText.value = demo.base
    closingChar.value = ''
    showCursor.value = true
    showClosing.value = false
    secondLine.value = ''
    thirdLine.value = ''
    stepLabel.value = '等待输入...'

    schedule(() => {
      displayText.value = demo.base + demo.open
      closingChar.value = demo.close
      showClosing.value = true
      secondLine.value = demo.second
      thirdLine.value = demo.third
      stepLabel.value = `输入 ${demo.open}，自动补全 ${demo.close}`
    }, 800)

    schedule(() => {
      showCursor.value = false
      stepLabel.value = '光标在括号之间'
    }, 1600)

    schedule(() => {
      demoIndex = (demoIndex + 1) % demos.length
      runDemo()
    }, 2800)
  } else {
    displayText.value = demo.base
    closingChar.value = ''
    showCursor.value = true
    showClosing.value = false
    secondLine.value = ''
    thirdLine.value = ''
    stepLabel.value = '等待输入...'

    schedule(() => {
      displayText.value = demo.base + demo.open
      secondLine.value = demo.second
      thirdLine.value = demo.third
      stepLabel.value = `输入 ${demo.open}，没有自动补全`
    }, 800)

    schedule(() => {
      displayText.value = demo.base + demo.open + demo.close
      stepLabel.value = '需要手动输入闭合字符'
    }, 2000)

    schedule(() => {
      demoIndex = (demoIndex + 1) % demos.length
      runDemo()
    }, 3200)
  }
}

watch(() => props.value, (v) => {
  enabled.value = v
  demoIndex = 0
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
.auto-pairs-preview {
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
  font-size: 13px;
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
  white-space: nowrap;
}

.second-line {
  color: var(--vscode-descriptionForeground, #999);
}

.third-line {
  color: var(--vscode-descriptionForeground, #999);
}

.typed-text {
  transition: none;
}

.closing-char {
  opacity: 0;
  color: var(--vscode-terminal-ansiYellow, #e5c07b);
  transition: opacity 0.3s ease;
}

.closing-char.visible {
  opacity: 1;
}

.cursor {
  opacity: 0;
  color: var(--vscode-foreground, #e0e0e0);
  font-weight: 100;
}

.cursor.visible {
  opacity: 1;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% { opacity: 0; }
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
