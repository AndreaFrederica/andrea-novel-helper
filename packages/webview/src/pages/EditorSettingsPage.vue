<template>
  <q-page class="editor-settings-page">
    <div class="page-container">
      <!-- 页面标题 -->
      <div class="page-header">
        <div class="page-title">
          <q-icon name="settings" size="32px" class="q-mr-md" />
          <div>
            <div class="text-h4">编辑器设置</div>
            <div class="text-subtitle2 text-grey-6">配置不同文件类型的默认编辑器</div>
          </div>
        </div>
      </div>

      <!-- 设置内容 -->
      <div class="settings-content">
        <!-- JSON5/OJSON5 文件设置 -->
        <q-card class="setting-card">
          <q-card-section>
            <div class="setting-header">
              <q-icon name="data_object" size="24px" color="primary" />
              <div class="setting-title">
                <div class="text-h6">JSON5/OJSON5 文件</div>
                <div class="text-caption text-grey-6">角色定义文件的编辑器设置</div>
              </div>
            </div>
          </q-card-section>

          <q-card-section class="q-pt-none">
            <div class="editor-options">
              <q-card
                v-for="option in json5EditorOptions"
                :key="option.value"
                class="editor-option"
                :class="{ 'selected': localSettings.json5Editor === option.value }"
                clickable
                @click="onJson5EditorChange(option.value)"
              >
                <q-card-section class="text-center">
                  <q-icon :name="option.icon" size="48px" :color="localSettings.json5Editor === option.value ? 'primary' : 'grey-5'" />
                  <div class="option-title">{{ option.label }}</div>
                  <div class="option-description">{{ option.description }}</div>
                </q-card-section>
              </q-card>
            </div>
          </q-card-section>
        </q-card>

        <!-- Markdown 文件设置 -->
        <q-card class="setting-card">
          <q-card-section>
            <div class="setting-header">
              <q-icon name="article" size="24px" color="secondary" />
              <div class="setting-title">
                <div class="text-h6">Markdown 文件</div>
                <div class="text-caption text-grey-6">文档和说明文件的编辑器设置</div>
              </div>
            </div>
          </q-card-section>

          <q-card-section class="q-pt-none">
            <div class="editor-options">
              <q-card
                v-for="option in mdEditorOptions"
                :key="option.value"
                class="editor-option"
                :class="{ 'selected': localSettings.mdEditor === option.value }"
                clickable
                @click="onMdEditorChange(option.value)"
              >
                <q-card-section class="text-center">
                  <q-icon :name="option.icon" size="48px" :color="localSettings.mdEditor === option.value ? 'secondary' : 'grey-5'" />
                  <div class="option-title">{{ option.label }}</div>
                  <div class="option-description">{{ option.description }}</div>
                </q-card-section>
              </q-card>
            </div>
          </q-card-section>
        </q-card>

        <!-- 界面设置 -->
        <q-card class="setting-card">
          <q-card-section>
            <div class="setting-header">
              <q-icon name="tune" size="24px" color="accent" />
              <div class="setting-title">
                <div class="text-h6">界面设置</div>
                <div class="text-caption text-grey-6">编辑器界面的显示选项</div>
              </div>
            </div>
          </q-card-section>

          <q-card-section class="q-pt-none">
            <div class="interface-settings">
              <q-item>
                <q-item-section avatar>
                  <q-icon name="toolbar" />
                </q-item-section>
                <q-item-section>
                  <q-item-label>显示编辑器工具栏</q-item-label>
                  <q-item-label caption>在编辑器顶部显示切换编辑器的工具栏</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-toggle
                    v-model="showToolbar"
                    color="accent"
                    @update:model-value="onShowToolbarChange"
                  />
                </q-item-section>
              </q-item>

              <q-item>
                <q-item-section avatar>
                  <q-icon name="auto_awesome" />
                </q-item-section>
                <q-item-section>
                  <q-item-label>自动选择编辑器</q-item-label>
                  <q-item-label caption>根据文件类型自动选择最适合的编辑器</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-toggle
                    v-model="autoSelectEditor"
                    color="accent"
                    @update:model-value="onAutoSelectEditorChange"
                  />
                </q-item-section>
              </q-item>
            </div>
          </q-card-section>
        </q-card>

        <!-- 操作按钮 -->
        <div class="action-buttons">
          <q-btn
            outline
            color="grey-7"
            icon="refresh"
            label="重置为默认"
            @click="resetToDefaults"
            class="q-mr-md"
          />
          <q-btn
            color="primary"
            icon="save"
            label="保存设置"
            @click="saveSettings"
          />
        </div>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { editorSettings, DEFAULT_EDITOR_SETTINGS } from '../utils/editorSettings';
import type { EditorSettings } from '../utils/editorSettings';

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
const autoSelectEditor = ref(true);

// 编辑器选项配置
const json5EditorOptions = [
  {
    label: '角色卡编辑器',
    value: 'roleCard' as const,
    icon: 'account_circle',
    description: '专为角色定义设计的可视化编辑器，支持字段管理和类型选择'
  },
  {
    label: 'Monaco 编辑器',
    value: 'monaco' as const,
    icon: 'code',
    description: '强大的代码编辑器，支持语法高亮、自动补全和错误检查'
  }
];

