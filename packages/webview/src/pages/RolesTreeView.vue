<template>
  <div class="roles-tree-view">
    <div class="q-pa-md q-gutter-sm">
  <q-tree :nodes="simple" node-key="id" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const simple = ref([
  {
    id: 1,
    label: 'Roles',
    children: [
      { id: 2, label: 'Admin' },
      { id: 3, label: 'Editor' },
      {
        id: 4,
        label: 'Viewer',
        children: [
          { id: 5, label: 'Admin' },
          { id: 6, label: 'Editor' },
          { id: 7, label: 'Viewer' }
        ]
      },
    ],
  },
]);
</script>

<style scoped>
.roles-tree-view {
  min-height: 100vh;
  padding: 16px;
  box-sizing: border-box;
}
</style>
