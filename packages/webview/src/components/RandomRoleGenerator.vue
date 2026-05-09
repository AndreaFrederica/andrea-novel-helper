<template>
  <div class="random-role-generator">
    <div class="random-role-generator__header">
      <div>
        <div class="title">随机生成角色</div>
        <div class="subtitle">使用扩展内置名字生成系统生成角色卡草稿</div>
      </div>
      <q-btn dense flat round icon="refresh" :loading="loadingOptions" @click="$emit('request-options')">
        <q-tooltip>刷新可用文化和风格</q-tooltip>
      </q-btn>
    </div>

    <div class="generator-form">
      <q-select
        v-model="form.culture"
        dense
        outlined
        emit-value
        map-options
        label="文化背景"
        :options="cultureOptions"
      />
      <q-select
        v-model="form.gender"
        dense
        outlined
        emit-value
        map-options
        label="性别"
        :options="genderOptions"
      />
      <q-select
        v-model="form.style"
        dense
        outlined
        emit-value
        map-options
        label="风格"
        :options="styleOptions"
      />
      <q-select
        v-model="form.roleType"
        dense
        outlined
        emit-value
        map-options
        label="角色类型"
        :options="roleTypeOptions"
      />
      <q-input v-model.number="form.count" dense outlined type="number" min="1" max="20" label="候选数" />
      <q-input v-model="form.affiliation" dense outlined label="从属" />
      <q-input v-model="form.color" dense outlined label="颜色" placeholder="#4ea1ff">
        <template #append>
          <div class="color-dot" :style="{ backgroundColor: form.color || '#cccccc' }" />
        </template>
      </q-input>
      <q-btn
        color="primary"
        dense
        icon="casino"
        label="生成"
        :loading="generating"
        :disable="!form.culture || !form.style"
        @click="generate"
      />
    </div>

    <div v-if="error" class="generator-error">{{ error }}</div>

    <div v-if="candidates.length" class="candidate-list">
      <div v-for="candidate in candidates" :key="candidate.id" class="candidate-row">
        <div class="candidate-main">
          <span class="candidate-color" :style="{ backgroundColor: candidate.base.color || '#cccccc' }"></span>
          <div class="candidate-text">
            <div class="candidate-name">{{ candidate.base.name }}</div>
            <div class="candidate-meta">
              {{ candidate.base.type }} · {{ candidate.base.affiliation || '未分组' }}
              <span v-if="candidate.base.aliases?.length"> · {{ candidate.base.aliases.join(' / ') }}</span>
            </div>
          </div>
        </div>
        <q-btn dense flat color="primary" icon="add" label="加入" @click="$emit('add-role', candidate)" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import type { RoleCardModel } from '../../types/role';

interface NameCultureOption {
  code: string;
  displayName: string;
  supportedGenders: string[];
  supportedStyles: string[];
}

type GeneratedRoleCandidate = RoleCardModel & { id: string };

const props = defineProps<{
  cultures: NameCultureOption[];
  candidates: GeneratedRoleCandidate[];
  loadingOptions?: boolean;
  generating?: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  (e: 'request-options'): void;
  (e: 'generate', payload: {
    culture: string;
    gender: string;
    style: string;
    roleType: string;
    count: number;
    affiliation: string;
    color: string;
  }): void;
  (e: 'add-role', role: GeneratedRoleCandidate): void;
}>();

const form = reactive({
  culture: 'zh_CN',
  gender: 'any',
  style: 'modern',
  roleType: '配角',
  count: 5,
  affiliation: '',
  color: '#4ea1ff',
});

const cultureOptions = computed(() => props.cultures.map(culture => ({
  label: `${culture.displayName} (${culture.code})`,
  value: culture.code,
})));

const currentCulture = computed(() => {
  return props.cultures.find(culture => culture.code === form.culture) || props.cultures[0];
});

const styleOptions = computed(() => {
  const styles = currentCulture.value?.supportedStyles?.length ? currentCulture.value.supportedStyles : ['modern'];
  return styles.map(style => ({ label: getStyleLabel(style), value: style }));
});

const genderOptions = [
  { label: '随机', value: 'any' },
  { label: '男性', value: 'male' },
  { label: '女性', value: 'female' },
  { label: '中性', value: 'neutral' },
];

const roleTypeOptions = ['主角', '配角', '联动角色'].map(value => ({ label: value, value }));

watch(
  () => props.cultures,
  (cultures) => {
    if (!cultures.length) return;
    if (!cultures.some(culture => culture.code === form.culture)) {
      form.culture = cultures[0]?.code || 'zh_CN';
    }
    syncStyleWithCulture();
  },
  { deep: true },
);

watch(() => form.culture, syncStyleWithCulture);

function syncStyleWithCulture() {
  const styles = currentCulture.value?.supportedStyles || [];
  if (styles.length && !styles.includes(form.style)) {
    form.style = styles[0] || 'modern';
  }
}

function generate() {
  emit('generate', {
    culture: form.culture,
    gender: form.gender,
    style: form.style,
    roleType: form.roleType,
    count: Math.max(1, Math.min(20, Number(form.count) || 5)),
    affiliation: form.affiliation.trim(),
    color: form.color.trim(),
  });
}

function getStyleLabel(style: string): string {
  const labels: Record<string, string> = {
    modern: '现代',
    classic: '经典',
    fantasy: '奇幻',
    'sci-fi': '科幻',
    historical: '历史',
    'high-fantasy': '高等奇幻',
    'dark-fantasy': '黑暗奇幻',
  };
  return labels[style] || style;
}
</script>

<style scoped>
.random-role-generator {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--vscode-widget-border, rgba(127, 127, 127, 0.25));
  border-radius: 8px;
  background: var(--vscode-editor-background, transparent);
}

.random-role-generator__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.title {
  font-size: 14px;
  font-weight: 700;
}

.subtitle {
  margin-top: 2px;
  font-size: 12px;
  color: var(--vscode-descriptionForeground, rgba(127, 127, 127, 0.9));
}

.generator-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  align-items: end;
}

.color-dot,
.candidate-color {
  display: inline-block;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid rgba(127, 127, 127, 0.45);
}

.generator-error {
  color: var(--vscode-errorForeground, #f48771);
  font-size: 12px;
}

.candidate-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 8px;
}

.candidate-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--vscode-panel-border, rgba(127, 127, 127, 0.25));
  border-radius: 6px;
}

.candidate-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.candidate-text {
  min-width: 0;
}

.candidate-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.candidate-meta {
  font-size: 12px;
  color: var(--vscode-descriptionForeground, rgba(127, 127, 127, 0.9));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
