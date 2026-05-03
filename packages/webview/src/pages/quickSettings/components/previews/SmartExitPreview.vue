<template>
  <div class="smart-exit-preview">
    <div class="mock-editor">
      <div class="mock-gutter">
        <span v-for="n in lineCount" :key="n">{{ n }}</span>
      </div>
      <div class="mock-content">
        <div v-for="(line, li) in displayLines" :key="li" class="mock-line">
          <template v-for="(seg, si) in line" :key="si">
            <span v-if="seg.type === 'text'" :class="seg.cls">{{ seg.value }}</span>
            <span v-else-if="seg.type === 'cursor'" class="cursor" :class="{ visible: showCursor }">|</span>
          </template>
        </div>
      </div>
    </div>
    <div class="preview-label">
      {{ enabled ? '光标在括号前，按 Enter 跳出' : '光标在括号前，按 Enter 换行' }}
      <span class="step-label">{{ stepLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{ value: boolean }>()

interface Seg {
  type: 'text' | 'cursor'
  value: string
  cls?: string
}

type Line = Seg[]

const enabled = ref(props.value)

const demos: { before: Line[]; afterOn: Line[]; afterOff: Line[] }[] = [
  {
    before: [
      [{ type: 'text', value: '她轻声说：「你好' }, { type: 'cursor', value: '' }, { type: 'text', value: '」' }],
      [{ type: 'text', value: '心中涌起一股说不清的惆怅。', cls: 'dim' }],
    ],
    afterOn: [
      [{ type: 'text', value: '她轻声说：「你好」' }, { type: 'cursor', value: '' }],
      [{ type: 'text', value: '心中涌起一股说不清的惆怅。', cls: 'dim' }],
    ],
    afterOff: [
      [{ type: 'text', value: '她轻声说：「你好」' }],
      [{ type: 'cursor', value: '' }],
      [{ type: 'text', value: '心中涌起一股说不清的惆怅。', cls: 'dim' }],
    ],
  },
  {
    before: [
      [{ type: 'text', value: 'Hello("World' }, { type: 'cursor', value: '' }, { type: 'text', value: '")' }],
      [{ type: 'text', value: 'The quick brown fox jumps.', cls: 'dim' }],
    ],
    afterOn: [
      [{ type: 'text', value: 'Hello("World")' }, { type: 'cursor', value: '' }],
      [{ type: 'text', value: 'The quick brown fox jumps.', cls: 'dim' }],
    ],
    afterOff: [
      [{ type: 'text', value: 'Hello("World")' }],
      [{ type: 'cursor', value: '' }],
      [{ type: 'text', value: 'The quick brown fox jumps.', cls: 'dim' }],
    ],
  },
  {
    before: [
      [{ type: 'text', value: '《' }, { type: 'text', value: '西游记' }, { type: 'cursor', value: '' }, { type: 'text', value: '》' }],
      [{ type: 'text', value: '推开那扇木门，屋内陈设一如往昔。', cls: 'dim' }],
    ],
    afterOn: [
      [{ type: 'text', value: '《西游记》' }, { type: 'cursor', value: '' }],
      [{ type: 'text', value: '推开那扇木门，屋内陈设一如往昔。', cls: 'dim' }],
    ],
    afterOff: [
      [{ type: 'text', value: '《西游记》' }],
      [{ type: 'cursor', value: '' }],
      [{ type: 'text', value: '推开那扇木门，屋内陈设一如往昔。', cls: 'dim' }],
    ],
  },
]

const displayLines = ref<Line[]>(demos[0]!.before)
const showCursor = ref(true)
const stepLabel = ref('')
const lineCount = computed(() => displayLines.value.length || 1)

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
  const closingChar = (demo.before[0]?.find(s => s.type === 'text' && s.value.length === 1 && '」)》】'.includes(s.value)) as any)?.value || ''

  displayLines.value = demo.before
  showCursor.value = true
  stepLabel.value = `光标在 ${closingChar} 前，按 Enter`

  schedule(() => {
    showCursor.value = false
  }, 100)

  schedule(() => {
    if (enabled.value) {
      displayLines.value = demo.afterOn
      stepLabel.value = '光标跳到括号外面'
    } else {
      displayLines.value = demo.afterOff
      stepLabel.value = '正常换行，插入新行'
    }
    showCursor.value = true
  }, 1200)

  schedule(() => {
    demoIndex = (demoIndex + 1) % demos.length
    runDemo()
  }, 2600)
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
.smart-exit-preview {
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
  min-height: 1.6em;
}

.dim {
  color: var(--vscode-descriptionForeground, #999);
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
