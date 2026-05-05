<template>
  <div class="energy-editor">
    <div ref="chartRef" class="chart"></div>
    <div class="controls">
      <label v-for="metric in metrics" :key="metric.key">
        <span>{{ metric.label }}</span>
        <q-slider
          dense
          :model-value="metric.value"
          :min="0"
          :max="50"
          :step="1"
          :color="metric.color"
          @update:model-value="updateMetric(metric.key, Number($event))"
        />
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import type { EnergyMetric } from '../sampleData'
import { useDashboardTheme, getVSCodeVar } from '../useDashboardTheme'

const props = defineProps<{
  metrics: EnergyMetric[]
}>()
const emit = defineEmits<{
  'update:metrics': [metrics: EnergyMetric[]]
}>()

const chartRef = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null
const { isDark } = useDashboardTheme()

function renderChart() {
  if (!chartRef.value) return
  chart ??= echarts.init(chartRef.value)
  const fg = getVSCodeVar('--vscode-foreground', isDark.value ? '#a0a0a0' : '#6f6370')
  const axisLine = getVSCodeVar('--vscode-panel-border', isDark.value ? 'rgba(255,255,255,0.08)' : '#ead9e6')
  const splitLine = getVSCodeVar('--vscode-panel-border', isDark.value ? 'rgba(255,255,255,0.08)' : '#f0e5ef')
  chart.setOption({
    grid: { left: 36, right: 18, top: 24, bottom: 36 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: props.metrics.map(item => item.label),
      axisTick: { show: false },
      axisLabel: { color: fg, fontSize: 11 },
      axisLine: { lineStyle: { color: axisLine } }
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 50,
      splitLine: { lineStyle: { color: splitLine } },
      axisLabel: { color: getVSCodeVar('--vscode-foreground', isDark.value ? '#a0a0a0' : '#8a7d89'), fontSize: 11 }
    },
    series: [{
      type: 'bar',
      barWidth: 42,
      data: props.metrics.map(item => ({
        value: item.value,
        itemStyle: { color: item.color, borderRadius: [3, 3, 0, 0] }
      })),
      label: {
        show: true,
        position: 'top',
        color: fg,
        formatter: ({ value }: { value: number }) => String(value)
      }
    }]
  })
}

function resize() {
  chart?.resize()
}

function updateMetric(key: string, value: number) {
  emit('update:metrics', props.metrics.map(metric => metric.key === key ? { ...metric, value } : metric))
}

onMounted(() => {
  void nextTick(() => {
    renderChart()
    window.addEventListener('resize', resize)
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  chart?.dispose()
  chart = null
})

watch(() => props.metrics, renderChart, { deep: true })
watch(isDark, renderChart)
</script>

<style scoped>
.energy-editor {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-rows: minmax(100px, 1fr) auto;
  gap: 8px;
}

.chart {
  width: 100%;
  height: 100%;
  min-height: 120px;
}

.controls {
  display: grid;
  gap: 4px;
}

label {
  display: grid;
  grid-template-columns: 78px 1fr;
  align-items: center;
  gap: 8px;
  color: var(--dash-text-muted);
  font-size: 12px;
}
</style>
