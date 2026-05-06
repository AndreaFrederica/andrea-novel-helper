<template>
  <div class="clock-card" :class="[`align-${settings.align}`, `preset-${settings.preset}`]">
    <div class="clock-header">
      <div v-if="settings.showTitle" class="clock-title">
        <q-icon name="schedule" size="17px" />
        <span>{{ settings.title || '当前时间' }}</span>
      </div>
      <div class="clock-tools">
        <span v-if="settings.showPeriod" class="period">{{ dayPeriod }}</span>
        <q-btn dense flat round icon="settings" @click="settingsOpen = true">
          <q-tooltip>时钟设置</q-tooltip>
        </q-btn>
      </div>
    </div>

    <div v-if="settings.customLabel" class="custom-label">{{ settings.customLabel }}</div>

    <div v-if="settings.preset === 'analog'" class="analog-wrap" aria-label="模拟时钟">
      <div class="analog-face">
        <span v-for="mark in analogMarks" :key="mark" class="analog-mark" :style="analogMarkStyle(mark)" />
        <span class="hand hour-hand" :style="{ transform: `rotate(${hourDeg}deg)` }" />
        <span class="hand minute-hand" :style="{ transform: `rotate(${minuteDeg}deg)` }" />
        <span v-if="settings.showSeconds" class="hand second-hand" :style="{ transform: `rotate(${secondDeg}deg)` }" />
        <span class="pin" />
      </div>
    </div>

    <div class="clock-main">
      <span class="time">{{ timeText }}</span>
      <span v-if="settings.showSeconds" class="seconds">{{ secondsText }}</span>
    </div>

    <div v-if="settings.showDate || settings.showWeekday" class="date-row">
      <span v-if="settings.showDate">{{ dateText }}</span>
      <span v-if="settings.showWeekday">{{ weekdayText }}</span>
    </div>

    <div v-if="settings.showProgress" class="day-progress" :aria-label="`今日已过 ${dayProgress}%`">
      <span class="progress-fill" :style="{ width: `${dayProgress}%` }" />
    </div>

    <div class="clock-footer">
      <span v-if="settings.showTimezone">{{ timezoneText }}</span>
      <span v-if="settings.showProgress">今日 {{ dayProgress }}%</span>
    </div>

    <section v-if="extraClockRows.length" class="extra-clocks">
      <div v-for="clock in extraClockRows" :key="clock.id" class="extra-clock">
        <div class="extra-label">{{ clock.label }}</div>
        <div class="extra-time">{{ clock.time }}</div>
        <div class="extra-meta">
          <span>{{ clock.zoneLabel }}</span>
          <span v-if="clock.date">{{ clock.date }}</span>
        </div>
      </div>
    </section>

    <WindowModal
      v-model="settingsOpen"
      title="时钟设置"
      icon="schedule"
      modal-id="clock-settings"
      :width="520"
      modal
    >
        <div class="settings-body">
          <q-select
            dense
            outlined
            label="显示预设"
            :model-value="settings.preset"
            :options="presetOptions"
            emit-value
            map-options
            @update:model-value="applyPreset($event)"
          />
          <q-input dense outlined label="标题" :model-value="settings.title" @update:model-value="patch({ title: String($event) })" />
          <q-input dense outlined label="自定义文本" :model-value="settings.customLabel" @update:model-value="patch({ customLabel: String($event) })" />
          <q-select
            dense
            outlined
            label="主时区"
            :model-value="settings.timeZone"
            :options="timezoneOptions"
            emit-value
            map-options
            @update:model-value="patch({ timeZone: String($event) })"
          />
          <q-toggle :model-value="settings.showTitle" label="显示标题" @update:model-value="patch({ showTitle: !!$event })" />
          <q-toggle :model-value="settings.hour12" label="12 小时制" @update:model-value="patch({ hour12: !!$event })" />
          <q-toggle :model-value="settings.showSeconds" label="显示秒" @update:model-value="patch({ showSeconds: !!$event })" />
          <q-select
            dense
            outlined
            label="秒显示方式"
            :disable="!settings.showSeconds"
            :model-value="settings.secondsStyle"
            :options="secondsStyleOptions"
            emit-value
            map-options
            @update:model-value="patch({ secondsStyle: $event })"
          />
          <q-select
            dense
            outlined
            label="日期格式"
            :model-value="settings.dateStyle"
            :options="dateStyleOptions"
            emit-value
            map-options
            @update:model-value="patch({ dateStyle: $event })"
          />
          <q-select
            dense
            outlined
            label="对齐"
            :model-value="settings.align"
            :options="alignOptions"
            emit-value
            map-options
            @update:model-value="patch({ align: $event })"
          />
          <div class="toggle-grid">
            <q-toggle :model-value="settings.showDate" label="日期" @update:model-value="patch({ showDate: !!$event })" />
            <q-toggle :model-value="settings.showWeekday" label="星期" @update:model-value="patch({ showWeekday: !!$event })" />
            <q-toggle :model-value="settings.showPeriod" label="时段" @update:model-value="patch({ showPeriod: !!$event })" />
            <q-toggle :model-value="settings.showProgress" label="今日进度" @update:model-value="patch({ showProgress: !!$event })" />
            <q-toggle :model-value="settings.showTimezone" label="时区" @update:model-value="patch({ showTimezone: !!$event })" />
          </div>
          <q-separator />
          <div class="settings-subhead">
            <span>其他时区</span>
            <q-btn dense flat round icon="add" @click="addExtraClock">
              <q-tooltip>添加其他时钟</q-tooltip>
            </q-btn>
          </div>
          <div v-if="!settings.extraClocks.length" class="empty-extra">未添加其他时钟</div>
          <div v-for="clock in settings.extraClocks" :key="clock.id" class="extra-editor">
            <q-input
              dense
              outlined
              label="名称"
              :model-value="clock.label"
              @update:model-value="patchExtraClock(clock.id, { label: String($event) })"
            />
            <q-select
              dense
              outlined
              label="时区"
              :model-value="clock.timeZone"
              :options="extraTimezoneOptions"
              emit-value
              map-options
              @update:model-value="patchExtraClock(clock.id, { timeZone: String($event) })"
            />
            <q-toggle
              dense
              :model-value="clock.showDate"
              label="日期"
              @update:model-value="patchExtraClock(clock.id, { showDate: !!$event })"
            />
            <q-btn dense flat round icon="delete" color="negative" @click="removeExtraClock(clock.id)">
              <q-tooltip>删除时钟</q-tooltip>
            </q-btn>
          </div>
        </div>
    </WindowModal>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ClockExtraZone, ClockSettings } from '../sampleData'
