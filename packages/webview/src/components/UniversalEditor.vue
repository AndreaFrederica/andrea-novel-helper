<template>
  <div class="universal-editor">
    <!-- 编辑器工具栏 -->
    <div class="editor-toolbar" v-if="showToolbar">
      <div class="toolbar-left">
        <q-btn-group flat>
          <q-btn
            v-if="supportsRoleCard"
            :color="currentEditor === 'roleCard' ? 'primary' : 'grey-7'"
            :flat="currentEditor !== 'roleCard'"
            icon="account_circle"
            label="角色卡"
            @click="switchEditor('roleCard')"
            size="sm"
          />
          <q-btn
            :color="currentEditor === 'monaco' ? 'primary' : 'grey-7'"
            :flat="currentEditor !== 'monaco'"
            icon="code"
            label="代码编辑器"
            @click="switchEditor('monaco')"
            size="sm"
          />
          <q-btn
            v-if="supportsVditor"
            :color="currentEditor === 'vditor' ? 'primary' : 'grey-7'"
            :flat="currentEditor !== 'vditor'"
            icon="article"
            label="Markdown"
            @click="switchEditor('vditor')"
            size="sm"
          />
        </q-btn-group>
      </div>
      <div class="toolbar-right">
        <q-btn
          flat
          icon="settings"
          @click="showSettings = true"
          size="sm"
          color="grey-7"
        >
          <q-tooltip>编辑器设置</q-tooltip>
        </q-btn>
      </div>
    </div>

    <!-- 编辑器内容区域 -->
    <div class="editor-content" :class="{ 'with-toolbar': showToolbar }">
      <!-- 角色卡编辑器 -->
      <div v-if="currentEditor === 'roleCard'" class="role-card-container">
        <RoleCard
          v-if="roleData"
          :model-value="roleData"
          @update:model-value="onRoleDataUpdate"
          :readonly="readonly"
        />
        <div v-else class="editor-placeholder">
          <q-icon name="account_circle" size="48px" color="grey-5" />
          <div class="text-grey-6">无法解析角色数据</div>
        </div>
      </div>

      <!-- Monaco 编辑器 -->
      <div v-if="currentEditor === 'monaco'" class="monaco-container">
        <div ref="monacoContainer" class="monaco-editor-container"></div>
      </div>

      <!-- Vditor 编辑器 -->
      <div v-if="currentEditor === 'vditor'" class="vditor-container">
        <div ref="vditorContainer" class="vditor-editor-container"></div>
      </div>
    </div>

    <!-- 设置对话框 -->
    <q-dialog v-model="showSettings">
      <EditorSettingsDialog @close="showSettings = false" />
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useQuasar } from 'quasar';
import * as monaco from 'monaco-editor';
import Vditor from 'vditor';
import RoleCard from './RoleCard.vue';
import EditorSettingsDialog from './EditorSettingsDialog.vue';
import { editorSettings } from '../utils/editorSettings';
import type { RoleCardModel } from '../../types/role';

interface Props {
  modelValue: string;
  fileName?: string;
  language?: string;
  readonly?: boolean;
  showToolbar?: boolean;
}

interface Emits {
  (e: 'update:modelValue', value: string): void;
  (e: 'editor-changed', editor: string): void;
}

const props = withDefaults(defineProps<Props>(), {
  fileName: '',
  language: 'plaintext',
  readonly: false,
  showToolbar: true
});

const emit = defineEmits<Emits>();

const $q = useQuasar();

// 编辑器实例引用
const monacoContainer = ref<HTMLElement>();
const vditorContainer = ref<HTMLElement>();
let monacoEditor: monaco.editor.IStandaloneCodeEditor | null = null;
let vditorEditor: Vditor | null = null;

// 状态管理
const showSettings = ref(false);
const currentEditor = ref<'roleCard' | 'monaco' | 'vditor'>('monaco');

// 计算属性
const supportsRoleCard = computed(() => {
  return editorSettings.supportsRoleCardEditor(props.fileName);
});

const supportsVditor = computed(() => {
  return editorSettings.supportsVditor(props.fileName);
});

const roleData = computed(() => {
  if (currentEditor.value !== 'roleCard') return null;
  
  try {
    return JSON.parse(props.modelValue) as RoleCardModel;
  } catch {
    return null;
  }
});

// 初始化编辑器选择
function initializeEditor() {
  const recommended = editorSettings.getRecommendedEditor(props.fileName);
  
  if (recommended === 'roleCard' && supportsRoleCard.value) {
    currentEditor.value = 'roleCard';
  } else if (recommended === 'vditor' && supportsVditor.value) {
    currentEditor.value = 'vditor';
  } else {
    currentEditor.value = 'monaco';
  }
}

// 切换编辑器
async function switchEditor(editor: 'roleCard' | 'monaco' | 'vditor') {
  if (currentEditor.value === editor) return;
  
  // 保存当前编辑器的内容
  const currentContent = getCurrentContent();
  
  // 销毁当前编辑器
  destroyCurrentEditor();
  
  // 切换到新编辑器
  currentEditor.value = editor;
  
  // 等待DOM更新后初始化新编辑器
  await nextTick();
  initializeCurrentEditor();
  
  // 设置内容
  setCurrentContent(currentContent);
  
  // 更新设置
  if (editor === 'roleCard' && supportsRoleCard.value) {
    editorSettings.setJson5Editor('roleCard');
  } else if (editor === 'monaco') {
    if (supportsRoleCard.value) {
      editorSettings.setJson5Editor('monaco');
    } else if (supportsVditor.value) {
      editorSettings.setMdEditor('monaco');
    }
  } else if (editor === 'vditor' && supportsVditor.value) {
    editorSettings.setMdEditor('vditor');
  }
  
  emit('editor-changed', editor);
}

