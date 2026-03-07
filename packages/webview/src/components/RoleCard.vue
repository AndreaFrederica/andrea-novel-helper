<template>
  <q-card bordered class="q-pa-md role-card">
    <!-- ===== 基础字段 ===== -->
    <q-card-section class="q-gutter-md">
      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-6">
          <q-input
            v-model="draft.base.name"
            label="名称 (name)"
            dense
            filled
            :debounce="150"
            @update:model-value="commit(['base.name'])"
          />
        </div>

        <div class="col-12 col-md-6">
          <q-select
            v-model="typeSelect"
            :options="typeOptions"
            label="类型 (type)"
            dense
            filled
            emit-value
            map-options
            @update:model-value="onTypeSelect"
          />
        </div>

        <div class="col-12 col-md-6">
          <q-input
            v-model="draft.base.description"
            type="textarea"
            autogrow
            label="描述 (description)"
            dense
            filled
            :debounce="150"
            @update:model-value="commit(['base.description'])"
          />
        </div>

        <div class="col-12 col-md-6">
          <q-input
            v-model="draft.base.affiliation"
            label="从属 (affiliation)"
            dense
            filled
            :debounce="150"
            @update:model-value="commit(['base.affiliation'])"
          />
        </div>

        <div v-if="typeSelect === '__custom__'" class="col-12 col-md-6">
          <q-input
            v-model="customType"
            label="自定义类型"
            dense
            filled
            :debounce="150"
            @update:model-value="onCustomTypeInput"
          />
        </div>

        <div class="col-12 col-md-6">
          <q-input
            v-model.number="draft.base.priority"
            type="number"
            label="优先级 (priority)"
            dense
            filled
            :debounce="150"
            @update:model-value="commit(['base.priority'])"
          />
        </div>

        <div class="col-12 col-md-6">
          <q-toggle
            label="是否受到分词器过滤影响 (wordSegmentFilter)"
            color="pink"
            false-value="Disagreed"
            true-value="Agreed"
            v-model="draft.base.wordSegmentFilter"
            @update:model-value="commit(['base.wordSegmentFilter'])"
          />
        </div>

        <!-- UUID字段 -->
        <div class="col-12 col-md-6">
          <q-input
            v-model="draft.base.uuid"
            label="UUID (uuid)"
            dense
            filled
            readonly
            :debounce="150"
            @update:model-value="commit(['base.uuid'])"
          >
            <template #append>
              <q-btn dense flat icon="content_copy" @click="copyUUID" />
            </template>
          </q-input>
        </div>

        <div class="col-12 col-md-6">
          <div class="row items-center q-col-gutter-sm">
            <div class="col">
              <q-input
                v-model="draft.base.color"
                label="前景色 (color)"
                dense
                filled
                :debounce="150"
                @update:model-value="commit(['base.color'])"
              >
                <template #append>
                  <q-btn dense flat icon="palette" @click="openColor = true" />
                </template>
              </q-input>
            </div>
            <div class="col-auto">
              <div class="color-dot" :style="{ backgroundColor: draft.base.color || '#ccc' }" />
            </div>
          </div>
          <q-dialog v-model="openColor">
            <q-card>
              <q-card-section class="text-subtitle1">选择前景色</q-card-section>
              <q-card-section>
                <q-color
                  v-model="colorPicker"
                  format-model="hex"
                  no-header
                  default-view="palette"
                />
              </q-card-section>
              <q-card-actions align="right">
                <q-btn flat label="取消" v-close-popup />
                <q-btn color="primary" label="应用" @click="applyColor()" v-close-popup />
              </q-card-actions>
            </q-card>
          </q-dialog>
        </div>

        <!-- 背景色 -->
        <div class="col-12 col-md-6">
          <div class="row items-center q-col-gutter-sm">
            <div class="col">
              <q-input
                v-model="backgroundColor"
                label="背景色 (backgroundColor)"
                dense
                filled
                :debounce="150"
              >
                <template #append>
                  <q-btn dense flat icon="palette" @click="openBackgroundColor = true" />
                </template>
              </q-input>
            </div>
            <div class="col-auto">
              <div class="color-dot" :style="{ backgroundColor: backgroundColor || '#ccc' }" />
            </div>
          </div>
          <q-dialog v-model="openBackgroundColor">
            <q-card>
              <q-card-section class="text-subtitle1">选择背景色</q-card-section>
              <q-card-section>
                <q-color
                  v-model="backgroundColorPicker"
                  format-model="hex"
                  no-header
                  default-view="palette"
                />
              </q-card-section>
              <q-card-actions align="right">
                <q-btn flat label="取消" v-close-popup />
                <q-btn color="primary" label="应用" @click="applyBackgroundColor()" v-close-popup />
              </q-card-actions>
            </q-card>
          </q-dialog>
        </div>

        <!-- 文本样式选项 -->
        <div class="col-12">
          <div class="text-subtitle2 q-mb-sm">文本样式</div>
          <div class="row q-col-gutter-md">
            <div class="col-auto">
              <q-toggle
                v-model="bold"
                label="粗体"
                color="primary"
                @update:model-value="commit(['base.style'])"
              />
            </div>
            <div class="col-auto">
              <q-toggle
                v-model="italic"
                label="斜体"
                color="primary"
                @update:model-value="commit(['base.style'])"
              />
            </div>
            <div class="col-auto">
              <q-toggle
                v-model="strikethrough"
                label="删除线"
                color="primary"
                @update:model-value="commit(['base.style'])"
              />
            </div>
            <div class="col-auto">
              <q-toggle
                v-model="underline"
                label="下划线"
                color="primary"
                @update:model-value="commit(['base.style'])"
              />
            </div>
          </div>
          <!-- 样式预览 -->
          <div class="q-mt-sm q-pa-sm rounded-borders" :style="previewStyle">
            <span>{{ draft.base.name || '预览文本' }}</span>
          </div>
        </div>

        <!-- 别名：逐行编辑，每行一个，最后保留空行用于添加 -->
        <div class="col-12">
          <div class="row items-center q-mb-xs">
            <div class="text-subtitle2">别名（基础字段）</div>
            <q-badge class="q-ml-sm" color="primary" outline>aliases</q-badge>
          </div>
          <div class="q-pa-sm aliases-list">
            <div
              v-for="i in aliasesUI"
              :key="'alias-' + i"
              class="row items-center q-col-gutter-sm q-mb-xs"
            >
              <div class="col">
                <q-input
                  :model-value="i < aliasesModel.length ? aliasesModel[i] : aliasDraft"
                  dense
                  filled
                  placeholder="输入别名，回车/离焦以添加"
                  @update:model-value="(val) => onAliasesInput(i, String(val || ''))"
                  @keyup.enter="() => onAliasesConfirm(i)"
                  @blur="() => onAliasesConfirm(i)"
                />
              </div>
              <div class="col-auto">
                <q-btn
                  flat
                  dense
                  icon="delete"
                  color="negative"
                  @click="removeAlias(i)"
                  v-if="i < aliasesModel.length"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- 正则表达式专属基础字段 -->
        <template v-if="draft.base.type === '正则表达式'">
          <div class="col-12 col-md-8">
            <q-input
              v-model="draft.base.regex"
              label="正则模式 (regex)"
              dense
              filled
              :debounce="150"
              @update:model-value="commit(['base.regex'])"
            />
          </div>
          <div class="col-12 col-md-4">
            <q-input
              v-model="draft.base.regexFlags"
              label="标志 (regexFlags，例如 gmi)"
              dense
              filled
              :debounce="150"
              @update:model-value="commit(['base.regexFlags'])"
            />
          </div>
        </template>

        <!-- fixes：逐行编辑（仅敏感词可编辑），每行一个，末行空用于添加 -->
        <template v-if="draft.base.type === '敏感词'">
          <div class="col-12">
            <div class="row items-center q-mb-xs">
              <div class="text-subtitle2">修复词（敏感词专用）</div>
              <q-badge class="q-ml-sm" color="primary" outline>fixes</q-badge>
            </div>
            <div class="q-pa-sm fixes-list">
              <div
                v-for="i in fixesUI"
                :key="'fix-' + i"
                class="row items-center q-col-gutter-sm q-mb-xs"
              >
                <div class="col">
                  <q-input
                    :model-value="i < fixesModel.length ? fixesModel[i] : fixDraft"
                    dense
                    filled
                    placeholder="输入修复词，回车/离焦以添加"
                    @update:model-value="(val) => onFixesInput(i, String(val || ''))"
                    @keyup.enter="() => onFixesConfirm(i)"
                    @blur="() => onFixesConfirm(i)"
                  />
                </div>
                <div class="col-auto">
                  <q-btn
                    flat
                    dense
                    icon="delete"
                    color="negative"
                    @click="removeFix(i)"
                    v-if="i < fixesModel.length"
                  />
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </q-card-section>

    <q-separator />

    <!-- ===== 扩展 & 自定义 字段（统一列表）===== -->
    <q-card-section>
        <div class="row items-center justify-between q-mb-sm">
        <div class="text-subtitle2">扩展 / 自定义字段</div>
        <q-btn dense color="primary" icon="add" label="新增字段" @click="onOpenAdd" />
      </div>

      <div v-if="mergedEntries.length === 0" :class="[isDark ? 'text-grey-5' : 'text-grey-6']">
        暂无字段。你可以点击「新增字段」添加（默认归入自定义）。
      </div>

      <q-list v-else bordered class="rounded-borders">
        <q-expansion-item
          v-for="(item, idx) in mergedEntries"
          :key="item.key"
          expand-separator
          icon="notes"
          :label="displayLabel(item)"
          :caption="item.bucket === 'extended' ? '扩展字段' : '自定义字段'"
          default-opened
          :header-class="[(isDark ? 'bg-grey-9' : 'bg-grey-1'), 'expansion-header-wrap']"
        >
          <div class="q-pa-sm q-gutter-sm">
            <div class="row q-col-gutter-md">
              <div class="col-12 col-md-4">
                <q-input
                  v-model="item.key"
                  dense
                  filled
                  label="字段 key"
                  :debounce="150"
                  @update:model-value="onExtraEditKey(idx)"
                />
              </div>
              <div class="col-12 col-md-4">
                <q-select
                  v-model="item.valueType"
                  :options="valueTypeOptions"
                  dense
                  filled
                  label="值类型"
                  :disable="item.locked"
                  emit-value
                  map-options
                  @update:model-value="onExtraTypeChange(idx)"
                />
              </div>
              <div class="col-12 col-md-4">
                <q-select
                  v-model="item.bucket"
                  :options="bucketOptions"
                  dense
                  filled
                  label="类别（扩展/自定义）"
                  emit-value
                  map-options
                  @update:model-value="onExtraBucketChange(idx)"
                />
              </div>

              <!-- 值编辑：按 valueType 渲染 -->
              <div class="col-12" v-if="item.valueType === 'string'">
                <q-input
                  v-model="item.valueStr"
                  type="textarea"
                  autogrow
                  dense
                  filled
                  label="值（字符串 / Markdown）"
                  :debounce="150"
                  @update:model-value="onExtraValueChange(idx)"
                />
                <q-expansion-item
                  dense
                  icon="visibility"
                  label="预览"
                  :header-class="isDark ? 'bg-grey-9' : 'bg-grey-2'"
                >
                  <q-markdown :src="item.valueStr || '（空）'" />
                </q-expansion-item>
              </div>

              <div class="col-12" v-else-if="item.valueType === 'number'">
                <q-input
                  v-model.number="item.valueNum"
                  type="number"
                  dense
                  filled
                  label="值（数字）"
                  :debounce="150"
                  @update:model-value="onExtraValueChange(idx)"
                />
              </div>

              <div class="col-12" v-else-if="item.valueType === 'boolean'">
                <q-toggle
                  v-model="item.valueBool"
                  label="布尔值"
                  @update:model-value="onExtraValueChange(idx)"
                />
              </div>

              <div class="col-12" v-else-if="item.valueType === 'string[]'">
                <q-select
                  v-model="item.valueArr"
                  multiple
                  use-input
                  new-value-mode="add-unique"
                  input-debounce="0"
                  dense
                  filled
                  label="字符串数组；回车添加"
                  @update:model-value="onExtraValueChange(idx)"
                />
              </div>

              <div class="col-12 row justify-between">
                <div class="col-auto">
                  <q-btn
                    flat
                    dense
                    icon="arrow_upward"
                    label="上移"
                    :disable="idx === 0"
                    @click="moveExtra(idx, -1)"
                  />
                  <q-btn
                    flat
                    dense
                    icon="arrow_downward"
                    label="下移"
                    :disable="idx === mergedEntries.length - 1"
                    @click="moveExtra(idx, 1)"
                  />
                </div>
                <div class="col-auto">
                  <q-btn
                    flat
                    dense
                    color="negative"
                    icon="delete"
                    label="删除"
                    @click="removeExtra(idx)"
                  />
                </div>
              </div>
            </div>
          </div>
        </q-expansion-item>
      </q-list>
    </q-card-section>

    <!-- 新增字段对话框 -->
    <q-dialog v-model="openAdd">
      <q-card style="min-width: 540px; max-width: 90vw">
        <q-card-section class="text-h6">新增字段</q-card-section>
        <q-card-section class="q-gutter-md">
          <div v-if="addForm.bucket === 'extended'">
            <q-select v-model="addForm.key" :options="EXTENDED_KEY_OPTIONS" label="字段 key（扩展字段：从列表选择）" dense filled emit-value map-options />
          </div>
          <div v-else>
            <q-input v-model="addForm.key" label="字段 key" dense filled />
          </div>
          <q-select
            v-model="addForm.valueType"
            :options="valueTypeOptions"
            :disable="addTypeLocked"
            emit-value
            map-options
            dense
            filled
            label="值类型"
          />
          <q-select
            v-model="addForm.bucket"
            :options="bucketOptions"
            emit-value
            map-options
            dense
            filled
            label="类别（扩展/自定义）"
          />
          <q-input
            v-if="addForm.valueType === 'string'"
            v-model="addForm.valueStr"
            type="textarea"
            autogrow
            dense
            filled
            label="值（字符串/Markdown）"
          />
          <q-input
            v-else-if="addForm.valueType === 'number'"
            v-model.number="addForm.valueNum"
            type="number"
            dense
            filled
            label="值（数字）"
          />
          <q-toggle
            v-else-if="addForm.valueType === 'boolean'"
            v-model="addForm.valueBool"
            label="布尔值"
          />
          <q-select
            v-else-if="addForm.valueType === 'string[]'"
            v-model="addForm.valueArr"
            multiple
            use-input
            new-value-mode="add-unique"
            input-debounce="0"
            dense
            filled
            label="字符串数组；回车添加"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="取消" v-close-popup />
          <q-btn
            color="primary"
            label="添加"
            :disable="!addForm.key"
            @click="appendExtra"
            v-close-popup
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-card>
</template>