import WindowModal from './WindowModal.vue'

const props = defineProps<{
  settings: ClockSettings
}>()

const emit = defineEmits<{
  'update:settings': [settings: ClockSettings]
}>()

const now = ref(new Date())
const settingsOpen = ref(false)
let timer: number | undefined

const analogMarks = Array.from({ length: 12 }, (_, index) => index)
const presetOptions = [
  { label: '标配', value: 'standard' },
  { label: '紧凑', value: 'compact' },
  { label: '极简', value: 'minimal' },
  { label: '模拟表盘', value: 'analog' }
]
const secondsStyleOptions = [
  { label: '0x秒', value: 'suffix' },
  { label: ':0x', value: 'colon' },
  { label: '0x', value: 'plain' }
]
const dateStyleOptions = [
  { label: '2026年5月6日', value: 'long' },
  { label: '2026/05/06', value: 'short' },
  { label: '05/06', value: 'numeric' }
]
const alignOptions = [
  { label: '居中', value: 'center' },
  { label: '左对齐', value: 'left' }
]
const namedTimezoneOptions = [
  { label: '上海 / 北京', value: 'Asia/Shanghai' },
  { label: 'UTC', value: 'UTC' },
  { label: '纽约', value: 'America/New_York' },
  { label: '伦敦', value: 'Europe/London' },
  { label: '东京', value: 'Asia/Tokyo' },
  { label: '悉尼', value: 'Australia/Sydney' },
  { label: '洛杉矶', value: 'America/Los_Angeles' },
  { label: '巴黎', value: 'Europe/Paris' },
  { label: '新加坡', value: 'Asia/Singapore' }
]
const fixedUtcOptions = Array.from({ length: 27 }, (_, index) => {
  const offset = index - 12
  const value = formatUtcOffsetValue(offset * 60)
  return {
    label: `${value} 固定偏移`,
    value
  }
})
const timezoneOptions = computed(() => [
  { label: `系统本地 (${systemUtcOffsetText()})`, value: '' },
  ...namedTimezoneOptions.map(option => ({
    label: `${option.label} (${timezoneUtcOffsetText(option.value)})`,
    value: option.value
  })),
  ...fixedUtcOptions
])
const extraTimezoneOptions = computed(() => timezoneOptions.value.filter(option => option.value))

