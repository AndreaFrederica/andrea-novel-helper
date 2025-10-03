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
            label="开始时间 *"
            filled
            dense
            class="q-mb-md"
            :rules="[(val) => !!val || '开始时间不能为空']"
            hint="格式: YYYY-MM-DDTHH:mm:ss 或 YYYY-MM-DD"
          >
            <template v-slot:append>
              <q-icon name="event" class="cursor-pointer">
                <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                  <q-date v-model="formData.date" mask="YYYY-MM-DDTHH:mm:ss">
                    <div class="row items-center justify-end">
                      <q-btn v-close-popup label="确定" color="primary" flat />
                    </div>
                  </q-date>
                </q-popup-proxy>
              </q-icon>
            </template>
          </q-input>

          <q-input
            v-model="formData.endDate"
            label="结束时间 (可选)"
            filled
            dense
            class="q-mb-md"
            hint="用于时间区间事件，格式同上"
            clearable
          >
            <template v-slot:append>
              <q-icon name="event" class="cursor-pointer">
                <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                  <q-date v-model="formData.endDate" mask="YYYY-MM-DDTHH:mm:ss">
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

          <!-- 嵌套和布局配置 -->
          <div class="text-subtitle2 q-mt-lg q-mb-md">嵌套和布局配置</div>

          <q-select
            v-model="formData.parentNode"
            :options="availableParentNodes"
            label="亲代节点 (可选)"
            filled
            dense
            class="q-mb-md"
            hint="选择亲代节点使此节点成为子节点"
            clearable
            emit-value
            map-options
            option-label="label"
            option-value="value"
          >
            <template v-slot:no-option>
              <q-item>
                <q-item-section class="text-grey">
                  无可用的亲代节点
                </q-item-section>
              </q-item>
            </template>
          </q-select>

          <div class="row q-col-gutter-md q-mb-md">
            <div class="col-6">
              <q-input
                v-model.number="formData.width"
                label="节点宽度 (px)"
                filled
                dense
                type="number"
                min="150"
                hint="用于亲代节点，最小150px"
                clearable
              />
            </div>
            <div class="col-6">
              <q-input
                v-model.number="formData.height"
                label="节点高度 (px)"
                filled
                dense
                type="number"
                min="100"
                hint="用于亲代节点，最小100px"
                clearable
              />
            </div>
          </div>

          <div class="row items-center q-mb-md">
            <q-checkbox
              v-model="formData.extent"
              true-value="parent"
              false-value=""
              label="限制在亲代节点内移动"
              dense
            />
            <q-icon name="help_outline" size="xs" class="q-ml-xs" color="grey-6">
              <q-tooltip>子节点无法拖动到亲代节点范围外</q-tooltip>
            </q-icon>
          </div>

          <div class="row items-center q-mb-md">
            <q-checkbox
              v-model="formData.expandParent"
              label="拖动时自动扩展亲代节点"
              dense
            />
            <q-icon name="help_outline" size="xs" class="q-ml-xs" color="grey-6">
              <q-tooltip>拖动子节点接近边缘时，自动扩大亲代节点</q-tooltip>
            </q-icon>
          </div>
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
import { ref, watch, computed } from 'vue';

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
  endDate?: string;
  description: string;
  timeless?: boolean;
  position?: { x: number; y: number };
  bindings?: BindingReference[];
  parentNode?: string;
  width?: number;
  height?: number;
  extent?: 'parent';
  expandParent?: boolean;
}

interface Props {
  modelValue: boolean;
  event?: TimelineEvent | null;
  allEvents?: TimelineEvent[];  // 所有事件列表，用于构建亲代节点选项
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
  expandParent: false,
});

// 可用的亲代节点选项
const availableParentNodes = computed(() => {
  if (!props.allEvents) return [];
  
  const currentEventId = props.event?.id;
  
  return props.allEvents
    .filter(e => {
      // 排除当前节点本身
      if (e.id === currentEventId) return false;
      // 排除已经是子节点的节点（避免嵌套过深）
      if (e.parentNode) return false;
      return true;
    })
    .map(e => ({
      label: `${e.title} (${e.id.substring(0, 8)}...)`,
      value: e.id,
    }));
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
      const data: Partial<TimelineEvent> = {
        ...newEvent,
        bindings: newEvent.bindings ? [...newEvent.bindings] : [],
        expandParent: newEvent.expandParent ?? false,
      };
      
      // 只在有值时才设置可选字段
      if (newEvent.endDate) data.endDate = newEvent.endDate;
      if (newEvent.parentNode) data.parentNode = newEvent.parentNode;
      if (newEvent.width !== undefined) data.width = newEvent.width;
      if (newEvent.height !== undefined) data.height = newEvent.height;
      if (newEvent.extent) data.extent = newEvent.extent;
      
      formData.value = data;
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
