<template>
  <div class="editor-settings-enhanced-page">
    <div class="page-container">
      <!-- 头部区域 -->
      <div class="header">
        <div class="header-left">
          <h1 class="page-title">编辑器设置</h1>
          <p class="page-subtitle">配置 Andrea Novel Helper 的所有设置选项</p>
        </div>

        <div class="header-controls">
          <!-- 搜索框 -->
          <div class="search-container">
            <div class="search-box">
              <svg class="search-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 21L15.5 15.5M17 10C17 13.866 13.866 17 10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10Z"
                      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <input
                type="text"
                v-model="searchQuery"
                placeholder="搜索设置（名称、描述或配置项ID）..."
                class="search-input"
                @input="handleSearch"
              />
              <button
                v-if="searchQuery"
                class="clear-search"
                @click="clearSearch"
                title="清除搜索"
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>

          <!-- 作用域切换 -->
          <div class="scope-toggle">
            <button
              class="scope-btn"
              :class="{ active: currentScope === 'global' }"
              @click="setScope('global')"
            >
              全局设置
            </button>
            <button
              class="scope-btn"
              :class="{ active: currentScope === 'workspace' }"
              @click="setScope('workspace')"
            >
              工作区设置
            </button>
          </div>

          <!-- 操作按钮 -->
          <div class="header-actions">
            <button v-if="changedCount > 0" class="btn btn-reset" @click="resetConfig">
              放弃更改（{{ changedCount }}）
            </button>
            <button class="btn btn-save" @click="saveConfig" :disabled="changedCount === 0">
              保存更改
            </button>
          </div>
        </div>
      </div>

      <!-- 主内容区 - 带侧边栏布局 -->
      <div class="main-content">
        <!-- 左侧导航栏 -->
        <div class="sidebar">
          <div class="sidebar-header">
            <h3 class="sidebar-title">设置类别</h3>
            <div class="sidebar-count">共 {{ configItems.length }} 项</div>
          </div>

          <div class="sidebar-nav">
            <template v-for="section in sidebarSections" :key="section.id">
              <button
                v-show="getSectionItems(section.id).length > 0"
                class="nav-item"
                :class="{
                  active: activeSection === section.id,
                  'has-items': getSectionItems(section.id).length > 0
                }"
                @click="scrollToSection(section.id)"
              >
                <div class="nav-item-content">
                  <div class="nav-item-name">{{ section.name }}</div>
                  <div class="nav-item-count">({{ getSectionItems(section.id).length }})</div>
                </div>
              </button>
            </template>
          </div>

          <!-- 搜索状态指示器 -->
          <div v-if="searchQuery" class="search-status">
            <div class="search-status-icon">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 21L15.5 15.5M17 10C17 13.866 13.866 17 10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10Z"
                      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="search-status-text">
              找到 {{ filteredConfigItems.length }} 项
            </div>
          </div>
        </div>

        <!-- 右侧设置内容 -->
        <div class="settings-content">
          <!-- 搜索结果提示 -->
          <div v-if="searchQuery" class="search-summary">
            搜索结果：{{ filteredConfigItems.length }} 个匹配项
            <button class="btn btn-link" @click="clearSearch">清除搜索</button>
          </div>

          <!-- 设置类别内容 -->
          <div v-if="displaySections.length > 0" class="settings-container">
            <template v-for="section in displaySections" :key="section.id">
              <div
                class="settings-section"
                :id="`section-${section.id}`"
                :class="{ 'is-active': activeSection === section.id }"
              >
                <div class="section-header">
                  <h2 class="section-title">
                    <svg class="section-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M9 5H7C5.89543 5 5 5.89543 5 7V19C5 20.1046 5.89543 21 7 21H17C18.1046 21 19 20.1046 19 19V7C19 5.89543 18.1046 5 17 5H15"
                            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      <path d="M13 3H11C9.89543 3 9 3.89543 9 5V15C9 16.1046 9.89543 17 11 17H15C16.1046 17 17 16.1046 17 15V5C17 3.89543 16.1046 3 15 3H13Z"
                            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    {{ section.name }}
                  </h2>
                  <div class="section-count">{{ getSectionItems(section.id).length }} 项设置</div>
                </div>

                <div class="section-items">
                  <SettingsConfigItem
                    v-for="item in getSectionItems(section.id)"
                    :key="item.id"
                    :item="item"
                    @update:value="updateConfigValue(item.id, $event)"
                    @jumpToSettings="handleJumpToSettings"
                    @reset="updateConfigValue(item.id, item.defaultValue)"
                  />
                </div>
              </div>
            </template>
          </div>

          <!-- 无搜索结果时的提示 -->
          <div v-else-if="searchQuery && filteredConfigItems.length === 0" class="no-results">
            <div class="no-results-icon">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 21L15.5 15.5M17 10C17 13.866 13.866 17 10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10Z"
                      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M8 10H12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="no-results-title">未找到匹配的设置项</div>
            <div class="no-results-description">
              尝试使用其他关键词，如：设置名称、描述或配置项ID
            </div>
            <button class="btn btn-link" @click="clearSearch">清除搜索</button>
          </div>

          <!-- 加载中状态 -->
          <div v-else-if="configItems.length === 0" class="loading-state">
            <div class="loading-spinner"></div>
            <div class="loading-text">正在加载设置...</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import SettingsConfigItem from '../settingView/components/SettingsConfigItem.vue'
