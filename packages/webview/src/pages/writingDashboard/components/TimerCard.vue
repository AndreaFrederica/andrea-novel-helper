<template>
  <div class="timer-card">
    <!-- 模式切换 -->
    <div class="timer-modes">
      <button
        v-for="m in modes"
        :key="m.key"
        :class="['mode-btn', { active: mode === m.key }]"
        @click="switchMode(m.key)"
      >
        {{ m.label }}
      </button>
    </div>

    <!-- 圆形进度 + 时间显示 -->
    <div class="timer-display">
      <svg class="timer-ring" viewBox="0 0 120 120">
        <circle class="ring-bg" cx="60" cy="60" r="54" />
        <circle
          class="ring-progress"
          cx="60" cy="60" r="54"
          :stroke-dasharray="`${circumference} ${circumference}`"
          :stroke-dashoffset="ringOffset"
          :stroke="ringColor"
        />
      </svg>
      <div class="timer-text">
        <div class="timer-main">{{ displayTime }}</div>
        <div v-if="mode === 'pomodoro'" class="timer-sub">
          {{ isBreak ? '休息中' : '专注中' }} · 第 {{ pomodoroCount }} 轮
        </div>
        <div v-else-if="mode === 'countdown'" class="timer-sub">倒计时</div>
        <div v-else class="timer-sub">计时器</div>
      </div>
    </div>

    <!-- 控制按钮 -->
    <div class="timer-controls">
      <q-btn
        round
        :color="isRunning ? 'grey-6' : 'pink-5'"
        :icon="isRunning ? 'pause' : 'play_arrow'"
        size="md"
        @click="toggle"
      />
      <q-btn
        round
        outline
        color="grey-6"
        icon="replay"
        size="sm"
        @click="reset"
      />
      <q-btn
        round
        outline
        color="grey-6"
        icon="settings"
        size="sm"
        @click="showSettings = true"
      />
    </div>

    <!-- 设置面板 -->
    <WindowModal
      v-model="showSettings"
      v-bind="settingsModalProps"
    >
      <div class="timer-settings-body">
        <template v-if="mode === 'pomodoro'">
          <q-input
            v-model.number="settings.workMinutes"
            type="number"
            outlined dense
            label="专注时长（分钟）"
            :min="1" :max="120"
          />
          <q-input
            v-model.number="settings.breakMinutes"
            type="number"
            outlined dense
            label="休息时长（分钟）"
            :min="1" :max="60"
          />
        </template>
        <template v-else-if="mode === 'countdown'">
          <div class="row q-gutter-sm">
            <q-input v-model.number="settings.countdownH" type="number" outlined dense label="时" class="col" :min="0" :max="99" />
            <q-input v-model.number="settings.countdownM" type="number" outlined dense label="分" class="col" :min="0" :max="59" />
            <q-input v-model.number="settings.countdownS" type="number" outlined dense label="秒" class="col" :min="0" :max="59" />
          </div>
        </template>
      </div>
      <template #footer>
        <q-btn flat label="关闭" @click="showSettings = false" />
      </template>
    </WindowModal>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch, onBeforeUnmount } from 'vue'
import WindowModal from './WindowModal.vue'

type TimerMode = 'pomodoro' | 'countdown' | 'stopwatch'

const props = defineProps<{
  windowId?: string
}>()

const settingsModalProps = computed(() => {
  const base: Record<string, unknown> = {
    title: '计时器设置',
    width: 300,
    modalId: `${props.windowId ?? 'standalone'}-timer-settings`,
    closable: true,
  }
  if (props.windowId) base.ownerId = props.windowId
  return base
})

const modes = [
  { key: 'pomodoro' as TimerMode, label: '番茄钟' },
  { key: 'countdown' as TimerMode, label: '倒计时' },
  { key: 'stopwatch' as TimerMode, label: '计时器' },
]

/* ── 状态 ────────────────────────────────── */
const mode = ref<TimerMode>('pomodoro')
const isRunning = ref(false)
const isBreak = ref(false)
const elapsedMs = ref(0)      // 已流逝时间（毫秒）
const pomodoroCount = ref(0)  // 已完成轮数
const showSettings = ref(false)

const settings = reactive({
  workMinutes: 25,
  breakMinutes: 5,
  countdownH: 0,
  countdownM: 10,
  countdownS: 0,
})

