<template>
  <main class="patchouli-preview" :style="previewThemeStyle">
    <PatchouliReader
      ref="readerRef"
      :html="html"
      :show-controls="false"
      :show-navigate="false"
      :reader-settings="readerRuntimeSettings"
      :initial-pointer-engine="true"
      :initial-high-level-paged-engine="true"
      pointer-root-mode="children"
      @after-page-render="handleAfterPageRender"
      @page-change="handlePageChange"
    />
    <div
      v-if="settings.roleHoverMode === 'custom' && roleHoverTooltip.visible && roleHoverTooltip.hover"
      ref="roleHoverTooltipEl"
      class="role-hover-tooltip"
      :style="roleHoverTooltipStyle"
    >
      <div class="role-hover-title">
        <span class="role-hover-swatch" :style="{ backgroundColor: roleHoverTooltip.hover.color || 'currentColor' }" />
        <span>{{ roleHoverTooltip.hover.name }}</span>
      </div>
      <div class="role-hover-type">{{ roleHoverTooltip.hover.type }}</div>
      <div class="role-hover-fields">
        <div v-for="field in visibleRoleHoverFields" :key="`${field.label}:${field.value}`" class="role-hover-field">
          <span class="role-hover-label">{{ field.label }}</span>
          <span class="role-hover-value">{{ field.value }}</span>
        </div>
      </div>
    </div>
    <PreviewSettingsPanel
      v-model:settings="settings"
      :fonts="fonts"
      :vscode-font-family="vscodeFontFamily"
      :role-types="roleTypes"
      :current-page="pageState.currentPage"
      :total-pages="pageState.totalPages"
      :debug-info="debugInfo"
      :voices="voiceOptions"
      :selected-voice="selectedVoice"
      :tts-status="ttsStatus"
      :tts-supported="ttsSupported"
      @request-fonts="requestFonts"
      @request-role-colors="requestRoleColors"
      @request-role-highlights="requestRoleHighlights"
      @set-obsidian-options="setObsidianOptions"
      @prev-page="readerRef?.prevPage?.()"
      @next-page="readerRef?.nextPage?.()"
      @tts-command="handleTtsCommand"
      @voice-change="selectedVoice = $event"
    />
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { PatchouliReader, type PatchouliReaderDebugInfo } from '@anh/patchouli-reader';
import { useVsCodeApiStore } from 'stores/vscode';
import PreviewSettingsPanel from 'components/PreviewSettingsPanel.vue';
import { defaultReaderSettings, type ReaderSettings } from 'components/previewSettings';

type RoleStyle = {
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
};

type RoleHighlight = {
  srcLine: number;
  start: number;
  end: number;
  role?: (RoleStyle & { type?: string; style?: RoleStyle });
  hover?: RoleHover;
};

type RoleColor = {
  type?: string;
};

type RoleHover = {
  name: string;
  type: string;
  color?: string;
  fields: Array<{ label: string; value: string }>;
};

type PatchouliReaderExpose = {
  patchouliContent?: HTMLElement;
  debugInfo?: () => PatchouliReaderDebugInfo;
  reflow?: () => void;
  nextPage?: () => void;
  prevPage?: () => void;
  goToPage?: (pageIndex: number) => void;
  scrollToRatio?: (ratio: number) => void;
};

const vscodeStore = useVsCodeApiStore();
const html = ref('');
const readerRef = ref<PatchouliReaderExpose | null>(null);
const roleHighlights = ref<RoleHighlight[]>([]);
const roleColors = ref<RoleColor[]>([]);
const fonts = ref<string[]>([]);
const vscodeFontFamily = ref('');
const debugInfo = ref<PatchouliReaderDebugInfo | null>(null);
const pageState = ref({ currentPage: 0, totalPages: 1, progress: 0 });
const settings = ref(loadInitialSettings());
const voices = ref<SpeechSynthesisVoice[]>([]);
const selectedVoice = ref('');
const ttsStatus = ref('就绪');
const currentUtterance = ref<SpeechSynthesisUtterance | null>(null);
const utterText = ref('');
const persistedState = ref<Record<string, unknown>>({});
const roleHoverTooltip = ref<{ visible: boolean; x: number; y: number; hover: RoleHover | null }>({
  visible: false,
  x: 0,
  y: 0,
  hover: null,
});
const roleHoverTooltipEl = ref<HTMLElement | null>(null);
const roleHoverTooltipLayout = ref({
  left: 12,
  top: 12,
  maxWidth: 560,
  maxHeight: 260,
});
let roleHoverRoot: (ParentNode & EventTarget) | null = null;

