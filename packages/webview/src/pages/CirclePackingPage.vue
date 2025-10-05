<template>
  <q-layout view="hHh lpR fFf" class="circle-packing-layout">
    <!-- 设置抽屉 -->
    <q-drawer
      v-model="settingsDrawerOpen"
      side="right"
      overlay
      bordered
      :width="320"
      class="settings-drawer"
    >
      <q-scroll-area class="fit">
        <div class="q-pa-md">
          <div class="text-h6 q-mb-md flex items-center justify-between">
            <span>设置</span>
            <q-btn
              flat
              round
              dense
              icon="close"
              @click="settingsDrawerOpen = false"
            />
          </div>
          <CirclePackingSettings
            @refresh="loadData"
            @export="exportData"
          />
        </div>
      </q-scroll-area>
    </q-drawer>

    <!-- 主内容区 -->
    <q-page-container>
      <q-page class="page-wrapper">
        <!-- 设置按钮 -->
        <q-btn
          v-if="!settingsDrawerOpen"
          fab
          icon="settings"
          color="primary"
          class="fixed-settings-btn"
          @click="settingsDrawerOpen = true"
        >
          <q-tooltip>设置</q-tooltip>
        </q-btn>

        <!-- 加载状态 -->
        <div v-if="loading" class="loading-overlay">
          <q-spinner-gears size="50px" color="primary" />
          <div class="q-mt-md text-white">加载数据中...</div>
        </div>

        <div class="circle-packing-container">
      <CirclePackingFlat
        :items="filteredItems"
        :padding="settingsStore.bubblePadding"
        :minLabelRadius="settingsStore.minLabelRadius"
        @nodeClick="onNodeClick"
        @nodeHover="onNodeHover"
      />
    </div>

    <!-- 时间序列图表区域 -->
    <div v-if="settingsStore.showTimeSeriesCharts" class="charts-section">
      <div class="section-header">
        <h2>{{ getChartSectionTitle() }}</h2>
        <p class="subtitle">
          {{ getChartSectionSubtitle() }}
          <span class="text-caption q-ml-sm">
            (共 {{ filteredItems.length }} 个角色{{ settingsStore.pageSize > 0 ? `, 当前第 ${settingsStore.currentPage}/${totalPages} 页` : '' }})
          </span>
        </p>
      </div>

      <!-- 使用虚拟滚动（当 pageSize = 0 时） -->
      <div v-if="settingsStore.pageSize === 0" class="charts-virtual-scroll">
        <q-virtual-scroll
          :items="displayedChartItems"
          virtual-scroll-item-size="280"
          virtual-scroll-slice-size="10"
          class="virtual-scroll-container"
        >
          <template v-slot="{ item }">
            <div
              :key="item.id"
              :data-item-id="item.id"
              class="chart-card q-ma-md"
            >
              <TimeSeriesChart
                :title="item.label"
                :data="item.timeSeriesData || []"
                :color="getColorForItem(item)"
                :height="settingsStore.chartHeight"
              />
            </div>
          </template>
        </q-virtual-scroll>
      </div>

      <!-- 使用分页（当 pageSize > 0 时） -->
      <template v-else>
        <div class="charts-grid">
          <div
            v-for="item in displayedChartItems"
            :key="item.id"
            :data-item-id="item.id"
            class="chart-card"
          >
            <TimeSeriesChart
              :title="item.label"
              :data="item.timeSeriesData || []"
              :color="getColorForItem(item)"
              :height="settingsStore.chartHeight"
            />
          </div>
        </div>

        <!-- 分页控件 -->
        <div v-if="totalPages > 1" class="pagination-container">
          <q-pagination
            v-model="settingsStore.currentPage"
            :max="totalPages"
            :max-pages="7"
            direction-links
            boundary-links
            color="primary"
            @update:model-value="scrollToTop"
          />
        </div>
      </template>
    </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { Notify } from 'quasar'
import CirclePackingFlat from 'components/CirclePackingFlat.vue'
import TimeSeriesChart from 'components/TimeSeriesChart.vue'
import CirclePackingSettings from 'components/CirclePackingSettings.vue'
import type { CompleteItem, TimeSeriesDataPoint } from '../types/dataSchema'
import { getColorForItem } from '../data/circlePackingDefaultData'
import { useCirclePackingSettingsStore } from '../stores/circle-packing-settings'
import { useVsCodeApiStore } from '../stores/vscode'

