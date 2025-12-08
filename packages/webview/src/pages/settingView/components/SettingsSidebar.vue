<template>
  <div class="sidebar" :class="{ 'active': isOpen }">
    <div class="sidebar-header">
      <div class="logo-text">设置</div>
    </div>
    <div class="sidebar-nav">
      <div 
        v-for="section in sections" 
        :key="section.id" 
        class="nav-item" 
        :class="{ 'active': activeSection === section.id }"
        @click="handleSectionClick(section.id)"
      >
        <i></i>
        <span>{{ section.name }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

interface Section {
  id: string
  name: string
}

interface Props {
  isOpen: boolean
  activeSection: string
  sections: Section[]
}

interface Emits {
  (e: 'update:isOpen', value: boolean): void
  (e: 'section-change', sectionId: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const handleSectionClick = (sectionId: string) => {
  emit('section-change', sectionId)
  // 移动端点击后关闭侧边栏
  if (window.innerWidth <= 768) {
    emit('update:isOpen', false)
  }
}

// 监听窗口大小变化
watch(() => props.isOpen, (newVal) => {
  document.body.style.overflow = newVal ? 'hidden' : 'auto'
})
</script>

<style scoped>
.sidebar {
  width: 225px;
  min-width: 180px;
  background-color: var(--vscode-sideBar-background, #1e1e1e);
  color: var(--vscode-sideBar-foreground, #e0e0e0);
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 5;
  height: 100%;
}

@media (max-width: 768px) {
  .sidebar {
    position: absolute;
    top: 0;
    left: 0;
    transform: translateX(-100%);
    z-index: 10;
    transition: transform 0.3s ease;
    width: 252px;
  }
  
  .sidebar.active {
    transform: translateX(0);
  }
}

.sidebar-header {
  padding: var(--spacing-medium, 14px);
  border-bottom: 1px solid var(--vscode-sideBar-border, #333);
  display: flex;
  align-items: center;
  gap: var(--spacing-small, 7px);
}

.logo-text {
  font-weight: bold;
  font-size: var(--vscode-font-size-large, 1rem);
}

.sidebar-nav {
  flex: 1;
  padding-top: var(--spacing-small, 7px);
  overflow-y: auto;
}

.nav-item {
  padding: var(--spacing-medium, 11px) var(--spacing-large, 14px);
  display: flex;
  align-items: center;
  gap: var(--spacing-medium, 11px);
  cursor: pointer;
  transition: all 0.2s;
  font-size: var(--vscode-font-size, 14px);
  min-height: var(--input-height, 40px);
}

.nav-item:hover {
  background-color: var(--vscode-list-hoverBackground, #2c2c2c);
}

.nav-item.active {
  background-color: var(--vscode-list-activeSelectionBackground, #1976d2);
  color: var(--vscode-list-activeSelectionForeground, white);
}

@media (max-width: 768px) {
  .nav-item {
    font-size: var(--vscode-font-size, 14px);
    padding: var(--spacing-large, 13px) var(--spacing-large, 14px);
  }
}
</style>