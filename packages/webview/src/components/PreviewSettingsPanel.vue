<template>
  <div class="patchouli-topbar">
    <q-select
      dense
      outlined
      emit-value
      map-options
      class="voice-select"
      :model-value="selectedVoice"
      :options="voiceSelectOptions"
      :disable="!ttsSupported"
      @update:model-value="$emit('voice-change', String($event ?? ''))"
    />
    <q-btn dense round flat icon="play_arrow" :disable="!ttsSupported" title="播放" @click="$emit('tts-command', 'play')" />
    <q-btn dense round flat icon="pause" :disable="!ttsSupported" title="暂停" @click="$emit('tts-command', 'pause')" />
    <q-btn dense round flat icon="stop" :disable="!ttsSupported" title="停止" @click="$emit('tts-command', 'stop')" />
    <span class="tts-status">{{ ttsStatus }}</span>
  </div>

  <div v-if="settings.mode === 'paged'" class="pagebar">
    <q-btn dense round unelevated icon="chevron_left" :disable="currentPage <= 0" @click="$emit('prev-page')" />
    <span class="pagebar-text">{{ currentPage + 1 }} / {{ Math.max(1, totalPages) }}</span>
    <q-linear-progress rounded size="5px" :value="pageProgressRatio" class="pagebar-progress" />
    <q-btn dense round unelevated icon="chevron_right" :disable="currentPage >= totalPages - 1" @click="$emit('next-page')" />
  </div>

  <q-btn class="settings-fab" round unelevated color="primary" icon="settings" title="阅读器设置" @click="open = true" />

  <q-dialog v-model="open" position="right">
    <q-card class="settings-card">
      <q-card-section class="settings-header">
        <div class="text-subtitle1">Patchouli 预览设置</div>
        <q-btn dense round flat icon="close" @click="open = false" />
      </q-card-section>
      <q-separator />
      <q-scroll-area class="settings-scroll">
        <q-card-section class="settings-body">
          <q-expansion-item default-opened dense label="外观" icon="tune">
            <SettingSlider label="字体大小" :model-value="settings.font" :min="12" :max="30" :step="1" @update:model-value="patch({ font: $event })" />
            <div class="setting-row">
              <div class="setting-label">字体</div>
              <q-btn-toggle
                dense
                unelevated
                toggle-color="primary"
                :model-value="settings.fontFamilyMode"
                :options="fontModeOptions"
                @update:model-value="patch({ fontFamilyMode: $event })"
              />
            </div>
            <div class="setting-row wide">
              <q-select
                dense
                outlined
                emit-value
                map-options
                class="setting-fill"
                :disable="settings.fontFamilyMode !== 'custom'"
                :model-value="settings.fontFamily"
                :options="fontOptions"
                @update:model-value="patch({ fontFamily: String($event ?? '') })"
              />
              <q-btn dense flat icon="refresh" title="刷新字体" @click="$emit('request-fonts', true)" />
            </div>
            <SettingSlider label="行间距" :model-value="settings.line" :min="1.2" :max="2.2" :step="0.05" :digits="2" @update:model-value="patch({ line: $event })" />
            <SettingSlider label="段落间距" :model-value="settings.para" :min="0" :max="32" :step="1" @update:model-value="patch({ para: $event })" />
          </q-expansion-item>

          <q-expansion-item default-opened dense label="页面" icon="crop_free">
            <div class="setting-row">
              <div class="setting-label">显示方式</div>
              <q-btn-toggle dense unelevated toggle-color="primary" :model-value="settings.mode" :options="displayModes" @update:model-value="patch({ mode: $event })" />
            </div>
            <div class="setting-row">
              <div class="setting-label">高度模式</div>
              <q-btn-toggle dense unelevated toggle-color="primary" :model-value="settings.heightMode" :options="heightModes" @update:model-value="patch({ heightMode: $event })" />
            </div>
            <q-input dense outlined type="number" label="高度" :model-value="heightText" @update:model-value="patchNumber('height', $event)" />
            <div class="setting-row">
              <div class="setting-label">宽度模式</div>
              <q-btn-toggle dense unelevated toggle-color="primary" :model-value="settings.widthMode" :options="widthModes" @update:model-value="patch({ widthMode: $event })" />
            </div>
            <q-input dense outlined type="number" label="宽度" :model-value="widthText" @update:model-value="patchNumber('width', $event)" />

            <div class="lock-row">
              <q-toggle dense :model-value="settings.lockVerticalMargins" label="锁定上下边距" @update:model-value="patch({ lockVerticalMargins: !!$event })" />
              <q-toggle dense :model-value="settings.lockHorizontalMargins" label="锁定左右边距" @update:model-value="patch({ lockHorizontalMargins: !!$event })" />
            </div>
            <SettingSlider label="上边距" :model-value="settings.marginTop" :min="0" :max="96" :step="1" @update:model-value="patchMargin('top', $event)" />
            <SettingSlider label="下边距" :model-value="settings.marginBottom" :min="0" :max="96" :step="1" @update:model-value="patchMargin('bottom', $event)" />
            <SettingSlider label="左边距" :model-value="settings.marginLeft" :min="0" :max="96" :step="1" @update:model-value="patchMargin('left', $event)" />
            <SettingSlider label="右边距" :model-value="settings.marginRight" :min="0" :max="96" :step="1" @update:model-value="patchMargin('right', $event)" />
          </q-expansion-item>

          <q-expansion-item dense label="Markdown" icon="article">
            <div class="chip-grid">
              <q-toggle v-for="item in markdownToggles" :key="item.key" dense :label="item.label" :model-value="!!settings[item.key]" @update:model-value="toggle(item.key)" />
            </div>
            <div class="setting-row">
              <div class="setting-label">标题样式</div>
              <q-btn-toggle dense unelevated toggle-color="primary" :model-value="settings.markdownHeadingStyle" :options="headingStyles" @update:model-value="patch({ markdownHeadingStyle: $event, markdownHeadings: true })" />
            </div>
            <div class="setting-row">
              <div class="setting-label">列表样式</div>
              <q-btn-toggle dense unelevated toggle-color="primary" :model-value="settings.markdownListStyle" :options="listStyles" @update:model-value="patch({ markdownListStyle: $event, markdownLists: true })" />
            </div>
          </q-expansion-item>

          <q-expansion-item dense label="渲染" icon="visibility">
            <div class="chip-grid">
              <q-toggle dense label="双链" :model-value="settings.obsidianRenderWikilinks" @update:model-value="patchObsidian({ obsidianRenderWikilinks: !!$event })" />
              <q-toggle dense label="标签" :model-value="settings.obsidianRenderTags" @update:model-value="patchObsidian({ obsidianRenderTags: !!$event })" />
              <q-toggle dense label="转义标签" :model-value="settings.obsidianRenderEscapedTags" @update:model-value="patchObsidian({ obsidianRenderEscapedTags: !!$event })" />
            </div>
            <div class="setting-row">
              <div class="setting-label">分割线</div>
              <q-btn-toggle dense unelevated toggle-color="primary" :model-value="settings.separatorRenderMode" :options="separatorModes" @update:model-value="patchObsidian({ separatorRenderMode: $event })" />
            </div>
            <div class="setting-row">
              <div class="setting-label">列数</div>
              <q-btn-toggle dense unelevated toggle-color="primary" :model-value="String(settings.cols)" :options="columnModes" @update:model-value="patch({ cols: Number($event) || 1 })" />
            </div>
            <div class="setting-row">
              <div class="setting-label">同步滚动</div>
              <q-btn-toggle dense unelevated toggle-color="primary" :model-value="settings.sync" :options="syncModes" @update:model-value="patch({ sync: $event })" />
            </div>
          </q-expansion-item>

          <q-expansion-item dense label="角色" icon="palette">
            <q-toggle dense label="角色着色" :model-value="settings.colorizeRoles" @update:model-value="patchRoleColor(!!$event)" />
            <div class="setting-row">
              <div class="setting-label">Hover</div>
              <q-btn-toggle dense unelevated toggle-color="primary" :model-value="settings.roleHoverMode" :options="roleHoverModes" @update:model-value="patch({ roleHoverMode: $event })" />
            </div>
            <div class="setting-row">
              <div class="setting-label">内容量</div>
              <q-btn-toggle dense unelevated toggle-color="primary" :disable="settings.roleHoverMode === 'off'" :model-value="settings.roleHoverDetail" :options="roleHoverDetails" @update:model-value="patch({ roleHoverDetail: $event })" />
            </div>
            <div class="role-types">
              <q-chip
                v-for="type in roleTypes"
                :key="type"
                clickable
                square
                :color="enabledRoleTypeSet.has(type) ? 'primary' : 'grey-8'"
                text-color="white"
                @click="toggleRoleType(type)"
              >
                {{ type }}
              </q-chip>
              <span v-if="!roleTypes.length" class="empty-text">暂无角色类型</span>
            </div>
          </q-expansion-item>

          <q-expansion-item dense label="主题与预设" icon="settings_suggest">
            <div class="setting-row">
              <div class="setting-label">主题</div>
              <q-btn-toggle dense unelevated toggle-color="primary" :model-value="settings.theme" :options="themeModes" @update:model-value="patch({ theme: $event })" />
            </div>
            <div class="color-row">
              <q-input dense outlined label="背景色" :model-value="settings.customBackground" @update:model-value="patch({ customBackground: String($event), theme: 'custom' })">
                <template #append>
                  <q-icon name="palette" class="cursor-pointer">
                    <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                      <q-color :model-value="settings.customBackground" @update:model-value="patch({ customBackground: String($event), theme: 'custom' })" />
                    </q-popup-proxy>
                  </q-icon>
                </template>
              </q-input>
              <q-input dense outlined label="文本色" :model-value="settings.customForeground" @update:model-value="patch({ customForeground: String($event), theme: 'custom' })">
                <template #append>
                  <q-icon name="palette" class="cursor-pointer">
                    <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                      <q-color :model-value="settings.customForeground" @update:model-value="patch({ customForeground: String($event), theme: 'custom' })" />
                    </q-popup-proxy>
                  </q-icon>
                </template>
              </q-input>
            </div>
            <div class="setting-row wide">
              <q-select dense outlined emit-value map-options class="setting-fill" :model-value="activePreset" :options="presetOptions" @update:model-value="selectPreset(String($event ?? ''))" />
              <q-btn dense flat icon="save" title="保存" @click="savePreset" />
              <q-btn dense flat icon="add" title="新建" @click="newPreset" />
              <q-btn dense flat icon="delete" title="删除" @click="deletePreset" />
            </div>
          </q-expansion-item>

          <q-expansion-item dense label="关于 Patchouli.js" icon="info">
            <div class="about-widget">
              <img class="about-icon" :src="patchouliLogoSrc" alt="Patchouli.js logo" />
              <div class="about-text">
                <img class="about-title" :src="patchouliTitleSrc" alt="Patchouli.js" />
                <p>Patchouli.js 是一个基于 Vue 编写的 HTML 文档阅读器，支持单页和分页显示。</p>
                <q-btn
                  dense
                  flat
                  no-caps
                  align="left"
                  icon="open_in_new"
                  label="AndreaFrederica/patchouli.js"
                  :href="patchouliRepoUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                />
              </div>
            </div>
          </q-expansion-item>

          <q-expansion-item dense label="诊断" icon="bug_report">
            <pre class="debug-output">{{ debugText }}</pre>
          </q-expansion-item>
        </q-card-section>
      </q-scroll-area>
      <q-separator />
      <q-card-actions align="right">
        <q-btn flat label="重置默认" @click="resetDefaults" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, ref } from 'vue';