import { useVsCodeApiStore } from '../../stores/vscode'

import type { ConfigItem } from 'src/types/config'

interface Section {
  id: string
  name: string
}

// Stores
const vsCodeApiStore = useVsCodeApiStore()

// 状态管理
const currentScope = ref<'global' | 'workspace'>('workspace')
const searchQuery = ref('')
const activeSection = ref<string>('')

// 配置项数据
const sections = ref<Section[]>([])
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

// 显示的sections（内容区域显示）
const displaySections = computed(() => {
  if (!searchQuery.value) {
    return sections.value
  }

  // 搜索时只显示有匹配项的section
  return sections.value.filter(section => {
    return getSectionItems(section.id).length > 0
  })
})

// 侧边栏显示的分类（搜索时过滤掉没有项目的分类）
const sidebarSections = computed(() => {
  if (!searchQuery.value) {
    return sections.value
  }

  // 搜索时只显示有匹配项的section
  return sections.value.filter(section => {
    return getSectionItems(section.id).length > 0
  })
})

// 过滤后的配置项
const filteredConfigItems = computed(() => {
  if (!searchQuery.value) {
    return configItems.value
  }

  const query = searchQuery.value.toLowerCase()
  return configItems.value.filter(item => {
    return item.id.toLowerCase().includes(query) ||
           item.name.toLowerCase().includes(query) ||
           item.description.toLowerCase().includes(query)
  })
})

// 带高亮的配置项
const highlightedConfigItems = computed(() => {
  return configItems.value.map(item => ({
    ...item,
    highlightedName: highlightText(item.name, searchQuery.value),
    highlightedDescription: highlightText(item.description, searchQuery.value),
    highlightedId: highlightText(item.id, searchQuery.value)
  }))
})

// 获取某个section下的项目
const getSectionItems = (sectionId: string): any[] => {
  if (!searchQuery.value) {
    return highlightedConfigItems.value.filter(item => item.section === sectionId)
  }

  // 搜索时返回匹配的项目
  const query = searchQuery.value.toLowerCase()
  return highlightedConfigItems.value.filter(item => {
    return item.section === sectionId && (
      item.id.toLowerCase().includes(query) ||
      item.name.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query)
    )
  })
}

// 方法
const handleSearch = () => {
  // 搜索结果会自动更新
}

const clearSearch = () => {
  searchQuery.value = ''
}

const resetConfig = () => {
  configItems.value.forEach(item => {
    if (originalSettings.value[item.id] !== item.value) {
      updateConfigValue(item.id, originalSettings.value[item.id])
    }
  })
}

const updateConfigValue = (itemId: string, newValue: any) => {
  const item = configItems.value.find(item => item.id === itemId)
  if (item) {
    item.value = newValue

    // 发送更新消息
    const message = {
      command: 'updateSetting',
      key: itemId,
      value: newValue
    }

    if (window.parent !== window) {
      // 在iframe中，发送到父窗口
      window.parent.postMessage(message, '*')
    } else if (vsCodeApiStore.vscode) {
      // 直接在webview中
      vsCodeApiStore.vscode.postMessage(message)
    }
  }
}

const saveConfig = () => {
  const changedSettings: Record<string, any> = {}
  let hasChanges = false

  configItems.value.forEach(item => {
    if (originalSettings.value[item.id] !== item.value) {
      changedSettings[item.id] = item.value
      hasChanges = true
    }
  })

  if (!hasChanges) {
    alert('没有需要保存的更改')
    return
  }

  // 发送保存消息
  const message = {
    command: 'saveSettings',
    settings: changedSettings
  }

  if (window.parent !== window) {
    window.parent.postMessage(message, '*')
  } else if (vsCodeApiStore.vscode) {
    vsCodeApiStore.vscode.postMessage(message)
  }

  // 更新原始值
  Object.keys(changedSettings).forEach(key => {
    originalSettings.value[key] = changedSettings[key]
  })
}

