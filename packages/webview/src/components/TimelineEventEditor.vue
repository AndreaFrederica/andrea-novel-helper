<template>
  <q-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" persistent>
    <q-card style="min-width: 600px; max-width: 800px">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">编辑事件</div>
        <q-space />
        <q-btn icon="close" flat round dense @click="closeDialog" />
      </q-card-section>

      <q-card-section>
        <q-form @submit.prevent="saveEvent">
          <!-- 基本信息 -->
          <div class="text-subtitle2 q-mb-md">基本信息</div>

          <q-input
            v-model="formData.title"
            label="事件标题 *"
            filled
            dense
            class="q-mb-md"
            :rules="[(val) => !!val || '标题不能为空']"
          />

          <div class="row q-col-gutter-md q-mb-md">
            <div class="col-6">
              <q-input
                v-model="formData.group"
                label="事件分组 *"
                filled
                dense
                :rules="[(val) => !!val || '分组不能为空']"
              />
            </div>
            <div class="col-6">
              <q-select
                v-model="formData.type"
                :options="typeOptions"
                label="事件类型 *"
                filled
                dense
                emit-value
                map-options
              />
            </div>
          </div>

          <q-input
            v-model="formData.date"
            label="事件日期 *"
            filled
            dense
            class="q-mb-md"
            :rules="[(val) => !!val || '日期不能为空']"
          >
            <template v-slot:append>
              <q-icon name="event" class="cursor-pointer">
                <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                  <q-date v-model="formData.date" mask="YYYY-MM-DD">
                    <div class="row items-center justify-end">
                      <q-btn v-close-popup label="确定" color="primary" flat />
                    </div>
                  </q-date>
                </q-popup-proxy>
              </q-icon>
            </template>
          </q-input>

          <div class="row items-center q-mb-md">
            <q-checkbox
              v-model="formData.timeless"
              label="与时间无关（忽略时间验证）"
              dense
            />
            <q-icon name="help_outline" size="xs" class="q-ml-xs" color="grey-6">
              <q-tooltip>选中后，此事件不受时间顺序约束，适用于背景设定、梦境等</q-tooltip>
            </q-icon>
          </div>

          <q-input
            v-model="formData.description"
            label="事件描述"
            filled
            dense
            type="textarea"
            rows="3"
            class="q-mb-md"
          />

          <!-- 资源绑定 -->
          <div class="text-subtitle2 q-mt-lg q-mb-md">资源绑定</div>

          <div v-if="formData.bindings && formData.bindings.length > 0" class="q-mb-md">
            <q-list bordered separator>
              <q-item v-for="(binding, index) in formData.bindings" :key="index">
                <q-item-section avatar>
                  <q-avatar :color="getBindingColor(binding.type)" text-color="white" size="sm">
                    <q-icon :name="getBindingIcon(binding.type)" />
                  </q-avatar>
                </q-item-section>
                <q-item-section>
                  <q-item-label>{{ binding.label || binding.uuid }}</q-item-label>
                  <q-item-label caption>{{ getBindingTypeLabel(binding.type) }}</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-btn
                    flat
                    dense
                    round
                    icon="delete"
                    color="negative"
                    size="sm"
                    @click="removeBinding(index)"
                  >
                    <q-tooltip>删除绑定</q-tooltip>
                  </q-btn>
                </q-item-section>
              </q-item>
            </q-list>
          </div>
          <div v-else class="text-caption text-grey-6 q-mb-md">
            暂无绑定资源
          </div>

          <!-- 添加绑定 -->
          <q-card flat bordered class="q-pa-md">
            <div class="text-subtitle2 q-mb-md">添加新绑定</div>
            <div class="row q-col-gutter-md">
              <div class="col-4">
                <q-select
                  v-model="newBinding.type"
                  :options="bindingTypeOptions"
                  label="资源类型"
                  filled
                  dense
                  emit-value
                  map-options
                />
              </div>
              <div class="col-5">
                <q-input
                  v-model="newBinding.uuid"
                  label="资源UUID"
                  filled
                  dense
                  placeholder="输入或粘贴UUID"
                />
              </div>
              <div class="col-3">
                <q-input
                  v-model="newBinding.label"
                  label="显示名称"
                  filled
                  dense
                  placeholder="可选"
                />
              </div>
            </div>
            <div class="row justify-end q-mt-md">
              <q-btn
                label="添加绑定"
                color="primary"
                outline
                dense
                @click="addBinding"
                :disable="!newBinding.uuid || !newBinding.type"
              />
            </div>
          </q-card>
        </q-form>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn label="取消" flat @click="closeDialog" />
        <q-btn label="保存" color="primary" @click="saveEvent" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

