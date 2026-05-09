<template>
  <div class="role-table-editor">
    <div class="role-table-editor__toolbar row items-center q-col-gutter-sm">
      <div class="col-12 col-md-4">
        <q-input
          :model-value="draft.base.name"
          dense
          outlined
          label="名称"
          :debounce="120"
          @update:model-value="(value) => updateBaseString('name', value)"
        />
      </div>

      <div class="col-12 col-sm-6 col-md-3">
        <q-select
          v-model="typeModel"
          :options="typeOptions"
          dense
          outlined
          use-input
          hide-selected
          fill-input
          input-debounce="0"
          label="类型"
          @new-value="onTypeNewValue"
          @update:model-value="applyType"
        />
      </div>

      <div class="col-6 col-sm-3 col-md-2">
        <q-input
          :model-value="draft.base.priority"
          dense
          outlined
          type="number"
          label="优先级"
          :debounce="120"
          @update:model-value="(value) => updatePriority(value)"
        />
      </div>

      <div class="col-6 col-sm-3 col-md-3">
        <q-input
          :model-value="draft.base.affiliation"
          dense
          outlined
          label="从属"
          :debounce="120"
          @update:model-value="(value) => updateBaseString('affiliation', value)"
        />
      </div>
    </div>

    <div class="role-table-editor__meta row items-center q-gutter-sm">
      <q-chip dense square :style="chipStyle">
        {{ draft.base.type || '未分类' }}
      </q-chip>
      <q-chip dense outline>
        UUID: {{ draft.base.uuid || '未设置' }}
        <q-btn
          v-if="draft.base.uuid"
          flat
          dense
          round
          size="sm"
          icon="content_copy"
          class="q-ml-xs"
          @click="copyUUID"
        >
          <q-tooltip>复制 UUID</q-tooltip>
        </q-btn>
      </q-chip>
      <q-toggle
        :model-value="draft.base.wordSegmentFilter === true"
        dense
        label="分词过滤"
        @update:model-value="updateWordSegmentFilter"
      />
    </div>

    <q-markup-table flat bordered dense wrap-cells class="role-field-table">
      <thead>
        <tr>
          <th class="field-name">字段</th>
          <th>值</th>
          <th class="field-type">类型</th>
          <th class="field-actions">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="field-name">description</td>
          <td>
            <q-input
              :model-value="draft.base.description"
              dense
              outlined
              type="textarea"
              autogrow
              placeholder="角色描述"
              :debounce="120"
              @update:model-value="(value) => updateBaseString('description', value)"
            />
          </td>
          <td class="field-type">string</td>
          <td class="field-actions"></td>
        </tr>

        <tr>
          <td class="field-name">color</td>
          <td>
            <div class="row items-center no-wrap q-gutter-sm">
              <div class="color-dot" :style="{ backgroundColor: draft.base.color || '#cccccc' }" />
              <q-input
                :model-value="draft.base.color"
                dense
                outlined
                class="table-input"
                placeholder="#RRGGBB"
                :debounce="120"
                @update:model-value="(value) => updateBaseString('color', value)"
              />
            </div>
          </td>
          <td class="field-type">color</td>
          <td class="field-actions">
            <q-btn dense flat round icon="palette" @click="openColorPicker('color')">
              <q-tooltip>选择前景色</q-tooltip>
            </q-btn>
          </td>
        </tr>

        <tr>
          <td class="field-name">style</td>
          <td>
            <div class="style-row">
              <div class="row items-center q-gutter-xs">
                <q-btn
                  dense
                  flat
                  round
                  icon="format_bold"
                  :color="draft.base.style?.bold ? 'primary' : undefined"
                  @click="toggleStyle('bold')"
                >
                  <q-tooltip>粗体</q-tooltip>
                </q-btn>
                <q-btn
                  dense
                  flat
                  round
                  icon="format_italic"
                  :color="draft.base.style?.italic ? 'primary' : undefined"
                  @click="toggleStyle('italic')"
                >
                  <q-tooltip>斜体</q-tooltip>
                </q-btn>
                <q-btn
                  dense
                  flat
                  round
                  icon="format_strikethrough"
                  :color="draft.base.style?.strikethrough ? 'primary' : undefined"
                  @click="toggleStyle('strikethrough')"
                >
                  <q-tooltip>删除线</q-tooltip>
                </q-btn>
                <q-btn
                  dense
                  flat
                  round
                  icon="format_underlined"
                  :color="draft.base.style?.underline ? 'primary' : undefined"
                  @click="toggleStyle('underline')"
                >
                  <q-tooltip>下划线</q-tooltip>
                </q-btn>
                <q-separator vertical inset />
                <div class="color-dot" :style="{ backgroundColor: backgroundColor || '#cccccc' }" />
                <q-btn dense flat round icon="format_color_fill" @click="openColorPicker('background')">
                  <q-tooltip>选择背景色</q-tooltip>
                </q-btn>
              </div>
              <div class="style-preview" :style="previewStyle">
                {{ draft.base.name || '预览文本' }}
              </div>
            </div>
          </td>
          <td class="field-type">object</td>
          <td class="field-actions">
            <q-btn dense flat round icon="restart_alt" @click="resetStyle">
              <q-tooltip>清空样式</q-tooltip>
            </q-btn>
          </td>
        </tr>

        <tr v-for="row in visibleArrayRows" :key="row.field">
          <td class="field-name">{{ row.field }}</td>
          <td>
            <q-select
              :model-value="getStringList(row.field)"
              multiple
              use-input
              use-chips
              new-value-mode="add-unique"
              dense
              outlined
              input-debounce="0"
              :placeholder="row.placeholder"
              @update:model-value="(value) => setStringList(row.field, value)"
            />
          </td>
          <td class="field-type">string[]</td>
          <td class="field-actions">
            <q-btn
              v-if="row.lookupKind"
              dense
              flat
              round
              icon="manage_search"
              @click="requestLookupCandidates(row.lookupKind)"
            >
              <q-tooltip>从后端候选项追加</q-tooltip>
            </q-btn>
          </td>
        </tr>

        <tr v-if="draft.base.type === '正则表达式'">
          <td class="field-name">regex</td>
          <td>
            <q-input
              :model-value="draft.base.regex"
              dense
              outlined
              placeholder="正则表达式"
              :debounce="120"
              @update:model-value="(value) => updateBaseString('regex', value)"
            />
          </td>
          <td class="field-type">string</td>
          <td class="field-actions"></td>
        </tr>

        <tr v-if="draft.base.type === '正则表达式'">
          <td class="field-name">regexFlags</td>
          <td>
            <q-input
              :model-value="draft.base.regexFlags"
              dense
              outlined
              placeholder="gim"
              :debounce="120"
              @update:model-value="(value) => updateBaseString('regexFlags', value)"
            />
          </td>
          <td class="field-type">string</td>
          <td class="field-actions"></td>
        </tr>

        <tr v-for="row in extraRows" :key="`${row.bucket}.${row.key}`">
          <td class="field-name">
            <div class="row items-center no-wrap q-gutter-xs">
              <q-chip
                dense
                square
                size="sm"
                :color="row.bucket === 'extended' ? 'teal' : 'orange'"
                text-color="white"
              >
                {{ row.bucket }}
              </q-chip>
              <q-input
                :model-value="row.key"
                dense
                borderless
                class="key-input"
                @change="renameExtra(row, $event)"
              />
            </div>
          </td>
          <td>
            <q-input
              v-if="row.valueType === 'string'"
              :model-value="toInputString(row.value)"
              dense
              outlined
              type="textarea"
              autogrow
              :debounce="120"
              @update:model-value="(value) => updateExtra(row, value)"
            />
            <q-input
              v-else-if="row.valueType === 'number'"
              :model-value="Number(row.value ?? 0)"
              dense
              outlined
              type="number"
              :debounce="120"
              @update:model-value="(value) => updateExtra(row, Number(value ?? 0))"
            />
            <q-toggle
              v-else-if="row.valueType === 'boolean'"
              :model-value="Boolean(row.value)"
              dense
              @update:model-value="(value) => updateExtra(row, Boolean(value))"
            />
            <q-select
              v-else
              :model-value="Array.isArray(row.value) ? row.value : []"
              multiple
              use-input
              use-chips
              new-value-mode="add-unique"
              dense
              outlined
              input-debounce="0"
              @update:model-value="(value) => updateExtra(row, normalizeStringList(value))"
            />
          </td>
          <td class="field-type">{{ row.valueType }}</td>
          <td class="field-actions">
            <q-btn dense flat round icon="delete" color="negative" @click="removeExtra(row)">
              <q-tooltip>删除字段</q-tooltip>
            </q-btn>
          </td>
        </tr>
      </tbody>
    </q-markup-table>

    <div class="row items-center justify-between q-mt-sm">
      <div class="text-caption text-grey-7">
        基础字段固定展示，扩展字段和自定义字段可在表格中直接编辑。
      </div>
      <q-btn dense color="primary" icon="add" label="新增字段" @click="openAddExtra" />
    </div>

    <q-dialog v-model="colorDialog.open">
      <q-card class="role-table-dialog">
        <q-card-section class="text-subtitle1">{{ colorDialog.title }}</q-card-section>
        <q-card-section>
          <q-color v-model="colorDialog.value" format-model="hex" no-header default-view="palette" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="取消" v-close-popup />
          <q-btn color="primary" label="应用" @click="applyColorPicker" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="addDialog.open">
      <q-card class="role-table-dialog">
        <q-card-section class="text-subtitle1">新增字段</q-card-section>
        <q-card-section class="q-gutter-md">
          <q-select
            v-model="addDialog.bucket"
            :options="bucketOptions"
            dense
            outlined
            emit-value
            map-options
            label="分组"
          />
          <q-input v-model="addDialog.key" dense outlined label="字段名" />
          <q-select
            v-model="addDialog.valueType"
            :options="valueTypeOptions"
            dense
            outlined
            emit-value
            map-options
            label="类型"
          />
          <q-input
            v-if="addDialog.valueType === 'string'"
            v-model="addDialog.valueStr"
            dense
            outlined
            type="textarea"
            autogrow
            label="初始值"
          />
          <q-input
            v-else-if="addDialog.valueType === 'number'"
            v-model.number="addDialog.valueNum"
            dense
            outlined
            type="number"
            label="初始值"
          />
          <q-toggle
            v-else-if="addDialog.valueType === 'boolean'"
            v-model="addDialog.valueBool"
            dense
            label="初始值"
          />
          <q-select
            v-else
            v-model="addDialog.valueArr"
            multiple
            use-input
            use-chips
            new-value-mode="add-unique"
            dense
            outlined
            label="初始值"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="取消" v-close-popup />
          <q-btn color="primary" label="添加" :disable="!addDialog.key.trim()" @click="appendExtra" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import type { BuiltinType, JsonValue, RoleCardModel, RoleType, TextStyleOptions } from 'app/types/role';
