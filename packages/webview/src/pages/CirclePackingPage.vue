<template>
  <div class="page-wrapper">
    <div class="circle-packing-container">
      <CirclePackingFlat
        :items="items"
        :padding="3"
        :minLabelRadius="26"
        @nodeClick="onNodeClick"
        @nodeHover="onNodeHover"
      />
    </div>

    <!-- 时间序列图表区域 -->
    <div class="charts-section">
      <div class="section-header">
        <h2>{{ getChartSectionTitle() }}</h2>
        <p class="subtitle">{{ getChartSectionSubtitle() }}</p>
      </div>

      <div class="charts-grid">
        <div
          v-for="item in items"
          :key="item.id"
          :data-item-id="item.id"
          class="chart-card"
        >
          <TimeSeriesChart
            :title="item.label"
            :data="generateTimeSeriesData(item)"
            :color="getColorForItem(item)"
            :height="220"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import CirclePackingFlat from 'components/CirclePackingFlat.vue'
import TimeSeriesChart from 'components/TimeSeriesChart.vue'
import type { CompleteItem } from '../types/dataSchema'
import { defaultItems, getColorForItem, generateTimeSeriesData } from '../data/circlePackingDefaultData'

// 使用默认数据
const items = ref<CompleteItem[]>(defaultItems)

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
.page-wrapper {
  width: 100vw;
  min-height: 100vh;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  background: #0a0a0f;
}

.circle-packing-container {
  width: 100%;
  height: 100vh;
  flex-shrink: 0;
}

.charts-section {
  width: 100%;
  padding: 40px 20px;
  background: linear-gradient(180deg, #0b0b12 0%, #12121a 100%);
}

.section-header {
  max-width: 1400px;
  margin: 0 auto 32px;
  text-align: center;
}

.section-header h2 {
  color: #f3f4f6;
  font-size: 28px;
  font-weight: 700;
  margin: 0 0 8px;
}

.subtitle {
  color: #9ca3af;
  font-size: 14px;
  margin: 0;
}

.charts-grid {
  max-width: 1400px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
  gap: 24px;
}

.chart-card {
  background: rgba(17, 24, 39, 0.6);
  border: 1px solid rgba(75, 85, 99, 0.3);
  border-radius: 12px;
  padding: 16px;
  height: 260px;
  backdrop-filter: blur(8px);
  transition: all 0.3s ease;
}

.chart-card:hover {
  border-color: rgba(96, 165, 250, 0.5);
  box-shadow: 0 8px 24px rgba(96, 165, 250, 0.15);
  transform: translateY(-2px);
}

@media (max-width: 768px) {
  .charts-grid {
    grid-template-columns: 1fr;
  }

  .charts-section {
    padding: 20px 12px;
  }
}
</style>
