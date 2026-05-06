<template>
  <div class="writing-heatmap">
    <div class="toolbar">
      <div>
        <strong>{{ selectedYear }} 年</strong>
        <span>{{ summaryText }}</span>
      </div>
      <div class="actions">
        <q-btn dense flat round size="sm" icon="chevron_left" @click="yearOffset -= 1">
          <q-tooltip>上一年</q-tooltip>
        </q-btn>
        <q-btn dense flat round size="sm" icon="today" @click="yearOffset = 0">
          <q-tooltip>回到今年</q-tooltip>
        </q-btn>
        <q-btn dense flat round size="sm" icon="chevron_right" @click="yearOffset += 1">
          <q-tooltip>下一年</q-tooltip>
        </q-btn>
      </div>
    </div>

    <div class="heatmap-scroll">
      <div
        class="heatmap-grid"
        :style="gridStyle"
        @mouseleave="hovered = null"
      >
        <div class="corner" />
        <div
          v-for="month in monthLabels"
          :key="month.key"
          class="month-label"
          :style="{ gridColumn: String(month.column), gridRow: '1' }"
        >
          {{ month.label }}
        </div>
        <div
          v-for="label in weekdayLabels"
          :key="label.row"
          class="weekday-label"
          :style="{ gridColumn: '1', gridRow: String(label.row + 2) }"
        >
          {{ label.text }}
        </div>
        <div
          v-for="cell in cells"
          :key="cell.key"
          :class="['day-cell', { today: cell.isToday, 'out-year': !cell.inYear }]"
          :style="cellStyle(cell)"
          @mouseenter="hovered = cell"
        />
      </div>
    </div>

    <div v-if="hovered?.inYear" class="detail">
      <span>{{ hovered.label }}</span>
      <strong>{{ hovered.value > 0 ? `${hovered.value.toLocaleString()} 字` : '无记录' }}</strong>
    </div>
    <div v-else class="detail muted">
      <span>悬停日期查看明细</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { getVSCodeVar } from '../useDashboardTheme'

type HeatmapCell = {
  key: string
  date: Date
  label: string
  value: number
  week: number
  weekday: number
  inYear: boolean
  isToday: boolean
}

const props = defineProps<{
  data: Array<[string, number]>
}>()

const yearOffset = ref(0)
const hovered = ref<HeatmapCell | null>(null)

const msDay = 24 * 60 * 60 * 1000
const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
const weekdayLabels = [
  { row: 0, text: '一' },
  { row: 2, text: '三' },
  { row: 4, text: '五' },
  { row: 6, text: '日' }
]

const selectedYear = computed(() => new Date().getFullYear() + yearOffset.value)

const valueByDay = computed(() => {
  const map = new Map<string, number>()
  for (const [date, rawValue] of props.data) {
    const value = Number(rawValue)
    if (!date || !Number.isFinite(value) || value <= 0) continue
    map.set(date, (map.get(date) || 0) + Math.round(value))
  }
  return map
})

const yearStart = computed(() => new Date(selectedYear.value, 0, 1))
const gridStart = computed(() => {
  const start = yearStart.value
  const mondayBasedWeekday = (start.getDay() + 6) % 7
  return new Date(start.getTime() - mondayBasedWeekday * msDay)
})

const totalWeeks = computed(() => {
  const end = new Date(selectedYear.value, 11, 31)
  const days = Math.floor((end.getTime() - gridStart.value.getTime()) / msDay) + 1
  return Math.ceil(days / 7)
})

const cells = computed<HeatmapCell[]>(() => {
  const todayKey = formatDate(new Date())
  const result: HeatmapCell[] = []
  for (let week = 0; week < totalWeeks.value; week += 1) {
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = new Date(gridStart.value.getTime() + (week * 7 + weekday) * msDay)
      const key = formatDate(date)
      const inYear = date.getFullYear() === selectedYear.value
      result.push({
        key,
        date,
        label: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
        value: inYear ? valueByDay.value.get(key) || 0 : 0,
        week,
        weekday,
        inYear,
        isToday: key === todayKey
      })
    }
  }
  return result
})

