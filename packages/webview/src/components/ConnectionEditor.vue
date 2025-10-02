<template>
  <q-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)">
    <q-card style="min-width: 500px">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">编辑连线</div>
        <q-space />
        <q-btn icon="close" flat round dense @click="closeDialog" />
      </q-card-section>

      <q-card-section>
        <div class="text-body2 q-mb-md text-grey-7">
          从 <strong>{{ sourceEventTitle }}</strong> 到 <strong>{{ targetEventTitle }}</strong>
        </div>

        <q-select
          v-model="formData.connectionType"
          :options="connectionTypeOptions"
          label="连线类型"
          filled
          dense
          emit-value
          map-options
          class="q-mb-md"
        >
          <template v-slot:prepend>
            <q-icon :name="getConnectionIcon(formData.connectionType || 'normal')" />
          </template>
        </q-select>

        <q-input
          v-model="formData.label"
          label="连线注解（可选）"
          filled
          dense
          type="textarea"
          rows="3"
          placeholder="例如：穿越到过去、梦境中见到、平行时空等"
          hint="为不符合常规时间顺序的连线添加说明"
        />
      </q-card-section>

      <q-card-actions align="right">
        <q-btn label="删除连线" flat color="negative" @click="handleDelete" />
        <q-space />
        <q-btn label="取消" flat @click="closeDialog" />
        <q-btn label="保存" color="primary" @click="saveConnection" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

interface ConnectionData {
  id: string;
  source: string;
  target: string;
  label?: string;
  connectionType?: 'normal' | 'time-travel' | 'reincarnation' | 'parallel' | 'dream' | 'flashback' | 'other';
}

interface Props {
  modelValue: boolean;
  connection?: ConnectionData | null;
  sourceEventTitle?: string;
  targetEventTitle?: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'save': [connection: ConnectionData];
  'delete': [id: string];
}>();

// 表单数据
const formData = ref<Partial<ConnectionData>>({
  connectionType: 'normal',
  label: '',
});

// 连线类型选项
const connectionTypeOptions = [
  { label: '正常顺序', value: 'normal', icon: 'arrow_forward' },
  { label: '时间穿越', value: 'time-travel', icon: 'schedule' },
  { label: '轮回转世', value: 'reincarnation', icon: 'autorenew' },
  { label: '平行时空', value: 'parallel', icon: 'call_split' },
  { label: '梦境/幻觉', value: 'dream', icon: 'cloud' },
  { label: '回忆/闪回', value: 'flashback', icon: 'history' },
  { label: '其他特殊', value: 'other', icon: 'more_horiz' },
];

// 监听 connection prop 变化
watch(
  () => props.connection,
  (newConnection) => {
    if (newConnection) {
      formData.value = {
        connectionType: newConnection.connectionType || 'normal',
        label: newConnection.label || '',
      };
    } else {
      formData.value = {
        connectionType: 'normal',
        label: '',
      };
    }
  },
  { immediate: true }
);

// 获取连线类型图标
function getConnectionIcon(type: string): string {
  const iconMap: Record<string, string> = {
    normal: 'arrow_forward',
    'time-travel': 'schedule',
    reincarnation: 'autorenew',
    parallel: 'call_split',
    dream: 'cloud',
    flashback: 'history',
    other: 'more_horiz',
  };
  return iconMap[type] || 'arrow_forward';
}

// 保存连线
function saveConnection() {
  if (!props.connection) return;

  const updated: ConnectionData = {
    id: props.connection.id,
    source: props.connection.source,
    target: props.connection.target,
  };

  if (formData.value.label) {
    updated.label = formData.value.label;
  }
  if (formData.value.connectionType) {
    updated.connectionType = formData.value.connectionType;
  }

  emit('save', updated);
  closeDialog();
}

// 删除连线
function handleDelete() {
  if (props.connection) {
    emit('delete', props.connection.id);
    closeDialog();
  }
}

// 关闭对话框
function closeDialog() {
  emit('update:modelValue', false);
}
</script>

<style scoped>
/* 可以添加自定义样式 */
</style>