import { computed, reactive, ref, watch } from 'vue';
import { useQuasar } from 'quasar';

type LookupCandidateKind = 'pinyin' | 'romanized';
type ArrayBaseFieldKey =
  | 'aliases'
  | 'fixes'
  | 'lookupKeys_pinyin'
  | 'lookupKeys_romanized'
  | 'lookupKeys_spelling';
type EditableBaseStringKey =
  | 'name'
  | 'description'
  | 'affiliation'
  | 'color'
  | 'regex'
  | 'regexFlags';
type ValueType = 'string' | 'number' | 'boolean' | 'string[]';
type ExtraBucket = 'extended' | 'custom';
type StyleFlag = 'bold' | 'italic' | 'strikethrough' | 'underline';

interface ExtraRow {
  bucket: ExtraBucket;
  key: string;
  value: JsonValue;
  valueType: ValueType;
}

const props = defineProps<{ modelValue: RoleCardModel }>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: RoleCardModel): void;
  (e: 'changed', payload: { changedPaths: string[]; snapshot: RoleCardModel }): void;
  (e: 'type-changed', payload: { from: RoleType; to: RoleType; snapshot: RoleCardModel }): void;
  (e: 'request-lookup-candidates', payload: { kind: LookupCandidateKind; snapshot: RoleCardModel }): void;
}>();