const handleJumpToSettings = (key: string) => {
  const message = {
    command: 'jumpToSettings',
    key: key
  }

  if (window.parent !== window) {
    window.parent.postMessage(message, '*')
  } else if (vsCodeApiStore.vscode) {
    vsCodeApiStore.vscode.postMessage(message)
  }
}

const setScope = (scope: 'global' | 'workspace') => {
  currentScope.value = scope
  const message = {
    command: 'setScope',
    scope: scope
  }

  if (window.parent !== window) {
    window.parent.postMessage(message, '*')
  } else if (vsCodeApiStore.vscode) {
    vsCodeApiStore.vscode.postMessage(message)
  }
}

const scrollToSection = (sectionId: string) => {
  activeSection.value = sectionId

  // 查找对应的section元素
  const element = document.getElementById(`section-${sectionId}`)
  if (element) {
    // 平滑滚动到目标位置
    element.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
      inline: 'nearest'
    })
  }
}

// 高亮关键词
const highlightText = (text: string, query: string): string => {
  if (!query.trim()) {
    return text
  }

  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  return text.replace(regex, '<mark class="search-highlight">$1</mark>')
}

// 监听滚动事件，更新activeSection
const handleScroll = (event: Event) => {
  const target = event.target as HTMLElement
  const sections = document.querySelectorAll('.settings-section')
  const scrollTop = target.scrollTop
  const containerRect = target.getBoundingClientRect()

  let currentActiveSection = ''

  sections.forEach((section) => {
    const sectionElement = section as HTMLElement
    const sectionRect = sectionElement.getBoundingClientRect()
    const containerTop = containerRect.top
    const sectionTop = sectionRect.top - containerTop
    const sectionHeight = sectionRect.height

    // 检查section是否在视口中
    if (sectionTop <= 100 && sectionTop + sectionHeight > 100) {
      const sectionId = sectionElement.id.replace('section-', '')
      currentActiveSection = sectionId
    }
  })

  if (currentActiveSection !== activeSection.value) {
    activeSection.value = currentActiveSection
  }
}

// 生命周期
onMounted(() => {
  // 请求配置数据
  const message = {
    command: 'getSettings'
  }

  if (window.parent !== window) {
    window.parent.postMessage(message, '*')
  } else if (vsCodeApiStore.vscode) {
    vsCodeApiStore.vscode.postMessage(message)
  }

  // 监听消息
  const handleMessage = (event: MessageEvent) => {
    const message = event.data

    switch (message.command) {
      case 'settingsData':
        if (message.data) {
          const { configItems: newConfigItems, sections: newSections, currentScope: scope } = message.data
          configItems.value = newConfigItems
          sections.value = newSections
          currentScope.value = scope || 'global'

          // 保存原始配置值
          originalSettings.value = {}
          newConfigItems.forEach((item: ConfigItem) => {
            originalSettings.value[item.id] = item.value
          })

          // 设置第一个section为活跃状态
          if (newSections.length > 0) {
            activeSection.value = newSections[0].id
          }
        }
        break

      case 'settingUpdated':
        console.log(`Setting ${message.key} updated successfully`)
        break

      case 'settingsSaved':
        alert(message.message || '设置已保存')
        break

      case 'error':
        alert(`错误: ${message.message}`)
        break
    }
  }

  window.addEventListener('message', handleMessage)

  // 添加滚动监听器
  const contentArea = document.querySelector('.settings-content')
  if (contentArea) {
    contentArea.addEventListener('scroll', handleScroll)
  }

  // 清理函数
  onUnmounted(() => {
    window.removeEventListener('message', handleMessage)
    if (contentArea) {
      contentArea.removeEventListener('scroll', handleScroll)
    }
  })
})
</script>

