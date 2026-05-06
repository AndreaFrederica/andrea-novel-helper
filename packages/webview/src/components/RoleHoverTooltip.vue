<template>
  <Teleport to="body">
    <div
      v-if="visible && role"
      ref="tooltipRef"
      class="role-hover-tooltip"
      :style="tooltipStyle"
      @mouseenter="emit('tooltip-hover', true)"
      @mouseleave="emit('tooltip-hover', false)"
    >
      <header class="tooltip-header">
        <div class="title-block">
          <div class="role-name">{{ role.label || role.name }}</div>
          <div v-if="subtitle" class="role-subtitle">{{ subtitle }}</div>
        </div>
        <span v-if="roleColor" class="color-swatch" :style="{ backgroundColor: roleColor }" />
      </header>

      <div class="tooltip-body">
        <section v-if="description" class="tooltip-section">
          <div class="section-label">描述</div>
          <div class="description-text">{{ description }}</div>
        </section>

        <section v-if="baseRows.length" class="tooltip-section">
          <div v-for="row in baseRows" :key="row.label" class="field-row" :class="{ path: row.path }">
            <span class="field-label">{{ row.label }}</span>
            <span class="field-value">{{ row.value }}</span>
          </div>
        </section>

        <section v-if="styleRows.length" class="tooltip-section">
          <div class="section-label">样式</div>
          <div class="tag-list">
            <span v-for="row in styleRows" :key="row" class="tag">{{ row }}</span>
          </div>
        </section>

        <section v-if="extensionRows.length" class="tooltip-section">
          <div class="section-label">扩展字段</div>
          <div v-for="row in extensionRows" :key="row.label" class="field-row">
            <span class="field-label">{{ row.label }}</span>
            <span class="field-value multiline">{{ row.value }}</span>
          </div>
        </section>

        <section v-if="relationPreviewRows.length" class="tooltip-section">
          <div class="section-label">一级关系</div>
          <div class="relation-list">
            <div v-for="relation in relationPreviewRows" :key="relation.id" class="relation-row">
              <span class="relation-target">{{ relation.direction }} {{ relation.target }}</span>
              <span class="relation-type">{{ relation.type }}</span>
              <span class="relation-source">{{ relation.source }}</span>
            </div>
          </div>
        </section>

        <section v-if="roleColor" class="tooltip-section color-row">
          <span class="field-label">颜色</span>
          <span class="field-value">{{ roleColor }}</span>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

export interface RoleHoverTooltipRole {
  id?: string;
  label?: string;
  name?: string;
  uuid?: string;
  type?: string;
  affiliation?: string;
  packagePath?: string;
  sourcePath?: string;
  color?: string;
  roleData?: Record<string, unknown>;
}

export interface RoleHoverTooltipRelation {
  id: string;
  target: string;
  type: string;
  label?: string;
  direction: string;
  source: string;
}

export type RoleHoverTooltipScrollModifier = 'ctrl' | 'alt' | 'shift' | 'meta' | 'none' | 'disabled';

const props = withDefaults(defineProps<{
  visible: boolean;
  role: RoleHoverTooltipRole | null;
  position: { x: number; y: number };
  relations?: RoleHoverTooltipRelation[];
  followMouse?: boolean;
  maxRelations?: number;
  scrollModifier?: RoleHoverTooltipScrollModifier;
}>(), {
  visible: false,
  role: null,
  position: () => ({ x: 0, y: 0 }),
  relations: () => [],
  followMouse: true,
  maxRelations: 8,
  scrollModifier: 'ctrl',
});

const emit = defineEmits<{ 'tooltip-hover': [isHovering: boolean] }>();
const tooltipRef = ref<HTMLElement | null>(null);

const roleData = computed(() => props.role?.roleData || {});
const roleColor = computed(() => getString(roleData.value.color) || props.role?.color);
const description = computed(() => getString(roleData.value.description));
const subtitle = computed(() => [props.role?.type, props.role?.affiliation].filter(Boolean).join(' / '));