import { QSlider } from 'quasar';
import { defaultReaderSettings, type ReaderSettings } from './previewSettings';

type VoiceOption = { index: number; name: string; lang: string; default?: boolean };
type ToggleKey = keyof Pick<ReaderSettings, 'markdownHeadings' | 'markdownLists' | 'markdownBold' | 'markdownItalic' | 'markdownBoldItalic' | 'markdownStrike' | 'markdownBlockquotes' | 'markdownCode'>;
type MarginSide = 'top' | 'right' | 'bottom' | 'left';

const props = defineProps<{
  settings: ReaderSettings;
  fonts: string[];
  vscodeFontFamily: string;
  roleTypes: string[];
  currentPage: number;
  totalPages: number;
  debugInfo?: unknown;
  voices: VoiceOption[];
  selectedVoice: string;
  ttsStatus: string;
  ttsSupported: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:settings', value: ReaderSettings): void;
  (e: 'request-fonts', force: boolean): void;
  (e: 'request-role-colors'): void;
  (e: 'request-role-highlights', enabledTypes: string[]): void;
  (e: 'set-obsidian-options', value: Partial<ReaderSettings>): void;
  (e: 'prev-page'): void;
  (e: 'next-page'): void;
  (e: 'tts-command', command: 'play' | 'pause' | 'stop'): void;
  (e: 'voice-change', value: string): void;
}>();