const $q = useQuasar();
const draft = reactive<RoleCardModel>(cloneRole(props.modelValue));

watch(
  () => props.modelValue,
  (value) => {
    const next = cloneRole(value);
    draft.base = next.base;
    draft.extended = next.extended;
    draft.custom = next.custom;
    typeModel.value = String(next.base.type || '主角');
  },
  { deep: true },
);

const builtinTypes: BuiltinType[] = ['主角', '配角', '联动角色', '敏感词', '词汇', '正则表达式'];
const typeModel = ref(String(draft.base.type || '主角'));
const typeOptions = computed(() => {
  const current = String(draft.base.type || '').trim();
  return current && !builtinTypes.includes(current as BuiltinType) ? [...builtinTypes, current] : builtinTypes;
});

const arrayRows: Array<{
  field: ArrayBaseFieldKey;
  placeholder: string;
  lookupKind?: LookupCandidateKind;
}> = [
  { field: 'aliases', placeholder: '输入别名后回车' },
  { field: 'lookupKeys_pinyin', placeholder: '输入拼音查询键后回车', lookupKind: 'pinyin' },
  { field: 'lookupKeys_romanized', placeholder: '输入罗马字查询键后回车', lookupKind: 'romanized' },
  { field: 'lookupKeys_spelling', placeholder: '输入拼写查询键后回车' },
  { field: 'fixes', placeholder: '输入敏感词修复项后回车' },
];
const visibleArrayRows = computed(() =>
  arrayRows.filter((row) => row.field !== 'fixes' || draft.base.type === '敏感词'),
);

