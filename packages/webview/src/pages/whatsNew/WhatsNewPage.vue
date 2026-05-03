<template>
  <div class="whats-new-page">
    <div class="container">
      <!-- Header -->
      <div class="header">
        <div class="header-content">
          <q-icon name="celebration" size="32px" class="header-icon" />
          <div class="header-text">
            <h1 class="page-title">What's New</h1>
            <div class="version-row">
              <q-badge color="primary" class="version-badge">
                v{{ currentData?.version || selectedVersion || '...' }}
              </q-badge>
              <span v-if="currentData?.date" class="date-text">{{ currentData.date }}</span>
              <q-badge
                v-if="currentData?.source"
                :color="currentData.source === 'manual' ? 'positive' : 'grey-7'"
                outline
                class="source-badge"
              >
                {{ currentData.source === 'manual' ? '精选' : 'CHANGELOG' }}
              </q-badge>
            </div>
          </div>
        </div>
        <q-btn
          flat
          round
          dense
          icon="close"
          class="close-btn"
          @click="closePanel"
          title="关闭"
        />
      </div>

      <!-- Version Selector -->
      <div class="version-selector">
        <q-select
          v-model="selectedVersion"
          :options="versionOptions"
          label="选择版本"
          dense
          outlined
          emit-value
          map-options
          options-dense
          class="version-select"
          @update:model-value="onVersionChange"
        />
      </div>

      <!-- Content -->
      <div class="content">
        <!-- Loading -->
        <div v-if="loading" class="loading-state">
          <q-spinner color="primary" size="40px" />
          <p class="loading-text">正在加载更新内容...</p>
        </div>

        <!-- No content -->
        <div v-else-if="!currentData || currentData.sections.length === 0" class="empty-state">
          <q-icon name="info" size="48px" color="grey-5" />
          <p>此版本暂无详细更新说明</p>
        </div>

        <!-- Changelog sections -->
        <template v-else>
          <q-card
            v-for="(section, idx) in currentData.sections"
            :key="idx"
            flat
            bordered
            class="section-card"
          >
            <template v-if="section.header">
              <q-card-section class="section-header">
                <div class="section-title">{{ section.header }}</div>
              </q-card-section>
              <q-separator />
            </template>

            <q-card-section class="section-body">
              <!-- HTML 区块：直接渲染原始 HTML -->
              <template v-if="section.type === 'html'">
                <div
                  v-for="(item, itemIdx) in section.items"
                  :key="itemIdx"
                  class="html-block"
                  v-html="item"
                />
              </template>
              <!-- 列表区块：渲染为 bullet list -->
              <ul v-else class="changelog-list">
                <li
                  v-for="(item, itemIdx) in section.items"
                  :key="itemIdx"
                  class="changelog-item"
                >
                  <span class="item-bullet">•</span>
                  <span class="item-text" v-html="renderMarkdown(item)" />
                </li>
              </ul>
            </q-card-section>
          </q-card>
        </template>
      </div>

      <!-- Footer -->
      <div class="footer">
        <q-btn
          flat
          color="grey-7"
          label="打开设置"
          icon="settings"
          size="sm"
          @click="openSettings"
        />
        <q-btn
          flat
          color="primary"
          label="关闭"
          icon="check"
          size="sm"
          @click="closePanel"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useVsCodeApiStore } from 'stores/vscode';

interface WhatsNewSection {
  header: string;
  items: string[];
  type?: 'list' | 'html';
}

interface WhatsNewData {
  version: string;
  date: string;
  sections: WhatsNewSection[];
  source: 'manual' | 'changelog';
}

interface VersionInfo {
  version: string;
  date: string;
  source: 'manual' | 'changelog';
}

const vscodeStore = useVsCodeApiStore();
const currentData = ref<WhatsNewData | null>(null);
const allVersions = ref<VersionInfo[]>([]);
const selectedVersion = ref<string>('');
const loading = ref(true);

const versionOptions = ref<{ label: string; value: string }[]>([]);

