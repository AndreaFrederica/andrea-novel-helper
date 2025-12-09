<template>
  <div class="settings-page">
    <div class="container">
      <!-- 侧边栏 -->
      <SettingsSidebar 
        :is-open="isSidebarOpen"
        :active-section="activeSection"
        :sections="sections"
        @update:is-open="isSidebarOpen = $event"
        @section-change="handleSectionChange"
      />
      
      <!-- 遮罩层 -->
      <div class="overlay" :class="{ 'active': isSidebarOpen }" @click="toggleSidebar"></div>

      <!-- 内容区域 -->
      <div class="content">
        <div class="content-header">
          <div class="hamburger" @click="toggleSidebar">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 12H21M3 6H21M3 18H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="page-title">{{ activeSectionName }}</div>
          <div class="scope-toggle">
            <button 
              class="scope-btn" 
              :class="{ active: currentScope === 'global' }"
              @click="setScope('global')"
            >
              全局
            </button>
            <button 
              class="scope-btn" 
              :class="{ active: currentScope === 'workspace' }"
              @click="setScope('workspace')"
            >
              工作区
            </button>
          </div>
        </div>
        
        <div class="main-content">
          <!-- 配置项列表 -->
          <div v-if="activeConfigItems.length > 0">
            <SettingsConfigItem 
              v-for="item in activeConfigItems" 
              :key="item.id" 
              :item="item"
              @update:value="updateConfigValue(item.id, $event)"
              @jumpToSettings="handleJumpToSettings"
              @reset="updateConfigValue(item.id, item.defaultValue)"
            />
          </div>
          
          <!-- 无配置项时的提示 -->
          <div v-else class="config-section">
            <p>此部分暂无配置项</p>
          </div>
        </div>
        
        <div class="footer">
          <button v-if="changedCount > 0" class="btn btn-reset" @click="resetConfig">放弃更改（{{ changedCount }}个）</button>
          <button class="btn btn-save" @click="saveConfig">保存更改</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import SettingsSidebar from './components/SettingsSidebar.vue'
import SettingsConfigItem from './components/SettingsConfigItem.vue'
import { useVsCodeApiStore } from '../../stores/vscode'

import type { ConfigItem } from 'src/types/config'

interface Section {
  id: string
  name: string
}

// Stores
const vsCodeApiStore = useVsCodeApiStore()

// 状态管理
const isSidebarOpen = ref(false)
const activeSection = ref('')
const currentScope = ref<'global' | 'workspace'>('workspace')

// 侧边栏导航项 （设置分类）- 从后端获取配置结构
const sections = ref<Section[]>([])

// 配置项数据 （设置项）- 从后端获取
const configItems = ref<ConfigItem[]>([])

// 原始配置值，用于跟踪更改
const originalSettings = ref<Record<string, any>>({})

// 计算修改数量
const changedCount = computed(() => {
  let count = 0
  configItems.value.forEach(item => {
    if (originalSettings.value[item.id] !== item.value) {
      count++
    }
  })
  return count
})

// 计算属性
const activeSectionName = computed(() => {
  return sections.value.find(s => s.id === activeSection.value)?.name || '设置'
})

const activeConfigItems = computed(() => {
  if (activeSection.value === 'quickSettings') {
    return configItems.value.filter(item => item.quickSetting === true)
  }
  return configItems.value.filter(item => item.section === activeSection.value)
})

// 方法
const toggleSidebar = () => {
  isSidebarOpen.value = !isSidebarOpen.value
}

const handleSectionChange = (sectionId: string) => {
  activeSection.value = sectionId
}

const resetConfig = () => {
      // 将当前配置重新设为originalSettings
    configItems.value.forEach(item => {
      if (originalSettings.value[item.id] !== item.value) {
        // 使用updateConfigValue来更新，这样会触发保存
        updateConfigValue(item.id, originalSettings.value[item.id])
      }
    })
}

const updateConfigValue = (itemId: string, newValue: any) => {
  const item = configItems.value.find(item => item.id === itemId)
  if (item) {
    item.value = newValue
    
    // 发送更新消息到webview
    if (vsCodeApiStore.vscode) {
      vsCodeApiStore.vscode.postMessage({
        command: 'updateSetting',
        key: itemId,
        value: newValue
      })
    }
  }
}

const saveConfig = () => {
  // 只收集有更改的配置项
  const changedSettings: Record<string, any> = {}
  let hasChanges = false
  
  configItems.value.forEach(item => {
    // 比较当前值与原始值
    if (originalSettings.value[item.id] !== item.value) {
      changedSettings[item.id] = item.value
      hasChanges = true
    }
  })
  
  // 如果没有更改，显示提示信息
  if (!hasChanges) {
    alert('没有需要保存的更改')
    return
  }
  
  // 发送保存消息到webview，只包含更改的配置项
  if (vsCodeApiStore.vscode) {
    vsCodeApiStore.vscode.postMessage({
      command: 'saveSettings',
      settings: changedSettings
    })
    
    // 更新原始值，将当前更改的值设为新的原始值
    Object.keys(changedSettings).forEach(key => {
      originalSettings.value[key] = changedSettings[key]
    })
  }
}

const handleJumpToSettings = (key: string) => {
  // 发送跳转消息到webview
  if (vsCodeApiStore.vscode) {
    vsCodeApiStore.vscode.postMessage({
      command: 'jumpToSettings',
      key: key
    })
  }
}

const setScope = (scope: 'global' | 'workspace') => {
  currentScope.value = scope
  // 发送作用域切换消息到webview
  if (vsCodeApiStore.vscode) {
    vsCodeApiStore.vscode.postMessage({
      command: 'setScope',
      scope: scope
    })
  }
}