const bucketOptions = [
  { label: '扩展字段', value: 'extended' },
  { label: '自定义字段', value: 'custom' },
];
const valueTypeOptions = [
  { label: '字符串', value: 'string' },
  { label: '数字', value: 'number' },
  { label: '布尔', value: 'boolean' },
  { label: '字符串数组', value: 'string[]' },
];

const colorDialog = reactive({
  open: false,
  target: 'color' as 'color' | 'background',
  title: '',
  value: '#ffffff',
});

const addDialog = reactive({
  open: false,
  bucket: 'custom' as ExtraBucket,
  key: '',
  valueType: 'string' as ValueType,
  valueStr: '',
  valueNum: 0,
  valueBool: false,
  valueArr: [] as string[],
});

const backgroundColor = computed(() => draft.base.style?.backgroundColor || '');
const chipStyle = computed(() => {
  const style: Record<string, string> = {};
  if (draft.base.color) style.color = draft.base.color;
  if (backgroundColor.value) style.backgroundColor = backgroundColor.value;
  return style;
});
const previewStyle = computed(() => {
  const style: Record<string, string> = {};
  if (draft.base.color) style.color = draft.base.color;
  if (backgroundColor.value) style.backgroundColor = backgroundColor.value;
  if (draft.base.style?.bold) style.fontWeight = '700';
  if (draft.base.style?.italic) style.fontStyle = 'italic';
  const decorations: string[] = [];
  if (draft.base.style?.strikethrough) decorations.push('line-through');
  if (draft.base.style?.underline) decorations.push('underline');
  if (decorations.length) style.textDecoration = decorations.join(' ');
  return style;
});

const extraRows = computed<ExtraRow[]>(() => {
  const rows: ExtraRow[] = [];
  pushExtraRows(rows, draft.extended, 'extended');
  pushExtraRows(rows, draft.custom, 'custom');
  return rows;
});

function updateBaseString(key: EditableBaseStringKey, value: unknown) {
  const clean = toInputString(value);
  if (clean) {
    draft.base[key] = clean;
  } else {
    delete draft.base[key];
  }
  commit([`base.${key}`]);
}

function updatePriority(value: unknown) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    draft.base.priority = numeric;
  } else {
    delete draft.base.priority;
  }
  commit(['base.priority']);
}

function updateWordSegmentFilter(value: boolean) {
  if (value) {
    draft.base.wordSegmentFilter = true;
  } else {
    delete draft.base.wordSegmentFilter;
  }
  commit(['base.wordSegmentFilter']);
}

function onTypeNewValue(value: string, done: (item?: string, mode?: 'add' | 'add-unique' | 'toggle') => void) {
  const clean = toInputString(value).trim();
  if (!clean) {
    done();
    return;
  }
  done(clean, 'add-unique');
  applyType(clean);
}

