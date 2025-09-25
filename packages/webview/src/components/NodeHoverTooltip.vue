<template>
  <div
    v-if="visible"
    class="node-hover-tooltip"
    :style="{
      left: `${position.x + (followMouse ? 10 : 0)}px`,
      top: `${position.y + (followMouse ? 10 : 0)}px`,
      position: 'fixed',
      zIndex: 9999
    }"
    @mouseenter="$emit('tooltip-hover', true)"
    @mouseleave="$emit('tooltip-hover', false)"
  >
    <div class="tooltip-header">
      <div class="role-name">{{ roleInfo?.name || nodeData?.text || '未知节点' }}</div>
      <div 
        v-if="(roleInfo?.color || nodeData?.color)" 
        class="color-swatch" 
        :style="{ backgroundColor: roleInfo?.color || nodeData?.color }"
      ></div>
    </div>
    
    <div class="tooltip-content">
      <!-- 角色基本信息（来自后端role，完整展示） -->
      <div v-if="roleInfo" class="role-section">
        <div class="section-title">角色信息</div>
        <div v-for="(value, key) in roleBaseEntries" :key="key" class="info-item">
          <strong>{{ baseLabel(key) }}：</strong>
          <span v-if="Array.isArray(value)">{{ (value as any[]).join(', ') }}</span>
          <span v-else>{{ value }}</span>
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
          <strong>关联角色UUID：</strong>{{ nodeData.data.roleUuid }}
        </div>
      </div>

      <!-- 扩展字段（后端role.extended） -->
      <div v-if="roleInfo && roleInfo.extended && Object.keys(roleInfo.extended).length > 0" class="extended-section">
        <div class="section-title">扩展信息</div>
        <div v-for="(value, key) in roleInfo.extended" :key="key" class="info-item">
          <strong>{{ key }}：</strong>{{ value }}
        </div>
      </div>

      <!-- 自定义字段（后端role.custom） -->
      <div v-if="roleInfo && roleInfo.custom && Object.keys(roleInfo.custom).length > 0" class="custom-section">
        <div class="section-title">自定义信息</div>
        <div v-for="(value, key) in roleInfo.custom" :key="key" class="info-item">
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

          <!-- 显示关联角色的详细信息（完整） -->
          <div v-if="getRelatedRoleInfo(relatedItem.node)" class="related-role-info">
            <div class="related-info-item" v-for="(value, key) in getRelatedRoleInfo(relatedItem.node)?.base" :key="key">
              <strong>{{ baseLabel(key) }}：</strong>
              <span v-if="Array.isArray(value)">{{ (value as any[]).join(', ') }}</span>
              <span v-else>{{ value }}</span>
            </div>
            <div v-if="getRelatedRoleInfo(relatedItem.node)?.extended && Object.keys(getRelatedRoleInfo(relatedItem.node)!.extended!).length > 0" class="related-info-item">
              <div class="section-title">扩展</div>
              <div v-for="(v, k) in getRelatedRoleInfo(relatedItem.node)!.extended" :key="k">
                <strong>{{ k }}：</strong>{{ v }}
              </div>
            </div>
            <div v-if="getRelatedRoleInfo(relatedItem.node)?.custom && Object.keys(getRelatedRoleInfo(relatedItem.node)!.custom!).length > 0" class="related-info-item">
              <div class="section-title">自定义</div>
              <div v-for="(v, k) in getRelatedRoleInfo(relatedItem.node)!.custom" :key="k">
                <strong>{{ k }}：</strong>{{ v }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
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
  followMouse?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  nodeData: null,
  position: () => ({ x: 0, y: 0 }),
  roleList: () => [],
  followMouse: true,
});

// 定义emits
const emit = defineEmits<{ 'tooltip-hover': [isHovering: boolean] }>();