// 生命周期
onMounted(() => {
  // 请求配置数据
  if (vsCodeApiStore.vscode) {
    vsCodeApiStore.vscode.postMessage({
      command: 'getSettings'
    })
  }

  // 监听来自webview的消息
  const handleMessage = (event: MessageEvent) => {
    const message = event.data
    
    switch (message.command) {
      case 'settingsData':
        // 接收配置数据
        if (message.data) {
          // 直接使用后端返回的配置项和侧边栏数据
          const { configItems: newConfigItems, sections: newSections, currentScope: scope } = message.data
          
          // 更新数据
          configItems.value = newConfigItems
          
          // 添加快速设置section到sections数组开头
          const quickSettingsSection = { id: 'quickSettings', name: '快速设置' }
          sections.value = [quickSettingsSection, ...newSections]
          currentScope.value = scope || 'global'
          
          // 如果有sections但没有激活的section，默认选择快速设置
          if (sections.value.length > 0 && !activeSection.value) {
            activeSection.value = 'quickSettings'
          }
          
          // 保存原始配置值，用于跟踪更改
          originalSettings.value = {}
          newConfigItems.forEach((item: ConfigItem) => {
            originalSettings.value[item.id] = item.value
          })
        }
        break
        
      case 'settingUpdated':
        // 单个配置项更新成功
        console.log(`Setting ${message.key} updated successfully`)
        break
        
      case 'settingsSaved':
        // 配置保存成功
        alert(message.message || '更改的配置已保存')
        break
        
      case 'settingsReset':
        // 配置重置成功，重新获取数据
        // 清空原始设置跟踪，因为数据会重新加载
        originalSettings.value = {}
        if (vsCodeApiStore.vscode) {
          vsCodeApiStore.vscode.postMessage({
            command: 'getSettings'
          })
        }
        break
        
      case 'error':
        // 错误处理
        alert(`错误: ${message.message}`)
        break
    }
  }
  
  window.addEventListener('message', handleMessage)

  // 监听窗口大小变化
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      isSidebarOpen.value = false
    }
  })
  
  // 清理函数
  return () => {
    window.removeEventListener('message', handleMessage)
  }
})
</script>

<style scoped>
.settings-page {
  height: 100vh;
  background-color: var(--vscode-editor-background, #121212);
  color: var(--vscode-foreground, #e0e0e0);
  overflow: hidden;
}

.container {
  display: flex;
  height: 100vh;
  position: relative;
}

/* 遮罩层 */
.overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--vscode-widget-shadow, rgba(0, 0, 0, 0.5));
  z-index: 8;
  display: none;
}

.overlay.active {
  display: block;
}

/* 内容区域样式 */
.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  z-index: 1;
  height: 100%;
}

/* 内容头部 */
.content-header {
  padding: var(--spacing-medium, 16px);
  border-bottom: 1px solid var(--vscode-panel-border, #333);
  display: flex;
  align-items: center;
  gap: var(--spacing-small, 8px);
  position: relative;
}

.page-title {
  font-size: var(--vscode-font-size-header, 1.2rem);
  font-weight: 500;
  color: var(--vscode-foreground, #e0e0e0);
  margin: 0;
  padding: 0;
}

/* 汉堡菜单按钮 */
.hamburger {
  display: none;
  cursor: pointer;
  padding: var(--spacing-small, 8px);
  z-index: 15;
  color: var(--vscode-foreground, #e0e0e0);
}

/* 主内容区域 */
.main-content {
  flex: 1;
  padding: var(--spacing-large, 20px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* 底部操作栏 */
.footer {
  padding: var(--spacing-medium, 6px);
  border-top: 1px solid var(--vscode-panel-border, #333);
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-medium, 12px);
  position: sticky;
  bottom: 0;
  background-color: var(--vscode-editor-background, #121212);
  z-index: 10;
}

.btn {
  padding: var(--spacing-medium, 4px) var(--spacing-large, 10px);
  border-radius: var(--border-radius, 6px);
  border: none;
  cursor: pointer;
  font-weight: 500;
  font-size: var(--vscode-font-size, 1rem);
  min-height: var(--input-height, 25px);
  min-width: 50px;
  transition: all 0.2s;
}

.btn-save {
  background-color: var(--vscode-button-background, #1976d2);
  color: var(--vscode-button-foreground, white);
}

.btn-save:hover {
  background-color: var(--vscode-button-hoverBackground, #1565c0);
}

.btn-reset {
  background-color: var(--vscode-button-secondaryBackground, #444);
  color: var(--vscode-button-secondaryForeground, white);
}

.btn-reset:hover {
  background-color: var(--vscode-button-secondaryHoverBackground, #555);
}

/* 手机端适配 */
@media (max-width: 768px) {
  .hamburger {
    display: block;
  }
  
  .main-content {
    padding: var(--spacing-medium, 16px);
  }
  
  .content-header {
    padding: var(--spacing-small, 12px) var(--spacing-medium, 16px);
  }
}

/* 作用域切换按钮 */
.scope-toggle {
  display: flex;
  margin-left: auto;
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: var(--border-radius, 2px);
  overflow: hidden;
}

.scope-btn {
  padding: var(--spacing-small, 2px) var(--spacing-medium, 4px);
  border: none;
  background-color: transparent;
  color: var(--vscode-foreground, #e0e0e0);
  cursor: pointer;
  font-size: var(--vscode-font-size, 0.9rem);
  transition: all 0.2s;
  min-width: 40px;
}

.scope-btn:hover {
  background-color: var(--vscode-list-hoverBackground, #2a2a2a);
}

.scope-btn.active {
  background-color: var(--vscode-button-background, #1976d2);
  color: var(--vscode-button-foreground, white);
}

.scope-btn.active:hover {
  background-color: var(--vscode-button-hoverBackground, #1565c0);
}
</style>