function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function closePanel() {
  vscodeStore.vscode?.postMessage({ command: 'closePanel' });
}

function openSettings() {
  vscodeStore.vscode?.postMessage({ command: 'openSettings' });
}

function onVersionChange(version: string) {
  if (!version) { return; }
  loading.value = true;
  currentData.value = null;
  vscodeStore.vscode?.postMessage({ command: 'loadVersion', version });
}

function handleMessage(event: MessageEvent) {
  const message = event.data;

  if (message.command === 'initData') {
    allVersions.value = message.versions || [];
    selectedVersion.value = message.currentVersion || '';
    currentData.value = message.data || null;
    loading.value = false;

    // 构建下拉选项
    versionOptions.value = allVersions.value.map(v => ({
      label: `v${v.version}${v.date ? ` (${v.date})` : ''}${v.source === 'manual' ? ' ★' : ''}`,
      value: v.version
    }));
    return;
  }

  if (message.command === 'setChangelog') {
    currentData.value = message.data || null;
    loading.value = false;
    return;
  }
}

onMounted(() => {
  window.addEventListener('message', handleMessage);
  vscodeStore.vscode?.postMessage({ command: 'whatsnewReady' });
});

onUnmounted(() => {
  window.removeEventListener('message', handleMessage);
});
</script>

<style scoped>
.whats-new-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.container {
  max-width: 720px;
  margin: 0 auto;
  width: 100%;
  padding: 24px;
  display: flex;
  flex-direction: column;
  flex: 1;
}

/* Header */
.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}

.header-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-icon {
  color: var(--q-primary);
  opacity: 0.9;
}

.page-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  line-height: 1.2;
}

.version-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.version-badge {
  font-size: 13px;
  padding: 2px 10px;
  font-weight: 500;
}

.date-text {
  font-size: 13px;
  opacity: 0.6;
}

.source-badge {
  font-size: 11px;
  padding: 0px 6px;
  font-weight: 500;
}

.close-btn {
  margin-top: 4px;
}

/* Version Selector */
.version-selector {
  margin-bottom: 16px;
}

.version-select {
  max-width: 320px;
}

/* Content */
.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  gap: 16px;
  opacity: 0.7;
}

.loading-text {
  font-size: 14px;
  margin: 0;
}

/* Section cards */
.section-card {
  border-radius: 8px;
  overflow: hidden;
}

.section-header {
  padding: 12px 16px;
  background: rgba(128, 128, 128, 0.06);
}

.section-title {
  font-size: 14px;
  font-weight: 600;
}

.section-body {
  padding: 12px 16px;
}

.changelog-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.changelog-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 13px;
  line-height: 1.6;
}

.item-bullet {
  color: var(--q-primary);
  font-weight: 700;
  flex-shrink: 0;
  margin-top: 1px;
}

.item-text {
  word-break: break-word;
}

.item-text :deep(strong) {
  font-weight: 600;
}

.item-text :deep(code) {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.15);
}

/* HTML blocks */
.html-block {
  font-size: 13px;
  line-height: 1.6;
}

.html-block :deep(img) {
  max-width: 100%;
  border-radius: 6px;
  height: auto;
}

.html-block :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0;
}

.html-block :deep(th),
.html-block :deep(td) {
  padding: 8px 12px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  text-align: left;
}

.html-block :deep(th) {
  background: rgba(128, 128, 128, 0.1);
  font-weight: 600;
}

.html-block :deep(a) {
  color: var(--q-primary);
  text-decoration: none;
}

.html-block :deep(a:hover) {
  text-decoration: underline;
}

.html-block :deep(pre) {
  background: rgba(128, 128, 128, 0.1);
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
}

.html-block :deep(code) {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.15);
}

.html-block :deep(blockquote) {
  border-left: 3px solid var(--q-primary);
  margin: 8px 0;
  padding: 8px 16px;
  background: rgba(128, 128, 128, 0.06);
  border-radius: 0 6px 6px 0;
}

/* Footer */
.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid rgba(128, 128, 128, 0.2);
}
</style>
