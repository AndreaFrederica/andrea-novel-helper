<template>
  <div ref="chartRef" class="chart-container"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'

type DataPoint = [number | string, number] // [timestamp/file, count]

const props = defineProps<{
  title: string
  data: DataPoint[]
  color?: string
  height?: number
}>()

const chartRef = ref<HTMLDivElement | null>(null)
let chartInstance: echarts.ECharts | null = null

function initChart() {
  if (!chartRef.value) return

  chartInstance = echarts.init(chartRef.value)

  const option: echarts.EChartsOption = {
    title: {
      left: 'center',
      text: props.title,
      textStyle: {
        color: '#e5e7eb',
        fontSize: 14,
        fontWeight: 600
      }
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(17, 24, 39, 0.95)',
      borderColor: 'rgba(255,255,255,0.12)',
      textStyle: {
        color: '#e5e7eb'
      },
      formatter: (params: any) => {
        const param = params[0]
        return `${param.name}<br/>${param.seriesName}: ${param.value[1]}`
      }
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '10%',
      top: '15%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      axisLine: {
        lineStyle: { color: '#4b5563' }
      },
      axisLabel: {
        color: '#9ca3af',
        fontSize: 11
      }
    },
    yAxis: {
      type: 'value',
      boundaryGap: [0, '10%'],
      axisLine: {
        lineStyle: { color: '#4b5563' }
      },
      axisLabel: {
        color: '#9ca3af',
        fontSize: 11
      },
      splitLine: {
        lineStyle: {
          color: '#374151',
          type: 'dashed'
        }
      }
    },
    dataZoom: [
      {
        type: 'inside',
        start: 0,
        end: 100
      },
      {
        start: 0,
        end: 100,
        height: 20,
        bottom: 10,
        borderColor: '#4b5563',
        fillerColor: 'rgba(107, 114, 128, 0.2)',
        handleStyle: {
          color: '#6b7280'
        },
        textStyle: {
          color: '#9ca3af'
        }
      }
    ],
    series: [
      {
        name: '引用次数',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        sampling: 'lttb',
        itemStyle: {
          color: props.color || '#60a5fa'
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: props.color || '#60a5fa' },
            { offset: 1, color: 'rgba(96, 165, 250, 0.1)' }
          ])
        },
        data: props.data
      }
    ]
  }

  chartInstance.setOption(option)
}

function resizeChart() {
  chartInstance?.resize()
}

onMounted(() => {
  void nextTick(() => {
    initChart()
    window.addEventListener('resize', resizeChart)
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeChart)
  chartInstance?.dispose()
  chartInstance = null
})

watch(() => [props.data, props.title, props.color], () => {
  if (chartInstance) {
    initChart()
  }
}, { deep: true })
</script>

<style scoped>
.chart-container {
  width: 100%;
  height: 100%;
  min-height: 200px;
}
</style>