<style scoped>
.editor-settings-enhanced-page {
  height: 100vh;
  background-color: var(--vscode-editor-background, #1e1e1e);
  color: var(--vscode-foreground, #e0e0e0);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.page-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 侧边栏 */
.sidebar {
  width: 280px;
  background-color: var(--vscode-sideBar-background, #252526);
  border-right: 1px solid var(--vscode-sideBar-border, #333);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  flex-shrink: 0;
}

.sidebar-header {
  padding: 20px 16px;
  border-bottom: 1px solid var(--vscode-panel-border, #333);
}

.sidebar-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--vscode-foreground, #e0e0e0);
  margin: 0;
  padding: 0;
}

.sidebar-count {
  font-size: 12px;
  color: var(--vscode-descriptionForeground, #9d9d9d);
  margin-top: 4px;
}

.sidebar-nav {
  padding: 12px 0;
  flex: 1;
}

.nav-item {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  margin: 0 8px 2px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 14px;
  color: var(--vscode-foreground, #e0e0e0);
  text-decoration: none;
  border: none;
  background: none;
  width: calc(100% - 16px);
  text-align: left;
}

.nav-item:hover {
  background-color: var(--vscode-toolbar-hoverBackground, #333);
}

.nav-item.active {
  background-color: var(--vscode-list-activeSelectionBackground, #094771);
  color: var(--vscode-list-activeSelectionForeground, #ffffff);
  font-weight: 500;
}

.nav-item-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.nav-item-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-item-count {
  font-size: 11px;
  color: var(--vscode-descriptionForeground, #9d9d9d);
  background-color: var(--vscode-badge-background, #4d4d4d);
  color: var(--vscode-badge-foreground, #ffffff);
  padding: 2px 6px;
  border-radius: 8px;
  font-weight: 500;
  min-width: 18px;
  text-align: center;
  margin-left: 8px;
}

.nav-item.active .nav-item-count {
  background-color: var(--vscode-badge-background, #ffffff);
  color: var(--vscode-badge-foreground, #094771);
}

.search-status {
  padding: 16px;
  border-top: 1px solid var(--vscode-panel-border, #333);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--vscode-descriptionForeground, #9d9d9d);
}

.search-status-icon {
  width: 16px;
  height: 16px;
  opacity: 0.7;
}

.search-status-text {
  flex: 1;
}

/* 主内容区域 */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: row;
  overflow: hidden;
}

/* 设置内容区域 */
.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

/* 头部区域 */
.header {
  padding: 12px 24px;
  background-color: var(--vscode-editor-background, #1e1e1e);
  border-bottom: 1px solid var(--vscode-panel-border, #333);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.page-title {
  font-size: 28px;
  font-weight: 600;
  color: var(--vscode-foreground, #e0e0e0);
  margin: 0;
  padding: 0;
}

.page-subtitle {
  font-size: 14px;
  color: var(--vscode-descriptionForeground, #9d9d9d);
  margin: 0;
  padding: 0;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 16px;
}

/* 搜索框 */
.search-container {
  position: relative;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  width: 320px;
}

.search-icon {
  position: absolute;
  left: 12px;
  width: 20px;
  height: 20px;
  color: var(--vscode-input-foreground, #e0e0e0);
  opacity: 0.7;
  z-index: 1;
}

.search-input {
  width: 100%;
  padding: 10px 16px 10px 44px;
  background-color: var(--vscode-input-background, #2a2a2a);
  border: 1px solid var(--vscode-input-border, #444);
  border-radius: 6px;
  color: var(--vscode-input-foreground, #e0e0e0);
  font-size: 14px;
  outline: none;
  transition: all 0.2s;
}

.search-input:focus {
  border-color: var(--vscode-focusBorder, #007acc);
}

.clear-search {
  position: absolute;
  right: 8px;
  width: 24px;
  height: 24px;
  background: none;
  border: none;
  color: var(--vscode-input-foreground, #e0e0e0);
  opacity: 0.7;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.clear-search:hover {
  opacity: 1;
  background-color: var(--vscode-toolbar-hoverBackground, #333);
}

/* 作用域切换 */
.scope-toggle {
  display: flex;
  border: 1px solid var(--vscode-input-border, #444);
  border-radius: 6px;
  overflow: hidden;
}

.scope-btn {
  padding: 8px 16px;
  border: none;
  background-color: var(--vscode-button-secondaryBackground, #3a3d41);
  color: var(--vscode-button-secondaryForeground, #e0e0e0);
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
  font-weight: 500;
}

.scope-btn:hover {
  background-color: var(--vscode-button-secondaryHoverBackground, #45494e);
}

.scope-btn.active {
  background-color: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #ffffff);
}

.scope-btn.active:hover {
  background-color: var(--vscode-button-hoverBackground, #1177bb);
}

/* 操作按钮 */
.header-actions {
  display: flex;
  gap: 12px;
}

.btn {
  padding: 8px 20px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-weight: 500;
  font-size: 14px;
  transition: all 0.2s;
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-save {
  background-color: var(--vscode-button-background, #1976d2);
  color: var(--vscode-button-foreground, white);
}

.btn-save:hover:not(:disabled) {
  background-color: var(--vscode-button-hoverBackground, #1565c0);
}

.btn-reset {
  background-color: var(--vscode-button-secondaryBackground, #444);
  color: var(--vscode-button-secondaryForeground, white);
}

.btn-reset:hover {
  background-color: var(--vscode-button-secondaryHoverBackground, #555);
}

.btn-link {
  background-color: transparent;
  color: var(--vscode-textLink-foreground, #3794ff);
  text-decoration: underline;
  padding: 0;
  min-height: auto;
}

.btn-link:hover {
  color: var(--vscode-textLink-activeForeground, #3794ff);
}

/* 主内容区域 */
.content {
  flex: 1;
  overflow-y: auto;
  padding: 0 24px 24px;
}

.content-area {
  flex: 1;
  overflow-y: auto;
  scroll-behavior: smooth;
}

/* 搜索结果提示 */
.search-summary {
  padding: 16px 24px;
  margin-bottom: 16px;
  background-color: var(--vscode-textBlockQuote-background, #2a2a2a);
  border-left: 4px solid var(--vscode-textLink-foreground, #3794ff);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  color: var(--vscode-descriptionForeground, #9d9d9d);
}

/* 设置容器 */
.settings-container {
  display: flex;
  flex-direction: column;
  gap: 40px;
  padding: 20px 0;
}

.settings-section {
  background-color: var(--vscode-editor-background, #252526);
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: 8px;
  overflow: hidden;
  scroll-margin-top: 20px;
}

.section-header {
  padding: 20px 24px;
  background-color: var(--vscode-editor-background, #2d2d2d);
  border-bottom: 1px solid var(--vscode-panel-border, #333);
  display: flex;
  align-items: center;
  gap: 12px;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--vscode-foreground, #e0e0e0);
  margin: 0;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-icon {
  width: 20px;
  height: 20px;
}

.section-count {
  font-size: 12px;
  color: var(--vscode-descriptionForeground, #9d9d9d);
  background-color: var(--vscode-badge-background, #4d4d4d);
  color: var(--vscode-badge-foreground, #ffffff);
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
}

.section-items {
  padding: 0;
}

/* 无结果和加载状态 */
.no-results, .loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.no-results-icon, .loading-spinner {
  width: 64px;
  height: 64px;
  color: var(--vscode-descriptionForeground, #9d9d9d);
  margin-bottom: 20px;
}

.loading-spinner {
  border: 3px solid var(--vscode-focusBorder, #007fd4);
  border-top: 3px solid transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.no-results-title, .loading-text {
  font-size: 18px;
  font-weight: 500;
  color: var(--vscode-foreground, #e0e0e0);
  margin-bottom: 8px;
}

.no-results-description {
  font-size: 14px;
  color: var(--vscode-descriptionForeground, #9d9d9d);
  margin-bottom: 24px;
  max-width: 400px;
  line-height: 1.5;
}

/* 滚动条样式 */
.content::-webkit-scrollbar {
  width: 8px;
}

.content::-webkit-scrollbar-track {
  background: transparent;
}

.content::-webkit-scrollbar-thumb {
  background-color: var(--vscode-scrollbarSlider-background, #79797966);
  border-radius: 4px;
}

.content::-webkit-scrollbar-thumb:hover {
  background-color: var(--vscode-scrollbarSlider-hoverBackground, #646464b3);
}

/* 响应式设计 */
@media (max-width: 1200px) {
  .header {
    flex-direction: column;
    gap: 16px;
    align-items: stretch;
  }

  .header-controls {
    justify-content: space-between;
  }

  .search-box {
    width: 100%;
    max-width: 400px;
  }
}

@media (max-width: 768px) {
  .header {
    padding: 16px;
  }

  .header-controls {
    flex-wrap: wrap;
    gap: 12px;
  }

  .search-box {
    width: 100%;
  }

  .page-title {
    font-size: 24px;
  }

  .content {
    padding: 0 16px 16px;
  }

  .settings-section {
    margin-bottom: 20px;
  }

  .section-header {
    padding: 16px;
  }

  .section-title {
    font-size: 16px;
  }
}

/* 搜索高亮样式 */
:deep(.search-highlight) {
  background-color: var(--vscode-editor-findMatchHighlightBackground, #515c6a);
  color: var(--vscode-editor-foreground, #e0e0e0);
  padding: 1px 2px;
  border-radius: 2px;
  font-weight: 600;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
</style>