/* ── 计算总时长 ──────────────────────────── */
const totalMs = computed(() => {
  if (mode.value === 'pomodoro') {
    return (isBreak.value ? settings.breakMinutes : settings.workMinutes) * 60 * 1000
  }
  if (mode.value === 'countdown') {
    return (settings.countdownH * 3600 + settings.countdownM * 60 + settings.countdownS) * 1000
  }
  return 0 // stopwatch 不需要总时长
})

/* ── 环形进度 ────────────────────────────── */
const circumference = 2 * Math.PI * 54
const ringOffset = computed(() => {
  if (mode.value === 'stopwatch') return circumference // 计时器没有进度环
  if (totalMs.value <= 0) return circumference
  const progress = Math.min(elapsedMs.value / totalMs.value, 1)
  return circumference - progress * circumference
})
const ringColor = computed(() => {
  if (mode.value === 'pomodoro') return isBreak.value ? '#84c66f' : '#ef6262'
  if (mode.value === 'countdown') return '#5d7bd5'
  return '#d94a9b'
})

/* ── 显示时间 ────────────────────────────── */
const displayTime = computed(() => {
  let ms: number
  if (mode.value === 'countdown') {
    ms = Math.max(0, totalMs.value - elapsedMs.value)
  } else {
    ms = elapsedMs.value
  }
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`
  return `${pad(m)}:${pad(s)}`
})

/* ── 计时器核心 ──────────────────────────── */
let intervalId: ReturnType<typeof setInterval> | null = null
let lastTick = 0

function tick() {
  const now = Date.now()
  const delta = now - lastTick
  lastTick = now
  elapsedMs.value += delta

  // 倒计时 / 番茄钟 自动结束
  if ((mode.value === 'countdown' || mode.value === 'pomodoro') && elapsedMs.value >= totalMs.value) {
    onComplete()
  }
}

function onComplete() {
  pause()
  if (mode.value === 'pomodoro') {
    if (!isBreak.value) {
      pomodoroCount.value++
    }
    // 自动切换工作/休息
    isBreak.value = !isBreak.value
    elapsedMs.value = 0
  }
  // 播放提示音（如果浏览器支持）
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.value = 0.3
    osc.start()
    osc.stop(ctx.currentTime + 0.3)
  } catch { /* ignore */ }
}

function start() {
  if (isRunning.value) return
  isRunning.value = true
  lastTick = Date.now()
  intervalId = setInterval(tick, 100)
}

function pause() {
  isRunning.value = false
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

function toggle() {
  if (isRunning.value) pause()
  else start()
}

function reset() {
  pause()
  elapsedMs.value = 0
  if (mode.value === 'pomodoro') {
    isBreak.value = false
  }
}

function switchMode(newMode: TimerMode) {
  pause()
  mode.value = newMode
  elapsedMs.value = 0
  isBreak.value = false
}

/* ── 切换模式时重置 ──────────────────────── */
watch(mode, () => {
  elapsedMs.value = 0
  isBreak.value = false
})

onBeforeUnmount(() => {
  pause()
})
</script>

<style scoped>
.timer-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 12px;
}

/* 模式切换 */
.timer-modes {
  display: flex;
  gap: 4px;
  background: var(--dash-panel-bg2);
  border-radius: 8px;
  padding: 4px;
}

.mode-btn {
  padding: 4px 12px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--dash-text-secondary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.mode-btn:hover {
  color: var(--dash-page-fg);
}

.mode-btn.active {
  background: var(--dash-window-bg);
  color: var(--dash-accent);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

/* 时间显示区 */
.timer-display {
  position: relative;
  width: 160px;
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.timer-ring {
  position: absolute;
  inset: 0;
  transform: rotate(-90deg);
}

.ring-bg {
  fill: none;
  stroke: var(--dash-border-lighter);
  stroke-width: 6;
}

.ring-progress {
  fill: none;
  stroke-width: 6;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.3s ease;
}

.timer-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  z-index: 1;
}

.timer-main {
  font-size: 32px;
  font-weight: 700;
  color: var(--dash-page-fg);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.timer-sub {
  font-size: 11px;
  color: var(--dash-text-secondary);
}

/* 控制按钮 */
.timer-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 设置弹窗内容 */
.timer-settings-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.timer-settings-body .row {
  display: flex;
  gap: 8px;
}

.timer-settings-body .col {
  flex: 1;
  min-width: 0;
}
</style>
