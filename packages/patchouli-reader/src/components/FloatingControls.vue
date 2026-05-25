<template>
  <!-- 折叠按钮 -->
  <button class="toggle-btn" @click.stop="toggleCollapse">
    {{ isCollapsed ? 'Expand' : 'Collapse' }}
  </button>
  <div
    class="floating-controls"
    :class="{ collapsed: isCollapsed }"
    v-if="!isCollapsed"
    @click.stop
  >
    <!-- 翻页控件 -->
    <div class="pagination-panel">
      <div class="pagination-info">
        <span>Page {{ currentPage }} of {{ totalPages }}</span>
      </div>
      <div class="progress-bar">
        <div class="progress" :style="{ width: progress + '%' }"></div>
      </div>
      <div class="page-buttons">
        <button @click.stop="prevPage" :disabled="currentPage === 1">Previous</button>
        <button @click.stop="nextPage" :disabled="currentPage === totalPages">Next</button>
      </div>
    </div>

    <!-- 字体大小调整控件 -->
    <div class="font-panel">
      <div class="size-bar">
        <label for="fontSize">正文大小：</label>
        <input type="range" id="fontSize" v-model.number="fontSize" min="10" max="50" step="1" />
        <span>{{ fontSize }} px</span>
      </div>

      <!-- 标题大小调整控件 -->
      <div class="size-bar">
        <label for="headingFontSize">标题大小：</label>
        <input
          type="range"
          id="headingFontSize"
          v-model.number="headingFontSize"
          min="20"
          max="80"
          step="1"
        />
        <span>{{ headingFontSize }} px</span>
      </div>
    </div>
    <div>
      <!-- 模式切换按钮 -->
      <div class="mode-buttons">
        <div class="row">
          <button class="mode-btn" @click.stop="onPagedModeClick">
            {{ text_paged_mode_bottom }}
          </button>
          <button class="mode-btn" @click.stop="onEngineModeClick">
            {{ text_engine_mode_bottom }}
          </button>
        </div>
        <div class="row">
          <button class="mode-btn" @click.stop="onViewModeClick">
            {{ text_view_mode_bottom }}
          </button>
          <button class="mode-btn" @click.stop="onDisplayNavigate">
            {{ text_display_navigate_bottom }}
          </button>
        </div>
        <!-- 在 mode-buttons 部分修改为 -->
        <div class="row">
          <button
            class="mode-btn"
            :class="{ active: themeMode === 'light' }"
            @click.stop="setTheme('light')"
          >
            🌞 Light
          </button>
          <button
            class="mode-btn"
            :class="{ active: themeMode === 'dark' }"
            @click.stop="setTheme('dark')"
          >
            🌙 Dark
          </button>
          <button
            class="mode-btn"
            :class="{ active: themeMode === 'system' }"
            @click.stop="setTheme('system')"
          >
            ⚙️ System
          </button>
        </div>
      </div>

      <!-- About Widget (图标和信息部分) -->
      <br />
      <AboutWidget />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, ref, watch, type Ref } from 'vue'
import AboutWidget from './AboutWidget.vue'

const onReaderClick = inject('PatchouliReader_onReaderClick')
const emit = defineEmits([
  'prev-page',
  'next-page',
  'switch-view-mode',
  'switch-paged_mode',
  'switch-paged_engine',
  'switch-display-navigate',
])
const props = defineProps({
  currentPage: {
    type: Number,
    required: true,
  },
  totalPages: {
    type: Number,
    required: true,
  },
  progress: {
    type: Number,
    required: true,
  },
  enable_high_level_paged_engine: {
    type: Boolean,
    required: true,
  },
  enable_single_page_mode: {
    type: Boolean,
    required: true,
  },
  enable_pointer_engine: {
    type: Boolean,
    required: true,
  },
  display_navigate: {
    type: Boolean,
    required: true,
  },
})

const headingFontSize: Ref<number> = defineModel<number>('headingFontSize', { required: true })
const fontSize: Ref<number> = defineModel<number>('fontSize', { required: true })
const isCollapsed = ref<boolean>(false) // 控制折叠状态