const zonedNow = computed(() => getZonedDateParts(now.value, props.settings.timeZone))
const timeText = computed(() => formatTime(now.value, props.settings.timeZone, props.settings.hour12, false))
const secondsText = computed(() => {
  const seconds = String(zonedNow.value.second).padStart(2, '0')
  if (props.settings.secondsStyle === 'colon') return `:${seconds}`
  if (props.settings.secondsStyle === 'plain') return seconds
  return `${seconds}秒`
})
const dateText = computed(() => formatDate(now.value, props.settings.timeZone, props.settings.dateStyle))
const weekdayText = computed(() => safeLocaleDate(now.value, props.settings.timeZone, {
  weekday: 'long',
}))
const dayPeriod = computed(() => {
  const hour = zonedNow.value.hour
  if (hour < 5) return '深夜'
  if (hour < 11) return '上午'
  if (hour < 14) return '中午'
  if (hour < 18) return '下午'
  return '夜间'
})
const dayProgress = computed(() => {
  const d = zonedNow.value
  const elapsed = d.hour * 3600 + d.minute * 60 + d.second
  return Math.min(100, Math.max(0, Math.round((elapsed / 86400) * 100)))
})
const timezoneText = computed(() => getTimezoneLabel(props.settings.timeZone))
const hourDeg = computed(() => ((zonedNow.value.hour % 12) + zonedNow.value.minute / 60) * 30)
const minuteDeg = computed(() => (zonedNow.value.minute + zonedNow.value.second / 60) * 6)
const secondDeg = computed(() => zonedNow.value.second * 6)
const extraClockRows = computed(() => props.settings.extraClocks.map(clock => ({
  id: clock.id,
  label: clock.label || '其他时区',
  zoneLabel: getTimezoneLabel(clock.timeZone),
  time: formatTime(now.value, clock.timeZone, props.settings.hour12, props.settings.showSeconds),
  date: clock.showDate ? formatDate(now.value, clock.timeZone, 'short') : '',
})))

function formatTime(value: Date, timeZone: string, hour12: boolean, includeSeconds: boolean) {
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hour12
  }
  if (includeSeconds) options.second = '2-digit'
  return safeLocaleTime(value, timeZone, options)
}

