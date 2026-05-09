<template>
  <div v-if="content" class="markdown-description" v-html="rendered"></div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  content: string | undefined
  tone?: 'normal' | 'accent' | 'error'
}>()

const rendered = computed(() => renderMarkdown(props.content ?? ''))

function renderMarkdown(source: string) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let paragraph: string[] = []
  let listItems: string[] = []
  let codeLines: string[] = []
  let inCode = false
  let codeLang = ''

  const flushParagraph = () => {
    if (!paragraph.length) return
    html.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`)
    paragraph = []
  }

  const flushList = () => {
    if (!listItems.length) return
    html.push(`<ul>${listItems.map(item => `<li>${renderInline(item)}</li>`).join('')}</ul>`)
    listItems = []
  }

  const flushCode = () => {
    html.push(`<pre><code${codeLang ? ` data-lang="${escapeAttr(codeLang)}"` : ''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
    codeLines = []
    codeLang = ''
  }

  for (const line of lines) {
    const codeFence = line.match(/^```(\w+)?\s*$/)
    if (codeFence) {
      if (inCode) {
        flushCode()
        inCode = false
      } else {
        flushParagraph()
        flushList()
        inCode = true
        codeLang = codeFence[1] ?? ''
      }
      continue
    }

    if (inCode) {
      codeLines.push(line)
      continue
    }

    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      const level = Math.min(4, heading[1]!.length + 2)
      html.push(`<h${level}>${renderInline(heading[2]!)}</h${level}>`)
      continue
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)$/)
    if (bullet) {
      flushParagraph()
      listItems.push(bullet[1]!)
      continue
    }

    flushList()
    paragraph.push(line)
  }

  if (inCode) flushCode()
  flushParagraph()
  flushList()

  return html.join('')
}

function renderInline(source: string) {
  return escapeHtml(source)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

function escapeHtml(source: string) {
  return source
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(source: string) {
  return escapeHtml(source).replace(/`/g, '&#96;')
}
</script>

<style scoped>
.markdown-description {
  font-size: var(--vscode-font-size, 0.75rem);
  line-height: 1.55;
  color: var(--vscode-descriptionForeground, #999);
  overflow-wrap: anywhere;
}

.markdown-description :deep(p) {
  margin: 0 0 6px;
}

.markdown-description :deep(p:last-child),
.markdown-description :deep(ul:last-child),
.markdown-description :deep(pre:last-child) {
  margin-bottom: 0;
}

.markdown-description :deep(strong) {
  color: var(--vscode-foreground, #e0e0e0);
  font-weight: 600;
}

.markdown-description :deep(em) {
  color: var(--vscode-foreground, #e0e0e0);
}

.markdown-description :deep(code) {
  padding: 1px 4px;
  border-radius: 4px;
  background-color: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.16));
  color: var(--vscode-textPreformat-foreground, var(--vscode-foreground, #e0e0e0));
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 0.95em;
}

.markdown-description :deep(pre) {
  margin: 6px 0;
  max-height: 180px;
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: 6px;
  background-color: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.12));
}

.markdown-description :deep(pre code) {
  display: block;
  padding: 0;
  background: transparent;
  white-space: pre;
}

.markdown-description :deep(ul) {
  margin: 4px 0 8px;
  padding-left: 18px;
}

.markdown-description :deep(li) {
  margin: 2px 0;
}

.markdown-description :deep(h3),
.markdown-description :deep(h4),
.markdown-description :deep(h5),
.markdown-description :deep(h6) {
  margin: 8px 0 4px;
  font-size: var(--vscode-font-size, 0.8rem);
  color: var(--vscode-foreground, #e0e0e0);
}
</style>