const text_paged_mode_bottom = computed(() =>
  props.enable_single_page_mode
    ? 'Raw'
    : props.enable_high_level_paged_engine
      ? 'HighLevel'
      : 'LowLevel',
)
const text_view_mode_bottom = computed(() =>
  props.enable_single_page_mode === true ? 'SinglePage' : 'MultiPage',
)

const text_engine_mode_bottom = computed(() =>
  props.enable_pointer_engine === true ? 'Pointer' : 'SourceGen',
)

const text_display_navigate_bottom = computed(() =>
  props.display_navigate === true ? 'NaviDisplay' : 'Navigate',
)

watch([onReaderClick as Ref<boolean>], () => {
  if ((onReaderClick as Ref<boolean>).value === true) {
    toggleCollapse()
    ;(onReaderClick as Ref<boolean>).value = false
    // console.log("2222",(onReaderClick as Ref<boolean>).value)
    // 清标志位
  }
})

const prevPage = () => {
  emit('prev-page')
}

const nextPage = () => {
  emit('next-page')
}

const onViewModeClick = () => {
  emit('switch-view-mode')
}

const onPagedModeClick = () => {
  emit('switch-paged_mode')
}

const onEngineModeClick = () => {
  emit('switch-paged_engine')
}

const onDisplayNavigate = () => {
  emit('switch-display-navigate')
}

const toggleCollapse = () => {
  // console.log("1111")
  // console.log("1111",(onReaderClick as Ref<boolean>).value)
  isCollapsed.value = !isCollapsed.value // 切换折叠状态
}

// 定义三种主题模式
type ThemeMode = 'system' | 'dark' | 'light'
const themeMode = ref<ThemeMode>('system')

// 初始化主题
onMounted(() => {
  const savedMode = localStorage.getItem('themeMode') as ThemeMode | null
  themeMode.value = savedMode || 'system'
  applyTheme()
})

// 初始化主题
onMounted(() => {
  const savedMode = (localStorage.getItem('themeMode') as ThemeMode) || 'system'
  themeMode.value = savedMode
  applyTheme()
})

// 系统主题监听器
let systemThemeQuery: MediaQueryList | null = null

const setTheme = (mode: ThemeMode) => {
  themeMode.value = mode
  localStorage.setItem('themeMode', mode)
  applyTheme()
}

const applyTheme = () => {
  if (systemThemeQuery) {
    systemThemeQuery.removeEventListener('change', handleSystemThemeChange)
  }

  if (themeMode.value === 'system') {
    systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
    systemThemeQuery.addEventListener('change', handleSystemThemeChange)
    updateThemeClass(systemThemeQuery.matches)
  } else {
    updateThemeClass(themeMode.value === 'dark')
  }
}

const handleSystemThemeChange = (e: MediaQueryListEvent) => {
  if (themeMode.value === 'system') {
    updateThemeClass(e.matches)
  }
}

const updateThemeClass = (isDark: boolean) => {
  document.documentElement.classList.toggle('dark', isDark)
}

// function onMounted(arg0: () => void) {
//   throw new Error('Function not implemented.')
// }
</script>

<style scoped>
/* ========== 通用样式 ========== */
.floating-controls {
  position: fixed;
  bottom: 20px;
  right: 20px;
  border-radius: 8px;
  background-color: var(--floating-bg);
  /* background-color: rgba(40, 40, 40, 0.95); */
  border-radius: 12px;
  padding: 16px;
  /* box-shadow: var(--floating-shadow); */
  z-index: 1000;
  width: min(400px, calc(100vw - 32px));
  transition: all 0.3s ease;
  /* backdrop-filter: blur(8px); */
  gap: 15px;
  height: auto;
}

.toggle-btn {
  background-color: var(--toggle-btn-bg);
  color: var(--text-primary);
  border: 1px solid rgba(0, 0, 0, 0.1);
  &:hover {
    background-color: var(--toggle-btn-hover);
    color: white;
  }
}