// 统一查找与规范化 role 结构（兼容后端返回的不同结构）
type RoleLike = { uuid?: string } & Record<string, unknown>;
function findRoleByUuid(list: any[], uuid?: string | null): RoleLike | null {
  if (!uuid || !Array.isArray(list)) return null;
  for (const item of list) {
    if (item && Array.isArray((item as any).roles)) {
      // package 分组
      const hit = (item as any).roles.find((r: any) => r?.uuid === uuid);
      if (hit) return hit as RoleLike;
    } else if ((item as any)?.uuid === uuid) {
      return item as RoleLike;
    }
  }
  return null;
}

type NormalizedRole = {
  uuid?: string;
  base: Record<string, any>;
  extended?: Record<string, any>;
  custom?: Record<string, any>;
};

function normalizeRole(role: any): NormalizedRole {
  if (!role) return { base: {} };
  // 带有 base/extended/custom 的结构
  if (role.base || role.extended || role.custom) {
    return {
      uuid: role.base?.uuid ?? role.uuid,
      base: role.base ?? {},
      extended: role.extended ?? {},
      custom: role.custom ?? {},
    };
  }
  // 扁平结构：从已知字段组装 base
  const knownKeys = ['name', 'type', 'affiliation', 'aliases', 'color', 'priority', 'description', 'uuid'];
  const base: Record<string, any> = {};
  for (const k of knownKeys) {
    if (role[k] !== undefined) base[k] = role[k];
  }
  return {
    uuid: role.uuid,
    base,
    extended: role.extended ?? {},
    custom: role.custom ?? {},
  };
}

const roleInfo = computed(() => {
  const uuid = props.nodeData?.data?.roleUuid || null;
  const raw = findRoleByUuid(props.roleList, uuid);
  const norm = normalizeRole(raw);
  // 组合需要展示的平面字段
  return {
    name: norm.base?.name,
    description: norm.base?.description,
    type: norm.base?.type,
    affiliation: norm.base?.affiliation,
    aliases: norm.base?.aliases,
    color: norm.base?.color,
    extended: norm.extended,
    custom: norm.custom,
    base: norm.base,
  } as Record<string, any> | null;
});

// 基本字段展示（包含所有 base 字段）
const roleBaseEntries = computed<Record<string, any>>(() => {
  const base = (roleInfo.value?.base ?? {}) as Record<string, any>;
  return base;
});

function baseLabel(key: string): string {
  const map: Record<string, string> = {
    name: '名称',
    type: '类型',
    affiliation: '阵营',
    aliases: '别名',
    color: '颜色',
    uuid: 'UUID',
    description: '描述',
    priority: '优先级'
  };
  return map[key] || key;
}

// 格式化性别显示
function formatSexType(sexType: string) {
  const sexMap: Record<string, string> = {
    male: '男性',
    female: '女性',
    other: '其他',
    男: '男性',
    女: '女性'
  };
  return sexMap[sexType] || sexType;
}

// 格式化角色性质显示
function formatGoodMan(isGoodMan: boolean | string) {
  if (typeof isGoodMan === 'boolean') return isGoodMan ? '正面角色' : '反面角色';
  if (isGoodMan === 'other') return '中性角色';
  return String(isGoodMan);
}

// 根据关联节点获取角色信息（规范化）
function getRelatedRoleInfo(node: any): NormalizedRole | null {
  const uuid = node?.data?.roleUuid || null;
  const raw = findRoleByUuid(props.roleList, uuid);
  return raw ? normalizeRole(raw) : null;
}
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
.custom-section,
.position-section,
.related-nodes-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-title {
  font-weight: bold;
  color: #eeeeee;
  margin-bottom: 4px;
}

.info-item,
.related-info-item {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.related-node-item {
  border-top: 1px dashed #555;
  padding-top: 6px;
  margin-top: 6px;
}

.related-node-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.related-color-swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid #666;
  flex-shrink: 0;
}

.relationships {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
}

.relationship-item {
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 6px;
  border-radius: 4px;
}
</style>