const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
const wheelPageThreshold = 80;
let wheelAccumulator = 0;
const voiceOptions = computed(() => voices.value.map((voice, index) => ({
  index,
  name: voice.name,
  lang: voice.lang,
  default: voice.default,
})));
const roleTypes = computed(() => {
  const order = ['主角', '配角', '联动角色', '词汇', '敏感词', '正则表达式'];
  const set = new Set(roleColors.value.map((role) => role.type || '角色'));
  return [...set].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return a.localeCompare(b);
  });
});
const readerRuntimeSettings = computed(() => ({
  ...settings.value,
  vscodeFontFamily: vscodeFontFamily.value,
}));
const previewThemeStyle = computed(() => {
  if (settings.value.theme === 'light') return { background: '#fafafa', color: '#222' };
  if (settings.value.theme === 'dark') return { background: '#1e1f22', color: '#ddd' };
  if (settings.value.theme === 'custom') return { background: settings.value.customBackground, color: settings.value.customForeground };
  return {};
});
const roleHoverTooltipStyle = computed(() => {
  return {
    left: `${roleHoverTooltipLayout.value.left}px`,
    top: `${roleHoverTooltipLayout.value.top}px`,
    maxWidth: `${roleHoverTooltipLayout.value.maxWidth}px`,
    maxHeight: `${roleHoverTooltipLayout.value.maxHeight}px`,
    '--role-hover-max-height': `${roleHoverTooltipLayout.value.maxHeight}px`,
  };
});
const visibleRoleHoverFields = computed(() => {
  const fields = roleHoverTooltip.value.hover?.fields ?? [];
  const detail = settings.value.roleHoverDetail || 'standard';
  if (detail === 'full') return fields;
  const labels = detail === 'compact'
    ? new Set(['描述', '从属', '别名', '修复', '正则', '颜色'])
    : new Set(['描述', '从属', '别名', '修复', '包路径', '源文件', '正则', '正则标志', '匹配文本', '匹配来源', '部分命中', '颜色']);
  return fields.filter((field) => labels.has(field.label));
});

function calculateRoleHoverLayout(measured?: DOMRect) {
  const margin = 12;
  const gapX = 14;
  const gapY = 18;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const detail = settings.value.roleHoverDetail || 'standard';
  const preferredWidth = detail === 'full' ? 720 : 560;
  const maxWidth = Math.min(preferredWidth, Math.max(240, viewportWidth - margin * 2));
  const measuredWidth = Math.min(measured?.width || maxWidth, maxWidth);
  const belowTop = Math.min(roleHoverTooltip.value.y + gapY, viewportHeight - margin);
  const belowSpace = Math.max(120, viewportHeight - belowTop - margin);
  const aboveSpace = Math.max(120, roleHoverTooltip.value.y - gapY - margin);
  const aboveIsMuchLarger = aboveSpace >= belowSpace * 1.35 && aboveSpace - belowSpace >= 160;
  const belowIsComfortable = belowSpace >= 260;
  const preferBelow = !aboveIsMuchLarger && (belowIsComfortable || belowSpace >= aboveSpace);
  const maxHeight = Math.max(120, preferBelow ? belowSpace : aboveSpace);
  const measuredHeight = Math.min(measured?.height || maxHeight, maxHeight);
  const rightLeft = roleHoverTooltip.value.x + gapX;
  const leftLeft = roleHoverTooltip.value.x - gapX - measuredWidth;
  const left = rightLeft + measuredWidth <= viewportWidth - margin
    ? rightLeft
    : Math.max(margin, Math.min(leftLeft, viewportWidth - measuredWidth - margin));
  const top = preferBelow
    ? belowTop
    : Math.max(margin, roleHoverTooltip.value.y - gapY - measuredHeight);

  roleHoverTooltipLayout.value = {
    left,
    top,
    maxWidth,
    maxHeight,
  };
}

