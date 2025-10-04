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

          <!-- 自定义颜色 -->
          <div class="q-mb-md">
            <div class="text-caption q-mb-xs">节点颜色（可选）</div>
            <div class="row items-center q-gutter-sm">
              <q-input
                v-model="formData.color"
                label="自定义颜色"
                filled
                dense
                placeholder="#42b883 或 rgb(66, 184, 131)"
                style="flex: 1"
                clearable
              >
                <template v-slot:append>
                  <q-icon name="colorize" class="cursor-pointer">
                    <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                      <q-color v-model="formData.color" />
                    </q-popup-proxy>
                  </q-icon>
                </template>
              </q-input>
              <div
                v-if="formData.color"
                :style="{
                  width: '40px',
                  height: '40px',
                  borderRadius: '4px',
                  backgroundColor: formData.color,
                  border: '1px solid #ccc'
                }"
              />
            </div>
          </div>

          <!-- 资源绑定 -->
          <div class="text-subtitle2 q-mt-lg q-mb-md">资源绑定</div>

          <div v-if="formData.bindings && formData.bindings.length > 0" class="q-mb-md">
            <q-list bordered separator>
              <q-item
                v-for="(binding, index) in formData.bindings"
                :key="index"
                clickable
              >
                <q-item-section avatar>
                  <q-avatar :color="getBindingColor(binding)" text-color="white" size="sm">
                    <q-icon :name="getBindingIcon(binding.type)" />
                  </q-avatar>
                </q-item-section>
                <q-item-section>
                  <q-item-label>{{ binding.label || binding.uuid }}</q-item-label>
                  <q-item-label caption>{{ getBindingTypeLabel(binding.type) }}</q-item-label>
                  <q-item-label caption v-if="getBindingAdditionalInfo(binding)">
                    {{ getBindingAdditionalInfo(binding) }}
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-btn
                    flat
                    dense
                    round
                    icon="delete"
                    color="negative"
                    size="sm"
                    @click.stop="removeBinding(index)"
                  >
                    <q-tooltip>删除绑定</q-tooltip>
                  </q-btn>
                </q-item-section>

                <!-- 右键菜单 -->
                <q-menu
                  touch-position
                  context-menu
                >
                  <q-list dense style="min-width: 150px">
                    <q-item clickable v-close-popup @click="jumpToDefinition(binding)">
                      <q-item-section avatar>
                        <q-icon name="open_in_new" />
                      </q-item-section>
                      <q-item-section>转跳到定义</q-item-section>
                    </q-item>
                    <q-separator />
                    <q-item clickable v-close-popup @click="removeBinding(index)">
                      <q-item-section avatar>
                        <q-icon name="delete" color="negative" />
                      </q-item-section>
                      <q-item-section>删除绑定</q-item-section>
                    </q-item>
                  </q-list>
                </q-menu>
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
                  @update:model-value="onBindingTypeChanged"
                />
              </div>
              <div class="col-5">
                <q-select
                  v-model="newBinding.uuid"
                  :options="bindingResourceOptions"
                  label="选择资源"
                  filled
                  dense
                  emit-value
                  map-options
                  use-input
                  input-debounce="300"
                  @filter="filterBindingOptions"
                  @update:model-value="onBindingResourceSelected"
                  :loading="bindingResourceOptions.length === 0"
                >
                  <template v-slot:no-option>
                    <q-item>
                      <q-item-section class="text-grey">
                        {{ newBinding.type === 'character' ? '无可用角色' : '无可用文章' }}
                      </q-item-section>
                    </q-item>
                  </template>
                  <template v-slot:option="scope">
                    <q-item v-bind="scope.itemProps">
                      <q-item-section avatar v-if="scope.opt.role">
                        <q-avatar
                          size="sm"
                          :color="scope.opt.role.color || 'grey'"
                          text-color="white"
                        >
                          {{ scope.opt.role.name.substring(0, 1) }}
                        </q-avatar>
                      </q-item-section>
                      <q-item-section>
                        <q-item-label>{{ scope.opt.label }}</q-item-label>
                        <q-item-label caption v-if="scope.opt.role">
                          UUID: {{ scope.opt.value.substring(0, 8) }}...
                        </q-item-label>
                        <q-item-label caption v-else-if="scope.opt.article">
                          {{ scope.opt.article.fullPath || scope.opt.article.path }}
                        </q-item-label>
                      </q-item-section>
                    </q-item>
                  </template>
                </q-select>
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
import { ref, watch, computed, onMounted, onUnmounted } from 'vue';
import { useVsCodeApiStore } from '../stores/vscode';
import { useTimelineSettingsStore } from '../stores/timeline-settings';

interface BindingReference {
  uuid: string;
  type: 'character' | 'article';
  label?: string;
  status?: string;
  documentTitle?: string;
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
  color?: string; // 自定义颜色
  data?: {
    type: 'main' | 'side' | 'condition'; // 支持条件节点类型
  };
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
  rolesList?: Array<{ uuid: string; name: string; type: string; color?: string }>;  // 角色列表(从父组件传入)
  articlesList?: Array<{ uuid: string; title: string; path: string; fullPath: string }>;  // 文章列表(从父组件传入)
}

type RoleInfo = {
  uuid: string;
  name: string;
  type: string;
  color?: string;
  [key: string]: unknown;
};

type ArticleInfo = {
  uuid: string;
  title: string;
  path: string;
  fullPath: string;
  [key: string]: unknown;
};

const props = defineProps<Props>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'save': [event: Partial<TimelineEvent>];
}>();

