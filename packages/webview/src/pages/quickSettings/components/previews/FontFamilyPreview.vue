<template>
  <div class="font-family-preview">
    <div class="preview-text" :style="{ fontFamily: value }">
      <div
        v-for="sample in visibleSamples"
        :key="sample.lang"
        class="preview-line"
        :class="sample.lang"
      >
        <span class="sample-lang">{{ sample.label }}</span>
        <span>{{ sample.text }}</span>
      </div>
      <div class="sample-pager">
        <button class="pager-btn" :disabled="samplePage === 0" @click="samplePage--" title="上一页">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <span class="pager-label">{{ samplePage + 1 }} / {{ samplePageCount }}</span>
        <button
          class="pager-btn"
          :disabled="samplePage >= samplePageCount - 1"
          @click="samplePage++"
          title="下一页"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
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
import { computed, ref, watch } from 'vue'
import { useVsCodeApiStore } from '../../../../stores/vscode'

const props = defineProps<{
  value: string
}>()

const vsCodeApiStore = useVsCodeApiStore()
const samplePage = ref(0)
const samplesPerPage = 3

const sampleLines = [
  { lang: 'zh', label: '中', text: '每个人心中都有一座城，住着一个不可能的人。' },
  { lang: 'en', label: 'EN', text: 'The quick brown fox jumps over the lazy dog.' },
  { lang: 'ja', label: '日', text: '吾輩は猫である。名前はまだ無い。' },
  { lang: 'ru', label: 'RU', text: 'Съешь ещё этих мягких французских булок.' },
  { lang: 'el', label: 'EL', text: 'Ξεσκεπάζω τὴν ψυχοφθόρα βδελυγμία.' },
  { lang: 'fr', label: 'FR', text: 'Portez ce vieux whisky au juge blond qui fume.' },
  { lang: 'de', label: 'DE', text: 'Zwölf Boxkämpfer jagen Viktor quer über den großen Sylter Deich.' },
]

const samplePageCount = computed(() => Math.max(1, Math.ceil(sampleLines.length / samplesPerPage)))
const visibleSamples = computed(() => {
  const start = samplePage.value * samplesPerPage
  return sampleLines.slice(start, start + samplesPerPage)
})

watch(samplePageCount, (count) => {
  if (samplePage.value >= count) samplePage.value = count - 1
})

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
  text-align: left;
  font-size: 14px;
  line-height: 1.45;
  transition: font-family 0.2s ease;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  min-height: 138px;
}

.preview-line {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: baseline;
  gap: 8px;
  font-size: 14px;
  word-break: break-word;
  overflow-wrap: break-word;
  max-width: 100%;
}

.sample-lang {
  font-size: 10px;
  color: var(--vscode-descriptionForeground, #999);
  font-family: var(--vscode-font-family, sans-serif);
}

.sample-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: auto;
  font-family: var(--vscode-font-family, sans-serif);
}

.pager-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 22px;
  border: 1px solid var(--vscode-button-border, #444);
  border-radius: 4px;
  background: transparent;
  color: var(--vscode-foreground, #e0e0e0);
  cursor: pointer;
}

.pager-btn:disabled {
  cursor: default;
  opacity: 0.45;
}

.pager-btn:not(:disabled):hover {
  background-color: var(--vscode-toolbar-hoverBackground, #333);
}

.pager-label {
  min-width: 42px;
  text-align: center;
  font-size: 11px;
  color: var(--vscode-descriptionForeground, #999);
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
