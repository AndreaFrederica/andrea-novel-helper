<template>
  <q-dialog 
    v-model="isVisible" 
    maximized 
    persistent
    @before-show="onBeforeShow"
    @hide="onHide"
  >
    <q-card class="universal-editor-modal">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">{{ title }}</div>
        <q-space />
        <q-btn 
          icon="close" 
          flat 
          round 
          dense 
          v-close-popup 
          :disable="isSaving"
        />
      </q-card-section>

      <q-card-section class="q-pt-none full-height">
        <div class="editor-container full-height">
          <!-- 编辑器工具栏 -->
          <div v-if="showToolbar" class="editor-toolbar">
            <q-btn-group flat>
              <q-btn
                v-if="supportsRoleCard"
                :color="currentEditor === 'rolecard' ? 'primary' : 'grey-7'"
                :outline="currentEditor !== 'rolecard'"
                icon="person"
                label="角色卡"
                @click="switchEditor('rolecard')"
                :disable="isSaving"
              />
              <q-btn
                v-if="supportsMonaco"
                :color="currentEditor === 'monaco' ? 'primary' : 'grey-7'"
                :outline="currentEditor !== 'monaco'"
                icon="code"
                label="代码编辑器"
                @click="switchEditor('monaco')"
                :disable="isSaving"
              />
              <q-btn
                v-if="supportsVditor"
                :color="currentEditor === 'vditor' ? 'primary' : 'grey-7'"
                :outline="currentEditor !== 'vditor'"
                icon="edit_note"
                label="Markdown编辑器"
                @click="switchEditor('vditor')"
                :disable="isSaving"
              />
            </q-btn-group>
            
            <q-space />
            
            <q-btn-group flat>
              <q-btn
                color="positive"
                icon="save"
                label="保存"
                @click="saveFile"
                :loading="isSaving"
                :disable="!hasChanges"
              />
              <q-btn
                color="negative"
                icon="cancel"
                label="取消"
                @click="closeModal"
                :disable="isSaving"
              />
            </q-btn-group>
          </div>

          <!-- 编辑器内容区域 -->
          <div class="editor-content" :class="{ 'with-toolbar': showToolbar }">
            <!-- 角色卡编辑器 -->
            <div 
              v-show="currentEditor === 'rolecard'" 
              class="editor-area"
              ref="rolecardContainer"
            >
              <RoleCard 
                v-if="currentEditor === 'rolecard' && rolecardMounted"
                :model-value="roleData"
                @update:model-value="onRoleDataUpdate"
              />
            </div>

            <!-- Monaco编辑器 -->
            <div 
              v-show="currentEditor === 'monaco'" 
              class="editor-area"
              ref="monacoContainer"
            >
              <!-- Monaco编辑器将在这里挂载 -->
            </div>

            <!-- Vditor编辑器 -->
            <div 
              v-show="currentEditor === 'vditor'" 
              class="editor-area"
              ref="vditorContainer"
            >
              <!-- Vditor编辑器将在这里挂载 -->
            </div>
          </div>
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useQuasar } from 'quasar'
import RoleCard from './RoleCard.vue'
import { editorSettings } from '../utils/editorSettings'
import type { EditorSettings, EditorType } from '../utils/editorSettings'

// Props
interface Props {
  modelValue: boolean
  filePath?: string
  fileType?: string
  title?: string
}

const props = withDefaults(defineProps<Props>(), {
  title: '编辑文件'
})

// Emits
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'file-saved': [filePath: string, content: string]
}>()

// Composables
const $q = useQuasar()

// Reactive data
const isVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const currentEditor = ref<EditorType>('monaco')
const content = ref('')
const originalContent = ref('')
const roleData = ref<any>(null)
const isSaving = ref(false)
const hasChanges = ref(false)

// Editor instances
const monacoEditor = ref<any>(null)
const vditorInstance = ref<any>(null)
const rolecardMounted = ref(false)

// Refs
const monacoContainer = ref<HTMLElement>()
const vditorContainer = ref<HTMLElement>()
const rolecardContainer = ref<HTMLElement>()

// Settings
const settings = ref(editorSettings.getSettings())

// Computed
const showToolbar = computed(() => settings.value.showToolbar)

const supportsRoleCard = computed(() => {
  return props.fileType === 'json5' || props.fileType === 'ojson5'
})

const supportsMonaco = computed(() => true)

const supportsVditor = computed(() => {
  return props.fileType === 'md'
})