const baseRows = computed(() => {
  const rows: Array<{ label: string; value: string; path?: boolean }> = [];
  appendRow(rows, '类型', props.role?.type || getString(roleData.value.type));
  appendRow(rows, '从属', props.role?.affiliation || getString(roleData.value.affiliation));
  appendRow(rows, '别名', formatList(roleData.value.aliases));
  appendRow(rows, '修复', formatList(roleData.value.fixes || roleData.value.fixs));
  appendRow(rows, '包路径', props.role?.packagePath || getString(roleData.value.packagePath), true);
  appendRow(rows, '源文件', sourceFileName(props.role?.sourcePath || getString(roleData.value.sourcePath)), true);
  appendRow(rows, 'UUID', props.role?.uuid || getString(roleData.value.uuid));
  return rows;
});

const styleRows = computed(() => {
  const rows: string[] = [];
  const style = roleData.value.style;
  if (style && typeof style === 'object') {
    const data = style as Record<string, unknown>;
    appendStyle(rows, '前景色', data.color);
    appendStyle(rows, '背景色', data.backgroundColor);
    if (data.bold) rows.push('粗体');
    if (data.italic) rows.push('斜体');
    if (data.strikethrough) rows.push('删除线');
    if (data.underline) rows.push('下划线');
  }
  for (const key of ['backgroundColor', 'bold', 'italic', 'strikethrough', 'underline']) {
    const value = roleData.value[key];
    if (key === 'backgroundColor') {
      appendStyle(rows, '背景色', value);
    } else if (value === true) {
      rows.push(fieldLabel(key));
    }
  }
  return Array.from(new Set(rows));
});

const extensionRows = computed(() => {
  const rows: Array<{ label: string; value: string }> = [];
  const skipped = new Set([
    'name',
    'label',
    'description',
    'type',
    'affiliation',
    'aliases',
    'fixes',
    'fixs',
    'packagePath',
    'sourcePath',
    'uuid',
    'id',
    'color',
    'style',
    'backgroundColor',
    'bold',
    'italic',
    'strikethrough',
    'underline',
    'relations',
    'relationships',
    'wordSegmentFilter',
    'regex',
    'regexFlags',
    'priority',
  ]);
  for (const [key, value] of Object.entries(roleData.value)) {
    if (skipped.has(key) || value === undefined || value === null || value === '') {
      continue;
    }
    rows.push({ label: fieldLabel(key), value: stringifyValue(value) });
  }
  return rows.slice(0, 12);
});

const relationPreviewRows = computed(() => (props.relations || []).slice(0, props.maxRelations));
const hasScrollableContent = computed(() => {
  const el = tooltipRef.value;
  return !!el && el.scrollHeight > el.clientHeight + 1;
});

const tooltipStyle = computed(() => {
  const offset = props.followMouse ? 14 : 0;
  const width = tooltipRef.value?.offsetWidth || 360;
  const height = tooltipRef.value?.offsetHeight || 260;
  const margin = 8;
  const x = Math.min(Math.max(props.position.x + offset, margin), Math.max(margin, window.innerWidth - width - margin));
  const y = Math.min(Math.max(props.position.y + offset, margin), Math.max(margin, window.innerHeight - height - margin));
  return {
    left: `${x}px`,
    top: `${y}px`,
  };
});

function appendRow(rows: Array<{ label: string; value: string; path?: boolean }>, label: string, value?: string, path = false) {
  if (!value) {
    return;
  }
  rows.push({ label, value, path });
}

function appendStyle(rows: string[], label: string, value: unknown) {
  const text = getString(value);
  if (text) {
    rows.push(`${label}: ${text}`);
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function formatList(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const items = value.map(item => stringifyValue(item)).filter(Boolean);
    return items.length ? items.join('，') : undefined;
  }
  return getString(value);
}

function sourceFileName(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.split(/[/\\]/).pop() || value;
}

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map(item => stringifyValue(item)).filter(Boolean).join('，');
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[Object]';
    }
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