/* ========== 分页控件 ========== */
.pagination-info {
  color: var(--text-primary);
  font-size: 0.9em;
}

/* .progress-bar {
  background-color: var(--progress-bg);
  .progress {
    background-color: var(--progress-fill);
  }
} */

/* ========== 按钮样式 ========== */
.mode-btn {
  background: var(--btn-bg);
  color: white;
  transition: all 0.2s ease;

  &:hover {
    background: var(--btn-hover);
    transform: translateY(-1px);
  }

  &:active {
    background: var(--btn-active);
    transform: translateY(1px);
  }

  &.active {
    background: var(--btn-active-border) !important;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
}

/* ========== 响应式设计 ========== */
@media (max-width: 600px) {
  .floating-controls {
    width: 90%;
    right: 5%;
    bottom: 10px;
  }

  .row {
    flex-wrap: wrap;
    button {
      flex: 1 0 45%;
      margin: 4px;
    }
  }
}

/* .floating-controls {
  position: fixed;
  bottom: 20px;
  right: 20px;
  border-radius: 8px;
  padding: 10px;
  box-shadow: 0px 4px 6px rgba(0, 0, 0, 0.2);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 15px;
  width: 300px;
  height: auto;
} */

.floating-controls.collapsed {
  bottom: 20px;
  right: 80px;
}

.toggle-btn {
  position: fixed;
  top: 20px;
  right: 20px;
  background-color: rgba(169, 169, 169, 0.5); /* 灰色且半透明 */
  border: none;
  border-radius: 5px;
  padding: 10px 20px;
  cursor: pointer;
  font-size: 16px;
  z-index: 1001;
  transition:
    background-color 0.3s ease,
    opacity 0.3s ease;
  opacity: 0.7;
}

.toggle-btn:hover {
  background-color: #4caf50; /* 绿色背景 */
  opacity: 1;
}

.toggle-btn:focus {
  outline: none;
}

.pagination-panel,
.font-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.pagination-info {
  font-size: 12px;
  margin-bottom: 5px;
}

.progress-bar {
  width: 100%;
  height: 5px;
  background-color: #f0f0f0; /* 浅色进度条背景 */
  border-radius: 3px;
  margin-bottom: 5px;
}

.progress {
  height: 100%;
  background-color: #4caf50;
  border-radius: 3px;
  transition: width 0.3s;
}

.page-buttons button {
  padding: 5px 10px;
  margin: 0 5px;
  font-size: 14px;
  background-color: #4caf50;
  border: none;
  border-radius: 3px;
  width: 80px;
}

.mode-buttons {
  display: flex;
  flex-direction: column; /* 按行排列 */
  align-items: center; /* 水平居中 */
  gap: 10px; /* 行间距 */
}

.row {
  display: flex;
  justify-content: center; /* 每行中的按钮水平居中 */
  gap: 10px; /* 按钮之间的间距 */
}

.mode-btn {
  padding: 8px 15px; /* 按钮内边距 */
  font-size: 14px; /* 字体大小 */
  background-color: #499a97; /* 背景色 */
  border: none; /* 移除边框 */
  border-radius: 5px; /* 圆角 */
  cursor: pointer; /* 鼠标样式 */
  /* transition:
    background-color 0.3s ease,
    transform 0.2s ease; 动效 */
  width: 100px;
}

.mode-btn:hover {
  background-color: #387e7b; /* 鼠标悬停时的背景色 */
  /* transform: scale(1.05); 悬停时稍微放大 */
}

.mode-btn:active {
  background-color: #285e5d; /* 点击时的背景色 */
  /* transform: scale(0.95); 点击时稍微缩小 */
}

@media (max-width: 600px) {
  .mode-buttons {
    flex-direction: column; /* 小屏幕时垂直排列 */
    align-items: center; /* 垂直居中对齐 */
  }

  .mode-btn {
    width: 100%; /* 按钮在小屏幕上占满宽度 */
  }
}

.size-bar {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.size-bar input {
  margin: 0 10px;
}
</style>
