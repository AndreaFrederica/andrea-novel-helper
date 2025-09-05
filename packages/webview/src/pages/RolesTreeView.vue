<template>
  <ExplorerTree @change="onChange" />
</template>

<script setup lang="ts">
import ExplorerTree from 'src/components/ExplorerTree.vue'

function onChange(v: unknown) {
  // 可选：需要时拿到内部状态的变更
  // console.log('tree changed', v)
}
</script>