const open = ref(false);

const option = (label: string, value: string) => ({ label, value });
const displayModes = [option('滚动', 'scroll'), option('分页', 'paged')];
const heightModes = [option('自动', 'auto'), option('手动', 'manual')];
const widthModes = [option('自动', 'auto'), option('手动', 'manual')];
const fontModeOptions = [option('跟随', 'auto'), option('自定义', 'custom')];
const headingStyles = [option('左对齐', 'left'), option('居中', 'center')];
const listStyles = [option('标记缩进', 'indent'), option('纯文本', 'plain')];
const separatorModes = [option('渲染', 'render'), option('抹除', 'hidden'), option('原样', 'preserve')];
const columnModes = [option('1 列', '1'), option('2 列', '2')];
const syncModes = [option('开启', 'on'), option('关闭', 'off')];
const themeModes = [option('浅色', 'light'), option('深色', 'dark'), option('跟随', 'auto'), option('自定义', 'custom')];
const roleHoverModes = [option('自定义', 'custom'), option('原生', 'native'), option('关闭', 'off')];
const roleHoverDetails = [option('标准', 'standard'), option('精简', 'compact'), option('完整', 'full')];
const markdownToggles: Array<{ key: ToggleKey; label: string }> = [
  { key: 'markdownHeadings', label: '标题' },
  { key: 'markdownLists', label: '列表' },
  { key: 'markdownBold', label: '粗体' },
  { key: 'markdownItalic', label: '斜体' },
  { key: 'markdownBoldItalic', label: '粗斜' },
  { key: 'markdownStrike', label: '删除线' },
  { key: 'markdownBlockquotes', label: '引用' },
  { key: 'markdownCode', label: '代码' },
];

