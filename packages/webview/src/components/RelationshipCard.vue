<template>
  <q-card bordered class="q-pa-md relationship-card">
    <!-- ===== 基础字段 ===== -->
    <q-card-section class="q-gutter-md">
      <div class="row q-col-gutter-md">
        <!-- 源角色 -->
        <div class="col-12 col-md-6">
          <q-input
            v-model="draft.base.fromRoleId"
            label="源角色 (fromRoleId)"
            dense
            filled
            :debounce="150"
            @update:model-value="commit(['base.fromRoleId'])"
          />
        </div>

        <!-- 目标角色 -->
        <div class="col-12 col-md-6">
          <q-input
            v-model="draft.base.toRoleId"
            label="目标角色 (toRoleId)"
            dense
            filled
            :debounce="150"
            @update:model-value="commit(['base.toRoleId'])"
          />
        </div>

        <!-- 关系类型 -->
        <div class="col-12 col-md-6">
          <q-select
            v-model="relationshipTypeSelect"
            :options="relationshipTypeOptions"
            label="关系类型 (relationshipType)"
            dense
            filled
            emit-value
            map-options
            @update:model-value="onRelationshipTypeSelect"
          />
        </div>

        <!-- 自定义关系类型 -->
        <div v-if="relationshipTypeSelect === '__custom__'" class="col-12 col-md-6">
          <q-input
            v-model="customRelationshipType"
            label="自定义关系类型"
            dense
            filled
            :debounce="150"
            @update:model-value="onCustomRelationshipTypeInput"
          />
        </div>

        <!-- 关系描述 -->
        <div class="col-12">
          <q-input
            v-model="draft.base.description"
            type="textarea"
            autogrow
            label="关系描述 (description)"
            dense
            filled
            :debounce="150"
            @update:model-value="commit(['base.description'])"
          />
        </div>

        <!-- 关系强度 -->
        <div class="col-12 col-md-6">
          <q-slider
            v-model="draft.base.strength"
            :min="1"
            :max="10"
            :step="1"
            label
            :label-value="`强度: ${draft.base.strength || 5} (${getStrengthLabel(draft.base.strength || 5)})`"
            color="primary"
            @update:model-value="commit(['base.strength'])"
          />
        </div>

        <!-- 是否单向关系 -->
        <div class="col-12 col-md-6">
          <q-toggle
            v-model="draft.base.isDirectional"
            label="单向关系 (isDirectional)"
            color="primary"
            @update:model-value="commit(['base.isDirectional'])"
          />
        </div>

        <!-- 关系状态 -->
        <div class="col-12 col-md-6">
          <q-select
            v-model="draft.base.status"
            :options="statusOptions"
            label="关系状态 (status)"
            dense
            filled
            emit-value
            map-options
            @update:model-value="commit(['base.status'])"
          />
        </div>

        <!-- 开始时间 -->
        <div class="col-12 col-md-6">
          <q-input
            v-model="draft.base.startTime"
            label="开始时间 (startTime)"
            dense
            filled
            :debounce="150"
            @update:model-value="commit(['base.startTime'])"
          >
            <template #append>
              <q-icon name="event" class="cursor-pointer">
                <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                  <q-date v-model="draft.base.startTime" @update:model-value="commit(['base.startTime'])">
                    <div class="row items-center justify-end">
                      <q-btn v-close-popup label="关闭" color="primary" flat />
                    </div>
                  </q-date>
                </q-popup-proxy>
              </q-icon>
            </template>
          </q-input>
        </div>

        <!-- 结束时间 -->
        <div class="col-12 col-md-6">
          <q-input
            v-model="draft.base.endTime"
            label="结束时间 (endTime)"
            dense
            filled
            :debounce="150"
            @update:model-value="commit(['base.endTime'])"
          >
            <template #append>
              <q-icon name="event" class="cursor-pointer">
                <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                  <q-date v-model="draft.base.endTime" @update:model-value="commit(['base.endTime'])">
                    <div class="row items-center justify-end">
                      <q-btn v-close-popup label="关闭" color="primary" flat />
                    </div>
                  </q-date>
                </q-popup-proxy>
              </q-icon>
            </template>
          </q-input>
        </div>

        <!-- 标签 -->
        <div class="col-12">
          <q-select
            v-model="draft.base.tags"
            :options="tagOptions"
            label="标签 (tags)"
            dense
            filled
            multiple
            use-chips
            use-input
            new-value-mode="add-unique"
            @update:model-value="commit(['base.tags'])"
          />
        </div>

        <!-- 备注 -->
        <div class="col-12">
          <q-input
            v-model="draft.base.notes"
            type="textarea"
            autogrow
            label="备注 (notes)"
            dense
            filled
            :debounce="150"
            @update:model-value="commit(['base.notes'])"
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
      </div>
    </q-card-section>

    <!-- ===== 扩展字段 ===== -->
    <q-card-section v-if="draft.extended && Object.keys(draft.extended).length > 0">
      <q-separator class="q-mb-md" />
      <div class="text-subtitle2 q-mb-md">扩展字段 (Extended)</div>
      <div class="row q-col-gutter-md">
        <div
          v-for="(value, key) in draft.extended"
          :key="`ext-${key}`"
          class="col-12 col-md-6"
        >
          <q-input
            :model-value="formatFieldValue(value)"
            :label="`${key}`"
            dense
            filled
            :debounce="150"
            @update:model-value="(val) => updateExtendedField(key, val)"
          />
        </div>
      </div>
    </q-card-section>

    <!-- ===== 自定义字段 ===== -->
    <q-card-section v-if="draft.custom && Object.keys(draft.custom).length > 0">
      <q-separator class="q-mb-md" />
      <div class="text-subtitle2 q-mb-md">自定义字段 (Custom)</div>
      <div class="row q-col-gutter-md">
        <div
          v-for="(value, key) in draft.custom"
          :key="`custom-${key}`"
          class="col-12 col-md-6"
        >
          <q-input
            :model-value="formatFieldValue(value)"
            :label="`${key}`"
            dense
            filled
            :debounce="150"
            @update:model-value="(val) => updateCustomField(key, val)"
          >
            <template #append>
              <q-btn
                dense
                flat
                icon="delete"
                color="negative"
                @click="deleteCustomField(key)"
              />
            </template>
          </q-input>
        </div>
      </div>
    </q-card-section>

    <!-- ===== 添加自定义字段 ===== -->
    <q-card-section>
      <q-separator class="q-mb-md" />
      <div class="text-subtitle2 q-mb-md">添加自定义字段</div>
      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-4">
          <q-input
            v-model="newFieldKey"
            label="字段名"
            dense
            filled
          />
        </div>
        <div class="col-12 col-md-6">
          <q-input
            v-model="newFieldValue"
            label="字段值"
            dense
            filled
          />
        </div>
        <div class="col-12 col-md-2">
          <q-btn
            label="添加"
            color="primary"
            :disable="!newFieldKey || !newFieldValue"
            @click="addCustomField"
          />
        </div>
      </div>
    </q-card-section>

    <!-- ===== 操作按钮 ===== -->
    <q-card-actions align="right">
      <q-btn flat label="删除关系" color="negative" @click="$emit('delete')" />
      <q-btn label="保存" color="primary" @click="$emit('save')" />
    </q-card-actions>
  </q-card>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useQuasar } from 'quasar';

