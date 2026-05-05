<template>
  <div class="clock-card">
    <div class="clock-top">
      <q-icon name="schedule" size="18px" />
      <span>当前时间</span>
      <q-badge rounded color="pink-4" label="下午好" />
    </div>
    <div class="time">{{ timeText }}</div>
    <div class="date">{{ dateText }}</div>
    <q-chip dense color="pink-2" text-color="pink-8">规划日</q-chip>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const now = ref(new Date())
let timer: number | undefined

const timeText = computed(() => now.value.toLocaleTimeString('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
}))
const dateText = computed(() => now.value.toLocaleDateString('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric'
}))

onMounted(() => {
  timer = window.setInterval(() => {
    now.value = new Date()
  }, 1000)
})

onBeforeUnmount(() => {
  if (timer !== undefined) window.clearInterval(timer)
})
</script>

<style scoped>
.clock-card {
  height: 100%;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  color: var(--dash-page-fg);
}

.clock-top {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}

.time {
  color: var(--dash-accent-light);
  font-size: 46px;
  line-height: 1;
  font-weight: 800;
}

.date {
  color: var(--dash-text-muted2);
  font-size: 13px;
}
</style>
