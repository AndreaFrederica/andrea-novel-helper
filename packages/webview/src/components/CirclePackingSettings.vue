<template>
  <div class="circle-packing-settings">
    <!-- 数据过滤设置 -->
    <q-card flat bordered class="q-mb-md">
      <q-card-section>
        <div class="text-subtitle2 q-mb-md">数据过滤</div>

        <q-toggle
          v-model="settingsStore.filterSensitiveRoles"
          label="过滤敏感词类型的角色"
          color="primary"
          class="q-mb-md"
        >
          <q-tooltip>启用后，类型为"敏感词"的角色将不会显示在可视化中</q-tooltip>
        </q-toggle>

        <div>
          <div class="text-body2 q-mb-sm">
            最小引用次数: {{ settingsStore.minReferenceCount }} 次
            <q-tooltip>只显示引用次数大于等于此值的角色，设为0表示不过滤</q-tooltip>
          </div>
          <q-slider
            v-model="settingsStore.minReferenceCount"
            :min="0"
            :max="50000000"
            :step="1"
            label
            color="primary"
            markers
          />
        </div>
      </q-card-section>
    </q-card>

    <!-- 显示设置 -->
    <q-card flat bordered class="q-mb-md">
      <q-card-section>
        <div class="text-subtitle2 q-mb-md">显示设置</div>

        <q-toggle
          v-model="settingsStore.showTimeSeriesCharts"
          label="显示时间序列图表"
          color="primary"
        >
          <q-tooltip>显示或隐藏下方的时间序列图表区域</q-tooltip>
        </q-toggle>

        <div class="q-mt-md" v-if="settingsStore.showTimeSeriesCharts">
          <div class="text-body2 q-mb-sm">
            图表高度: {{ settingsStore.chartHeight }}px
          </div>
          <q-slider
            v-model="settingsStore.chartHeight"
            :min="150"
            :max="400"
            :step="10"
            label
            color="primary"
            markers
          />
        </div>
      </q-card-section>
    </q-card>

    <!-- 气泡图设置 -->
    <q-card flat bordered class="q-mb-md">
      <q-card-section>
        <div class="text-subtitle2 q-mb-md">气泡图设置</div>

        <div class="q-mb-md">
          <div class="text-body2 q-mb-sm">
            气泡间距: {{ settingsStore.bubblePadding }}px
          </div>
          <q-slider
            v-model="settingsStore.bubblePadding"
            :min="0"
            :max="10"
            :step="1"
            label
            color="primary"
            markers
          />
        </div>

        <div>
          <div class="text-body2 q-mb-sm">
            最小标签显示半径: {{ settingsStore.minLabelRadius }}px
          </div>
          <q-slider
            v-model="settingsStore.minLabelRadius"
            :min="10"
            :max="50"
            :step="2"
            label
            color="primary"
            markers
          >
            <q-tooltip>气泡半径小于此值时不显示文字标签</q-tooltip>
          </q-slider>
        </div>
      </q-card-section>
    </q-card>

    <!-- 图表分页设置 -->
    <q-card flat bordered class="q-mb-md">
      <q-card-section>
        <div class="text-subtitle2 q-mb-md">图表分页</div>

        <div>
          <div class="text-body2 q-mb-sm">
            每页显示数量: {{ settingsStore.pageSize === 0 ? '虚拟滚动' : `${settingsStore.pageSize} 个` }}
            <q-tooltip>设为0时使用虚拟滚动加载所有图表</q-tooltip>
          </div>
          <q-slider
            v-model="settingsStore.pageSize"
            :min="0"
            :max="100"
            :step="5"
            :label-value="settingsStore.pageSize === 0 ? '虚拟滚动' : settingsStore.pageSize"
            label
            color="primary"
            :markers="10"
          />
        </div>
      </q-card-section>
    </q-card>

    <!-- 数据刷新 -->
    <q-card flat bordered class="q-mb-md">
      <q-card-section>
        <div class="text-subtitle2 q-mb-md">数据操作</div>

        <q-btn
          label="刷新数据"
          color="primary"
          outline
          class="full-width q-mb-sm"
          icon="refresh"
          @click="$emit('refresh')"
        >
          <q-tooltip>重新从后端获取最新数据</q-tooltip>
        </q-btn>

        <q-btn
          label="导出数据到 JSON"
          color="secondary"
          outline
          class="full-width"
          icon="download"
          @click="$emit('export')"
        >
          <q-tooltip>导出当前数据为 JSON 文件</q-tooltip>
        </q-btn>
      </q-card-section>
    </q-card>

    <!-- 重置按钮 -->
    <q-btn
      label="重置为默认设置"
      color="grey"
      outline
      class="full-width"
      @click="settingsStore.reset()"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useCirclePackingSettingsStore } from '../stores/circle-packing-settings'

// 定义事件
defineEmits<{
  refresh: []
  export: []
}>()

// 使用 Pinia store
const settingsStore = useCirclePackingSettingsStore()

// 初始化时设置自动保存监听
onMounted(() => {
  settingsStore.init()
})
</script>

<style scoped>
.circle-packing-settings {
  padding: 0;
}
</style>