const pageProgressRatio = computed(() => {
  const total = Math.max(1, props.totalPages);
  return Math.max(0, Math.min(1, (props.currentPage + 1) / total));
});
const voiceSelectOptions = computed(() => [
  { label: '选择语音', value: '' },
  ...props.voices.map((voice) => ({
    label: `${voice.name} (${voice.lang})${voice.default ? ' [默认]' : ''}`,
    value: String(voice.index),
  })),
]);
const fontOptions = computed(() => [
  { label: '(默认)', value: '' },
  ...props.fonts.map((font) => ({ label: font, value: font })),
]);
const presetOptions = computed(() => presetNames.value.map((name) => ({ label: name, value: name })));
const enabledRoleTypes = computed(() => props.settings.colorizeRoleTypes ?? props.roleTypes);
const enabledRoleTypeSet = computed(() => new Set(enabledRoleTypes.value));
const debugText = computed(() => JSON.stringify(props.debugInfo ?? { reason: 'Patchouli debug info is not ready' }, null, 2));
const heightText = computed(() => (props.settings.height > 0 ? String(props.settings.height) : ''));
const widthText = computed(() => (props.settings.width > 0 ? String(props.settings.width) : ''));

const STORE_KEY = 'anhPatchouliReaderSettings';
const PRESET_KEY = 'anhPatchouliReaderPresets';
const DEFAULT_PRESET = '__default__';
const patchouliRepoUrl = 'https://github.com/AndreaFrederica/patchouli.js';
const patchouliLogoSrc = 'patchouli/logo.png';
const patchouliTitleSrc = 'patchouli/title.png';
const activePreset = ref(loadMeta().lastPreset || DEFAULT_PRESET);
const presetNames = computed(() => {
  const names = Object.keys(loadPresets());
  return names.length ? names : [DEFAULT_PRESET];
});

