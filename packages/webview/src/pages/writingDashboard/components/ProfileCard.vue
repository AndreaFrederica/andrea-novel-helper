<template>
  <div class="profile-card">
    <div v-if="showCover" class="cover-frame">
      <img class="cover-image" :src="coverUrl" :alt="`${profile.name || '小说'}封面`" @error="coverLoadFailed = true">
    </div>
    <div v-else class="avatar">{{ avatarText }}</div>
    <q-input dense borderless class="name-input" :model-value="profile.name" @update:model-value="update('name', String($event))" />
    <q-input dense borderless class="role-input" :model-value="profile.role" @update:model-value="update('role', String($event))" />
    <q-input dense borderless autogrow class="quote-input" :model-value="profile.quote" @update:model-value="update('quote', String($event))" />
    <div v-if="displayTags.length > 0" class="chips">
      <q-chip v-for="tag in displayTags" :key="tag" dense color="pink-1" text-color="pink-7" icon="sell">{{ tag }}</q-chip>
    </div>
    <div class="stats">
      <div>
        <strong>{{ profile.roleCount ?? 0 }}</strong>
        <span>角色</span>
      </div>
      <div>
        <strong>{{ profile.taskCount }}</strong>
        <span>任务</span>
      </div>
      <div>
        <strong>{{ formatCount(profile.wordCount ?? 0) }}</strong>
        <span>字数</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DashboardProfile } from '../sampleData'

const props = defineProps<{
  profile: DashboardProfile
}>()

const emit = defineEmits<{
  'update:profile': [profile: DashboardProfile]
}>()

function update(key: keyof DashboardProfile, value: string) {
  emit('update:profile', { ...props.profile, [key]: value })
}

const displayTags = computed(() => Array.isArray(props.profile.tags) ? props.profile.tags.slice(0, 4) : [])
const coverLoadFailed = ref(false)
const coverUrl = computed(() => typeof props.profile.coverUrl === 'string' ? props.profile.coverUrl.trim() : '')
const showCover = computed(() => !!coverUrl.value && !coverLoadFailed.value)
const avatarText = computed(() => {
  const name = (props.profile.name || '').trim()
  if (!name) return 'ANH'
  const chars = Array.from(name.replace(/\s+/g, ''))
  return chars.slice(0, 2).join('').toUpperCase()
})

watch(coverUrl, () => {
  coverLoadFailed.value = false
})

function formatCount(value: number) {
  const count = Math.max(0, Number(value) || 0)
  if (count >= 10000) return `${(count / 10000).toFixed(1)}万`
  return String(count)
}
</script>

<style scoped>
.profile-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
  color: var(--dash-text-muted);
}

.avatar {
  width: 72px;
  height: 72px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--dash-bg-soft, #2b2b2b);
  opacity: 0.95;
  color: var(--dash-accent);
  font-size: 22px;
  font-weight: 800;
  border: 1px solid var(--dash-border, rgba(255, 255, 255, 0.16));
  box-shadow: 0 8px 24px var(--dash-shadow);
}

.cover-frame {
  width: min(104px, 46%);
  height: min(132px, 42%);
  min-width: 72px;
  min-height: 84px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: var(--dash-bg-soft, #222);
  border: 1px solid var(--dash-border, rgba(255, 255, 255, 0.14));
  overflow: hidden;
  box-shadow: 0 8px 24px var(--dash-shadow);
}

.cover-image {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
}

.name-input {
  font-weight: 700;
}

:deep(.q-field__control) {
  min-height: 24px;
  height: auto;
}

:deep(input),
:deep(textarea) {
  text-align: center;
}

.role-input,
.quote-input {
  margin: 0;
  color: var(--dash-text-muted2);
  font-size: 12px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
}

.stats {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 8px;
}

.stats div {
  display: grid;
  gap: 2px;
}

.stats strong {
  color: var(--dash-accent);
  font-size: 18px;
}

.stats span {
  color: var(--dash-text-muted2);
  font-size: 11px;
}
</style>