async function updateRoleHoverLayout() {
  if (!roleHoverTooltip.value.visible) return;
  calculateRoleHoverLayout();
  await nextTick();
  const rect = roleHoverTooltipEl.value?.getBoundingClientRect();
  if (rect) calculateRoleHoverLayout(rect);
}

function loadInitialSettings(): ReaderSettings {
  const defaults = defaultReaderSettings();
  try {
    const meta = JSON.parse(localStorage.getItem('anhPatchouliReaderSettings') || '{}');
    const presets = JSON.parse(localStorage.getItem('anhPatchouliReaderPresets') || '{}');
    const name = meta?.lastPreset || '__default__';
    const saved = presets?.[name];
    if (saved && typeof saved === 'object') return normalizeSettings({ ...defaults, ...saved });
  } catch {
    // ignore invalid persisted settings
  }
  return defaults;
}

function normalizeSettings(value: ReaderSettings): ReaderSettings {
  const defaults = defaultReaderSettings();
  const pad = Number.isFinite(value.pad) ? value.pad : defaults.pad;
  const hasLegacyDefaultMargins = value.pad === 12
    && value.marginTop === 12
    && value.marginRight === 12
    && value.marginBottom === 12
    && value.marginLeft === 12;
  return {
    ...defaults,
    ...value,
    pad: hasLegacyDefaultMargins ? defaults.pad : pad,
    marginTop: hasLegacyDefaultMargins ? defaults.marginTop : (Number.isFinite(value.marginTop) ? value.marginTop : pad),
    marginRight: hasLegacyDefaultMargins ? defaults.marginRight : (Number.isFinite(value.marginRight) ? value.marginRight : pad),
    marginBottom: hasLegacyDefaultMargins ? defaults.marginBottom : (Number.isFinite(value.marginBottom) ? value.marginBottom : pad),
    marginLeft: hasLegacyDefaultMargins ? defaults.marginLeft : (Number.isFinite(value.marginLeft) ? value.marginLeft : pad),
    lockVerticalMargins: value.lockVerticalMargins !== false,
    lockHorizontalMargins: value.lockHorizontalMargins !== false,
    roleHoverMode: value.roleHoverMode || defaults.roleHoverMode,
    roleHoverDetail: value.roleHoverDetail || defaults.roleHoverDetail,
  };
}

function getReaderContentRoot(): ParentNode | null {
  const host = readerRef.value?.patchouliContent as HTMLElement | undefined;
  return host?.shadowRoot ?? null;
}

function getRoleType(role?: RoleHighlight['role']): string {
  return role?.type || 'default';
}

function applyRoleStyle(el: HTMLElement, role?: RoleHighlight['role']) {
  if (!role) return;
  const style = role.style && typeof role.style === 'object' ? role.style : role;
  if (style.color) el.style.color = style.color;
  if (style.backgroundColor) el.style.backgroundColor = style.backgroundColor;
  if (style.bold) el.style.fontWeight = '700';
  if (style.italic) el.style.fontStyle = 'italic';
  const decorations: string[] = [];
  if (style.underline) decorations.push('underline');
  if (style.strikethrough) decorations.push('line-through');
  if (decorations.length) el.style.textDecoration = decorations.join(' ');
}

function unwrapRoleColorSpans(root: ParentNode) {
  root.querySelectorAll('.anh-role-color').forEach((node) => {
    const span = node as HTMLElement;
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize();
  });
}

function closestRoleSpanFromEvent(event: Event): HTMLElement | null {
  for (const item of event.composedPath?.() ?? []) {
    if (item instanceof HTMLElement) {
      const span = item.closest('.anh-role-color');
      if (span instanceof HTMLElement) return span;
    }
  }
  return null;
}

