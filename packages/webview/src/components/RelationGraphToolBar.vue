<template>
  <div class="toolbar-container">
    <div class="toolbar-content">
      <q-btn
        dense
        round
        color="primary"
        icon="cloud_upload"
        @click="onSave"
        class="toolbar-btn"
      >
        <q-tooltip>保存</q-tooltip>
      </q-btn>

      <q-btn
        dense
        flat
        :label="`${options?.canvasZoom || 100}%`"
        @click="zoomToFit"
        class="toolbar-btn zoom-btn"
      >
        <q-tooltip>缩放比例</q-tooltip>
      </q-btn>

      <q-btn
        dense
        round
        :color="options?.creatingNodePlot ? 'positive' : 'grey-6'"
        icon="add_circle"
        @click="startAddNode($event)"
        class="toolbar-btn"
      >
        <q-tooltip>添加节点（点击）</q-tooltip>
      </q-btn>

      <q-btn
        dense
        round
        :color="options?.creatingNodePlot ? 'positive' : 'grey-6'"
        icon="add_circle_outline"
        @click="startAddNode($event)"
        class="toolbar-btn"
      >
        <q-tooltip>添加节点（拖拽）</q-tooltip>
      </q-btn>

      <q-btn
        dense
        round
        :color="options?.creatingLinePlot ? 'positive' : 'grey-6'"
        icon="timeline"
        @click="startAddLine($event)"
        class="toolbar-btn"
      >
        <q-tooltip>添加连线</q-tooltip>
      </q-btn>

      <q-btn
        dense
        round
        color="info"
        icon="fit_screen"
        @click="zoomToFit"
        class="toolbar-btn"
      >
        <q-tooltip>适应屏幕</q-tooltip>
      </q-btn>

      <q-btn
        dense
        round
        color="warning"
        icon="refresh"
        @click="refresh"
        class="toolbar-btn"
      >
        <q-tooltip>刷新</q-tooltip>
      </q-btn>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, inject, ref } from 'vue';
import type { RGNode } from 'relation-graph-vue3';
import { graphKey } from 'relation-graph-vue3';
import { Notify } from 'quasar';

// 定义graph的类型
interface GraphContext {
  options?: any;
  instance?: any;
}

const newNodeIdIndex = ref(1);
const newLineIdIndex = ref(1);
const graph = inject<GraphContext>(graphKey);

const options = computed(() => {
  return graph?.options;
});

const relationGraph = computed(() => {
  console.log('Computing relationGraph, graph:', graph);
  const instance = graph?.instance;
  console.log('Graph instance:', instance);
  return instance;
});

const onSave = () => {
  Notify.create({
    type: 'positive',
    message: '保存成功！',
    position: 'top'
  });
};

const refresh = () => {
  const graphInstance = relationGraph.value;
  if (graphInstance) {
    graphInstance.refresh();
  }
};

const zoomToFit = () => {
  const graphInstance = relationGraph.value;
  if (graphInstance) {
    graphInstance.setZoom(100);
    graphInstance.moveToCenter();
    graphInstance.zoomToFit();
  }
};

const startAddNode = (e: MouseEvent) => {
  console.log('startAddNode called');
  
  const graphInstance = relationGraph.value;
  console.log('graphInstance for node:', graphInstance);
  
  if (!graphInstance) {
    Notify.create({
      type: 'negative',
      message: '关系图实例未初始化！',
      position: 'top'
    });
    return;
  }

  try {
    graphInstance.startCreatingNodePlot(e, {
      templateText: '新节点',
      templateNode: {
        className: 'my-node-template'
      },
      onCreateNode: (x: number, y: number) => {
        console.log('New node created at:', x, y);
        const newId = newNodeIdIndex.value++;
        const newNode = {
          id: 'newNode-' + newId,
          text: '新节点 ' + newId,
          color: '#5da0f8',
          x: x - 50,
          y: y - 50
        };
        console.log('Adding node:', newNode);
        relationGraph.value?.addNodes([newNode]);
        
        Notify.create({
          type: 'positive',
          message: '节点创建成功！',
          position: 'top'
        });
      }
    });
    console.log('startCreatingNodePlot called successfully');
  } catch (error) {
    console.error('Error in startCreatingNodePlot:', error);
    Notify.create({
      type: 'negative',
      message: '启动节点创建失败：' + String(error),
      position: 'top'
    });
  }
};

const startAddLine = (e: MouseEvent) => {
  console.log('startAddLine called');
  
  const graphInstance = relationGraph.value;
  console.log('graphInstance:', graphInstance);
  
  if (!graphInstance) {
    Notify.create({
      type: 'negative',
      message: '关系图实例未初始化！',
      position: 'top'
    });
    return;
  }

  Notify.create({
    type: 'info',
    message: '点击一个节点开始创建连线！',
    position: 'top'
  });
  
  try {
    graphInstance.startCreatingLinePlot(e, {
      template: {
        lineWidth: 3,
        color: '#8080ff',
        text: '新连线'
      },
      onCreateLine: (from: RGNode, to: RGNode) => {
        console.log('New line created:', from, to);
        if (from?.id && to?.id) {
          const newLineId = newLineIdIndex.value++;
          const newLine = {
            from: from.id,
            to: to.id,
            lineWidth: 3,
            color: '#8080ff',
            text: '新连线 ' + newLineId
          };
          console.log('Adding line:', newLine);
          relationGraph.value?.addLines([newLine]);
          
          Notify.create({
            type: 'positive',
            message: '连线创建成功！',
            position: 'top'
          });
        } else {
          console.error('Invalid nodes for line creation:', from, to);
          Notify.create({
            type: 'negative',
            message: '连线创建失败：节点无效',
            position: 'top'
          });
        }
      }
    });
    console.log('startCreatingLinePlot called successfully');
  } catch (error) {
    console.error('Error in startCreatingLinePlot:', error);
    Notify.create({
      type: 'negative',
      message: '启动连线创建失败：' + String(error),
      position: 'top'
    });
  }
};
</script>

<style lang="scss" scoped>
.toolbar-container {
  position: absolute;
  z-index: 30;
  top: 10px;
  left: 40px;
  padding: 10px;
  background-color: rgba(255, 255, 255, 0.95);
  border: 1px solid #efefef;
  box-shadow: 0 3px 9px rgba(0, 21, 41, 0.08);
  border-radius: 10px;
  backdrop-filter: blur(10px);
}

.toolbar-content {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
}

.toolbar-btn {
  min-width: 40px;
  height: 40px;
}

.zoom-btn {
  min-width: 60px;
  font-size: 12px;
  font-weight: bold;
}

// 深色主题适配
.body--dark .toolbar-container {
  background-color: rgba(30, 30, 30, 0.95);
  border-color: #444;
}
</style>