<template>
  <div ref="chartRef" class="chart"></div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { useDashboardTheme, getVSCodeVar } from '../useDashboardTheme'

const props = defineProps<{
  data: Array<[string, number]>
}>()

const chartRef = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null
const { isDark } = useDashboardTheme()

function renderChart() {
  if (!chartRef.value) return
  chart ??= echarts.init(chartRef.value)
  const fg = getVSCodeVar('--vscode-foreground', isDark.value ? '#a0a0a0' : '#897889')
  const bg = getVSCodeVar('--vscode-editor-background', isDark.value ? '#1e1e1e' : '#ffffff')
  chart.setOption({
    tooltip: {
      formatter: (param: { value: [string, number] }) => `${param.value[0]}<br/>活跃度 ${param.value[1]}`
    },
    visualMap: {
      show: false,
      min: 0,
      max: 18,
      inRange: {
        color: isDark.value
          ? ['#2a2540', '#4a4480', '#6a64b0', '#8a84e0']
          : ['#f2eef8', '#cfc7f3', '#9587de', '#6250b8']
      }
    },
    calendar: {
      top: 12,
      left: 14,
      right: 14,
      bottom: 10,
      range: ['2026-01-01', '2026-05-31'],
      cellSize: ['auto', 11],
      splitLine: { show: false },
      itemStyle: { borderColor: bg, borderWidth: 2 },
      yearLabel: { show: false },
      monthLabel: { color: fg, fontSize: 10 },
      dayLabel: { show: false }
    },
    series: [{
      type: 'heatmap',
      coordinateSystem: 'calendar',
      data: props.data
    }]
  })
}

function resize() {
  chart?.resize()
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

watch(() => props.data, renderChart, { deep: true })
watch(isDark, renderChart)
</script>

<style scoped>
.chart {
  width: 100%;
  height: 100%;
  min-height: 120px;
}
</style>