function parseRoleHover(span: HTMLElement): RoleHover | null {
  try {
    const raw = span.dataset.roleHover;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RoleHover;
    if (!parsed || typeof parsed.name !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function handleRoleHoverMove(event: Event) {
  if (settings.value.roleHoverMode !== 'custom') {
    roleHoverTooltip.value.visible = false;
    return;
  }
  const mouse = event as MouseEvent;
  const span = closestRoleSpanFromEvent(event);
  const hover = span ? parseRoleHover(span) : null;
  if (!hover) {
    roleHoverTooltip.value.visible = false;
    return;
  }
  roleHoverTooltip.value = {
    visible: true,
    x: mouse.clientX,
    y: mouse.clientY,
    hover,
  };
  void updateRoleHoverLayout();
}

function handleRoleHoverLeave(event: Event) {
  if (!closestRoleSpanFromEvent(event)) {
    roleHoverTooltip.value.visible = false;
  }
}

function bindRoleHoverHandlers(root: ParentNode & EventTarget) {
  if (roleHoverRoot === root) return;
  if (roleHoverRoot) {
    roleHoverRoot.removeEventListener('mousemove', handleRoleHoverMove);
    roleHoverRoot.removeEventListener('mouseover', handleRoleHoverMove);
    roleHoverRoot.removeEventListener('mouseout', handleRoleHoverLeave);
    roleHoverRoot.removeEventListener('mouseleave', handleRoleHoverLeave);
  }
  roleHoverRoot = root;
  roleHoverRoot.addEventListener('mousemove', handleRoleHoverMove);
  roleHoverRoot.addEventListener('mouseover', handleRoleHoverMove);
  roleHoverRoot.addEventListener('mouseout', handleRoleHoverLeave);
  roleHoverRoot.addEventListener('mouseleave', handleRoleHoverLeave);
}

function unbindRoleHoverHandlers() {
  if (!roleHoverRoot) return;
  roleHoverRoot.removeEventListener('mousemove', handleRoleHoverMove);
  roleHoverRoot.removeEventListener('mouseover', handleRoleHoverMove);
  roleHoverRoot.removeEventListener('mouseout', handleRoleHoverLeave);
  roleHoverRoot.removeEventListener('mouseleave', handleRoleHoverLeave);
  roleHoverRoot = null;
}

function textNodesWithOffsets(root: Element) {
  const out: Array<{ node: Text; start: number; end: number }> = [];
  let offset = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    if (textNode.parentElement?.closest('.md-list-marker,.anh-role-color')) {
      node = walker.nextNode();
      continue;
    }
    const len = textNode.nodeValue?.length ?? 0;
    out.push({ node: textNode, start: offset, end: offset + len });
    offset += len;
    node = walker.nextNode();
  }
  return out;
}

function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function readBlockOffset(block: Element): number {
  const direct = parseInt((block as HTMLElement).dataset.mdOffset || '0', 10) || 0;
  if (direct > 0) return direct;
  const descendant = block.querySelector<HTMLElement>('[data-md-offset]');
  return parseInt(descendant?.dataset.mdOffset || '0', 10) || 0;
}

function wrapTextNodeSlice(textNode: Text, start: number, end: number, highlight: RoleHighlight) {
  if (end <= start) return;
  const text = textNode.nodeValue || '';
  if (start < 0 || end > text.length) return;
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  const span = document.createElement('span');
  span.className = 'anh-role-color';
  span.dataset.roleType = getRoleType(highlight.role);
  if (highlight.hover) {
    span.dataset.roleHover = JSON.stringify(highlight.hover);
    if (settings.value.roleHoverMode === 'native') {
      span.title = `${highlight.hover.name}\n${highlight.hover.fields.map((field) => `${field.label}: ${field.value}`).join('\n')}`;
    }
  }
  applyRoleStyle(span, highlight.role);
  try {
    range.surroundContents(span);
  } catch {
    span.textContent = text.slice(start, end);
    range.deleteContents();
    range.insertNode(span);
  }
}

function applyRoleHighlights() {
  const root = getReaderContentRoot();
  if (!root) return;
  bindRoleHoverHandlers(root as ParentNode & EventTarget);
  unwrapRoleColorSpans(root);
  if (!settings.value.colorizeRoles) return;
  const grouped = new Map<number, RoleHighlight[]>();
  for (const highlight of roleHighlights.value) {
    if (!Number.isFinite(highlight.start) || !Number.isFinite(highlight.end) || highlight.end <= highlight.start) continue;
    const arr = grouped.get(highlight.srcLine) ?? [];
    arr.push(highlight);
    grouped.set(highlight.srcLine, arr);
  }
  for (const [srcLine, highlights] of grouped) {
    const blocks = [...root.querySelectorAll(`[data-line="${escapeAttrValue(String(srcLine))}"]`)];
    for (const block of blocks) {
      const baseOffset = readBlockOffset(block);
      const nodes = textNodesWithOffsets(block);
      const lastNode = nodes.at(-1);
      const textLength = lastNode ? lastNode.end : 0;
      const blockEnd = baseOffset + textLength;
      const sorted = [...highlights]
        .filter((highlight) => highlight.start < blockEnd && highlight.end > baseOffset)
        .sort((a, b) => b.start - a.start || b.end - a.end);
      for (const highlight of sorted) {
        for (const entry of [...nodes].reverse()) {
          const start = Math.max(highlight.start - baseOffset, entry.start);
          const end = Math.min(highlight.end - baseOffset, entry.end);
          if (end <= start) continue;
          wrapTextNodeSlice(entry.node, start - entry.start, end - entry.start, highlight);
        }
      }
    }
  }
}

function handleAfterPageRender(info: PatchouliReaderDebugInfo) {
  debugInfo.value = info;
  void nextTick(() => {
    if (settings.value.colorizeRoles) requestRoleHighlights();
    applyRoleHighlights();
    vscodeStore.vscode?.postMessage({ type: 'patchouliPreviewDebug', debugInfo: info });
  });
}

function handlePageChange(payload: { currentPage: number; totalPages: number; progress: number }) {
  pageState.value = payload;
  persistWebviewState({ scrollRatio: payload.progress / 100, currentPage: payload.currentPage });
  vscodeStore.vscode?.postMessage({ type: 'patchouliPageChange', ...payload });
  if (settings.value.sync !== 'off') {
    const total = Math.max(1, payload.totalPages);
    vscodeStore.vscode?.postMessage({
      type: 'previewScroll',
      mode: settings.value.mode === 'paged' ? 'paged' : 'scroll',
      ratio: total > 1 ? +(payload.currentPage / (total - 1)).toFixed(4) : 0,
    });
  }
}

function handleMessage(event: MessageEvent) {
  const msg = event.data;
  if (msg?.type === 'init') {
    persistWebviewState({ docUri: msg.docUri, isPatchouli: true });
    return;
  }
  if (msg?.type === 'docRender' && typeof msg.html === 'string') {
    html.value = msg.html;
    return;
  }
  if (msg?.type === 'roleHighlights' && Array.isArray(msg.highlights)) {
    roleHighlights.value = msg.highlights;
    void nextTick(applyRoleHighlights);
    return;
  }
  if (msg?.type === 'roleColors') {
    roleColors.value = Array.isArray(msg.roles) ? msg.roles : [];
    if (settings.value.colorizeRoles) requestRoleHighlights();
    return;
  }
  if (msg?.type === 'fontFamilies') {
    fonts.value = Array.isArray(msg.list) ? msg.list : [];
    return;
  }
  if (msg?.type === 'vscodeFontFamily') {
    vscodeFontFamily.value = String(msg.value || '');
    return;
  }
  if (msg?.type === 'obsidianRenderOptions') {
    settings.value = {
      ...settings.value,
      obsidianRenderWikilinks: msg.renderWikilinks !== false,
      obsidianRenderTags: msg.renderTags !== false,
      obsidianRenderEscapedTags: !!msg.renderEscapedTags,
      separatorRenderMode: msg.separatorRenderMode || 'preserve',
    };
    settings.value = normalizeSettings(settings.value);
    return;
  }
  if (msg?.type === 'editorScroll' && settings.value.sync !== 'off') {
    const ratio = typeof msg.ratio === 'number' ? Math.max(0, Math.min(1, msg.ratio)) : 0;
    if (settings.value.mode === 'scroll') {
      readerRef.value?.scrollToRatio?.(ratio);
    } else {
      const total = Math.max(1, pageState.value.totalPages);
      readerRef.value?.goToPage?.(Math.round(ratio * Math.max(0, total - 1)));
    }
    return;
  }
  if (msg?.type === 'ttsControl') {
    handleTtsCommand(msg.command);
  }
}

function persistWebviewState(partial: Record<string, unknown>) {
  persistedState.value = { ...persistedState.value, ...partial };
  (vscodeStore.vscode as unknown as { setState?: (state: unknown) => void } | undefined)?.setState?.(persistedState.value);
}

function requestFonts(force = false) {
  vscodeStore.vscode?.postMessage({ type: 'requestFonts', force });
}

function requestRoleColors() {
  vscodeStore.vscode?.postMessage({ type: 'requestRoleColors', reason: 'patchouli-settings' });
}

function enabledRoleTypes(): string[] {
  return settings.value.colorizeRoleTypes ?? roleTypes.value;
}

function requestRoleHighlights(types = enabledRoleTypes()) {
  vscodeStore.vscode?.postMessage({ type: 'requestRoleHighlights', reason: 'patchouli-settings', enabledTypes: types });
}

function setObsidianOptions(value: Partial<ReaderSettings>) {
  vscodeStore.vscode?.postMessage({
    type: 'setObsidianRenderOptions',
    renderWikilinks: value.obsidianRenderWikilinks,
    renderTags: value.obsidianRenderTags,
    renderEscapedTags: value.obsidianRenderEscapedTags,
    separatorRenderMode: value.separatorRenderMode,
  });
}

function refreshVoices() {
  if (!ttsSupported) {
    ttsStatus.value = '不支持TTS';
    return;
  }
  const list = window.speechSynthesis.getVoices();
  const zh = list.filter((voice) => voice.lang.includes('zh') || voice.name.includes('中文') || voice.name.includes('Chinese'));
  const other = list.filter((voice) => !zh.includes(voice));
  voices.value = [...zh, ...other];
  if (!selectedVoice.value && zh.length > 0) {
    const firstZhVoice = zh[0];
    selectedVoice.value = firstZhVoice ? String(voices.value.indexOf(firstZhVoice)) : '';
  }
}

function getTtsRoot(): ParentNode | null {
  return getReaderContentRoot();
}

function getTtsText(): string {
  const selection = window.getSelection()?.toString().trim() || '';
  if (selection) return selection;
  const root = getTtsRoot();
  if (!root) return '';
  return [...root.querySelectorAll('pre')].map((pre) => pre.textContent || '').join('\n\n').trim();
}

function clearTtsHighlight() {
  const root = getTtsRoot();
  if (!root) return;
  root.querySelectorAll('.tts-reading-highlight').forEach((node) => {
    const span = node as HTMLElement;
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize();
  });
}

function buildFullDocumentNodes() {
  const root = getTtsRoot();
  const out: Array<{ node: Text; start: number; end: number; virtual?: false } | { node: Element; start: number; end: number; virtual: true }> = [];
  if (!root) return out;
  let offset = 0;
  const pres = [...root.querySelectorAll('pre')];
  pres.forEach((pre, index) => {
    const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const textNode = node as Text;
      const text = textNode.nodeValue || '';
      out.push({ node: textNode, start: offset, end: offset + text.length, virtual: false });
      offset += text.length;
      node = walker.nextNode();
    }
    if (index < pres.length - 1) {
      out.push({ node: pre, start: offset, end: offset + 2, virtual: true });
      offset += 2;
    }
  });
  return out;
}

function findBoundarySegment(text: string, index: number) {
  const safeIndex = Math.max(0, Math.min(index, Math.max(0, text.length - 1)));
  const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(navigator.language || 'und', { granularity: 'word' })
    : null;
  if (segmenter) {
    for (const segment of segmenter.segment(text)) {
      const start = segment.index;
      const end = start + segment.segment.length;
      if (safeIndex >= start && safeIndex < end) return { start, end };
    }
  }
  return { start: safeIndex, end: Math.min(text.length, safeIndex + 1) };
}

function locateAndHighlight(startIndex: number, length: number) {
  const nodes = buildFullDocumentNodes();
  if (!nodes.length) return;
  clearTtsHighlight();
  const target = nodes.find((entry) => !entry.virtual && startIndex >= entry.start && startIndex < entry.end);
  if (!target || target.virtual) return;
  const textNode = target.node;
  const localStart = Math.max(0, Math.min((textNode.nodeValue || '').length - 1, startIndex - target.start));
  const localEnd = Math.max(localStart + 1, Math.min((textNode.nodeValue || '').length, localStart + length));
  try {
    const range = document.createRange();
    range.setStart(textNode, localStart);
    range.setEnd(textNode, localEnd);
    const span = document.createElement('span');
    span.className = 'tts-reading-highlight';
    range.surroundContents(span);
    span.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } catch {
    // 高亮失败不影响朗读。
  }
}

function handleTtsCommand(command: 'play' | 'pause' | 'stop') {
  if (!ttsSupported) {
    ttsStatus.value = '不支持TTS';
    return;
  }
  if (command === 'pause') {
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
      ttsStatus.value = '已暂停';
    }
    return;
  }
  if (command === 'stop') {
    window.speechSynthesis.cancel();
    currentUtterance.value = null;
    clearTtsHighlight();
    ttsStatus.value = '已停止';
    return;
  }
  if (window.speechSynthesis.paused && currentUtterance.value) {
    window.speechSynthesis.resume();
    ttsStatus.value = '继续播放';
    return;
  }
  const text = getTtsText();
  if (!text) {
    ttsStatus.value = '无文本';
    return;
  }
  window.speechSynthesis.cancel();
  clearTtsHighlight();
  utterText.value = text;
  const utterance = new SpeechSynthesisUtterance(text);
  const voiceIndex = parseInt(selectedVoice.value, 10);
  if (!Number.isNaN(voiceIndex) && voices.value[voiceIndex]) utterance.voice = voices.value[voiceIndex];
  utterance.onstart = () => { ttsStatus.value = '播放中'; };
  utterance.onpause = () => { ttsStatus.value = '已暂停'; };
  utterance.onresume = () => { ttsStatus.value = '继续播放'; };
  utterance.onend = () => {
    ttsStatus.value = '播放完成';
    currentUtterance.value = null;
    clearTtsHighlight();
  };
  utterance.onerror = (event) => {
    ttsStatus.value = `错误: ${event.error || 'unknown'}`;
    currentUtterance.value = null;
    clearTtsHighlight();
  };
  utterance.onboundary = (event) => {
    const segment = findBoundarySegment(utterText.value, typeof event.charIndex === 'number' ? event.charIndex : 0);
    locateAndHighlight(segment.start, Math.max(1, segment.end - segment.start));
  };
  currentUtterance.value = utterance;
  window.speechSynthesis.speak(utterance);
}