function normalize(value: ReaderSettings): ReaderSettings {
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
  };
}

function loadMeta(): { lastPreset?: string } {
  try {
    const meta = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return meta && typeof meta === 'object' ? meta : {};
  } catch {
    return {};
  }
}

function saveMeta(meta: { lastPreset?: string }) {
  localStorage.setItem(STORE_KEY, JSON.stringify(meta));
}

function loadPresets(): Record<string, ReaderSettings> {
  try {
    const presets = JSON.parse(localStorage.getItem(PRESET_KEY) || '{}');
    return presets && typeof presets === 'object' && !Array.isArray(presets) ? presets : {};
  } catch {
    return {};
  }
}

function savePresets(presets: Record<string, ReaderSettings>) {
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
}

function persist(value: ReaderSettings) {
  const presets = loadPresets();
  presets[activePreset.value || DEFAULT_PRESET] = normalize(value);
  savePresets(presets);
  saveMeta({ ...loadMeta(), lastPreset: activePreset.value || DEFAULT_PRESET });
}

function update(value: ReaderSettings) {
  const next = normalize(value);
  emit('update:settings', next);
  persist(next);
}

function patch(partial: Partial<ReaderSettings>) {
  update({ ...props.settings, ...partial });
}

function patchMargin(side: MarginSide, value: number) {
  const partial: Partial<ReaderSettings> = {};
  if (side === 'top') {
    partial.marginTop = value;
    if (props.settings.lockVerticalMargins) partial.marginBottom = value;
  } else if (side === 'bottom') {
    partial.marginBottom = value;
    if (props.settings.lockVerticalMargins) partial.marginTop = value;
  } else if (side === 'left') {
    partial.marginLeft = value;
    if (props.settings.lockHorizontalMargins) partial.marginRight = value;
  } else {
    partial.marginRight = value;
    if (props.settings.lockHorizontalMargins) partial.marginLeft = value;
  }
  partial.pad = Math.round(((partial.marginTop ?? props.settings.marginTop) + (partial.marginRight ?? props.settings.marginRight) + (partial.marginBottom ?? props.settings.marginBottom) + (partial.marginLeft ?? props.settings.marginLeft)) / 4);
  patch(partial);
}

function patchObsidian(partial: Partial<ReaderSettings>) {
  const next = normalize({ ...props.settings, ...partial });
  update(next);
  emit('set-obsidian-options', next);
}

function patchRoleColor(enabled: boolean) {
  const next = normalize({ ...props.settings, colorizeRoles: enabled });
  update(next);
  if (enabled) {
    emit('request-role-colors');
    emit('request-role-highlights', enabledRoleTypes.value);
  }
}

function patchNumber(key: 'height' | 'width', value: string | number | null) {
  const parsed = parseInt(String(value ?? ''), 10);
  patch({ [key]: !Number.isNaN(parsed) && parsed > 0 ? parsed : 0 } as Partial<ReaderSettings>);
}

function toggle(key: ToggleKey) {
  patch({ [key]: !props.settings[key] } as Partial<ReaderSettings>);
}

function toggleRoleType(type: string) {
  const selected = [...enabledRoleTypes.value];
  const index = selected.indexOf(type);
  if (index >= 0) selected.splice(index, 1);
  else selected.push(type);
  const next = normalize({ ...props.settings, colorizeRoleTypes: selected });
  update(next);
  if (next.colorizeRoles) emit('request-role-highlights', selected);
}

function selectPreset(name: string) {
  const presets = loadPresets();
  if (!name || !presets[name]) return;
  activePreset.value = name;
  saveMeta({ ...loadMeta(), lastPreset: name });
  emit('update:settings', normalize(presets[name]));
}

function savePreset() {
  persist(props.settings);
}