function applyType(value: string | null) {
  const next = toInputString(value).trim() || '主角';
  const from = draft.base.type;
  typeModel.value = next;
  if (from === next) return;
  draft.base.type = next;
  cleanupTypeSideFields();
  commit(['base.type']);
  emit('type-changed', { from, to: draft.base.type, snapshot: cloneRole(draft) });
}

function getStringList(field: ArrayBaseFieldKey): string[] {
  return Array.isArray(draft.base[field]) ? [...draft.base[field]!] : [];
}

function setStringList(field: ArrayBaseFieldKey, value: unknown) {
  const clean = normalizeStringList(value);
  if (clean.length) {
    draft.base[field] = clean;
  } else {
    delete draft.base[field];
  }
  commit([`base.${field}`]);
}

function openColorPicker(target: 'color' | 'background') {
  colorDialog.target = target;
  colorDialog.title = target === 'color' ? '选择前景色' : '选择背景色';
  colorDialog.value = target === 'color' ? draft.base.color || '#ffffff' : backgroundColor.value || '#ffffff';
  colorDialog.open = true;
}

function applyColorPicker() {
  if (colorDialog.target === 'color') {
    draft.base.color = colorDialog.value;
    commit(['base.color']);
    return;
  }
  ensureStyle().backgroundColor = colorDialog.value;
  commit(['base.style']);
}

function toggleStyle(flag: StyleFlag) {
  const style = ensureStyle();
  if (style[flag]) {
    delete style[flag];
  } else {
    style[flag] = true;
  }
  commit(['base.style']);
}

function resetStyle() {
  delete draft.base.style;
  commit(['base.style']);
}

function requestLookupCandidates(kind: LookupCandidateKind) {
  emit('request-lookup-candidates', { kind, snapshot: cloneRole(draft) });
}

function openAddExtra() {
  addDialog.bucket = 'custom';
  addDialog.key = '';
  addDialog.valueType = 'string';
  addDialog.valueStr = '';
  addDialog.valueNum = 0;
  addDialog.valueBool = false;
  addDialog.valueArr = [];
  addDialog.open = true;
}

function appendExtra() {
  const key = buildUniqueExtraKey(addDialog.bucket, addDialog.key);
  if (!key) return;
  const bucket = ensureExtraBucket(addDialog.bucket);
  bucket[key] = readAddValue();
  addDialog.open = false;
  commit([`${addDialog.bucket}.${key}`]);
}

function updateExtra(row: ExtraRow, value: JsonValue) {
  const bucket = ensureExtraBucket(row.bucket);
  bucket[row.key] = value;
  commit([`${row.bucket}.${row.key}`]);
}

function renameExtra(row: ExtraRow, value: unknown) {
  const next = toInputString(value).trim();
  if (!next || next === row.key) return;
  const bucket = ensureExtraBucket(row.bucket);
  const oldKey = row.key;
  const existingValue = bucket[oldKey];
  delete bucket[oldKey];
  bucket[buildUniqueExtraKey(row.bucket, next)] = existingValue ?? '';
  cleanupEmptyExtraBuckets();
  commit([`${row.bucket}.${oldKey}`, `${row.bucket}.${next}`]);
}

function removeExtra(row: ExtraRow) {
  const bucket = row.bucket === 'extended' ? draft.extended : draft.custom;
  if (!bucket) return;
  delete bucket[row.key];
  cleanupEmptyExtraBuckets();
  commit([`${row.bucket}.${row.key}`]);
}

function commit(changedPaths: string[]) {
  cleanupTypeSideFields();
  for (const field of arrayRows.map((row) => row.field)) {
    if (Array.isArray(draft.base[field]) && draft.base[field]!.length === 0) {
      delete draft.base[field];
      const path = `base.${field}`;
      if (!changedPaths.includes(path)) changedPaths.push(path);
    }
  }
  cleanupEmptyExtraBuckets();
  emit('update:modelValue', cloneRole(draft));
  emit('changed', { changedPaths, snapshot: cloneRole(draft) });
}

function cleanupTypeSideFields() {
  if (draft.base.type !== '正则表达式') {
    delete draft.base.regex;
    delete draft.base.regexFlags;
  }
}