function handleKeydown(event: KeyboardEvent) {
  if (settings.value.mode !== 'paged') return;
  if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
    event.preventDefault();
    readerRef.value?.nextPage?.();
  } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
    event.preventDefault();
    readerRef.value?.prevPage?.();
  }
}

function describeWheelTarget(event: WheelEvent) {
  const path = event.composedPath?.() ?? [];
  const node = path.find(item => item instanceof Element) as Element | undefined;
  if (!node) return String((event.target as Node | null)?.nodeName ?? 'unknown');
  const className = typeof node.className === 'string' && node.className ? `.${node.className.trim().replace(/\s+/g, '.')}` : '';
  return `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${className}`;
}

function wheelPathHasInteractiveTarget(event: WheelEvent) {
  const interactiveSelector = [
    '.patchouli-topbar',
    '.pagebar',
    '.settings-fab',
    '.settings-card',
    '.q-dialog',
    '.q-menu',
    '.q-popup-proxy',
    '.q-field',
    '.q-slider',
    'button',
    'input',
    'select',
    'textarea',
    '[role="button"]',
  ].join(',');
  return (event.composedPath?.() ?? []).some(item => item instanceof Element && item.closest(interactiveSelector));
}

function normalizedWheelDelta(event: WheelEvent) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 36;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * Math.max(1, window.innerHeight);
  return event.deltaY;
}