// Methods
const determineDefaultEditor = (): EditorType => {
  if (props.fileType === 'json5' || props.fileType === 'ojson5') {
    return settings.value.defaultEditorForJson5
  } else if (props.fileType === 'md') {
    return settings.value.defaultEditorForMarkdown
  }
  return 'monaco'
}

const loadFileContent = () => {
  if (!props.filePath) return
  
  try {
    // 发送消息到VS Code扩展来读取文件
    if (window.vscode) {
      window.vscode.postMessage({
        type: 'loadFileContent',
        filePath: props.filePath
      })
    }
  } catch (error) {
    console.error('Failed to load file:', error)
    $q.notify({
      type: 'negative',
      message: '加载文件失败'
    })
  }
}

const saveFile = () => {
  if (!props.filePath || isSaving.value) return
  
  isSaving.value = true
  
  try {
    let contentToSave = ''
  if (currentEditor.value === 'rolecard' && roleData.value) {
    contentToSave = JSON.stringify(roleData.value, null, 2)
  } else if (currentEditor.value === 'monaco' && monacoEditor.value) {
    contentToSave = monacoEditor.value.getValue()
  } else if (currentEditor.value === 'vditor' && vditorInstance.value) {
    try {
      contentToSave = vditorInstance.value.getValue()
    } catch (error) {
      console.warn('Vditor getValue error during save (ignored):', error)
      contentToSave = content.value
    }
  } else {
    contentToSave = content.value
  }
    
    // 发送消息到VS Code扩展来保存文件
    if (window.vscode) {
      window.vscode.postMessage({
        type: 'saveFileContent',
        filePath: props.filePath,
        content: contentToSave
      })
    }
    
    originalContent.value = contentToSave
    hasChanges.value = false
    
    emit('file-saved', props.filePath, contentToSave)
    
    $q.notify({
      type: 'positive',
      message: '文件保存成功'
    })
    
  } catch (error) {
    console.error('Failed to save file:', error)
    $q.notify({
      type: 'negative',
      message: '保存文件失败'
    })
  } finally {
    isSaving.value = false
  }
}

const switchEditor = async (editorType: EditorType) => {
  if (currentEditor.value === editorType) return
  
  // 保存当前编辑器的内容
  let currentContent = ''
  if (currentEditor.value === 'rolecard' && roleData.value) {
    currentContent = JSON.stringify(roleData.value, null, 2)
  } else if (currentEditor.value === 'monaco' && monacoEditor.value) {
    currentContent = monacoEditor.value.getValue()
  } else if (currentEditor.value === 'vditor' && vditorInstance.value) {
    try {
      currentContent = vditorInstance.value.getValue()
    } catch (error) {
      console.warn('Vditor getValue error during switch (ignored):', error)
      currentContent = content.value
    }
  }
  
  content.value = currentContent
  currentEditor.value = editorType
  
  await nextTick()
  await initializeEditor(editorType)
}

const initializeEditor = async (editorType: EditorType) => {
  switch (editorType) {
    case 'rolecard':
      initializeRoleCard()
      break
    case 'monaco':
      await initializeMonaco()
      break
    case 'vditor':
      await initializeVditor()
      break
  }
}

const initializeRoleCard = () => {
  try {
    if (content.value) {
      roleData.value = JSON.parse(content.value)
    } else {
      roleData.value = {}
    }
    rolecardMounted.value = true
  } catch (error) {
    console.error('Failed to parse role data:', error)
    roleData.value = {}
    rolecardMounted.value = true
  }
}

const initializeMonaco = async () => {
  if (!monacoContainer.value) return
  
  try {
    // 动态导入Monaco编辑器
    const monaco = await import('monaco-editor')
    
    // 销毁现有编辑器实例
    if (monacoEditor.value) {
      monacoEditor.value.dispose()
    }
    
    // 创建新的编辑器实例
    monacoEditor.value = monaco.editor.create(monacoContainer.value, {
      value: content.value,
      language: getMonacoLanguage(props.fileType),
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on'
    })
    
    // 监听内容变化
    monacoEditor.value.onDidChangeModelContent(() => {
      if (monacoEditor.value) {
        const newContent = monacoEditor.value.getValue()
        hasChanges.value = newContent !== originalContent.value
      }
    })
    
  } catch (error) {
    console.error('Failed to initialize Monaco editor:', error)
  }
}