// 类型定义
interface BaseRelationshipFields {
  id?: string;
  uuid?: string;
  fromRoleId: string;
  toRoleId: string;
  relationshipType: string;
  description?: string;
  strength?: number;
  isDirectional?: boolean;
  startTime?: string;
  endTime?: string;
  status?: 'active' | 'inactive' | 'ended';
  tags?: string[];
  notes?: string;
}

interface RelationshipCardModel {
  base: BaseRelationshipFields;
  extended?: Record<string, any>;
  custom?: Record<string, any>;
}

type RelationshipCardModelWithId = RelationshipCardModel & { id?: string };

// Props
interface Props {
  modelValue: RelationshipCardModelWithId;
}

const props = defineProps<Props>();

// Emits
const emit = defineEmits<{
  'update:modelValue': [value: RelationshipCardModelWithId];
  'delete': [];
  'save': [];
}>();

// Quasar
const $q = useQuasar();

// 响应式数据
const draft = ref<RelationshipCardModelWithId>({ ...props.modelValue });
const newFieldKey = ref('');
const newFieldValue = ref('');
const customRelationshipType = ref('');

// 关系类型选项
const builtinRelationshipTypes = [
  '朋友', '恋人', '夫妻', 
  '父子', '母子', '父女', '母女', 
  '兄弟', '姐妹', 
  '师父', '师傅', 
  '同事', '上司', '下属', 
  '敌人', '仇人', '竞争对手', 
  '合作伙伴', '盟友'
];

