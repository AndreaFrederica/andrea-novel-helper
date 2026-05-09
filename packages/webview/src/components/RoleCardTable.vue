<template>
  <div class="role-table-editor">
    <div class="role-table-editor__toolbar row items-center q-col-gutter-sm">
      <div class="col-12 col-md-4">
        <q-input
          :model-value="draft.base.name"
          dense
          outlined
          :label="t('roleEditor.tableEditor.name')"
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
          :label="t('roleEditor.tableEditor.type')"
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
          :label="t('roleEditor.tableEditor.priority')"
          :debounce="120"
          @update:model-value="(value) => updatePriority(value)"
        />
      </div>

      <div class="col-6 col-sm-3 col-md-3">
        <q-input
          :model-value="draft.base.affiliation"
          dense
          outlined
          :label="t('roleEditor.tableEditor.affiliation')"
          :debounce="120"
          @update:model-value="(value) => updateBaseString('affiliation', value)"
        />
      </div>
    </div>

    <div class="role-table-editor__meta row items-center q-gutter-sm">
      <q-chip dense square :style="chipStyle">
        {{ draft.base.type || t('roleEditor.tableEditor.uncategorized') }}
      </q-chip>
      <q-chip dense outline>
        UUID: {{ draft.base.uuid || t('roleEditor.tableEditor.unset') }}
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
          <q-tooltip>{{ t('roleEditor.tableEditor.copyUuid') }}</q-tooltip>
        </q-btn>
      </q-chip>
      <q-toggle
        :model-value="draft.base.wordSegmentFilter === true"
        dense
        :label="t('roleEditor.tableEditor.wordSegmentFilter')"
        @update:model-value="updateWordSegmentFilter"
      />
    </div>

    <q-markup-table flat bordered dense wrap-cells class="role-field-table">
      <thead>
        <tr>
          <th class="field-name">{{ t('roleEditor.tableEditor.field') }}</th>
          <th>{{ t('roleEditor.tableEditor.value') }}</th>
          <th class="field-type">{{ t('roleEditor.tableEditor.type') }}</th>
          <th class="field-actions">{{ t('roleEditor.tableEditor.actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="field-name">
            <div class="field-label">
              <span>{{ roleKeyLabel('description').primary }}</span>
              <code v-if="roleKeyLabel('description').secondary">{{ roleKeyLabel('description').secondary }}</code>
            </div>
          </td>
          <td>
            <q-input
              :model-value="draft.base.description"
              dense
              outlined
              type="textarea"
              autogrow
              :placeholder="t('roleEditor.tableEditor.descriptionPlaceholder')"
              :debounce="120"
              @update:model-value="(value) => updateBaseString('description', value)"
            />
          </td>
          <td class="field-type">string</td>
          <td class="field-actions"></td>
        </tr>

        <tr>
          <td class="field-name">
            <div class="field-label">
              <span>{{ roleKeyLabel('style').primary }}</span>
              <code v-if="roleKeyLabel('style').secondary">{{ roleKeyLabel('style').secondary }}</code>
            </div>
          </td>
          <td>
            <div class="style-row">
              <div class="style-controls">
                <div class="style-color-control">
                  <div class="color-dot" :style="{ backgroundColor: draft.base.color || '#cccccc' }" />
                  <q-input
                    :model-value="draft.base.color"
                    dense
                    outlined
                    class="style-color-input"
                    placeholder="#RRGGBB"
                    :aria-label="t('roleEditor.tableEditor.foregroundColor')"
                    :debounce="120"
                    @update:model-value="(value) => updateBaseString('color', value)"
                  >
                    <template #append>
                      <q-btn dense flat round icon="palette" @click="openColorPicker('color')">
                        <q-tooltip>{{ t('roleEditor.tableEditor.foregroundColor') }}</q-tooltip>
                      </q-btn>
                    </template>
                  </q-input>
                </div>
                <q-btn
                  dense
                  flat
                  round
                  icon="format_bold"
                  :color="draft.base.style?.bold ? 'primary' : undefined"
                  @click="toggleStyle('bold')"
                >
                  <q-tooltip>{{ t('roleEditor.tableEditor.bold') }}</q-tooltip>
                </q-btn>
                <q-btn
                  dense
                  flat
                  round
                  icon="format_italic"
                  :color="draft.base.style?.italic ? 'primary' : undefined"
                  @click="toggleStyle('italic')"
                >
                  <q-tooltip>{{ t('roleEditor.tableEditor.italic') }}</q-tooltip>
                </q-btn>
                <q-btn
                  dense
                  flat
                  round
                  icon="format_strikethrough"
                  :color="draft.base.style?.strikethrough ? 'primary' : undefined"
                  @click="toggleStyle('strikethrough')"
                >
                  <q-tooltip>{{ t('roleEditor.tableEditor.strikethrough') }}</q-tooltip>
                </q-btn>
                <q-btn
                  dense
                  flat
                  round
                  icon="format_underlined"
                  :color="draft.base.style?.underline ? 'primary' : undefined"
                  @click="toggleStyle('underline')"
                >
                  <q-tooltip>{{ t('roleEditor.tableEditor.underline') }}</q-tooltip>
                </q-btn>
                <q-separator vertical inset />
                <div class="color-dot" :style="{ backgroundColor: backgroundColor || '#cccccc' }" />
                <q-btn dense flat round icon="format_color_fill" @click="openColorPicker('background')">
                  <q-tooltip>{{ t('roleEditor.tableEditor.backgroundColor') }}</q-tooltip>
                </q-btn>
              </div>
              <div class="style-preview" :style="previewStyle">
                {{ draft.base.name || t('roleEditor.tableEditor.previewText') }}
              </div>
            </div>
          </td>
          <td class="field-type">object</td>
          <td class="field-actions">
            <q-btn dense flat round icon="restart_alt" @click="resetStyle">
              <q-tooltip>{{ t('roleEditor.tableEditor.resetStyle') }}</q-tooltip>
            </q-btn>
          </td>
        </tr>

        <tr v-for="row in visibleArrayRows" :key="row.field">
          <td class="field-name">
            <div class="field-label">
              <span>{{ roleKeyLabel(row.field).primary }}</span>
              <code v-if="roleKeyLabel(row.field).secondary">{{ roleKeyLabel(row.field).secondary }}</code>
            </div>
          </td>
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
              <q-tooltip>{{ t('roleEditor.tableEditor.appendCandidates') }}</q-tooltip>
            </q-btn>
          </td>
        </tr>

        <tr v-if="draft.base.type === '正则表达式'">
          <td class="field-name">
            <div class="field-label">
              <span>{{ roleKeyLabel('regex').primary }}</span>
              <code v-if="roleKeyLabel('regex').secondary">{{ roleKeyLabel('regex').secondary }}</code>
            </div>
          </td>
          <td>
            <q-input
              :model-value="draft.base.regex"
              dense
              outlined
              :placeholder="t('roleEditor.tableEditor.regexPlaceholder')"
              :debounce="120"
              @update:model-value="(value) => updateBaseString('regex', value)"
            />
          </td>
          <td class="field-type">string</td>
          <td class="field-actions"></td>
        </tr>

        <tr v-if="draft.base.type === '正则表达式'">
          <td class="field-name">
            <div class="field-label">
              <span>{{ roleKeyLabel('regexFlags').primary }}</span>
              <code v-if="roleKeyLabel('regexFlags').secondary">{{ roleKeyLabel('regexFlags').secondary }}</code>
            </div>
          </td>
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
            <div class="field-label extra-key-cell">
              <div class="extra-key-cell__title">
                <span>{{ roleKeyLabel(row.key).primary }}</span>
                <span :class="['extra-key-cell__bucket', `extra-key-cell__bucket--${row.bucket}`]">
                  {{ row.bucket }}
                </span>
              </div>
              <q-input
                :model-value="row.key"
                dense
                borderless
                class="key-input extra-key-cell__input"
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
              <q-tooltip>{{ t('roleEditor.tableEditor.deleteField') }}</q-tooltip>
            </q-btn>
          </td>
        </tr>
      </tbody>
    </q-markup-table>

    <div class="row items-center justify-between q-mt-sm">
      <div class="text-caption role-table-summary">
        {{ t('roleEditor.tableEditor.summary') }}
      </div>
      <q-btn dense color="primary" icon="add" :label="t('roleEditor.tableEditor.addField')" @click="openAddExtra" />
    </div>

    <q-dialog v-model="colorDialog.open">
      <q-card class="role-table-dialog">
        <q-card-section class="text-subtitle1">{{ colorDialog.title }}</q-card-section>
        <q-card-section>
          <q-color v-model="colorDialog.value" format-model="hex" no-header default-view="palette" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="t('roleEditor.tableEditor.cancel')" v-close-popup />
          <q-btn color="primary" :label="t('roleEditor.tableEditor.apply')" @click="applyColorPicker" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="addDialog.open">
      <q-card class="role-table-dialog">
        <q-card-section class="text-subtitle1">{{ t('roleEditor.tableEditor.addField') }}</q-card-section>
        <q-card-section class="q-gutter-md">
          <q-select
            v-model="addDialog.bucket"
            :options="bucketOptions"
            dense
            outlined
            emit-value
            map-options
            :label="t('roleEditor.tableEditor.bucket')"
          />
          <q-select
            v-if="addDialog.bucket === 'extended'"
            v-model="addDialog.key"
            :options="extendedKeyOptions"
            dense
            outlined
            use-input
            fill-input
            hide-selected
            input-debounce="0"
            emit-value
            map-options
            new-value-mode="add-unique"
            :label="t('roleEditor.tableEditor.fieldName')"
          />
          <q-input v-else v-model="addDialog.key" dense outlined :label="t('roleEditor.tableEditor.fieldName')" />
          <q-select
            v-model="addDialog.valueType"
            :options="valueTypeOptions"
            dense
            outlined
            emit-value
            map-options
            :label="t('roleEditor.tableEditor.valueType')"
          />
          <q-input
            v-if="addDialog.valueType === 'string'"
            v-model="addDialog.valueStr"
            dense
            outlined
            type="textarea"
            autogrow
            :label="t('roleEditor.tableEditor.initialValue')"
          />
          <q-input
            v-else-if="addDialog.valueType === 'number'"
            v-model.number="addDialog.valueNum"
            dense
            outlined
            type="number"
            :label="t('roleEditor.tableEditor.initialValue')"
          />
          <q-toggle
            v-else-if="addDialog.valueType === 'boolean'"
            v-model="addDialog.valueBool"
            dense
            :label="t('roleEditor.tableEditor.initialValue')"
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
            :label="t('roleEditor.tableEditor.initialValue')"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="t('roleEditor.tableEditor.cancel')" v-close-popup />
          <q-btn color="primary" :label="t('roleEditor.tableEditor.add')" :disable="!addDialog.key.trim()" @click="appendExtra" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import type { BuiltinType, JsonValue, RoleCardModel, RoleType, TextStyleOptions } from 'app/types/role';
import { computed, reactive, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import {
  EXTENDED_ROLE_KEY_LIST,
  formatRoleKeyInline,
  formatRoleKeyLabel,
  type RoleKeyLabel,
} from '../utils/roleKeyLabels';

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

const props = withDefaults(defineProps<{
  modelValue: RoleCardModel;
  localizedKeyLabels?: boolean;
  displayLanguage?: string;
}>(), {
  localizedKeyLabels: true,
  displayLanguage: '',
});
const emit = defineEmits<{
  (e: 'update:modelValue', v: RoleCardModel): void;
  (e: 'changed', payload: { changedPaths: string[]; snapshot: RoleCardModel }): void;
  (e: 'type-changed', payload: { from: RoleType; to: RoleType; snapshot: RoleCardModel }): void;
  (e: 'request-lookup-candidates', payload: { kind: LookupCandidateKind; snapshot: RoleCardModel }): void;
}>();

const $q = useQuasar();
const { t } = useI18n();
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
  { field: 'aliases', placeholder: t('roleEditor.tableEditor.placeholders.aliases') },
  { field: 'lookupKeys_pinyin', placeholder: t('roleEditor.tableEditor.placeholders.pinyin'), lookupKind: 'pinyin' },
  { field: 'lookupKeys_romanized', placeholder: t('roleEditor.tableEditor.placeholders.romanized'), lookupKind: 'romanized' },
  { field: 'lookupKeys_spelling', placeholder: t('roleEditor.tableEditor.placeholders.spelling') },
  { field: 'fixes', placeholder: t('roleEditor.tableEditor.placeholders.fixes') },
];
const visibleArrayRows = computed(() =>
  arrayRows.filter((row) => row.field !== 'fixes' || draft.base.type === '敏感词'),
);

const bucketOptions = computed(() => [
  { label: t('roleEditor.tableEditor.buckets.extended'), value: 'extended' },
  { label: t('roleEditor.tableEditor.buckets.custom'), value: 'custom' },
]);
const valueTypeOptions = computed(() => [
  { label: t('roleEditor.tableEditor.valueTypes.string'), value: 'string' },
  { label: t('roleEditor.tableEditor.valueTypes.number'), value: 'number' },
  { label: t('roleEditor.tableEditor.valueTypes.boolean'), value: 'boolean' },
  { label: t('roleEditor.tableEditor.valueTypes.stringArray'), value: 'string[]' },
]);

const extendedKeyOptions = computed(() =>
  EXTENDED_ROLE_KEY_LIST.map((key) => ({
    label: formatRoleKeyInline(key, props.localizedKeyLabels, props.displayLanguage),
    value: key,
  })),
);

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

function roleKeyLabel(key: string): RoleKeyLabel {
  return formatRoleKeyLabel(key, props.localizedKeyLabels, props.displayLanguage);
}

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
  colorDialog.title = target === 'color'
    ? t('roleEditor.tableEditor.foregroundColor')
    : t('roleEditor.tableEditor.backgroundColor');
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
  delete draft.base.color;
  commit(['base.style', 'base.color']);
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
      $q.notify({ message: t('roleEditor.tableEditor.uuidCopied'), type: 'positive', position: 'top' });
    })
    .catch(() => {
      $q.notify({ message: t('roleEditor.tableEditor.copyFailed'), type: 'negative', position: 'top' });
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
  color: var(--vscode-editor-foreground, inherit);
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background, transparent));
}