// Stores
const settingsStore = useCirclePackingSettingsStore()
const vsCodeApiStore = useVsCodeApiStore()

// 状态
const items = ref<CompleteItem[]>([])
const loading = ref(false)
const settingsDrawerOpen = ref(false)

// 过滤后的数据（应用敏感词过滤和引用次数过滤）
const filteredItems = computed(() => {
  let filtered = items.value

  // 应用敏感词过滤
  if (settingsStore.filterSensitiveRoles) {
    filtered = filtered.filter(item => {
      const group = item.group?.toLowerCase() || ''
      return group !== '敏感词' && group !== 'sensitive'
    })
  }

  // 应用最小引用次数过滤
  if (settingsStore.minReferenceCount > 0) {
    filtered = filtered.filter(item => item.count >= settingsStore.minReferenceCount)
  }

  return filtered
})

// 分页相关计算
const totalPages = computed(() => {
  if (settingsStore.pageSize === 0) return 1
  return Math.ceil(filteredItems.value.length / settingsStore.pageSize)
})

// 当前页显示的图表项
const displayedChartItems = computed(() => {
  // 如果分页大小为0，使用虚拟滚动，返回所有项
  if (settingsStore.pageSize === 0) {
    return filteredItems.value
  }

  // 否则使用分页
  const start = (settingsStore.currentPage - 1) * settingsStore.pageSize
  const end = start + settingsStore.pageSize
  return filteredItems.value.slice(start, end)
})

// 重置到第一页
function resetToFirstPage() {
  settingsStore.currentPage = 1
}