<script lang="ts" setup>
import type { BuiltinType, JsonValue, RoleCardModel, RoleType } from 'app/types/role';
import { computed, reactive, watch, ref } from 'vue';
import { useQuasar } from 'quasar';

// 是否在「新增字段」对话框打开时，强制把值类型锁定为字符串（只读）
// NOTE: 将来应由扩展（extension 主体）通过配置或消息提供此开关，本地先用常量占位以便测试。
const DEFAULT_LOCK_NEW_FIELD_TYPE = true;

const $q = useQuasar();
const isDark = computed(() => $q.dark.isActive);

const props = defineProps<{ modelValue: RoleCardModel }>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: RoleCardModel): void;
  (e: 'changed', payload: { changedPaths: string[]; snapshot: RoleCardModel }): void;
  (e: 'type-changed', payload: { from: RoleType; to: RoleType; snapshot: RoleCardModel }): void;
}>();

/** ====== 本地草稿 ====== */
const draft = reactive<RoleCardModel>(cloneRole(props.modelValue));
watch(
  () => props.modelValue,
  (v) => Object.assign(draft, cloneRole(v)),
  { deep: true },
);

/** ====== 类型选择（内置 + 自定义） ====== */
const builtinTypes: BuiltinType[] = ['主角', '配角', '联动角色', '敏感词', '词汇', '正则表达式'];
const typeOptions = computed(() => [
  ...builtinTypes.map((t) => ({ label: t, value: t })),
  { label: '自定义…', value: '__custom__' },
]);
const typeSelect = ref<string>(
  builtinTypes.includes(draft.base.type as BuiltinType)
    ? (draft.base.type as string)
    : '__custom__',
);
const customType = ref<string>(
  builtinTypes.includes(draft.base.type as BuiltinType) ? '' : String(draft.base.type || '').trim(),
);

