<template>
  <div class="clock-card">
    <div class="clock-header">
      <div class="clock-title">
        <q-icon name="schedule" size="17px" />
        <span>当前时间</span>
      </div>
      <span class="period">{{ dayPeriod }}</span>
    </div>

    <div class="clock-main">
      <span class="time">{{ timeText }}</span>
      <span class="seconds">{{ secondsText }}</span>
    </div>

    <div class="date-row">
      <span>{{ dateText }}</span>
      <span>{{ weekdayText }}</span>
    </div>

    <div class="day-progress" :aria-label="`今日已过 ${dayProgress}%`">
      <span class="progress-fill" :style="{ width: `${dayProgress}%` }" />
    </div>

    <div class="clock-footer">
      <span>{{ timezoneText }}</span>
      <span>今日 {{ dayProgress }}%</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const now = ref(new Date())
let timer: number | undefined

const timeText = computed(() => now.value.toLocaleTimeString('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
}))

const secondsText = computed(() => now.value.toLocaleTimeString('zh-CN', {
  second: '2-digit',
}))

const dateText = computed(() => now.value.toLocaleDateString('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
}))

const weekdayText = computed(() => now.value.toLocaleDateString('zh-CN', {
  weekday: 'long',
}))

const dayPeriod = computed(() => {
  const hour = now.value.getHours()
  if (hour < 5) return '深夜'
  if (hour < 11) return '上午'
  if (hour < 14) return '中午'
  if (hour < 18) return '下午'
  return '夜间'
})

const dayProgress = computed(() => {
  const d = now.value
  const elapsed = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
  return Math.min(100, Math.max(0, Math.round((elapsed / 86400) * 100)))
})

const timezoneText = computed(() => {
  const offsetMinutes = -now.value.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const h = String(Math.floor(abs / 60)).padStart(2, '0')
  const m = String(abs % 60).padStart(2, '0')
  return `UTC${sign}${h}:${m}`
})

onMounted(() => {
  timer = window.setInterval(() => {
    now.value = new Date()
  }, 1000)
})

onBeforeUnmount(() => {
  if (timer !== undefined) window.clearInterval(timer)
})
</script>

<style scoped>
.clock-card {
  container-type: inline-size;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
  padding: 8px;
  color: var(--dash-page-fg);
}

.clock-header,
.clock-footer,
.date-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.clock-header {
  font-size: 13px;
  color: var(--dash-text-secondary);
}

.clock-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  color: var(--dash-title-fg);
}

.period {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--dash-accent-light);
  background: color-mix(in srgb, var(--dash-accent) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--dash-accent) 28%, transparent);
  font-size: 12px;
}

.clock-main {
  min-width: 0;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
}

.time {
  color: var(--dash-accent-light);
  font-size: clamp(38px, 17cqw, 68px);
  line-height: 1;
  font-weight: 800;
  letter-spacing: 0;
  font-variant-numeric: tabular-nums;
}

.seconds {
  color: var(--dash-text-secondary);
  font-size: clamp(18px, 6cqw, 28px);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.date-row {
  color: var(--dash-text-secondary);
  font-size: 13px;
}

.day-progress {
  position: relative;
  width: 100%;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dash-page-fg) 10%, transparent);
}

.progress-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--dash-accent), var(--dash-accent-light));
}

.clock-footer {
  color: var(--dash-text-muted2);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

@container (max-width: 260px) {
  .date-row,
  .clock-footer {
    align-items: flex-start;
    flex-direction: column;
    gap: 3px;
  }
}
</style>