// 获取当前编辑器内容
function getCurrentContent(): string {
  switch (currentEditor.value) {
    case 'roleCard':
      return props.modelValue;
    case 'monaco':
      return monacoEditor?.getValue() || props.modelValue;
    case 'vditor':
      try {
        return vditorEditor?.getValue() || props.modelValue;
      } catch (error) {
        console.warn('Vditor getValue error (ignored):', error);
        return props.modelValue;
      }
    default:
      return props.modelValue;
  }
}

// 设置当前编辑器内容
function setCurrentContent(content: string) {
  switch (currentEditor.value) {
    case 'roleCard':
      // 角色卡通过 props 更新
      break;
    case 'monaco':
      if (monacoEditor && monacoEditor.getValue() !== content) {
        monacoEditor.setValue(content);
      }
      break;
    case 'vditor':
      if (vditorEditor) {
        try {
          if (vditorEditor.getValue() !== content) {
            vditorEditor.setValue(content);
          }
        } catch (error) {
          console.warn('Vditor getValue/setValue error (ignored):', error);
        }
      }
      break;
  }
}

// 初始化当前编辑器
function initializeCurrentEditor() {
  switch (currentEditor.value) {
    case 'monaco':
      initializeMonaco();
      break;
    case 'vditor':
      initializeVditor();
      break;
  }
}

// 销毁当前编辑器
function destroyCurrentEditor() {
  if (monacoEditor) {
    monacoEditor.dispose();
    monacoEditor = null;
  }
  
  if (vditorEditor) {
    try {
      vditorEditor.destroy();
    } catch (error) {
      console.warn('Vditor destroy error (ignored):', error);
    }
    vditorEditor = null;
  }
}

// 初始化 Monaco 编辑器
function initializeMonaco() {
  if (!monacoContainer.value) return;
  
  // 设置主题
  const isDark = $q.dark.isActive;
  monaco.editor.setTheme(isDark ? 'vs-dark' : 'vs');
  
  monacoEditor = monaco.editor.create(monacoContainer.value, {
    value: props.modelValue,
    language: props.language,
    theme: isDark ? 'vs-dark' : 'vs',
    readOnly: props.readonly,
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'on'
  });
  
  // 监听内容变化
  monacoEditor.onDidChangeModelContent(() => {
    const value = monacoEditor?.getValue() || '';
    emit('update:modelValue', value);
  });
}

// 初始化 Vditor 编辑器
function initializeVditor() {
  if (!vditorContainer.value) return;
  
  const isDark = $q.dark.isActive;
  
  vditorEditor = new Vditor(vditorContainer.value, {
    value: props.modelValue,
    theme: isDark ? 'dark' : 'classic',
    mode: 'wysiwyg',
    height: 400,
    cache: { enable: false },
    lang: 'zh_CN',
    cdn: '',  // 禁用CDN加载，避免CSP问题
    input: (value: string) => {
      emit('update:modelValue', value);
    }
  });
}

// 角色数据更新处理
function onRoleDataUpdate(newData: RoleCardModel) {
  const jsonString = JSON.stringify(newData, null, 2);
  emit('update:modelValue', jsonString);
}

// 监听外部内容变化
watch(() => props.modelValue, (newValue) => {
  if (getCurrentContent() !== newValue) {
    setCurrentContent(newValue);
  }
});

// 监听主题变化
watch(() => $q.dark.isActive, (isDark) => {
  if (monacoEditor) {
    monaco.editor.setTheme(isDark ? 'vs-dark' : 'vs');
  }
  
  if (vditorEditor) {
    // Vditor 主题切换需要重新初始化
    let content = '';
    try {
      content = vditorEditor.getValue();
    } catch (error) {
      console.warn('Vditor getValue error during theme switch (ignored):', error);
      content = props.modelValue || '';
    }
    
    try {
      vditorEditor.destroy();
    } catch (error) {
      console.warn('Vditor destroy error during theme switch (ignored):', error);
    }
    vditorEditor = null;
    void nextTick(() => {
      void initializeVditor();
      if (vditorEditor) {
        vditorEditor.setValue(content);
      }
    });
  }
});

onMounted(async () => {
  initializeEditor();
  await nextTick();
  initializeCurrentEditor();
  setCurrentContent(props.modelValue);
});

onUnmounted(() => {
  destroyCurrentEditor();
});
</script>

<style scoped>
.universal-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.editor-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--q-separator-color);
  background: var(--q-card-background);
}

.toolbar-left {
  display: flex;
  align-items: center;
}

.toolbar-right {
  display: flex;
  align-items: center;
}

.editor-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.editor-content.with-toolbar {
  height: calc(100% - 48px);
}

.role-card-container,
.monaco-container,
.vditor-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.monaco-editor-container,
.vditor-editor-container {
  flex: 1;
  width: 100%;
  height: 100%;
}

.editor-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

/* 确保 Vditor 样式正确 */
:deep(.vditor) {
  height: 100% !important;
}

:deep(.vditor-content) {
  height: calc(100% - 40px) !important;
}
</style>