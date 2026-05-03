<template>
  <div class="font-family-preview">
    <div class="preview-text" :style="{ fontFamily: value }">
      <div class="preview-line zh">每个人心中都有一座城，住着一个不可能的人。</div>
      <div class="preview-line en">The quick brown fox jumps over the lazy dog.</div>
      <div class="preview-line ja">吾輩は猫である。名前はまだ無い。</div>
      <div class="preview-line ru">Съешь ещё этих мягких французских булок.</div>
      <div class="preview-line el">Ξεσκεπάζω τὴν ψυχοφθόρα βδελυγμία.</div>
      <div class="preview-line fr">Portez ce vieux whisky au juge blond qui fume.</div>
      <div class="preview-line de">Zwölf Boxkämpfer jagen Viktor quer über den großen Sylter Deich.</div>
    </div>
    <div class="font-list">
      <span
        v-for="(font, index) in fontList"
        :key="index"
        class="font-tag"
        :style="{ fontFamily: font }"
      >
        {{ cleanFontName(font) }}
        <span v-if="index === 0" class="primary-badge">首选</span>
      </span>
    </div>
    <button class="manage-btn" @click="openFontManager">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M12 15.5A3.5 3.5 0 0 1 8.5 12A3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5a3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97c0-.33-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.08-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1c0 .33.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66Z" fill="currentColor"/>
      </svg>
      管理字体
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useVsCodeApiStore } from '../../../../stores/vscode'

const props = defineProps<{
  value: string
}>()

const vsCodeApiStore = useVsCodeApiStore()

const fontList = computed(() => {
  if (!props.value) return []
  return props.value.split(',').map(f => f.trim()).filter(Boolean)
})

function cleanFontName(font: string): string {
  return font.replace(/^['"]|['"]$/g, '')
}

function openFontManager() {
  if (vsCodeApiStore.vscode) {
    vsCodeApiStore.vscode.postMessage({
      command: 'runCommand',
      commandId: 'andrea.manageEditorFontFamily'
    })
  }
}
</script>

<style scoped>
.font-family-preview {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.preview-text {
  color: var(--vscode-foreground, #e0e0e0);
  text-align: center;
  font-size: 14px;
  line-height: 1.6;
  transition: font-family 0.2s ease;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.preview-line {
  font-size: 14px;
  word-break: break-word;
  overflow-wrap: break-word;
  max-width: 100%;
}

.font-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: center;
}

.font-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background-color: var(--vscode-badge-background, #4d4d4d);
  color: var(--vscode-badge-foreground, #fff);
}

.primary-badge {
  font-size: 9px;
  padding: 0 4px;
  border-radius: 3px;
  background-color: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
}

.manage-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 3px 10px;
  border: 1px solid var(--vscode-button-border, #444);
  border-radius: 4px;
  background: transparent;
  color: var(--vscode-textLink-foreground, #3794ff);
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.manage-btn:hover {
  background-color: var(--vscode-toolbar-hoverBackground, #333);
}
</style>