function fieldLabel(key: string) {
  const labels: Record<string, string> = {
    lookupKeys_pinyin: '拼音查询键',
    lookupKeys_romanized: '罗马字查询键',
    lookupKeys_spelling: '拼写查询键',
    backgroundColor: '背景色',
    bold: '粗体',
    italic: '斜体',
    strikethrough: '删除线',
    underline: '下划线',
    gender: '性别',
    age: '年龄',
    status: '状态',
    tags: '标签',
    notes: '备注',
  };
  return labels[key] || key;
}

function handleGlobalWheel(event: WheelEvent) {
  if (!props.visible || !props.role || props.scrollModifier === 'disabled' || !hasScrollableContent.value) {
    return;
  }
  if (!isModifierActive(event)) {
    return;
  }
  const el = tooltipRef.value;
  if (!el) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  el.scrollTop += event.deltaY;
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
    el.scrollLeft += event.deltaX;
  }
}

function isModifierActive(event: WheelEvent) {
  if (props.scrollModifier === 'none') {
    return true;
  }
  if (props.scrollModifier === 'ctrl') {
    return event.ctrlKey;
  }
  if (props.scrollModifier === 'alt') {
    return event.altKey;
  }
  if (props.scrollModifier === 'shift') {
    return event.shiftKey;
  }
  if (props.scrollModifier === 'meta') {
    return event.metaKey;
  }
  return false;
}

onMounted(() => {
  window.addEventListener('wheel', handleGlobalWheel, { capture: true, passive: false });
});

onBeforeUnmount(() => {
  window.removeEventListener('wheel', handleGlobalWheel, { capture: true });
});
</script>

<style scoped>
.role-hover-tooltip {
  position: fixed;
  z-index: 9999;
  width: min(360px, calc(100vw - 16px));
  max-height: min(560px, calc(100vh - 16px));
  overflow: auto;
  border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-panel-border, rgba(128, 128, 128, 0.45)));
  border-radius: 4px;
  background: var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
  color: var(--vscode-editorHoverWidget-foreground, var(--vscode-editor-foreground));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.34);
  font-size: 12px;
  line-height: 1.5;
  pointer-events: auto;
}

.tooltip-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-panel-border, rgba(128, 128, 128, 0.28)));
}

.title-block {
  min-width: 0;
}

.role-name {
  color: var(--vscode-editorHoverWidget-foreground, var(--vscode-editor-foreground));
  font-size: 13px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-subtitle,
.field-label,
.relation-source {
  color: var(--vscode-descriptionForeground);
}

.color-swatch {
  width: 14px;
  height: 14px;
  border: 1px solid var(--vscode-editorHoverWidget-border, rgba(128, 128, 128, 0.5));
  border-radius: 2px;
  flex: 0 0 auto;
  margin-top: 1px;
}

.tooltip-body {
  padding: 8px 12px 10px;
}

.tooltip-section + .tooltip-section {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-panel-border, rgba(128, 128, 128, 0.2)));
}

.section-label {
  color: var(--vscode-editorHoverWidget-foreground, var(--vscode-editor-foreground));
  font-weight: 650;
  margin-bottom: 4px;
}

.description-text,
.field-value.multiline {
  white-space: pre-wrap;
}

.description-text {
  max-height: 132px;
  overflow: auto;
}

.field-row,
.color-row {
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
  min-width: 0;
}

.field-value {
  min-width: 0;
  overflow-wrap: anywhere;
}

.path .field-value {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 11px;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.tag {
  border: 1px solid var(--vscode-badge-background, var(--vscode-panel-border, rgba(128, 128, 128, 0.35)));
  border-radius: 3px;
  padding: 1px 5px;
  color: var(--vscode-badge-foreground, var(--vscode-editorHoverWidget-foreground));
}

.relation-list {
  display: grid;
  gap: 4px;
}

.relation-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 6px;
  align-items: center;
}

.relation-target {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.relation-type {
  color: var(--vscode-textLink-foreground, var(--vscode-editorHoverWidget-foreground));
}
</style>
