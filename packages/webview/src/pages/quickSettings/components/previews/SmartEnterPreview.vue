<template>
  <div class="smart-enter-preview">
    <div class="mock-editor">
      <div class="mock-gutter">
        <span v-for="n in lineCount" :key="n">{{ n }}</span>
      </div>
      <div class="mock-content">
        <div v-for="(line, li) in lines" :key="li" class="mock-line">
          <span v-if="line.isBlank" class="blank-line">&nbsp;</span>
          <template v-else>
            <span class="line-text">{{ line.text }}</span>
            <span
              v-if="line.showCursor"
              class="cursor"
              :class="{ visible: showCursor }"
            >|</span>
          </template>
        </div>
      </div>
    </div>
    <div class="preview-label">
      {{ enabled ? '段末按 Enter，自动分段（空行+缩进）' : '段末按 Enter，仅换行' }}
      <span class="step-label">{{ stepLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{ value: boolean }>()

interface MockLine {
  text: string
  isBlank: boolean
  showCursor: boolean
}

const enabled = ref(props.value)

const beforeState: MockLine[] = [
  { text: '她站在窗前，看着远处的山峦', isBlank: false, showCursor: true },
  { text: '在夕阳下渐渐模糊，心中', isBlank: false, showCursor: false },
  { text: '涌起一股说不清的惆怅。', isBlank: false, showCursor: false },
  { text: '窗外的雨渐渐停了，', isBlank: false, showCursor: false },
]

const afterStateOn: MockLine[] = [
  { text: '她站在窗前，看着远处的山峦', isBlank: false, showCursor: false },
  { text: '在夕阳下渐渐模糊，心中', isBlank: false, showCursor: false },
  { text: '涌起一股说不清的惆怅。', isBlank: false, showCursor: false },
  { text: '', isBlank: true, showCursor: false },
  { text: '  窗外的雨渐渐停了，', isBlank: false, showCursor: true },
]

const afterStateOff: MockLine[] = [
  { text: '她站在窗前，看着远处的山峦', isBlank: false, showCursor: false },
  { text: '在夕阳下渐渐模糊，心中', isBlank: false, showCursor: false },
  { text: '涌起一股说不清的惆怅。', isBlank: false, showCursor: false },
  { text: '窗外的雨渐渐停了，', isBlank: false, showCursor: true },
]

const lines = ref<MockLine[]>(beforeState.map(l => ({ ...l })))
const showCursor = ref(true)
const stepLabel = ref('')
const lineCount = computed(() => lines.value.length || 2)

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
  lines.value = beforeState.map(l => ({ ...l }))
  showCursor.value = true
  stepLabel.value = '光标在段落末尾，按 Enter'

  schedule(() => {
    showCursor.value = false
  }, 50)

  schedule(() => {
    if (enabled.value) {
      lines.value = afterStateOn.map(l => ({ ...l }))
      stepLabel.value = '自动插入空行 + 缩进'
    } else {
      lines.value = afterStateOff.map(l => ({ ...l }))
      stepLabel.value = '仅插入换行，无空行无缩进'
    }
    showCursor.value = true
  }, 1200)

  schedule(() => {
    stepLabel.value = enabled.value ? '新段落已就绪' : '需要手动输入空行和缩进'
  }, 2000)

  schedule(() => {
    runDemo()
  }, 3400)
}

watch(() => props.value, () => {
  enabled.value = props.value
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
.smart-enter-preview {
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
  white-space: nowrap;
  min-height: 1.6em;
}

.blank-line {
  display: inline-block;
}

.line-text {
  color: var(--vscode-foreground, #e0e0e0);
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