.role-table-editor__toolbar,
.role-table-editor__meta {
  min-width: 0;
}

.role-table-editor__meta {
  margin: 10px 0 12px;
}

.role-table-editor :deep(.q-field--outlined .q-field__control),
.role-table-editor :deep(.q-field--filled .q-field__control) {
  color: var(--vscode-input-foreground, var(--vscode-editor-foreground, inherit));
  background: var(--vscode-input-background, rgba(127, 127, 127, 0.12));
  border-color: var(--vscode-input-border, var(--vscode-widget-border, rgba(127, 127, 127, 0.35)));
}

.role-table-editor :deep(.q-field__native),
.role-table-editor :deep(.q-field__input),
.role-table-editor :deep(.q-field__label),
.role-table-editor :deep(.q-toggle__label),
.role-table-editor :deep(.q-item),
.role-table-editor :deep(.q-item__label) {
  color: var(--vscode-input-foreground, var(--vscode-editor-foreground, inherit));
}

.role-table-editor :deep(.q-field__label) {
  color: var(--vscode-descriptionForeground, rgba(127, 127, 127, 0.85));
}

.role-field-table {
  width: 100%;
  table-layout: fixed;
  color: var(--vscode-editor-foreground, inherit);
  background: var(--vscode-editor-background, transparent);
  border-color: var(--vscode-widget-border, rgba(127, 127, 127, 0.25));
}

