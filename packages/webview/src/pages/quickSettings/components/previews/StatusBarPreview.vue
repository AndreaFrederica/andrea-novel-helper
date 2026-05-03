<template>
  <div class="statusbar-preview">
    <div class="mock-editor">
      <div class="main-area">
        <div class="mock-line" v-for="(line, i) in editorLines" :key="i">
          <span class="line-text">{{ line }}</span>
        </div>
      </div>
    </div>
    <div class="mock-statusbar">
      <div class="statusbar-left">
        <!-- ANH:Sync — Left, priority 1000 (far left) -->
        <span class="statusbar-item sync" title="ANH:Sync 状态">
          <svg class="codicon" width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.001 7.001 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.501 5.501 0 0 0 8 2.5zM1.705 8.005a.75.75 0 0 1 .834.656 5.501 5.501 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.001 7.001 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834z"/></svg>
          {{ syncText }}
        </span>
        <!-- Writing stats — Left, priority 100 -->
        <span class="statusbar-item writing-stats" title="写作统计">
          <svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3 1.5h10a.5.5 0 0 1 .5.5v12a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5zm1.5 2v9h8v-9H4.5z"/></svg>
          {{ writingStatsText }}
        </span>
      </div>
      <div class="statusbar-right">
        <!-- 版式和快速设置 — Right, priority 100 -->
        <span class="statusbar-item layout-settings" title="版式和快速设置">
          <svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14.943 3.814a.75.75 0 0 1-.656.598l-.243.081a2 2 0 0 0-1.308 2.445l.17.494a.75.75 0 0 1-1.423.38l-.17-.494a.5.5 0 0 0-.327-.61l-.243-.082a.75.75 0 1 1 .67-.987l.243.081a2 2 0 0 0 1.308-2.445l-.17-.494a.75.75 0 0 1 1.423-.38l.17.494a.5.5 0 0 0 .327.61l.243.082a.75.75 0 0 1 .598.656zM8 1a.75.75 0 0 1 .75.75v.518a5.5 5.5 0 0 1 3.732 2.232l.365-.365a.75.75 0 1 1 1.06 1.06l-.365.365A5.5 5.5 0 0 1 13.75 8.75h.518a.75.75 0 0 1 0 1.5h-.518a5.5 5.5 0 0 1-2.232 3.732l.365.365a.75.75 0 1 1-1.06 1.06l-.365-.365A5.5 5.5 0 0 1 8.75 13.75v.518a.75.75 0 0 1-1.5 0v-.518a5.5 5.5 0 0 1-3.732-2.232l-.365.365a.75.75 0 0 1-1.06-1.06l.365-.365A5.5 5.5 0 0 1 2.25 8.75H1.732a.75.75 0 0 1 0-1.5h.518a5.5 5.5 0 0 1 2.232-3.732L4.12 3.156a.75.75 0 1 1 1.06-1.06l.365.365A5.5 5.5 0 0 1 8 1.25V1zM5.5 8a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0z"/></svg>
          {{ layoutText }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  statusBarMode: string
  speedUnit: string
  primaryUnit: string
  layoutCompact: boolean
  autoGitCompact: boolean
}>()

const editorLines = [
  '她站在窗前，看着远处的山峦',
  '在夕阳下渐渐模糊，心中',
  '涌起一股说不清的惆怅。',
  '那些年少时的誓言，如今',
  '看来不过是风中的尘埃。',
  '轻轻一吹便散了。',
]

// Matches statusBarProvider.ts lines 119-131
function formatTimeText(): string {
  const totalMinutes = 135 // 2h15m
  const totalHours = Math.floor(totalMinutes / 60)
  const remainingMinutes = totalMinutes % 60
  if (totalHours > 0) {
    return `${totalHours}h${remainingMinutes}m`
  } else if (totalMinutes > 0) {
    return `${totalMinutes}m`
  }
  return '<1m'
}

// Matches timeStats.ts line 962
function getUnitText(): string {
  switch (props.primaryUnit) {
    case 'includePunct': return '（含标点）'
    case 'nonWSNoPunct': return '（不含标点）'
    default: return '（词计）'
  }
}

// Matches statusBarProvider.ts lines 133-138 — different counts per primaryUnit
const wordCount = computed(() => {
  switch (props.primaryUnit) {
    case 'includePunct': return '35,210'   // nonWSChars — all non-whitespace
    case 'nonWSNoPunct': return '33,108'   // nonWSNoPunct — non-whitespace, no punctuation
    case 'excludePunct':
    default: return '32,847'               // total — CJK chars + English words
  }
})

// Matches statusBarProvider.ts lines 170-181 exactly
const writingStatsText = computed(() => {
  const timeText = formatTimeText()
  const speedText = props.speedUnit === 'cph' ? '1,260/h' : '21/m'
  const unitText = getUnitText()

  if (props.statusBarMode === 'compact') {
    // $(file-text) ${wordCount}字
    return `${wordCount.value}字${unitText}`
  } else if (props.statusBarMode === 'semi') {
    // $(file-text) ${wordCount}字 | 速度:${speedText}
    return `${wordCount.value}字${unitText} | 速度:${speedText}`
  } else {
    // $(file-text) ${timeText} | ${wordCount}字 | 速度:${speedText}
    return `${timeText} | ${wordCount.value}字${unitText} | 速度:${speedText}`
  }
})

// Matches layoutStatusBar.ts lines 29-31
const layoutText = computed(() => {
  if (props.layoutCompact) {
    return '版式和快速设置'
  }
  return '版式  缩进:2  首行:开  段距:1  去尾:✓  补齐:开  跳出:开  切段:开'
})

// Matches autoGitService.ts lines 388-402
const syncText = computed(() => {
  if (props.autoGitCompact) {
    return 'ANH:Sync'
  }
  return 'ANH:Sync Git:ON WebDAV:ON'
})
</script>

<style scoped>
.statusbar-preview {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.mock-editor {
  display: flex;
  height: 140px;
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: 4px 4px 0 0;
  overflow: hidden;
  background-color: var(--vscode-editor-background, #1e1e1e);
  font-family: monospace;
  font-size: 11px;
  line-height: 1.4;
}

.main-area {
  flex: 1;
  padding: 6px 10px;
  overflow: hidden;
}

.mock-line {
  color: var(--vscode-foreground, #e0e0e0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mock-statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  padding: 0 8px;
  background-color: var(--vscode-statusBar-background, #007acc);
  border-radius: 0 0 4px 4px;
  font-size: 11px;
  color: var(--vscode-statusBar-foreground, #fff);
  overflow: hidden;
}

.statusbar-left,
.statusbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.statusbar-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
  overflow: hidden;
}

.codicon {
  flex-shrink: 0;
  opacity: 0.9;
}

.writing-stats {
  transition: all 0.3s ease;
}
</style>