interface BindingReference {
  uuid: string;
  type: 'character' | 'article' | 'location' | 'item' | 'other';
  label?: string;
}

interface TimelineEvent {
  id: string;
  title: string;
  group: string;
  type: 'main' | 'side';
  date: string;
  description: string;
  timeless?: boolean;
  position?: { x: number; y: number };
  bindings?: BindingReference[];
}

interface Props {
  modelValue: boolean;
  event?: TimelineEvent | null;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'save': [event: Partial<TimelineEvent>];
}>();

// 表单数据
const formData = ref<Partial<TimelineEvent>>({
  title: '',
  group: '',
  type: 'main',
  date: '',
  description: '',
  bindings: [],
});

// 新绑定表单
const newBinding = ref<BindingReference>({
  uuid: '',
  type: 'character',
  label: '',
});

// 类型选项
const typeOptions = [
  { label: '主要事件', value: 'main' },
  { label: '次要事件', value: 'side' },
];

// 绑定类型选项
const bindingTypeOptions = [
  { label: '角色', value: 'character' },
  { label: '文章/章节', value: 'article' },
  { label: '地点', value: 'location' },
  { label: '物品', value: 'item' },
  { label: '其他', value: 'other' },
];

// 监听 event prop 变化,初始化表单
watch(
  () => props.event,
  (newEvent) => {
    if (newEvent) {
      formData.value = {
        ...newEvent,
        bindings: newEvent.bindings ? [...newEvent.bindings] : [],
      };
    } else {
      // 重置表单
      formData.value = {
        title: '',
        group: '',
        type: 'main' as const,
        date: new Date().toISOString().substring(0, 10),
        description: '',
        bindings: [],
      };
    }
  },
  { immediate: true }
);// 添加绑定
function addBinding() {
  if (!newBinding.value.uuid || !newBinding.value.type) return;

  if (!formData.value.bindings) {
    formData.value.bindings = [];
  }

  const bindingToAdd: BindingReference = {
    uuid: newBinding.value.uuid,
    type: newBinding.value.type,
  };
  if (newBinding.value.label) {
    bindingToAdd.label = newBinding.value.label;
  }
  formData.value.bindings.push(bindingToAdd);

  // 重置新绑定表单
  newBinding.value = {
    uuid: '',
    type: 'character',
    label: '',
  };
}

// 删除绑定
function removeBinding(index: number) {
  if (formData.value.bindings) {
    formData.value.bindings.splice(index, 1);
  }
}

// 获取绑定类型颜色
function getBindingColor(type: string): string {
  const colorMap: Record<string, string> = {
    character: 'purple',
    article: 'blue',
    location: 'green',
    item: 'orange',
    other: 'grey',
  };
  return colorMap[type] || 'grey';
}

// 获取绑定类型图标
function getBindingIcon(type: string): string {
  const iconMap: Record<string, string> = {
    character: 'person',
    article: 'description',
    location: 'place',
    item: 'inventory_2',
    other: 'label',
  };
  return iconMap[type] || 'label';
}

// 获取绑定类型标签
function getBindingTypeLabel(type: string): string {
  const labelMap: Record<string, string> = {
    character: '角色',
    article: '文章/章节',
    location: '地点',
    item: '物品',
    other: '其他',
  };
  return labelMap[type] || '其他';
}

// 保存事件
function saveEvent() {
  emit('save', formData.value);
  closeDialog();
}

// 关闭对话框
function closeDialog() {
  emit('update:modelValue', false);
}
</script>

<style scoped>
/* 可以添加自定义样式 */
</style>