const relationshipTypeOptions = computed(() => [
  ...builtinRelationshipTypes.map(type => ({ label: type, value: type })),
  { label: '自定义...', value: '__custom__' }
]);

const relationshipTypeSelect = computed({
  get() {
    const type = draft.value.base.relationshipType;
    return builtinRelationshipTypes.includes(type) ? type : '__custom__';
  },
  set(val) {
    if (val !== '__custom__') {
      draft.value.base.relationshipType = val;
      commit(['base.relationshipType']);
    }
  }
});

// 关系状态选项
const statusOptions = [
  { label: '活跃', value: 'active' },
  { label: '不活跃', value: 'inactive' },
  { label: '已结束', value: 'ended' }
];

// 标签选项（可以根据需要扩展）
const tagOptions = ref([
  '重要', '秘密', '公开', '复杂', '简单', '稳定', '不稳定'
]);

// 关系强度标签
const strengthLabels: Record<number, string> = {
  1: '极弱', 2: '很弱', 3: '弱', 4: '较弱', 5: '一般',
  6: '较强', 7: '强', 8: '很强', 9: '极强', 10: '最强'
};

// 方法
const getStrengthLabel = (strength: number): string => {
  return strengthLabels[strength] || '一般';
};

const formatFieldValue = (value: any): string => {
  if (Array.isArray(value)) return value.join(', ');
  return String(value || '');
};

const commit = (paths: string[]) => {
  emit('update:modelValue', { ...draft.value });
};

const onRelationshipTypeSelect = (val: string) => {
  relationshipTypeSelect.value = val;
};

const onCustomRelationshipTypeInput = (val: string | number | null) => {
  if (val !== null) {
    draft.value.base.relationshipType = String(val);
    commit(['base.relationshipType']);
  }
};

const updateExtendedField = (key: string, value: string | number | null) => {
  if (!draft.value.extended) draft.value.extended = {};
  if (value !== null) {
    draft.value.extended[key] = String(value);
    commit([`extended.${key}`]);
  }
};

const updateCustomField = (key: string, value: string | number | null) => {
  if (!draft.value.custom) draft.value.custom = {};
  if (value !== null) {
    draft.value.custom[key] = String(value);
    commit([`custom.${key}`]);
  }
};

const deleteCustomField = (key: string) => {
  if (draft.value.custom) {
    delete draft.value.custom[key];
    if (Object.keys(draft.value.custom).length === 0) {
      delete draft.value.custom;
    }
    commit([`custom.${key}`]);
  }
};

const addCustomField = () => {
  if (!newFieldKey.value || !newFieldValue.value) return;
  
  if (!draft.value.custom) draft.value.custom = {};
  draft.value.custom[newFieldKey.value] = newFieldValue.value;
  
  commit([`custom.${newFieldKey.value}`]);
  
  newFieldKey.value = '';
  newFieldValue.value = '';
};

const copyUUID = async () => {
  if (draft.value.base.uuid) {
    try {
      await navigator.clipboard.writeText(draft.value.base.uuid);
      $q.notify({
        message: 'UUID已复制到剪贴板',
        type: 'positive',
        position: 'top'
      });
    } catch (error) {
      $q.notify({
        message: '复制失败',
        type: 'negative',
        position: 'top'
      });
    }
  }
};

// 监听props变化
watch(() => props.modelValue, (newVal) => {
  draft.value = { ...newVal };
}, { deep: true });

// 初始化
onMounted(() => {
  // 设置默认值
  if (!draft.value.base.strength) {
    draft.value.base.strength = 5;
  }
  if (!draft.value.base.status) {
    draft.value.base.status = 'active';
  }
  if (!draft.value.base.isDirectional) {
    draft.value.base.isDirectional = false;
  }
  
  // 如果是自定义关系类型，设置customRelationshipType
  if (!builtinRelationshipTypes.includes(draft.value.base.relationshipType)) {
    customRelationshipType.value = draft.value.base.relationshipType;
  }
});
</script>

<style scoped>
.relationship-card {
  margin-bottom: 16px;
}

.mono {
  font-family: 'Courier New', Courier, monospace;
}
</style>