const monthLabels = computed(() => {
  const labels: Array<{ key: string; label: string; column: number }> = []
  let lastMonth = -1
  for (let week = 0; week < totalWeeks.value; week += 1) {
    const weekStart = new Date(gridStart.value.getTime() + week * 7 * msDay)
    const month = weekStart.getMonth()
    if (weekStart.getFullYear() === selectedYear.value && month !== lastMonth) {
      lastMonth = month
      labels.push({
        key: `${selectedYear.value}-${month}`,
        label: monthNames[month] || '',
        column: week + 2
      })
    }
  }
  return labels
})

const maxValue = computed(() => Math.max(1, ...cells.value.filter(cell => cell.inYear).map(cell => cell.value)))

const summary = computed(() => {
  let days = 0
  let total = 0
  for (const cell of cells.value) {
    if (!cell.inYear || cell.value <= 0) continue
    days += 1
    total += cell.value
  }
  return { days, total }
})

const summaryText = computed(() => {
  const total = summary.value.total >= 10000
    ? `${(summary.value.total / 10000).toFixed(1)} 万字`
    : `${summary.value.total.toLocaleString()} 字`
  return `${summary.value.days} 天 · ${total}`
})

const gridStyle = computed(() => ({
  gridTemplateColumns: `18px repeat(${totalWeeks.value}, 13px)`,
  gridTemplateRows: '14px repeat(7, 13px)'
}))

function cellStyle(cell: HeatmapCell) {
  return {
    gridColumn: String(cell.week + 2),
    gridRow: String(cell.weekday + 2),
    background: cell.inYear ? cellColor(cell.value) : 'transparent'
  }
}

function cellColor(value: number) {
  if (value <= 0) {
    return getVSCodeVar('--vscode-editorWidget-background', 'rgba(128,128,128,0.12)')
  }
  const base = parseCssColor(getVSCodeVar('--vscode-charts-blue', '#66aaff')) || { r: 102, g: 170, b: 255 }
  const ratio = Math.min(1, value / maxValue.value)
  const alpha = 0.2 + 0.72 * Math.sqrt(ratio)
  return `rgba(${base.r}, ${base.g}, ${base.b}, ${alpha.toFixed(3)})`
}

function formatDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

function parseCssColor(value: string): { r: number; g: number; b: number } | null {
  const trimmed = value.trim()
  const hex = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(trimmed)
  if (hex) {
    return {
      r: parseInt(hex[1] || '00', 16),
      g: parseInt(hex[2] || '00', 16),
      b: parseInt(hex[3] || '00', 16)
    }
  }
  const rgb = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(trimmed)
  return rgb ? { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) } : null
}
</script>

<style scoped>
.writing-heatmap {
  height: 100%;
  min-height: 120px;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 8px;
  color: var(--dash-page-fg);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.toolbar > div:first-child {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.toolbar strong {
  color: var(--dash-accent);
  font-size: 13px;
  line-height: 1.1;
}

.toolbar span,
.detail {
  color: var(--dash-text-muted2);
  font-size: 11px;
}

.actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
}

.heatmap-scroll {
  min-height: 0;
  overflow: auto hidden;
  padding: 2px 0 4px;
}

.heatmap-grid {
  width: max-content;
  display: grid;
  grid-auto-flow: column;
  gap: 3px;
  align-content: start;
}

.corner {
  grid-column: 1;
  grid-row: 1;
}

.month-label {
  grid-row: 1;
  align-self: end;
  color: var(--dash-text-muted2);
  font-size: 10px;
  line-height: 1;
  white-space: nowrap;
}

.weekday-label {
  grid-column: 1;
  align-self: center;
  justify-self: end;
  padding-right: 3px;
  color: var(--dash-text-muted2);
  font-size: 9px;
  line-height: 1;
}

.day-cell {
  width: 13px;
  height: 13px;
  border-radius: 3px;
  border: 1px solid var(--dash-panel-border);
  transition: transform 0.1s ease, border-color 0.1s ease;
}

.day-cell:not(.out-year):hover {
  transform: scale(1.28);
  border-color: var(--dash-accent);
  z-index: 2;
}

.day-cell.today {
  outline: 1.5px solid var(--dash-accent);
  outline-offset: 1px;
}

.day-cell.out-year {
  border-color: transparent;
}

.detail {
  min-height: 18px;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  border-top: 1px solid var(--dash-panel-border);
  padding-top: 5px;
}

.detail strong {
  color: var(--dash-accent);
  font-weight: 700;
}

.detail.muted {
  justify-content: flex-start;
}
</style>
