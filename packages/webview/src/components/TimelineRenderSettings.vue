<template>
  <div class="timeline-render-settings">
    <!-- 显示设置 -->
    <q-card flat bordered class="q-mb-md">
      <q-card-section>
        <div class="text-subtitle2 q-mb-md">显示组件</div>

        <q-toggle
          v-model="settingsStore.showBackground"
          label="显示背景网格"
          color="primary"
        />

        <q-toggle
          v-model="settingsStore.showMiniMap"
          label="显示小地图"
          color="primary"
        />

        <q-toggle
          v-model="settingsStore.showControls"
          label="显示控制按钮"
          color="primary"
        />
      </q-card-section>
    </q-card>

    <!-- 连线设置 -->
    <q-card flat bordered class="q-mb-md">
      <q-card-section>
        <div class="text-subtitle2 q-mb-sm">连线设置</div>

        <q-toggle
          v-model="settingsStore.edgesOnTop"
          label="连线显示在节点上方"
          color="primary"
        >
          <q-tooltip>启用后，连线会绘制在节点上方，更容易看清连接关系</q-tooltip>
        </q-toggle>

        <div class="q-mt-md">
          <div class="text-body2 q-mb-sm">
            动画速度: {{ settingsStore.edgeAnimationSpeed }}
          </div>
          <q-slider
            v-model="settingsStore.edgeAnimationSpeed"
            :min="1"
            :max="5"
            :step="1"
            label
            color="primary"
            markers
          />
        </div>
      </q-card-section>
    </q-card>

    <!-- 布局设置 -->
    <q-card flat bordered class="q-mb-md">
      <q-card-section>
        <div class="text-subtitle2 q-mb-sm">布局设置</div>

        <div class="q-mb-md">
          <div class="text-body2 q-mb-sm">
            节点默认间距: {{ settingsStore.nodeSpacing }}px
          </div>
          <q-slider
            v-model="settingsStore.nodeSpacing"
            :min="100"
            :max="400"
            :step="50"
            label
            color="primary"
            markers
          />
        </div>
      </q-card-section>
    </q-card>

    <!-- 交互行为设置 -->
    <q-card flat bordered class="q-mb-md">
      <q-card-section>
        <div class="text-subtitle2 q-mb-md">交互行为</div>

        <q-toggle
          v-model="settingsStore.closeAfterAdd"
          label="添加事件后自动关闭弹窗"
          color="primary"
        >
          <q-tooltip>启用后，添加新事件后会自动关闭添加对话框</q-tooltip>
        </q-toggle>

        <q-toggle
          v-model="settingsStore.closeAfterEdit"
          label="编辑事件保存后自动关闭弹窗"
          color="primary"
        >
          <q-tooltip>启用后，保存编辑的事件后会自动关闭编辑对话框</q-tooltip>
        </q-toggle>

        <q-toggle
          v-model="settingsStore.closeAfterEditConnection"
          label="编辑连线保存后自动关闭弹窗"
          color="primary"
        >
          <q-tooltip>启用后，保存编辑的连线后会自动关闭编辑对话框</q-tooltip>
        </q-toggle>
      </q-card-section>
    </q-card>

    <!-- 重置按钮 -->
    <q-btn
      label="重置为默认设置"
      color="grey"
      outline
      class="full-width"
      @click="settingsStore.reset()"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useTimelineSettingsStore } from '../stores/timeline-settings';

// 使用 Pinia store
const settingsStore = useTimelineSettingsStore();

// 初始化时设置自动保存监听
onMounted(() => {
  settingsStore.init();
});
</script>

<style scoped>
.timeline-render-settings {
  padding: 0;
}
</style>
