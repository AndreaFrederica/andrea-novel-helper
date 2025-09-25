<template>
  <div
    v-if="visible"
    class="node-hover-tooltip"
    :style="{
      left: `${position.x + 10}px`,
      top: `${position.y + 10}px`,
      position: 'fixed',
      zIndex: 9999
    }"
    @mouseenter="$emit('tooltip-hover', true)"
    @mouseleave="$emit('tooltip-hover', false)"
  >
    <div class="tooltip-header">
      <div class="role-name">{{ nodeData?.text || '未知节点' }}</div>
      <div 
        v-if="nodeData?.color" 
        class="color-swatch" 
        :style="{ backgroundColor: nodeData.color }"
      ></div>
    </div>
    
    <div class="tooltip-content">
      <!-- 角色基本信息 -->
      <div v-if="roleInfo" class="role-section">
        <div class="section-title">角色信息</div>
        <div v-if="roleInfo.description" class="info-item">
          <strong>描述：</strong>{{ roleInfo.description }}
        </div>
        <div v-if="roleInfo.type" class="info-item">
          <strong>类型：</strong>{{ roleInfo.type }}
        </div>
        <div v-if="roleInfo.affiliation" class="info-item">
          <strong>阵营：</strong>{{ roleInfo.affiliation }}
        </div>
        <div v-if="roleInfo.aliases && roleInfo.aliases.length > 0" class="info-item">
          <strong>别名：</strong>{{ roleInfo.aliases.join(', ') }}
        </div>
      </div>

      <!-- 节点数据信息 -->
      <div v-if="nodeData?.data" class="node-section">
        <div class="section-title">节点属性</div>
        <div v-if="nodeData.data.sexType" class="info-item">
          <strong>性别：</strong>{{ formatSexType(nodeData.data.sexType) }}
        </div>
        <div v-if="nodeData.data.isGoodMan !== undefined" class="info-item">
          <strong>角色性质：</strong>{{ formatGoodMan(nodeData.data.isGoodMan) }}
        </div>
        <div v-if="nodeData.data.roleUuid" class="info-item">
          <strong>关联角色：</strong>{{ nodeData.data.roleUuid }}
        </div>
      </div>

      <!-- 扩展字段 -->
      <div v-if="roleInfo && roleInfo.extended && Object.keys(roleInfo.extended).length > 0" class="extended-section">
        <div class="section-title">扩展信息</div>
        <div v-for="(value, key) in roleInfo.extended" :key="key" class="info-item">
          <strong>{{ key }}：</strong>{{ value }}
        </div>
      </div>

      <!-- 位置信息 -->
      <div v-if="nodeData" class="position-section">
        <div class="section-title">位置</div>
        <div class="info-item">
          <strong>坐标：</strong>({{ Math.round(nodeData.x || 0) }}, {{ Math.round(nodeData.y || 0) }})
        </div>
      </div>

      <!-- 关联节点信息 -->
      <div v-if="nodeData?.relatedNodes && nodeData.relatedNodes.length > 0" class="related-nodes-section">
        <div class="section-title">关联角色 ({{ nodeData.relatedNodes.length }})</div>
        <div v-for="(relatedItem, index) in nodeData.relatedNodes" :key="index" class="related-node-item">
          <div class="related-node-header">
            <span class="related-node-name">{{ relatedItem.node.text || '未知节点' }}</span>
            <div 
              v-if="relatedItem.node.color" 
              class="related-color-swatch" 
              :style="{ backgroundColor: relatedItem.node.color }"
            ></div>
          </div>
          
          <!-- 显示关系类型 -->
          <div v-if="relatedItem.relationships && relatedItem.relationships.length > 0" class="relationships">
            <div v-for="(rel, relIndex) in relatedItem.relationships" :key="relIndex" class="relationship-item">
              <span class="relationship-type">{{ rel.type }}</span>
              <span class="relationship-direction">
                {{ rel.direction === 'outgoing' ? '→' : '←' }}
              </span>
            </div>
          </div>

          <!-- 显示关联角色的详细信息 -->
          <div v-if="getRelatedRoleInfo(relatedItem.node)" class="related-role-info">
            <div v-if="getRelatedRoleInfo(relatedItem.node).description" class="related-info-item">
              <strong>描述：</strong>{{ getRelatedRoleInfo(relatedItem.node).description }}
            </div>
            <div v-if="getRelatedRoleInfo(relatedItem.node).type" class="related-info-item">
              <strong>类型：</strong>{{ getRelatedRoleInfo(relatedItem.node).type }}
            </div>
            <div v-if="getRelatedRoleInfo(relatedItem.node).affiliation" class="related-info-item">
              <strong>阵营：</strong>{{ getRelatedRoleInfo(relatedItem.node).affiliation }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import type { RGNode } from 'relation-graph-vue3';

// 扩展节点数据类型，包含关联节点信息
interface ExtendedNodeData extends RGNode {
  relatedNodes?: Array<{
    node: RGNode;
    relationships: Array<{
      type: string;
      direction: 'incoming' | 'outgoing';
    }>;
  }>;
}

interface Props {
  visible: boolean;
  nodeData: ExtendedNodeData | null;
  position: { x: number; y: number };
  roleList?: any[];
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  nodeData: null,
  position: () => ({ x: 0, y: 0 }),
  roleList: () => []
});

