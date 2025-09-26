<template>
  <q-card style="min-width: 400px">
    <q-card-section class="row items-center q-pb-none">
      <div class="text-h6">编辑器设置</div>
      <q-space />
      <q-btn icon="close" flat round dense @click="$emit('close')" />
    </q-card-section>

    <q-card-section>
      <div class="q-gutter-md">
        <!-- JSON5/OJSON5 文件编辑器设置 -->
        <div class="setting-group">
          <div class="setting-label">
            <q-icon name="data_object" class="q-mr-sm" />
            JSON5/OJSON5 文件默认编辑器
          </div>
          <div class="setting-description text-caption text-grey-6">
            选择打开 .json5 和 .ojson5 文件时使用的默认编辑器
          </div>
          <q-option-group
            v-model="localSettings.json5Editor"
            :options="json5EditorOptions"
            color="primary"
            inline
            @update:model-value="onJson5EditorChange"
          />
        </div>

        <q-separator />

        <!-- Markdown 文件编辑器设置 -->
        <div class="setting-group">
          <div class="setting-label">
            <q-icon name="article" class="q-mr-sm" />
            Markdown 文件默认编辑器
          </div>
          <div class="setting-description text-caption text-grey-6">
            选择打开 .md 文件时使用的默认编辑器
          </div>
          <q-option-group
            v-model="localSettings.mdEditor"
            :options="mdEditorOptions"
            color="primary"
            inline
            @update:model-value="onMdEditorChange"
          />
        </div>

        <q-separator />

        <!-- 其他设置 -->
        <div class="setting-group">
          <div class="setting-label">
            <q-icon name="tune" class="q-mr-sm" />
            其他设置
          </div>
          <q-checkbox
            v-model="showToolbar"
            label="显示编辑器工具栏"
            color="primary"
            @update:model-value="onShowToolbarChange"
          />
          <div class="setting-description text-caption text-grey-6">
            在编辑器顶部显示切换编辑器的工具栏
          </div>
        </div>
      </div>
    </q-card-section>

    <q-card-actions align="right">
      <q-btn
        flat
        label="重置为默认"
        color="grey-7"
        @click="resetToDefaults"
      />
      <q-btn
        flat
        label="关闭"
        color="primary"
        @click="$emit('close')"
      />
    </q-card-actions>
  </q-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { editorSettings, DEFAULT_EDITOR_SETTINGS } from '../utils/editorSettings';
import type { EditorSettings } from '../utils/editorSettings';

interface Emits {
  (e: 'close'): void;
}

const emit = defineEmits<Emits>();
const $q = useQuasar();

// 本地设置状态
const localSettings = ref<EditorSettings>({
  json5Editor: 'roleCard',
  mdEditor: 'vditor',
  showToolbar: true,
  defaultEditorForJson5: 'rolecard',
  defaultEditorForMarkdown: 'vditor'
});

const showToolbar = ref(true);

// 编辑器选项
const json5EditorOptions = [
  {
    label: '角色卡编辑器',
    value: 'roleCard',
    icon: 'account_circle'
  },
  {
    label: 'Monaco 编辑器',
    value: 'monaco',
    icon: 'code'
  }
];

const mdEditorOptions = [
  {
    label: 'Vditor 编辑器',
    value: 'vditor',
    icon: 'article'
  },
  {
    label: 'Monaco 编辑器',
    value: 'monaco',
    icon: 'code'
  }
];

// 设置变更处理
function onJson5EditorChange(value: 'roleCard' | 'monaco') {
  editorSettings.setJson5Editor(value);
  $q.notify({
    type: 'positive',
    message: `JSON5 文件默认编辑器已设置为：${getEditorDisplayName(value)}`,
    position: 'top'
  });
}

function onMdEditorChange(value: 'vditor' | 'monaco') {
  editorSettings.setMdEditor(value);
  $q.notify({
    type: 'positive',
    message: `Markdown 文件默认编辑器已设置为：${getEditorDisplayName(value)}`,
    position: 'top'
  });
}

function onShowToolbarChange(value: boolean) {
  // 这里可以添加工具栏显示设置的逻辑
  // 暂时只是本地状态，可以扩展到 localStorage
  localStorage.setItem('andrea-show-editor-toolbar', JSON.stringify(value));
  $q.notify({
    type: 'info',
    message: value ? '编辑器工具栏已启用' : '编辑器工具栏已禁用',
    position: 'top'
  });
}

// 获取编辑器显示名称
function getEditorDisplayName(editor: string): string {
  switch (editor) {
    case 'roleCard':
      return '角色卡编辑器';
    case 'monaco':
      return 'Monaco 编辑器';
    case 'vditor':
      return 'Vditor 编辑器';
    default:
      return editor;
  }
}

// 重置为默认设置
function resetToDefaults() {
  $q.dialog({
    title: '重置设置',
    message: '确定要将所有编辑器设置重置为默认值吗？',
    cancel: true,
    persistent: true
  }).onOk(() => {
    editorSettings.updateSettings(DEFAULT_EDITOR_SETTINGS);
    localSettings.value = { ...DEFAULT_EDITOR_SETTINGS };
    showToolbar.value = true;
    localStorage.setItem('andrea-show-editor-toolbar', 'true');
    
    $q.notify({
      type: 'positive',
      message: '编辑器设置已重置为默认值',
      position: 'top'
    });
  });
}

// 加载设置
function loadSettings() {
  localSettings.value = editorSettings.getSettings();
  
  // 加载工具栏显示设置
  try {
    const stored = localStorage.getItem('andrea-show-editor-toolbar');
    if (stored !== null) {
      showToolbar.value = JSON.parse(stored);
    }
  } catch {
    showToolbar.value = true;
  }
}

onMounted(() => {
  loadSettings();
});
</script>

<style scoped>
.setting-group {
  margin-bottom: 16px;
}

.setting-label {
  font-weight: 500;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
}

.setting-description {
  margin-bottom: 8px;
  line-height: 1.4;
}

:deep(.q-option-group) {
  margin-top: 8px;
}

:deep(.q-radio) {
  margin-right: 16px;
}

:deep(.q-checkbox) {
  margin-bottom: 4px;
}
</style>