function postWheelDebug(phase: string, event: WheelEvent, extra: Record<string, unknown> = {}) {
  vscodeStore.vscode?.postMessage({
    type: 'patchouliWheelDebug',
    phase,
    mode: settings.value.mode,
    deltaY: event.deltaY,
    deltaMode: event.deltaMode,
    target: describeWheelTarget(event),
    currentPage: pageState.value.currentPage,
    totalPages: pageState.value.totalPages,
    accumulator: wheelAccumulator,
    ...extra,
  });
}

function handleWheelPageTurn(event: WheelEvent) {
  if (settings.value.mode !== 'paged') {
    wheelAccumulator = 0;
    return;
  }
  if (wheelPathHasInteractiveTarget(event)) {
    wheelAccumulator = 0;
    postWheelDebug('ignored-interactive', event);
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const delta = normalizedWheelDelta(event);
  wheelAccumulator += delta;
  if (wheelAccumulator >= wheelPageThreshold) {
    wheelAccumulator = 0;
    postWheelDebug('next-page', event, { normalizedDelta: delta });
    readerRef.value?.nextPage?.();
    return;
  }
  if (wheelAccumulator <= -wheelPageThreshold) {
    wheelAccumulator = 0;
    postWheelDebug('prev-page', event, { normalizedDelta: delta });
    readerRef.value?.prevPage?.();
    return;
  }
  postWheelDebug('accumulate', event, { normalizedDelta: delta });
}

function handleWindowResize() {
  void updateRoleHoverLayout();
}

watch(settings, () => {
  void nextTick(() => {
    readerRef.value?.reflow?.();
    if (settings.value.colorizeRoles) requestRoleHighlights();
    else {
      roleHoverTooltip.value.visible = false;
      applyRoleHighlights();
    }
    void updateRoleHoverLayout();
  });
}, { deep: true });

onMounted(() => {
  persistedState.value = ((vscodeStore.vscode as unknown as { getState?: () => Record<string, unknown> | undefined } | undefined)?.getState?.() ?? {});
  window.addEventListener('message', handleMessage);
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('wheel', handleWheelPageTurn, { passive: false, capture: true });
  window.addEventListener('resize', handleWindowResize);
  if (ttsSupported) {
    window.speechSynthesis.onvoiceschanged = refreshVoices;
    refreshVoices();
  }
  void vscodeStore.vscode?.postMessage({ type: 'patchouliPreviewReady' });
  requestFonts(false);
  requestRoleColors();
  vscodeStore.vscode?.postMessage({ type: 'requestObsidianRenderOptions' });
  vscodeStore.vscode?.postMessage({ type: 'requestVscodeFontFamily' });
});

onBeforeUnmount(() => {
  window.removeEventListener('message', handleMessage);
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('wheel', handleWheelPageTurn, true);
  window.removeEventListener('resize', handleWindowResize);
  if (ttsSupported) {
    window.speechSynthesis.cancel();
    window.speechSynthesis.onvoiceschanged = null;
  }
  unbindRoleHoverHandlers();
});
</script>

<style scoped>
.patchouli-preview {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--vscode-editor-background, #111);
  color: var(--vscode-editor-foreground, #ddd);
  --color-text: currentColor;
  --color-link: var(--vscode-textLink-foreground, #4ea1ff);
}

.role-hover-tooltip {
  position: fixed;
  z-index: 2200;
  pointer-events: none;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 10px 12px;
  border: 1px solid var(--vscode-editorWidget-border, rgba(127, 127, 127, .35));
  border-radius: 6px;
  background: var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background, #252526));
  color: var(--vscode-editorHoverWidget-foreground, var(--vscode-editor-foreground, #ddd));
  box-shadow: 0 8px 24px rgba(0, 0, 0, .32);
  font-size: 13px;
  line-height: 1.45;
}

.role-hover-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
}

.role-hover-swatch {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  flex: 0 0 auto;
}

.role-hover-type {
  margin-top: 2px;
  opacity: .72;
  font-size: 12px;
}

.role-hover-fields {
  display: grid;
  gap: 4px;
  margin-top: 8px;
  min-height: 0;
  max-height: calc(var(--role-hover-max-height, 320px) - 56px);
  overflow: auto;
}

.role-hover-field {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 8px;
}

.role-hover-label {
  opacity: .68;
}

.role-hover-value {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