function formatDate(value: Date, timeZone: string, style: ClockSettings['dateStyle']) {
  if (style === 'short') {
    return safeLocaleDate(value, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' })
  }
  if (style === 'numeric') {
    return safeLocaleDate(value, timeZone, { month: '2-digit', day: '2-digit' })
  }
  return safeLocaleDate(value, timeZone, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function safeLocaleTime(value: Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return safeLocale(value, timeZone, options, true)
}

function safeLocaleDate(value: Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return safeLocale(value, timeZone, options, false)
}

function safeLocale(value: Date, timeZone: string, options: Intl.DateTimeFormatOptions, timeOnly: boolean) {
  const fixedOffset = parseFixedUtcOffset(timeZone)
  try {
    if (fixedOffset !== null) {
      const shifted = new Date(value.getTime() + fixedOffset * 60_000)
      const merged = { ...options, timeZone: 'UTC' }
      return timeOnly ? shifted.toLocaleTimeString('zh-CN', merged) : shifted.toLocaleDateString('zh-CN', merged)
    }
    const merged = timeZone ? { ...options, timeZone } : options
    return timeOnly ? value.toLocaleTimeString('zh-CN', merged) : value.toLocaleDateString('zh-CN', merged)
  } catch {
    return timeOnly ? value.toLocaleTimeString('zh-CN', options) : value.toLocaleDateString('zh-CN', options)
  }
}

function getZonedDateParts(value: Date, timeZone: string) {
  const fixedOffset = parseFixedUtcOffset(timeZone)
  if (fixedOffset !== null) {
    const shifted = new Date(value.getTime() + fixedOffset * 60_000)
    return {
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds(),
    }
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(value)
    const read = (type: string) => Number(parts.find(part => part.type === type)?.value || 0)
    const hour = read('hour')
    return {
      hour: hour === 24 ? 0 : hour,
      minute: read('minute'),
      second: read('second'),
    }
  } catch {
    return {
      hour: value.getHours(),
      minute: value.getMinutes(),
      second: value.getSeconds(),
    }
  }
}

function getTimezoneLabel(timeZone: string) {
  if (!timeZone) return `系统本地 (${systemUtcOffsetText()})`
  const fixedOffset = parseFixedUtcOffset(timeZone)
  if (fixedOffset !== null) return formatUtcOffsetValue(fixedOffset)
  const known = namedTimezoneOptions.find(option => option.value === timeZone)
  const offset = timezoneUtcOffsetText(timeZone)
  return known ? `${known.label} (${offset})` : `${timeZone} (${offset})`
}

function systemUtcOffsetText() {
  const offsetMinutes = -now.value.getTimezoneOffset()
  return formatUtcOffsetValue(offsetMinutes)
}

function timezoneUtcOffsetText(timeZone: string) {
  const fixedOffset = parseFixedUtcOffset(timeZone)
  if (fixedOffset !== null) return formatUtcOffsetValue(fixedOffset)
  if (timeZone === 'UTC') return 'UTC+00:00'
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(now.value)
    const read = (type: string) => Number(parts.find(part => part.type === type)?.value || 0)
    const zonedAsUtc = Date.UTC(read('year'), read('month') - 1, read('day'), normalizeIntlHour(read('hour')), read('minute'), read('second'))
    const offsetMinutes = Math.round((zonedAsUtc - now.value.getTime()) / 60_000)
    return formatUtcOffsetValue(offsetMinutes)
  } catch {
    return 'UTC?'
  }
}

function normalizeIntlHour(hour: number) {
  return hour === 24 ? 0 : hour
}

function formatUtcOffsetValue(offsetMinutes: number) {
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const h = String(Math.floor(abs / 60)).padStart(2, '0')
  const m = String(abs % 60).padStart(2, '0')
  return `UTC${sign}${h}:${m}`
}

function parseFixedUtcOffset(value: string) {
  if (!value || value === 'UTC') return value === 'UTC' ? 0 : null
  const match = /^UTC([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[2])
  const minutes = Number(match[3] || 0)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 14 || minutes >= 60) return null
  const total = hours * 60 + minutes
  return match[1] === '-' ? -total : total
}

function patch(patchValue: Partial<ClockSettings>) {
  emit('update:settings', { ...props.settings, ...patchValue })
}

function applyPreset(value: ClockSettings['preset']) {
  const presetPatch: Record<ClockSettings['preset'], Partial<ClockSettings>> = {
    standard: { preset: value, showTitle: true, showDate: true, showWeekday: true, showPeriod: true, showProgress: true, showTimezone: true, showSeconds: true },
    compact: { preset: value, showTitle: true, showDate: true, showWeekday: false, showPeriod: false, showProgress: false, showTimezone: true, showSeconds: true },
    minimal: { preset: value, showTitle: false, showDate: false, showWeekday: false, showPeriod: false, showProgress: false, showTimezone: false, showSeconds: false },
    analog: { preset: value, showTitle: true, showDate: true, showWeekday: true, showPeriod: false, showProgress: false, showTimezone: true, showSeconds: true },
  }
  patch(presetPatch[value] || { preset: 'standard' })
}

function addExtraClock() {
  const candidates = [
    { label: '东京', timeZone: 'Asia/Tokyo' },
    { label: '纽约', timeZone: 'America/New_York' },
    { label: '伦敦', timeZone: 'Europe/London' },
    { label: 'UTC', timeZone: 'UTC' },
  ]
  const existing = new Set(props.settings.extraClocks.map(clock => clock.timeZone))
  const next = candidates.find(item => !existing.has(item.timeZone)) || { label: '其他时区', timeZone: 'UTC' }
  patch({
    extraClocks: [
      ...props.settings.extraClocks,
      {
        id: `clock-zone-${Date.now()}`,
        label: next.label,
        timeZone: next.timeZone,
        showDate: true,
      }
    ]
  })
}

function patchExtraClock(id: string, patchValue: Partial<ClockExtraZone>) {
  patch({
    extraClocks: props.settings.extraClocks.map(clock => clock.id === id ? { ...clock, ...patchValue } : clock)
  })
}

function removeExtraClock(id: string) {
  patch({ extraClocks: props.settings.extraClocks.filter(clock => clock.id !== id) })
}

function analogMarkStyle(index: number) {
  return { transform: `rotate(${index * 30}deg) translateY(-46%)` }
}

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
  gap: 12px;
  padding: 8px;
  color: var(--dash-page-fg);
  overflow: hidden;
}

.clock-card.align-left {
  align-items: stretch;
}

.clock-card.align-center {
  align-items: stretch;
}

.clock-card.preset-compact {
  gap: 8px;
}

.clock-card.preset-minimal {
  gap: 6px;
}

.clock-card.preset-analog {
  justify-content: flex-start;
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

.clock-title,
.clock-tools {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.clock-title {
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

.custom-label {
  color: var(--dash-text-secondary);
  font-size: 12px;
}

.clock-main {
  min-width: 0;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
}

.preset-analog .clock-main {
  justify-content: center;
}

.align-left .clock-main {
  justify-content: flex-start;
}

.time {
  color: var(--dash-accent-light);
  font-size: clamp(38px, 17cqw, 68px);
  line-height: 1;
  font-weight: 800;
  letter-spacing: 0;
  font-variant-numeric: tabular-nums;
}

.preset-compact .time {
  font-size: clamp(32px, 14cqw, 52px);
}

.preset-minimal .time {
  font-size: clamp(44px, 20cqw, 82px);
}

.preset-analog .time {
  font-size: clamp(22px, 9cqw, 34px);
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
  min-height: 16px;
  color: var(--dash-text-muted2);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.analog-wrap {
  display: flex;
  justify-content: center;
  min-height: 0;
}

.analog-face {
  position: relative;
  width: min(128px, 56cqw, 34vh);
  aspect-ratio: 1;
  border: 2px solid color-mix(in srgb, var(--dash-accent-light) 72%, transparent);
  border-radius: 50%;
  background:
    radial-gradient(circle at center, color-mix(in srgb, var(--dash-accent) 20%, transparent) 0 5%, transparent 6%),
    color-mix(in srgb, var(--dash-window-bg) 86%, transparent);
  box-shadow: inset 0 0 0 6px color-mix(in srgb, var(--dash-page-fg) 5%, transparent);
}

.analog-mark {
  position: absolute;
  left: calc(50% - 1px);
  top: 7px;
  width: 2px;
  height: 10px;
  border-radius: 999px;
  transform-origin: 1px calc(50cqw - 7px);
  background: color-mix(in srgb, var(--dash-page-fg) 45%, transparent);
}

.hand {
  position: absolute;
  left: calc(50% - 1px);
  bottom: 50%;
  width: 2px;
  border-radius: 999px;
  transform-origin: 50% 100%;
  background: var(--dash-page-fg);
}

.hour-hand {
  height: 27%;
  width: 4px;
  left: calc(50% - 2px);
}

.minute-hand {
  height: 38%;
  background: var(--dash-accent-light);
}

.second-hand {
  height: 42%;
  width: 1px;
  left: calc(50% - 0.5px);
  background: #ef4444;
}

.pin {
  position: absolute;
  left: calc(50% - 5px);
  top: calc(50% - 5px);
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--dash-accent-light);
}

.extra-clocks {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
  gap: 8px;
  overflow: auto;
}

.extra-clock {
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--dash-window-border);
  border-radius: 8px;
  background: var(--dash-panel-bg2);
}

.extra-label {
  color: var(--dash-title-fg);
  font-size: 12px;
  font-weight: 700;
}

.extra-time {
  margin-top: 2px;
  color: var(--dash-accent-light);
  font-size: 20px;
  font-weight: 800;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.extra-meta {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  margin-top: 4px;
  color: var(--dash-text-muted2);
  font-size: 11px;
}

.clock-settings {
  width: min(520px, 92vw);
}

.settings-body {
  display: grid;
  gap: 12px;
  max-height: min(70vh, 680px);
  overflow: auto;
}

.toggle-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 10px;
}

.settings-subhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--dash-title-fg);
  font-size: 13px;
  font-weight: 700;
}

.empty-extra {
  padding: 10px;
  border: 1px dashed var(--dash-window-border);
  border-radius: 8px;
  color: var(--dash-text-muted2);
  font-size: 12px;
}

.extra-editor {
  display: grid;
  grid-template-columns: minmax(90px, 0.8fr) minmax(140px, 1fr) auto auto;
  align-items: center;
  gap: 8px;
}

@container (max-width: 260px) {
  .date-row,
  .clock-footer {
    align-items: flex-start;
    flex-direction: column;
    gap: 3px;
  }

  .extra-editor {
    grid-template-columns: 1fr;
  }
}
</style>