const timelineSettingsStore = useTimelineSettingsStore();

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
  status: '',
  documentTitle: '',
});

// 类型选项
const typeOptions = [
  { label: '主要事件', value: 'main' },
  { label: '次要事件', value: 'side' },
];

// 绑定类型选项 - 只保留角色和文章
const bindingTypeOptions = [
  { label: '角色', value: 'character' },
  { label: '文章/章节', value: 'article' },
];

// 角色和文章列表 - 从 props 获取(由父组件传入,避免重复请求)
const allRolesList = computed<RoleInfo[]>(() => props.rolesList || []);
const filteredRolesList = computed<RoleInfo[]>(() => {
  const list = allRolesList.value;
  if (timelineSettingsStore.filterSensitiveRoles) {
    return list.filter(role => role.type !== '敏感词');
  }
  return list;
});
const articlesList = computed<ArticleInfo[]>(() => props.articlesList || []);

// 使用 VSCode API store
const vsCodeApiStore = useVsCodeApiStore();
const vscode = computed(() => vsCodeApiStore.vscode);

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
      if (newEvent.color) data.color = newEvent.color; // 保留自定义颜色
      if (newEvent.data) data.data = { ...newEvent.data }; // 保留 data 字段

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
    if (newBinding.value.status) {
      bindingToAdd.status = newBinding.value.status;
    }
    if (newBinding.value.documentTitle) {
      bindingToAdd.documentTitle = newBinding.value.documentTitle;
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
function getBindingColor(binding: BindingReference): string {
  if (binding.type === 'character') {
    const role = getRoleByUuid(binding.uuid);
    if (typeof role?.color === 'string' && role.color.trim().length > 0) {
      return role.color;
    }
    return 'purple';
  }
  if (binding.type === 'article') {
    return 'blue';
  }
  return 'grey';
}

// 获取绑定类型图标
function getBindingIcon(type: string): string {
  const iconMap: Record<string, string> = {
    character: 'person',
    article: 'description',
  };
  return iconMap[type] || 'label';
}

// 获取绑定类型标签
function getBindingTypeLabel(type: string): string {
  const labelMap: Record<string, string> = {
    character: '角色',
    article: '文章/章节',
  };
  return labelMap[type] || '其他';
}

function getBindingAdditionalInfo(binding: BindingReference): string | undefined {
  if (binding.type === 'character') {
    const role = getRoleByUuid(binding.uuid);
    if (role) {
      return role.type;
    }
  } else if (binding.type === 'article') {
    const article = getArticleByUuid(binding.uuid);
    if (article) {
      return (article.fullPath || article.path || '').toString();
    }
  }
  return undefined;
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

// 消息处理 - 暂时保留用于未来可能的其他消息类型
function handleMessage(event: MessageEvent) {
  // 角色和文章数据现在通过 props 传入,不再通过消息处理
  // 这个函数保留用于未来可能需要的其他消息类型
  console.log('[TimelineEventEditor] Message received:', event.data?.type);
}

// 组件挂载时添加消息监听器(用于跳转到定义的响应)
onMounted(() => {
  window.addEventListener('message', handleMessage as EventListener);
});

// 组件卸载时移除监听
onUnmounted(() => {
  window.removeEventListener('message', handleMessage as EventListener);
});

// 计算下拉选项 - 根据选择的类型决定
const bindingResourceOptions = computed(() => {
  if (newBinding.value.type === 'character') {
    return filteredRolesList.value.map((role: RoleInfo) => ({
      label: `${role.name} (${role.type})`,
      value: role.uuid,
      role,
    }));
  }
  if (newBinding.value.type === 'article') {
    return articlesList.value.map((article: ArticleInfo) => ({
      label: article.title,
      value: article.uuid,
      article,
    }));
  }
  return [];
});

function getRoleByUuid(uuid: string): RoleInfo | undefined {
  return allRolesList.value.find((role) => role.uuid === uuid);
}

function getArticleByUuid(uuid: string): ArticleInfo | undefined {
  return articlesList.value.find((article) => article.uuid === uuid);
}

// 当选择资源时，自动填充名称
function onBindingResourceSelected(uuid: string) {
  if (newBinding.value.type === 'character') {
    const role = getRoleByUuid(uuid);
    if (role && !newBinding.value.label) {
      newBinding.value.label = role.name;
    }
  } else if (newBinding.value.type === 'article') {
    const article = getArticleByUuid(uuid);
    if (article && !newBinding.value.label) {
      newBinding.value.label = article.title;
    }
  }
}

// 过滤绑定选项（用于搜索）
function filterBindingOptions(val: string, update: (fn: () => void) => void) {
  update(() => {
    // Quasar的filter会自动处理过滤逻辑，这里只需要调用update
  });
}

function onBindingTypeChanged(value: BindingReference['type']) {
  newBinding.value.uuid = '';
  newBinding.value.label = '';
  newBinding.value.status = '';
  newBinding.value.documentTitle = '';
  newBinding.value.type = value;
}

// 转跳到定义
function jumpToDefinition(binding: BindingReference) {
  if (vscode.value?.postMessage) {
    console.log('[TimelineEventEditor] Jumping to definition:', binding.type, binding.uuid);
    vscode.value.postMessage({
      type: 'jumpToDefinition',
      resourceType: binding.type,
      resourceUuid: binding.uuid
    });
  } else {
    console.warn('[TimelineEventEditor] VSCode API not available');
  }
}

</script>

<style scoped>
/* 可以添加自定义样式 */
</style>
