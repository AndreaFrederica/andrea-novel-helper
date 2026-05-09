<template>
  <div class="random-role-generator">
    <div class="random-role-generator__header">
      <div>
        <div class="title">{{ t('roleEditor.generator.title') }}</div>
        <div class="subtitle">{{ t('roleEditor.generator.subtitle') }}</div>
      </div>
      <q-btn dense flat round icon="refresh" :loading="loadingOptions" @click="$emit('request-options')">
        <q-tooltip>{{ t('roleEditor.generator.refresh') }}</q-tooltip>
      </q-btn>
    </div>

    <div class="generator-form">
      <q-select
        v-model="form.culture"
        dense
        outlined
        emit-value
        map-options
        :label="t('roleEditor.generator.culture')"
        :options="cultureOptions"
      />
      <q-select
        v-model="form.gender"
        dense
        outlined
        emit-value
        map-options
        :label="t('roleEditor.generator.gender')"
        :options="genderOptions"
      />
      <q-select
        v-model="form.style"
        dense
        outlined
        emit-value
        map-options
        :label="t('roleEditor.generator.style')"
        :options="styleOptions"
      />
      <q-select
        v-model="form.roleType"
        dense
        outlined
        emit-value
        map-options
        :label="t('roleEditor.generator.roleType')"
        :options="roleTypeOptions"
      />
      <q-input v-model.number="form.count" dense outlined type="number" min="1" max="20" :label="t('roleEditor.generator.count')" />
      <q-input v-model="form.affiliation" dense outlined :label="t('roleEditor.generator.affiliation')" />
      <q-input v-model="form.color" dense outlined :label="t('roleEditor.generator.color')" placeholder="#4ea1ff">
        <template #append>
          <div class="color-dot" :style="{ backgroundColor: form.color || '#cccccc' }" />
        </template>
      </q-input>
      <q-btn
        color="primary"
        dense
        icon="casino"
        :label="t('roleEditor.generator.generate')"
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
              {{ candidate.base.type }} · {{ candidate.base.affiliation || t('roleEditor.generator.ungrouped') }}
              <span v-if="candidate.base.aliases?.length"> · {{ candidate.base.aliases.join(' / ') }}</span>
            </div>
          </div>
        </div>
        <q-btn dense flat color="primary" icon="add" :label="t('roleEditor.generator.add')" @click="$emit('add-role', candidate)" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
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

const { t } = useI18n();

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
  { label: t('roleEditor.generator.genders.any'), value: 'any' },
  { label: t('roleEditor.generator.genders.male'), value: 'male' },
  { label: t('roleEditor.generator.genders.female'), value: 'female' },
  { label: t('roleEditor.generator.genders.neutral'), value: 'neutral' },
];

const roleTypeOptions = [
  { label: t('roleEditor.generator.roleTypes.protagonist'), value: '主角' },
  { label: t('roleEditor.generator.roleTypes.supporting'), value: '配角' },
  { label: t('roleEditor.generator.roleTypes.crossover'), value: '联动角色' },
];

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
    modern: t('roleEditor.generator.styles.modern'),
    classic: t('roleEditor.generator.styles.classic'),
    fantasy: t('roleEditor.generator.styles.fantasy'),
    'sci-fi': t('roleEditor.generator.styles.sciFi'),
    historical: t('roleEditor.generator.styles.historical'),
    'high-fantasy': t('roleEditor.generator.styles.highFantasy'),
    'dark-fantasy': t('roleEditor.generator.styles.darkFantasy'),
  };
  return labels[style] || style;
}
</script>

<style scoped>
.random-role-generator {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  gap: 10px;
  align-self: stretch;
  height: auto;
  min-height: unset;
  max-height: none;
  padding: 12px;
  border: 1px solid var(--vscode-widget-border, rgba(127, 127, 127, 0.25));
  border-radius: 8px;
  color: var(--vscode-editor-foreground, inherit);
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background, transparent));
}

.random-role-generator > * {
  flex: 0 0 auto;
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
  grid-auto-rows: min-content;
  align-items: start;
  align-content: start;
  flex: 0 0 auto;
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
  background: var(--vscode-editor-background, transparent);
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
