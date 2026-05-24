<template>
  <div ref="container" class="markdown-renderer" :class="{ inline }" />
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import Vditor from 'vditor';
import 'vditor/dist/index.css';

const props = withDefaults(defineProps<{
  content: string;
  inline?: boolean;
}>(), {
  content: '',
  inline: false,
});

const container = ref<HTMLDivElement>();
let renderToken = 0;
let luteInjected = false;
let luteLoadPromise: Promise<void> | undefined;

function stripWrapper(html: string): string {
  const trimmed = html.trim();
  const match = trimmed.match(/^<p>([\s\S]*)<\/p>$/);
  return match ? (match[1] ?? '') : trimmed;
}

async function renderMarkdown() {
  const el = container.value;
  if (!el) return;

  const token = ++renderToken;
  const source = props.inline ? props.content.replace(/\r?\n+/g, ' ') : props.content;
  el.innerHTML = '';

  await nextTick();
  if (token !== renderToken || !container.value) return;

  try {
    await ensureLute();
    const html = await Vditor.md2html(source || '', {
      cdn: '',
      mode: 'light',
      markdown: {
        autoSpace: false,
        fixTermTypo: false,
        paragraphBeginningSpace: true,
        sanitize: true,
      },
      anchor: 0,
      hljs: {
        enable: false,
      },
    });
    if (token !== renderToken || !container.value) return;
    el.innerHTML = props.inline ? stripWrapper(html) : html;
    el.classList.add('vditor-reset');
  } catch (error) {
    console.warn('Markdown render failed:', error);
    el.textContent = source;
  }
}

function ensureLute(): Promise<void> {
  if (luteInjected || document.getElementById('vditorLuteScript')) {
    luteInjected = true;
    return Promise.resolve();
  }
  if (!luteLoadPromise) {
    luteLoadPromise = import('vditor/dist/js/lute/lute.min.js?raw').then((mod) => {
      if (document.getElementById('vditorLuteScript')) {
        luteInjected = true;
        return;
      }
      const script = document.createElement('script');
      script.id = 'vditorLuteScript';
      script.type = 'text/javascript';
      script.text = mod.default;
      document.head.appendChild(script);
      luteInjected = true;
    });
  }
  return luteLoadPromise;
}

watch(() => [props.content, props.inline] as const, () => {
  void renderMarkdown();
});

onMounted(() => {
  void renderMarkdown();
});
</script>

<style scoped>
.markdown-renderer {
  line-height: 1.7;
  word-break: break-word;
  color: inherit;
}

.markdown-renderer.inline {
  display: inline;
  line-height: inherit;
}

.markdown-renderer :deep(.vditor-reset) {
  background: transparent;
  color: inherit;
  font-size: inherit;
  line-height: inherit;
  padding: 0;
}

.markdown-renderer :deep(.vditor-reset p) {
  margin: 0.5em 0;
}

.markdown-renderer :deep(.vditor-reset a) {
  color: var(--vscode-textLink-foreground, #3794ff);
}

.markdown-renderer :deep(.vditor-reset img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  margin: 0.5em 0;
}

.markdown-renderer.inline :deep(.vditor-reset),
.markdown-renderer.inline :deep(.vditor-reset p) {
  display: inline;
  margin: 0;
}

.markdown-renderer.inline :deep(.vditor-reset img),
.markdown-renderer.inline :deep(img) {
  max-height: 1.2em;
  max-width: 12em;
  vertical-align: text-bottom;
  margin: 0 0.15em;
}
</style>