const initializeVditor = async () => {
  if (!vditorContainer.value) return
  
  try {
    // 动态导入Vditor
    const Vditor = (await import('vditor')).default
    
    // 销毁现有编辑器实例
    if (vditorInstance.value) {
      try {
        vditorInstance.value.destroy()
      } catch (error) {
        console.warn('Vditor destroy error (ignored):', error)
      }
      vditorInstance.value = null
    }
    
    // 创建新的编辑器实例
    vditorInstance.value = new Vditor(vditorContainer.value, {
      value: content.value,
      mode: 'wysiwyg',
      theme: 'dark',
      height: '100%',
      cache: { enable: false },
      lang: 'zh_CN',
      cdn: '',  // 禁用CDN加载，避免CSP问题
      input: () => {
        if (vditorInstance.value) {
          try {
            const newContent = vditorInstance.value.getValue()
            hasChanges.value = newContent !== originalContent.value
          } catch (error) {
            console.warn('Vditor getValue error in input callback (ignored):', error)
          }
        }
      }
    })
    
  } catch (error) {
    console.error('Failed to initialize Vditor:', error)
  }
}

const getMonacoLanguage = (fileType?: string): string => {
  switch (fileType) {
    case 'json5':
    case 'ojson5':
      return 'json'
    case 'md':
      return 'markdown'
    case 'js':
      return 'javascript'
    case 'ts':
      return 'typescript'
    default:
      return 'plaintext'
  }
}

const onRoleDataUpdate = (newRoleData: any) => {
  roleData.value = newRoleData
  hasChanges.value = JSON.stringify(newRoleData, null, 2) !== originalContent.value
}

const closeModal = () => {
  if (hasChanges.value) {
    $q.dialog({
      title: '确认',
      message: '您有未保存的更改，确定要关闭吗？',
      cancel: true,
      persistent: true
    }).onOk(() => {
      isVisible.value = false
    })
  } else {
    isVisible.value = false
  }
}

const onBeforeShow = async () => {
  // 确定默认编辑器
  currentEditor.value = determineDefaultEditor()
  
  // 加载文件内容
  loadFileContent()
  
  // 等待DOM更新后初始化编辑器
  await nextTick()
  await initializeEditor(currentEditor.value)
}

const onHide = () => {
  // 清理编辑器实例
  if (monacoEditor.value) {
    monacoEditor.value.dispose()
    monacoEditor.value = null
  }
  
  if (vditorInstance.value) {
    vditorInstance.value.destroy()
    vditorInstance.value = null
  }
  
  rolecardMounted.value = false
  roleData.value = null
  content.value = ''
  originalContent.value = ''
  hasChanges.value = false
}

// 监听来自VS Code的消息
const handleMessage = (event: MessageEvent) => {
  const message = event.data
  
  switch (message.type) {
    case 'fileContent':
      if (message.filePath === props.filePath) {
        content.value = message.content
        originalContent.value = message.content
        hasChanges.value = false
        
        // 重新初始化当前编辑器
        void nextTick(() => {
          void initializeEditor(currentEditor.value)
        })
      }
      break
    case 'fileContentError':
      $q.notify({
        type: 'negative',
        message: `加载文件失败: ${message.error}`
      })
      break
    case 'fileSaveSuccess':
      if (message.filePath === props.filePath) {
        isSaving.value = false
        $q.notify({
          type: 'positive',
          message: '文件保存成功'
        })
      }
      break
    case 'fileSaveError':
      isSaving.value = false
      $q.notify({
        type: 'negative',
        message: `保存失败: ${message.error}`
      })
      break
  }
}

onMounted(() => {
  window.addEventListener('message', handleMessage)
})

onUnmounted(() => {
  window.removeEventListener('message', handleMessage)
  
  // 清理编辑器实例
  if (monacoEditor.value) {
    monacoEditor.value.dispose()
  }
  
  if (vditorInstance.value) {
    try {
      vditorInstance.value.destroy()
    } catch (error) {
      console.warn('Vditor destroy error during cleanup (ignored):', error)
    }
    vditorInstance.value = null
  }
})
</script>

<style scoped>
.universal-editor-modal {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.editor-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--q-border-color, #e0e0e0);
  margin-bottom: 8px;
}

.editor-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.editor-content.with-toolbar {
  height: calc(100% - 60px);
}

.editor-area {
  flex: 1;
  height: 100%;
  min-height: 400px;
}

/* 深色主题适配 */
.body--dark .editor-toolbar {
  border-bottom-color: var(--q-dark-border-color, #424242);
}
</style>