function onTypeSelect(v: string) {
  if (v === '__custom__') {
    emitChanged([]); // 等待输入自定义名
    return;
  } else {
    const from = draft.base.type;
    draft.base.type = v as BuiltinType;
    cleanupTypeSideFields();
    commit(['base.type']);
    emit('type-changed', { from, to: draft.base.type, snapshot: cloneRole(draft) });
  }
}

function onCustomTypeInput() {
  const val = customType.value.trim();
  if (val.length === 0) return;
  const from = draft.base.type;
  draft.base.type = val;
  cleanupTypeSideFields();
  commit(['base.type']);
  emit('type-changed', { from, to: draft.base.type, snapshot: cloneRole(draft) });
}

/** ====== 颜色取色器 ====== */
const openColor = ref(false);
const colorPicker = ref<string>(draft.base.color || '#ffffff');
watch(
  () => draft.base.color,
  (v) => {
    colorPicker.value = v || '#ffffff';
  },
);
function applyColor() {
  draft.base.color = colorPicker.value;
  commit(['base.color']);
}

/** ====== 文本样式 ====== */
// 确保 draft.base.style 存在
watch(
  () => draft.base.style,
  (v) => {
    if (!v) {
      draft.base.style = {};
    }
  },
  { immediate: true },
);

// 背景色
const backgroundColor = ref<string>(draft.base.style?.backgroundColor || '');
const backgroundColorPicker = ref<string>(backgroundColor.value || '#ffffff');
const openBackgroundColor = ref(false);