.role-field-table :deep(th),
.role-field-table :deep(td) {
  vertical-align: top;
  color: var(--vscode-editor-foreground, inherit);
  background: transparent;
  border-color: var(--vscode-widget-border, rgba(127, 127, 127, 0.22));
}

.role-field-table :deep(thead th) {
  background: var(--vscode-sideBarSectionHeader-background, rgba(127, 127, 127, 0.1));
  color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-editor-foreground, inherit));
}

.role-table-summary {
  color: var(--vscode-descriptionForeground, rgba(127, 127, 127, 0.85));
}

.field-name {
  width: 190px;
  max-width: 190px;
  word-break: break-word;
}

.field-label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  font-weight: 600;
}

.field-label code,
.field-label__hint {
  color: var(--vscode-descriptionForeground, rgba(127, 127, 127, 0.8));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  font-size: 11px;
  font-weight: 400;
  overflow-wrap: anywhere;
}

.extra-key-cell {
  min-width: 0;
}

.extra-key-cell__title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
}

.extra-key-cell__title > span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.extra-key-cell__bucket {
  flex: 0 0 auto;
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--vscode-badge-foreground, #fff);
  background: var(--vscode-badge-background, rgba(127, 127, 127, 0.55));
  font-size: 10px;
  font-weight: 600;
  line-height: 1.35;
}

