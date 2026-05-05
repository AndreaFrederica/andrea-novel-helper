<template>
  <div class="profile-card">
    <div class="avatar">ANH</div>
    <q-input dense borderless class="name-input" :model-value="profile.name" @update:model-value="update('name', String($event))" />
    <q-input dense borderless class="role-input" :model-value="profile.role" @update:model-value="update('role', String($event))" />
    <q-input dense borderless autogrow class="quote-input" :model-value="profile.quote" @update:model-value="update('quote', String($event))" />
    <div class="chips">
      <q-chip dense color="pink-1" text-color="pink-7" icon="favorite">会写</q-chip>
      <q-chip dense color="purple-1" text-color="purple-7" icon="auto_fix_high">构思</q-chip>
      <q-chip dense color="blue-1" text-color="blue-7" icon="music_note">音乐</q-chip>
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
        <strong>{{ profile.goalCount }}</strong>
        <span>目标</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
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
  background: radial-gradient(circle at 35% 35%, #ffd7ef, #b983ef);
  opacity: 0.95;
  color: white;
  font-size: 22px;
  font-weight: 800;
  box-shadow: 0 8px 24px var(--dash-shadow);
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