function newPreset() {
  const name = window.prompt('新建预设名称（唯一）', '');
  if (!name?.trim()) return;
  activePreset.value = name.trim();
  persist(props.settings);
}

function deletePreset() {
  const name = activePreset.value;
  if (!name || !window.confirm(`删除预设: ${name}?`)) return;
  const presets = loadPresets();
  delete presets[name];
  const nextName = Object.keys(presets)[0] || DEFAULT_PRESET;
  activePreset.value = nextName;
  if (!presets[nextName]) presets[nextName] = normalize(props.settings);
  savePresets(presets);
  saveMeta({ ...loadMeta(), lastPreset: nextName });
  emit('update:settings', normalize(presets[nextName]));
}

function resetDefaults() {
  update(defaultReaderSettings());
}

const SettingSlider = defineComponent({
  props: {
    label: { type: String, required: true },
    modelValue: { type: Number, required: true },
    min: { type: Number, required: true },
    max: { type: Number, required: true },
    step: { type: Number, required: true },
    digits: { type: Number, default: 0 },
  },
  emits: ['update:modelValue'],
  setup(sliderProps, { emit: sliderEmit }) {
    return () => h('div', { class: 'slider-row' }, [
      h('div', { class: 'setting-label' }, sliderProps.label),
      h(QSlider, {
        modelValue: sliderProps.modelValue,
        min: sliderProps.min,
        max: sliderProps.max,
        step: sliderProps.step,
        dense: true,
        label: true,
        'onUpdate:modelValue': (value: number) => sliderEmit('update:modelValue', value),
      }),
      h('div', { class: 'setting-value' }, sliderProps.modelValue.toFixed(sliderProps.digits)),
    ]);
  },
});
</script>

<style scoped>
.patchouli-topbar {
  position: fixed;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border: 1px solid rgba(128, 128, 128, .24);
  border-radius: 6px;
  background: var(--vscode-editor-background, #151515);
  color: var(--vscode-editor-foreground, #ddd);
  z-index: 1500;
}

.voice-select {
  width: min(380px, 42vw);
}

.tts-status {
  min-width: 36px;
  font-size: 12px;
  opacity: .72;
}

.pagebar {
  position: fixed;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, .68);
  color: #fff;
  z-index: 1500;
}

.pagebar-text {
  min-width: 44px;
  text-align: center;
  font-size: 12px;
}

.pagebar-progress {
  width: 120px;
}

.settings-fab {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 1700;
}

.settings-card {
  width: min(460px, 92vw);
  height: 100vh;
  background: var(--vscode-editor-background, #151515);
  color: var(--vscode-editor-foreground, #ddd);
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
}

.settings-scroll {
  height: calc(100vh - 94px);
}

.settings-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px 16px;
}

.setting-row,
.slider-row {
  display: grid;
  grid-template-columns: 78px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  margin: 6px 0;
}

.setting-row.wide {
  grid-template-columns: minmax(0, 1fr) auto auto auto;
}

.setting-label {
  font-size: 12px;
  opacity: .68;
}

.setting-value {
  width: 36px;
  text-align: right;
  font-size: 12px;
  opacity: .72;
}

.setting-fill {
  min-width: 0;
}

.lock-row,
.chip-grid,
.color-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  margin: 6px 0;
}

.color-row > * {
  flex: 1 1 150px;
}

.role-types {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.empty-text {
  font-size: 12px;
  opacity: .65;
}

.debug-output {
  max-height: 220px;
  overflow: auto;
  padding: 8px;
  border-radius: 4px;
  background: rgba(0, 0, 0, .28);
  font-size: 11px;
  white-space: pre-wrap;
}

.about-widget {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}

.about-icon {
  width: 56px;
  height: 56px;
  object-fit: contain;
  flex: 0 0 auto;
}

.about-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.about-title {
  width: min(220px, 100%);
  height: auto;
  object-fit: contain;
  align-self: flex-start;
}

.about-text p {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  opacity: .78;
}

@media (max-width: 720px) {
  .patchouli-topbar {
    left: 8px;
    right: 8px;
  }

  .voice-select {
    flex: 1 1 auto;
    width: auto;
  }
}
</style>