watch(
  () => backgroundColor.value,
  (v) => {
    if (!draft.base.style) draft.base.style = {};
    if (v) {
      draft.base.style.backgroundColor = v;
    } else {
      delete draft.base.style.backgroundColor;
    }
    backgroundColorPicker.value = v || '#ffffff';
    commit(['base.style']);
  },
);

watch(
  () => draft.base.style?.backgroundColor,
  (v) => {
    backgroundColor.value = v || '';
  },
);

function applyBackgroundColor() {
  backgroundColor.value = backgroundColorPicker.value;
  if (!draft.base.style) draft.base.style = {};
  if (backgroundColorPicker.value) {
    draft.base.style.backgroundColor = backgroundColorPicker.value;
  } else {
    delete draft.base.style.backgroundColor;
  }
  commit(['base.style']);
}

// 粗体
const bold = ref<boolean>(draft.base.style?.bold || false);
watch(
  () => bold.value,
  (v) => {
    if (!draft.base.style) draft.base.style = {};
    if (v) {
      draft.base.style.bold = true;
    } else {
      delete draft.base.style.bold;
    }
    commit(['base.style']);
  },
);
watch(
  () => draft.base.style?.bold,
  (v) => {
    bold.value = !!v;
  },
);

// 斜体
const italic = ref<boolean>(draft.base.style?.italic || false);
watch(
  () => italic.value,
  (v) => {
    if (!draft.base.style) draft.base.style = {};
    if (v) {
      draft.base.style.italic = true;
    } else {
      delete draft.base.style.italic;
    }
    commit(['base.style']);
  },
);
watch(
  () => draft.base.style?.italic,
  (v) => {
    italic.value = !!v;
  },
);