const mdEditorOptions = [
  {
    label: 'Vditor 编辑器',
    value: 'vditor' as const,
    icon: 'article',
    description: '专业的 Markdown 编辑器，支持所见即所得和实时预览'
  },
  {
    label: 'Monaco 编辑器',
    value: 'monaco' as const,
    icon: 'code',
    description: '通用代码编辑器，支持 Markdown 语法高亮和基础编辑功能'
  }
];

// 设置变更处理
function onJson5EditorChange(value: 'roleCard' | 'monaco') {
  localSettings.value.json5Editor = value;
  editorSettings.setJson5Editor(value);
  
  $q.notify({
    type: 'positive',
    message: `JSON5 文件默认编辑器已设置为：${getEditorDisplayName(value)}`,
    position: 'top',
    timeout: 2000
  });
}

function onMdEditorChange(value: 'vditor' | 'monaco') {
  localSettings.value.mdEditor = value;
  editorSettings.setMdEditor(value);
  
  $q.notify({
    type: 'positive',
    message: `Markdown 文件默认编辑器已设置为：${getEditorDisplayName(value)}`,
    position: 'top',
    timeout: 2000
  });
}

function onShowToolbarChange(value: boolean) {
  localStorage.setItem('andrea-show-editor-toolbar', JSON.stringify(value));
  
  $q.notify({
    type: 'info',
    message: value ? '编辑器工具栏已启用' : '编辑器工具栏已禁用',
    position: 'top',
    timeout: 2000
  });
}

function onAutoSelectEditorChange(value: boolean) {
  localStorage.setItem('andrea-auto-select-editor', JSON.stringify(value));
  
  $q.notify({
    type: 'info',
    message: value ? '自动选择编辑器已启用' : '自动选择编辑器已禁用',
    position: 'top',
    timeout: 2000
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

// 保存设置
function saveSettings() {
  $q.notify({
    type: 'positive',
    message: '设置已保存',
    position: 'top',
    timeout: 2000
  });
}

// 重置为默认设置
function resetToDefaults() {
  $q.dialog({
    title: '重置设置',
    message: '确定要将所有编辑器设置重置为默认值吗？这将清除您的所有自定义设置。',
    cancel: true,
    persistent: true,
    color: 'primary'
  }).onOk(() => {
    // 重置编辑器设置
    editorSettings.updateSettings(DEFAULT_EDITOR_SETTINGS);
    localSettings.value = { ...DEFAULT_EDITOR_SETTINGS };
    
    // 重置界面设置
    showToolbar.value = true;
    autoSelectEditor.value = true;
    localStorage.setItem('andrea-show-editor-toolbar', 'true');
    localStorage.setItem('andrea-auto-select-editor', 'true');
    
    $q.notify({
      type: 'positive',
      message: '所有设置已重置为默认值',
      position: 'top',
      timeout: 3000
    });
  });
}

// 加载设置
function loadSettings() {
  localSettings.value = editorSettings.getSettings();
  
  // 加载界面设置
  try {
    const storedToolbar = localStorage.getItem('andrea-show-editor-toolbar');
    if (storedToolbar !== null) {
      showToolbar.value = JSON.parse(storedToolbar);
    }
    
    const storedAutoSelect = localStorage.getItem('andrea-auto-select-editor');
    if (storedAutoSelect !== null) {
      autoSelectEditor.value = JSON.parse(storedAutoSelect);
    }
  } catch (error) {
    console.warn('Failed to load interface settings:', error);
  }
}

onMounted(() => {
  loadSettings();
});
</script>

<style scoped>
.editor-settings-page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-container {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.page-header {
  margin-bottom: 8px;
}

.page-title {
  display: flex;
  align-items: center;
}

.settings-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.setting-card {
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.setting-header {
  display: flex;
  align-items: center;
  gap: 16px;
}

.setting-title {
  flex: 1;
}

.editor-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.editor-option {
  border: 2px solid transparent;
  border-radius: 8px;
  transition: all 0.2s ease;
  cursor: pointer;
}

.editor-option:hover {
  border-color: var(--q-primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.editor-option.selected {
  border-color: var(--q-primary);
  background-color: rgba(25, 118, 210, 0.05);
}

.option-title {
  font-weight: 500;
  margin: 8px 0 4px 0;
}

.option-description {
  font-size: 12px;
  color: var(--q-text-grey-6);
  line-height: 1.4;
}

.interface-settings {
  margin-top: 8px;
}

.action-buttons {
  display: flex;
  justify-content: center;
  padding: 16px 0;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .editor-settings-page {
    padding: 16px;
  }
  
  .editor-options {
    grid-template-columns: 1fr;
  }
  
  .action-buttons {
    flex-direction: column;
    gap: 12px;
  }
  
  .action-buttons .q-btn {
    margin: 0 !important;
  }
}

/* 深色模式适配 */
.body--dark .setting-card {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.body--dark .editor-option:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}
</style>