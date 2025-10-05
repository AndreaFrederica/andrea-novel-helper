/**
 * Circle Packing 可视化设置 Store
 */
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const useCirclePackingSettingsStore = defineStore('circlePackingSettings', () => {
  // 过滤设置
  const filterSensitiveRoles = ref(true) // 默认过滤敏感词类型的角色
  const minReferenceCount = ref(1) // 最小引用次数过滤（0表示不过滤）

  // 显示设置
  const showTimeSeriesCharts = ref(true) // 显示时间序列图表
  const chartHeight = ref(220) // 图表高度

  // 分页设置
  const pageSize = ref(20) // 每页显示的图表数量（0表示使用虚拟滚动）
  const currentPage = ref(1) // 当前页码

  // 气泡图设置
  const bubblePadding = ref(3) // 气泡间距
  const minLabelRadius = ref(26) // 最小标签显示半径

  // 加载设置
  function loadSettings() {
    try {
      const saved = localStorage.getItem('circlePackingSettings')
      if (saved) {
        const settings = JSON.parse(saved)
        if (typeof settings.filterSensitiveRoles === 'boolean') {
          filterSensitiveRoles.value = settings.filterSensitiveRoles
        }
        if (typeof settings.minReferenceCount === 'number') {
          minReferenceCount.value = settings.minReferenceCount
        }
        if (typeof settings.showTimeSeriesCharts === 'boolean') {
          showTimeSeriesCharts.value = settings.showTimeSeriesCharts
        }
        if (typeof settings.chartHeight === 'number') {
          chartHeight.value = settings.chartHeight
        }
        if (typeof settings.pageSize === 'number') {
          pageSize.value = settings.pageSize
        }
        if (typeof settings.bubblePadding === 'number') {
          bubblePadding.value = settings.bubblePadding
        }
        if (typeof settings.minLabelRadius === 'number') {
          minLabelRadius.value = settings.minLabelRadius
        }
      }
    } catch (error) {
      console.error('Failed to load circle packing settings:', error)
    }
  }

  // 保存设置
  function saveSettings() {
    try {
      const settings = {
        filterSensitiveRoles: filterSensitiveRoles.value,
        minReferenceCount: minReferenceCount.value,
        showTimeSeriesCharts: showTimeSeriesCharts.value,
        chartHeight: chartHeight.value,
        pageSize: pageSize.value,
        bubblePadding: bubblePadding.value,
        minLabelRadius: minLabelRadius.value,
      }
      localStorage.setItem('circlePackingSettings', JSON.stringify(settings))
    } catch (error) {
      console.error('Failed to save circle packing settings:', error)
    }
  }

  // 重置为默认设置
  function reset() {
    filterSensitiveRoles.value = true
    minReferenceCount.value = 0
    showTimeSeriesCharts.value = true
    chartHeight.value = 220
    pageSize.value = 20
    currentPage.value = 1
    bubblePadding.value = 3
    minLabelRadius.value = 26
    saveSettings()
  }

  // 初始化
  function init() {
    loadSettings()

    // 监听设置变化并自动保存（但不监听 currentPage，避免频繁保存）
    watch(
      [filterSensitiveRoles, minReferenceCount, showTimeSeriesCharts, chartHeight, pageSize, bubblePadding, minLabelRadius],
      () => {
        saveSettings()
      },
      { deep: true }
    )
  }

  return {
    // 状态
    filterSensitiveRoles,
    minReferenceCount,
    showTimeSeriesCharts,
    chartHeight,
    pageSize,
    currentPage,
    bubblePadding,
    minLabelRadius,

    // 方法
    loadSettings,
    saveSettings,
    reset,
    init,
  }
})