// 删除线
const strikethrough = ref<boolean>(draft.base.style?.strikethrough || false);
watch(
  () => strikethrough.value,
  (v) => {
    if (!draft.base.style) draft.base.style = {};
    if (v) {
      draft.base.style.strikethrough = true;
    } else {
      delete draft.base.style.strikethrough;
    }
    commit(['base.style']);
  },
);
watch(
  () => draft.base.style?.strikethrough,
  (v) => {
    strikethrough.value = !!v;
  },
);

// 下划线
const underline = ref<boolean>(draft.base.style?.underline || false);
watch(
  () => underline.value,
  (v) => {
    if (!draft.base.style) draft.base.style = {};
    if (v) {
      draft.base.style.underline = true;
    } else {
      delete draft.base.style.underline;
    }
    commit(['base.style']);
  },
);
watch(
  () => draft.base.style?.underline,
  (v) => {
    underline.value = !!v;
  },
);

// 样式预览
const previewStyle = computed(() => {
  const style: Record<string, string> = {};
  if (draft.base.color) style.color = draft.base.color;
  if (backgroundColor.value) style.backgroundColor = backgroundColor.value;
  if (bold.value) style.fontWeight = 'bold';
  if (italic.value) style.fontStyle = 'italic';
  if (strikethrough.value) style.textDecoration = 'line-through';
  if (underline.value) style.textDecoration = style.textDecoration ? `${style.textDecoration} underline` : 'underline';
  return style;
});

/** ====== 别名 / 修复词（基础字段字符串数组） ====== */
const aliasesModel = ref<string[]>(
  Array.isArray(draft.base.aliases) ? draft.base.aliases.slice() : [],
);
const fixesModel = ref<string[]>(Array.isArray(draft.base.fixes) ? draft.base.fixes.slice() : []);

/** —— 别名/修复词：输入缓存（只对“最后一行”生效，避免输入法合成阶段误提交） —— */
const aliasDraft = ref<string>(''); // 别名的“新增空行”的输入缓存
const fixDraft = ref<string>(''); // fixes 的“新增空行”的输入缓存

/** 当用户在最后一行输入时，先写入缓存；在已有项上编辑则直接写回数组 */
function onAliasesInput(i: number, val: string) {
  if (i < aliasesModel.value.length) {
    // 编辑已有项
    const arr = aliasesModel.value.slice();
    arr[i] = val.trim();
    if (!arr[i]) arr.splice(i, 1);
    onAliasesUpdate(arr);
  } else {
    // 正在编辑“新增空行”
    aliasDraft.value = val;
  }
}

/** 确认新增：回车/离焦时，把缓存变成正式项 */
function onAliasesConfirm(i: number) {
  if (i === aliasesModel.value.length) {
    const v = (aliasDraft.value || '').trim();
    if (v) {
      const arr = aliasesModel.value.slice();
      if (!arr.includes(v)) arr.push(v);
      onAliasesUpdate(arr);
    }
    aliasDraft.value = ''; // 清空缓存，保持末行为空
  }
}