.extra-key-cell__bucket--extended {
  color: var(--vscode-button-foreground, #fff);
  background: var(--vscode-textLink-foreground, #3794ff);
}

.extra-key-cell__bucket--custom {
  color: var(--vscode-button-foreground, #fff);
  background: var(--vscode-charts-orange, #d18616);
}

.extra-key-cell__input {
  width: 100%;
  max-width: 100%;
}

.extra-key-cell__input :deep(.q-field__control) {
  min-height: 26px;
  height: 26px;
  padding: 0 6px;
  border-radius: 5px;
  background: var(--vscode-input-background, rgba(127, 127, 127, 0.15));
}

.extra-key-cell__input :deep(.q-field__native) {
  min-height: 26px;
  padding: 0;
  color: var(--vscode-input-foreground, var(--vscode-editor-foreground, inherit));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
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
  grid-template-columns: minmax(360px, max-content) minmax(160px, 1fr);
  gap: 8px;
  align-items: center;
}

.style-controls,
.style-color-control {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.style-controls {
  flex-wrap: wrap;
}

.style-color-control {
  width: 176px;
}

.style-color-input {
  min-width: 0;
  flex: 1 1 auto;
}

.style-color-input :deep(.q-field__append) {
  padding-left: 2px;
}

.style-preview {
  min-height: 32px;
  padding: 5px 8px;
  border: 1px solid var(--vscode-widget-border, rgba(127, 127, 127, 0.35));
  border-radius: 6px;
  overflow-wrap: anywhere;
}

.role-table-dialog {
  min-width: 420px;
  max-width: 92vw;
  color: var(--vscode-editorWidget-foreground, var(--vscode-editor-foreground, inherit));
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background, inherit));
  border: 1px solid var(--vscode-widget-border, rgba(127, 127, 127, 0.25));
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