// 滚动到顶部
function scrollToTop() {
  const chartsSection = document.querySelector('.charts-section')
  if (chartsSection) {
    chartsSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

// 从后端加载数据
async function loadData() {
  if (!vsCodeApiStore.vscode) {
    console.warn('VS Code API not available')
    Notify.create({
      type: 'warning',
      message: '无法连接到 VS Code API',
      position: 'top'
    })
    return
  }

  loading.value = true

  try {
    // 调用后端命令获取完整数据集
    const result = await vsCodeApiStore.vscode.postMessage({
      command: 'executeCommand',
      args: ['AndreaNovelHelper.circlePacking.getCompleteDataset']
    })

    // 等待响应（通过消息监听）
    window.addEventListener('message', handleDataMessage)
  } catch (error) {
    console.error('Failed to load data:', error)
    Notify.create({
      type: 'negative',
      message: `加载数据失败: ${error instanceof Error ? error.message : String(error)}`,
      position: 'top'
    })
    loading.value = false
  }
}

// 处理从后端接收的数据消息
function handleDataMessage(event: MessageEvent) {
  const message = event.data

  if (message.command === 'circlePackingData') {
    try {
      const data = message.data

      if (data.roleReferences && data.roleReferences.items) {
        // 转换数据格式以匹配前端的 CompleteItem 接口
        items.value = data.roleReferences.items.map((item: any): CompleteItem => ({
          id: item.id,
          label: item.label,
          count: item.count,
          group: item.group,
          color: item.color,
          metadata: item.metadata,
          timeSeriesData: item.timeSeriesData?.map((point: any): TimeSeriesDataPoint => ({
            timestamp: point.timestamp,
            value: point.value,
            label: point.label
          }))
        }))

        Notify.create({
          type: 'positive',
          message: `成功加载 ${items.value.length} 个角色的数据`,
          position: 'top'
        })
      }
    } catch (error) {
      console.error('Failed to parse data:', error)
      Notify.create({
        type: 'negative',
        message: '解析数据失败',
        position: 'top'
      })
    } finally {
      loading.value = false
      window.removeEventListener('message', handleDataMessage)
    }
  }
}

// 导出数据到 JSON
async function exportData() {
  if (!vsCodeApiStore.vscode) {
    Notify.create({
      type: 'warning',
      message: '无法连接到 VS Code API',
      position: 'top'
    })
    return
  }

  try {
    await vsCodeApiStore.vscode.postMessage({
      command: 'executeCommand',
      args: ['AndreaNovelHelper.circlePacking.exportToJson']
    })

    Notify.create({
      type: 'positive',
      message: '数据导出命令已发送',
      position: 'top'
    })
  } catch (error) {
    console.error('Failed to export data:', error)
    Notify.create({
      type: 'negative',
      message: `导出数据失败: ${error instanceof Error ? error.message : String(error)}`,
      position: 'top'
    })
  }
}

// 页面加载时自动获取数据
onMounted(() => {
  void loadData()
})

// 监听过滤条件变化，自动重置到第一页
watch(
  () => [settingsStore.filterSensitiveRoles, settingsStore.minReferenceCount],
  () => {
    resetToFirstPage()
  }
)

// 计算图表区域标题
function getChartSectionTitle(): string {
  return '角色引用趋势'
}

// 计算图表区域副标题
function getChartSectionSubtitle(): string {
  return '各角色在不同章节中的出现次数变化'
}

function onNodeClick(item: CompleteItem) {
  console.log('Node clicked:', item)
  // 可以滚动到对应的图表
  const chartElement = document.querySelector(`[data-item-id="${item.id}"]`)
  if (chartElement) {
    chartElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

function onNodeHover(item: CompleteItem | null) {
  console.log('Node hover:', item)
}
</script>

<style scoped>
/* 布局容器 */
.circle-packing-layout {
  height: 100vh;
  width: 100%;
  background: var(--vscode-editor-background, #1e1e1e);
  color: var(--vscode-editor-foreground, #d4d4d4);
}

.page-wrapper {
  width: 100%;
  min-height: 100vh;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  background: var(--vscode-editor-background, #1e1e1e);
  position: relative;
}

/* 设置抽屉样式 */
.settings-drawer {
  background: var(--vscode-sideBar-background, rgba(37, 37, 38, 0.98));
  backdrop-filter: blur(10px);
  border-left: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
}

.settings-drawer :deep(.q-scrollarea__content) {
  background: transparent;
}

.settings-drawer :deep(.text-h6) {
  color: var(--vscode-foreground, #cccccc);
}

/* 固定设置按钮 */
.fixed-settings-btn {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

/* 加载覆盖层 */
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100vh;
  background: var(--vscode-editor-background, rgba(30, 30, 30, 0.85));
  backdrop-filter: blur(4px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.loading-overlay .text-white {
  color: var(--vscode-foreground, #cccccc);
}

.circle-packing-container {
  width: 100%;
  height: 100vh;
  flex-shrink: 0;
}

.charts-section {
  width: 100%;
  padding: 40px 20px;
  background: var(--vscode-editor-background, #1e1e1e);
  border-top: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
}

.section-header {
  max-width: 1400px;
  margin: 0 auto 32px;
  text-align: center;
}

.section-header h2 {
  color: var(--vscode-foreground, #cccccc);
  font-size: 28px;
  font-weight: 700;
  margin: 0 0 8px;
}

.subtitle {
  color: var(--vscode-descriptionForeground, #cccccc99);
  font-size: 14px;
  margin: 0;
}

/* 虚拟滚动容器 */
.charts-virtual-scroll {
  max-width: 1400px;
  margin: 0 auto;
  height: calc(100vh - 300px);
  min-height: 400px;
}

.virtual-scroll-container {
  height: 100%;
  width: 100%;
}

/* 分页网格 */
.charts-grid {
  max-width: 1400px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
  gap: 24px;
}

/* 分页控件 */
.pagination-container {
  max-width: 1400px;
  margin: 32px auto 0;
  display: flex;
  justify-content: center;
}

.chart-card {
  background: var(--vscode-panel-background, rgba(37, 37, 38, 0.6));
  border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
  border-radius: 12px;
  padding: 16px;
  height: 260px;
  backdrop-filter: blur(8px);
  transition: all 0.3s ease;
}

.chart-card:hover {
  border-color: var(--vscode-focusBorder, rgba(0, 122, 204, 0.8));
  box-shadow: 0 8px 24px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));
  transform: translateY(-2px);
}

@media (max-width: 768px) {
  .charts-grid {
    grid-template-columns: 1fr;
  }

  .charts-section {
    padding: 20px 12px;
  }

  .fixed-settings-btn {
    top: 10px;
    right: 10px;
  }

  .charts-virtual-scroll {
    height: calc(100vh - 250px);
  }
}
</style>