// 定义emits
const emit = defineEmits<{
  'tooltip-hover': [isHovering: boolean]
}>();

// 根据roleUuid查找角色信息
const roleInfo = computed(() => {
  if (!props.nodeData?.data?.roleUuid || !props.roleList.length) {
    return null;
  }
  
  return props.roleList.find(role => role.uuid === props.nodeData?.data?.roleUuid) || null;
});

// 计算tooltip位置样式
// const tooltipStyle = computed(() => {
//   const offset = 10; // 偏移量，避免遮挡鼠标
//   const style = {
//     left: `${props.position.x + offset}px`,
//     top: `${props.position.y + offset}px`,
//     position: 'fixed',
//     zIndex: 9999
//   };
//   return style;
// });

// 格式化性别显示
const formatSexType = (sexType: string) => {
  const sexMap: Record<string, string> = {
    'male': '男性',
    'female': '女性',
    'other': '其他',
    '男': '男性',
    '女': '女性'
  };
  return sexMap[sexType] || sexType;
};

// 格式化角色性质显示
const formatGoodMan = (isGoodMan: boolean | string) => {
  if (typeof isGoodMan === 'boolean') {
    return isGoodMan ? '正面角色' : '反面角色';
  }
  if (isGoodMan === 'other') {
    return '中性角色';
  }
  return String(isGoodMan);
};

// 根据关联节点获取角色信息
const getRelatedRoleInfo = (node: any) => {
  if (!node?.data?.roleUuid || !props.roleList.length) {
    return null;
  }
  
  return props.roleList.find(role => role.uuid === node.data.roleUuid) || null;
};
</script>

<style scoped>
.node-hover-tooltip {
  background: rgba(45, 45, 45, 0.95);
  color: #cccccc;
  border: 1px solid #454545;
  border-radius: 6px;
  padding: 12px;
  max-width: 320px;
  min-width: 200px;
  font-size: 13px;
  line-height: 1.4;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(8px);
  pointer-events: none; /* 防止tooltip阻挡鼠标事件 */
}

.tooltip-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid #555;
}

.role-name {
  font-weight: bold;
  font-size: 14px;
  color: #ffffff;
}

.color-swatch {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  border: 1px solid #666;
  flex-shrink: 0;
}

.tooltip-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.role-section,
.node-section,
.extended-section,
.position-section,
.related-nodes-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-title {
  font-weight: bold;
  color: #ffffff;
  font-size: 12px;
  margin-bottom: 2px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.info-item {
  font-size: 12px;
  color: #cccccc;
  word-wrap: break-word;
}

.info-item strong {
  color: #ffffff;
  font-weight: 500;
}

/* 关联节点样式 */
.related-nodes-section {
  border-top: 1px solid #555;
  padding-top: 8px;
  margin-top: 4px;
}

.related-node-item {
  background: rgba(60, 60, 60, 0.5);
  border-radius: 4px;
  padding: 8px;
  margin-bottom: 6px;
  border-left: 3px solid #007acc;
}

.related-node-item:last-child {
  margin-bottom: 0;
}

.related-node-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.related-node-name {
  font-weight: bold;
  color: #ffffff;
  font-size: 12px;
}

.related-color-swatch {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  border: 1px solid #666;
  flex-shrink: 0;
}

.relationships {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}

.relationship-item {
  display: flex;
  align-items: center;
  gap: 2px;
  background: rgba(0, 122, 204, 0.2);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
}

.relationship-type {
  color: #87ceeb;
  font-weight: 500;
}

.relationship-direction {
  color: #ffffff;
  font-weight: bold;
}

.related-role-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.related-info-item {
  font-size: 11px;
  color: #bbbbbb;
  word-wrap: break-word;
}

.related-info-item strong {
  color: #dddddd;
  font-weight: 500;
}

/* 响应式调整 */
@media (max-width: 768px) {
  .node-hover-tooltip {
    max-width: 280px;
    font-size: 12px;
  }
  
  .role-name {
    font-size: 13px;
  }
}
</style>