function normalizeStringList(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of source) {
    const clean = toInputString(item).trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function toInputString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function inferType(value: JsonValue): ValueType {
  if (Array.isArray(value)) return 'string[]';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

function pushExtraRows(rows: ExtraRow[], source: Record<string, JsonValue> | undefined, bucket: ExtraBucket) {
  if (!source) return;
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    rows.push({ bucket, key, value, valueType: inferType(value) });
  }
}

function ensureStyle(): TextStyleOptions {
  draft.base.style ??= {};
  return draft.base.style;
}

function ensureExtraBucket(bucket: ExtraBucket): Record<string, JsonValue> {
  if (bucket === 'extended') {
    draft.extended ??= {};
    return draft.extended;
  }
  draft.custom ??= {};
  return draft.custom;
}

function cleanupEmptyExtraBuckets() {
  if (draft.extended && Object.keys(draft.extended).length === 0) delete draft.extended;
  if (draft.custom && Object.keys(draft.custom).length === 0) delete draft.custom;
}

function buildUniqueExtraKey(bucketName: ExtraBucket, rawKey: string): string {
  const clean = rawKey.trim();
  if (!clean) return '';
  const bucket = bucketName === 'extended' ? draft.extended : draft.custom;
  if (!bucket || !(clean in bucket)) return clean;
  let index = 2;
  let candidate = `${clean}_${index}`;
  while (candidate in bucket) {
    index += 1;
    candidate = `${clean}_${index}`;
  }
  return candidate;
}

function readAddValue(): JsonValue {
  if (addDialog.valueType === 'number') return Number(addDialog.valueNum || 0);
  if (addDialog.valueType === 'boolean') return Boolean(addDialog.valueBool);
  if (addDialog.valueType === 'string[]') return normalizeStringList(addDialog.valueArr);
  return addDialog.valueStr;
}

function cloneRole(role: RoleCardModel): RoleCardModel {
  return JSON.parse(JSON.stringify(role ?? { base: { name: '', type: '主角' } })) as RoleCardModel;
}

function copyUUID() {
  if (!draft.base.uuid) return;
  navigator.clipboard
    .writeText(draft.base.uuid)
    .then(() => {
      $q.notify({ message: 'UUID 已复制', type: 'positive', position: 'top' });
    })
    .catch(() => {
      $q.notify({ message: '复制失败', type: 'negative', position: 'top' });
    });
}
</script>

<style scoped>
.role-table-editor {
  width: 100%;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--vscode-widget-border, rgba(127, 127, 127, 0.25));
  border-radius: 8px;
  background: var(--vscode-editor-background, transparent);
}

.role-table-editor__toolbar,
.role-table-editor__meta {
  min-width: 0;
}

.role-table-editor__meta {
  margin: 10px 0 12px;
}

.role-field-table {
  width: 100%;
  table-layout: fixed;
}

.role-field-table :deep(th),
.role-field-table :deep(td) {
  vertical-align: top;
}

.field-name {
  width: 190px;
  max-width: 190px;
  word-break: break-word;
}

.field-type {
  width: 92px;
  color: var(--vscode-descriptionForeground, rgba(127, 127, 127, 0.85));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
}

.field-actions {
  width: 70px;
  text-align: center;
}

.table-input,
.key-input {
  min-width: 0;
  width: 100%;
}

.color-dot {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  border-radius: 4px;
  border: 1px solid rgba(127, 127, 127, 0.45);
}

.style-row {
  display: grid;
  grid-template-columns: minmax(220px, max-content) minmax(160px, 1fr);
  gap: 8px;
  align-items: center;
}

.style-preview {
  min-height: 32px;
  padding: 5px 8px;
  border: 1px solid rgba(127, 127, 127, 0.35);
  border-radius: 6px;
  overflow-wrap: anywhere;
}

.role-table-dialog {
  min-width: 420px;
  max-width: 92vw;
}

@media (max-width: 720px) {
  .role-field-table {
    table-layout: auto;
  }

  .field-name,
  .field-type,
  .field-actions {
    width: auto;
    max-width: none;
  }

  .style-row {
    grid-template-columns: 1fr;
  }
}
</style>