function onFixesInput(i: number, val: string) {
  if (i < fixesModel.value.length) {
    const arr = fixesModel.value.slice();
    arr[i] = val.trim();
    if (!arr[i]) arr.splice(i, 1);
    onFixesUpdate(arr);
  } else {
    fixDraft.value = val;
  }
}

function onFixesConfirm(i: number) {
  if (i === fixesModel.value.length) {
    const v = (fixDraft.value || '').trim();
    if (v) {
      const arr = fixesModel.value.slice();
      if (!arr.includes(v)) arr.push(v);
      onFixesUpdate(arr);
    }
    fixDraft.value = '';
  }
}

// 外部变化同步
watch(
  () => draft.base.aliases,
  (v) => {
    aliasesModel.value = Array.isArray(v) ? v.slice() : [];
  },
);
watch(
  () => draft.base.fixes,
  (v) => {
    fixesModel.value = Array.isArray(v) ? v.slice() : [];
  },
);

// 监听本地模型：当用户在 UI 中删除到空数组时，确保把 draft.base.aliases/fixes 置为 undefined 并提交
watch(aliasesModel, (v) => {
  if (Array.isArray(v) && v.length === 0 && draft.base.aliases !== undefined) {
    // 用户清空了别名：确保删除基础字段并触发提交
    draft.base.aliases = undefined;
    commit(['base.aliases']);
  }
});
watch(fixesModel, (v) => {
  if (Array.isArray(v) && v.length === 0 && draft.base.fixes !== undefined) {
    // 用户清空了 fixes：确保删除基础字段并触发提交
    draft.base.fixes = undefined;
    commit(['base.fixes']);
  }
});

// 类型切换：敏感词时刷新本地镜像（不清空数据）
watch(
  () => draft.base.type,
  (t) => {
    if (t === '敏感词') {
      fixesModel.value = draft.base.fixes ? draft.base.fixes.slice() : [];
    }
  },
);

function normalizeStrList(vals: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of vals || []) {
    if (v === null || v === undefined) continue;
    let s: string;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      s = String(v).trim();
    } else {
      // skip objects/arrays/non-primitive values
      continue;
    }
    if (!s) continue;
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function onAliasesUpdate(vals: string[]) {
  const clean = normalizeStrList(vals);
  aliasesModel.value = clean;
  draft.base.aliases = clean.length ? clean : undefined;
  commit(['base.aliases']);
}

function onFixesUpdate(vals: string[]) {
  const clean = normalizeStrList(vals);
  fixesModel.value = clean;
  draft.base.fixes = clean.length ? clean : undefined;
  commit(['base.fixes']);
}

// 为逐行编辑提供视图长度（保证始终有一行空行用于添加）
const aliasesUI = computed(() => {
  return Array.from({ length: Math.max(1, aliasesModel.value.length + 1) }, (_, i) => i);
});
const fixesUI = computed(() => {
  return Array.from({ length: Math.max(1, fixesModel.value.length + 1) }, (_, i) => i);
});

function removeAlias(i: number) {
  const arr = aliasesModel.value.slice();
  if (i < arr.length) {
    arr.splice(i, 1);
    onAliasesUpdate(arr);
  }
}

function removeFix(i: number) {
  const arr = fixesModel.value.slice();
  if (i < arr.length) {
    arr.splice(i, 1);
    onFixesUpdate(arr);
  }
}

/** ====== 正则/敏感词适配性清理（最小必要） ====== */
function cleanupTypeSideFields() {
  const t = draft.base.type;
  if (t !== '正则表达式') {
    if (draft.base.regex) delete draft.base.regex;
    if (draft.base.regexFlags) delete draft.base.regexFlags;
  }
  // aliases / fixes 作为基础字段不再按类型强删
}

/** ====== 统一的变更提交 + 广播 ====== */
function commit(changedPaths: string[]) {
  // 非正则：清理正则字段（避免误存）
  if (draft.base.type !== '正则表达式') {
    if (draft.base.regex) delete draft.base.regex;
    if (draft.base.regexFlags) delete draft.base.regexFlags;
  }
  // aliases/fixes：空数组 -> undefined
  if (Array.isArray(draft.base.aliases) && draft.base.aliases.length === 0) {
    delete draft.base.aliases;
    if (!changedPaths.includes('base.aliases')) changedPaths.push('base.aliases');
  }
  if (Array.isArray(draft.base.fixes) && draft.base.fixes.length === 0) {
    delete draft.base.fixes;
    if (!changedPaths.includes('base.fixes')) changedPaths.push('base.fixes');
  }

  emit('update:modelValue', cloneRole(draft));
  emit('changed', { changedPaths, snapshot: cloneRole(draft) });
}

