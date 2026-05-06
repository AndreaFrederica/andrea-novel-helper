<template>
  <q-table
    flat
    dense
    hide-pagination
    class="log-table"
    :rows="logs"
    :columns="columns"
    row-key="id"
    :rows-per-page-options="[0]"
  />
</template>

<script setup lang="ts">
import type { QTableColumn } from 'quasar'
import type { DashboardLog } from '../sampleData'

defineProps<{
  logs: DashboardLog[]
}>()

const columns: QTableColumn<DashboardLog>[] = [
  { name: 'createdAt', field: 'createdAt', label: '创建时间', align: 'left' },
  { name: 'completedAt', field: 'completedAt', label: '完成时间', align: 'left' },
  { name: 'title', field: 'title', label: '标题', align: 'left' },
  { name: 'tag', field: 'tag', label: '标签', align: 'left' }
]
</script>

<style scoped>
.log-table {
  height: 100%;
  color: var(--dash-page-fg);
}

:deep(th) {
  color: var(--dash-table-head);
  font-weight: 700;
}

:deep(td) {
  font-size: 12px;
}
</style>
