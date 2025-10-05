<template>
  <div class="page-container">
    <CirclePackingFlat
      :items="items"
      :padding="3"
      :minLabelRadius="26"
      @nodeClick="onNodeClick"
      @nodeHover="onNodeHover"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import CirclePackingFlat from 'components/CirclePackingFlat.vue'

type Item = {
  id: string
  label: string
  count: number
  group?: string
}

// 示例数据
const items = ref<Item[]>([
  { id: 'a', label: 'TimelinePage.vue', count: 22600, group: 'views' },
  { id: 'b', label: 'wordCountProvider.ts', count: 13680, group: 'providers' },
  { id: 'c', label: 'fileTrackingData.ts', count: 7020, group: 'data' },
  { id: 'd', label: 'commentsTreeView.ts', count: 6800, group: 'views' },
  { id: 'e', label: 'activate.ts', count: 2300, group: 'infra' }
])

function onNodeClick(item: Item) {
  console.log('Node clicked:', item)
}

function onNodeHover(item: Item | null) {
  console.log('Node hover:', item)
}
</script>

<style scoped>
.page-container {
  width: 100%;
  height: 100%;
}
</style>