function emitChanged(paths: string[]) {
  emit('changed', { changedPaths: paths, snapshot: cloneRole(draft) });
}

/** ====== 扩展 & 自定义（统一列表） ====== */
type ValueType = 'string' | 'number' | 'boolean' | 'string[]';
const valueTypeOptions = [
  { label: '字符串/Markdown', value: 'string' },
  { label: '数字', value: 'number' },
  { label: '布尔', value: 'boolean' },
  { label: '字符串数组', value: 'string[]' },
];
const bucketOptions = [
  { label: '扩展字段', value: 'extended' },
  { label: '自定义字段', value: 'custom' },
];

// 扩展字段可选 key 列表（只能从中选择）
const EXTENDED_KEY_LIST = [
  'age', '年龄', 'gender', '性别', 'occupation', '职业', 'personality', '性格', 'appearance', '外貌', 'background', '背景',
  'relationship', 'relationships', '关系', 'skill', 'skills', '技能', 'weakness', 'weaknesses', '弱点',
  'goal', 'goals', '目标', 'motivation', '动机', 'fear', 'fears', '恐惧', 'secret', 'secrets', '秘密',
  'quote', 'quotes', '台词', 'note', 'notes', '备注', 'tag', 'tags', '标签', 'category', '分类', 'level', '等级',
  'status', '状态', 'location', '位置', 'origin', '出身', 'family', '家庭', 'education', '教育', 'hobby', 'hobbies', '爱好'
];
const EXTENDED_KEY_OPTIONS = EXTENDED_KEY_LIST.map((k) => ({ label: k, value: k }));

/** 归并为一个可编辑数组，保持“类型锁定” */
interface ExtraEntry {
  key: string;
  bucket: 'extended' | 'custom';
  valueType: ValueType;
  locked: boolean;
  valueStr?: string;
  valueNum?: number;
  valueBool?: boolean | undefined;
  valueArr?: string[];
}

function inferType(v: unknown): ValueType {
  if (Array.isArray(v)) return 'string[]';
  const t = typeof v;
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  return 'string';
}
function toEntry(k: string, v: JsonValue, bucket: 'extended' | 'custom'): ExtraEntry {
  const typ = inferType(v);
  const e: ExtraEntry = { key: k, bucket, valueType: typ, locked: true };
  if (typ === 'string') e.valueStr = String(v ?? '');
  else if (typ === 'number') e.valueNum = typeof v === 'number' ? v : Number(v ?? 0);
  else if (typ === 'boolean') e.valueBool = Boolean(v);
  else if (typ === 'string[]') e.valueArr = Array.isArray(v) ? v.map((x) => String(x)) : [];
  return e;
}

/** 基础键黑名单：不应进入 扩展/自定义 列表 */
const BASE_KEYS_BLOCKLIST = new Set(['aliases', 'fixes', 'regex', 'regexFlags', 'affiliation', 'uuid']);

const mergedEntries = reactive<ExtraEntry[]>([]);
function reloadExtras() {
  mergedEntries.splice(0);
  const pushFrom = (obj: Record<string, JsonValue> | undefined, bucket: 'extended' | 'custom') => {
    if (!obj) return;
    Object.keys(obj).forEach((k) => {
        if (BASE_KEYS_BLOCKLIST.has(k)) return;
        const val = obj[k];
        if (val === undefined) return;
        mergedEntries.push(toEntry(k, val, bucket));
      });
  };
  pushFrom(draft.extended, 'extended');
  pushFrom(draft.custom, 'custom');
}
reloadExtras();
watch(() => [draft.extended, draft.custom], reloadExtras, { deep: true });

/** 展示名：key（类型锁定徽标） */
function displayLabel(e: ExtraEntry) {
  const lock = e.locked ? '🔒' : '🆕';
  return `${e.key} ${lock} · ${e.valueType}`;
}

/** 编辑交互：键、类型、归属、值 */
function onExtraEditKey(idx: number) {
  if (mergedEntries[idx] === undefined) return;
  mergedEntries[idx].key =
    prompt('Enter new key:', mergedEntries[idx].key) ?? mergedEntries[idx].key;
  syncExtrasToDraft();
  commit([mergedEntries[idx].bucket + '.' + mergedEntries[idx].key]);
}
function onExtraTypeChange(idx: number) {
  if (mergedEntries[idx] === undefined) return;
  if (mergedEntries[idx].locked) {
    mergedEntries[idx].valueType = inferType(readEntryValue(mergedEntries[idx]));
    return;
  }
}
function onExtraBucketChange(_idx: number) {
  syncExtrasToDraft();
  commit([]);
}
function onExtraValueChange(idx: number) {
  if (mergedEntries[idx] === undefined) return;
  syncExtrasToDraft();
  commit([mergedEntries[idx].bucket + '.' + mergedEntries[idx].key]);
}

function moveExtra(idx: number, delta: number) {
  if (mergedEntries[idx] === undefined) return;
  const e = mergedEntries[idx];
  mergedEntries.splice(idx, 1);
  mergedEntries.splice(idx + delta, 0, e);
  emitChanged([]);
}
function removeExtra(idx: number) {
  if (mergedEntries[idx] === undefined) return;
  const p = mergedEntries[idx];
  mergedEntries.splice(idx, 1);
  syncExtrasToDraft();
  commit([p.bucket + '.' + p.key]);
}

function readEntryValue(e: ExtraEntry): JsonValue {
  if (e.valueType === 'string') return e.valueStr ?? '';
  if (e.valueType === 'number') return Number(e.valueNum ?? 0);
  if (e.valueType === 'boolean') return Boolean(e.valueBool);
  if (e.valueType === 'string[]') return (e.valueArr ?? []).map((x) => String(x));
  return '';
}

/** 将 mergedEntries 写回 draft.extended/custom（保持原桶；新建的按当前 bucket） */
function syncExtrasToDraft() {
  const ext: Record<string, JsonValue> = {};
  const cus: Record<string, JsonValue> = {};
  mergedEntries.forEach((e) => {
    const v = readEntryValue(e);
    if (e.bucket === 'extended') ext[e.key] = v;
    else cus[e.key] = v;
  });
  draft.extended = Object.keys(ext).length ? ext : undefined;
  draft.custom = Object.keys(cus).length ? cus : undefined;
}

/** 新增字段对话框 */
const openAdd = ref(false);
const addForm = reactive<ExtraEntry>({
  key: '',
  bucket: 'custom',
  valueType: 'string',
  locked: false,
  valueStr: '',
});
const addTypeLocked = ref(false);

function onOpenAdd() {
  // 只允许新增字符串字段（UI 上锁定类型选择）
  addForm.valueType = 'string';
  addForm.valueStr = '';
  delete addForm.valueNum;
  delete addForm.valueBool;
  addForm.valueArr = [];
  addForm.bucket = 'custom';
  addForm.key = '';
  addTypeLocked.value = DEFAULT_LOCK_NEW_FIELD_TYPE;
  openAdd.value = true;
}

// 当对话框关闭时，解除类型锁定（防止取消后仍保持锁定）
watch(() => openAdd.value, (v) => {
  if (!v) addTypeLocked.value = false;
});
function appendExtra() {
  if (!addForm.key) return;
  if (mergedEntries.some((e) => e.key === addForm.key)) {
    let i = 2;
    let k = `${addForm.key}_${i}`;
    while (mergedEntries.some((e) => e.key === k)) {
      i++;
      k = `${addForm.key}_${i}`;
    }
    addForm.key = k;
  }
  mergedEntries.push(JSON.parse(JSON.stringify(addForm)));
  const lastEntry = mergedEntries[mergedEntries.length - 1];
  if (lastEntry === undefined) return;
  lastEntry.locked = true;
  addForm.key = '';
  addForm.bucket = 'custom';
  addForm.valueType = 'string';
  addForm.valueStr = '';
  delete addForm.valueNum;
  delete addForm.valueBool;
  addForm.valueArr = [];
  addTypeLocked.value = false;
  syncExtrasToDraft();
  commit([]);
}

/** 工具：深拷贝 */
function cloneRole(r: RoleCardModel): RoleCardModel {
  return JSON.parse(JSON.stringify(r ?? { base: { name: '', type: '主角' } }));
}

/** 复制UUID到剪贴板 */
function copyUUID() {
  if (draft.base.uuid) {
    navigator.clipboard.writeText(draft.base.uuid).then(() => {
      $q.notify({
        message: 'UUID已复制到剪贴板',
        type: 'positive',
        position: 'top'
      });
    }).catch(() => {
      $q.notify({
        message: '复制失败',
        type: 'negative',
        position: 'top'
      });
    });
  }
}
</script>

<style scoped>
.rounded-borders {
  border-radius: 8px;
}
.color-dot {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

/* Allow long field labels in expansion header to wrap instead of truncating */
.expansion-header-wrap {
  /* ensure header content can use multiple lines */
  white-space: normal !important;
  word-break: break-word; /* break long words if needed */
  overflow-wrap: anywhere; /* modern fallback */
}

/* Make sure the label and caption inside the header can wrap */
.expansion-header-wrap .q-expansion-item__header__label,
.expansion-header-wrap .q-expansion-item__header__caption {
  white-space: normal !important;
}
</style>
