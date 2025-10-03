<script setup lang="ts">
import { Position, getBezierPath, getSmoothStepPath } from '@vue-flow/core';
import { computed } from 'vue';

interface Props {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  sourceNode: any;
  targetNode: any;
  data?: {
    pathType?: string;
  };
}

const props = defineProps<Props>();

const path = computed(() => {
  if (props.sourceNode && props.targetNode) {
    const pathType = props.data?.pathType || 'bezier';
    
    if (pathType === 'bezier') {
      if (
        (props.sourcePosition === Position.Bottom && props.targetPosition === Position.Top) ||
        (props.sourcePosition === Position.Top && props.targetPosition === Position.Bottom)
      ) {
        // 水平方向的回环边
        const radiusX = 60;
        const radiusY = props.sourceY - props.targetY;

        return [`M ${props.sourceX} ${props.sourceY} A ${radiusX} ${radiusY} 0 1 0 ${props.targetX} ${props.targetY}`];
      } else if (
        (props.sourcePosition === Position.Left && props.targetPosition === Position.Right) ||
        (props.sourcePosition === Position.Right && props.targetPosition === Position.Left)
      ) {
        // 垂直方向的回环边
        const radiusX = (props.sourceX - props.targetX) * 0.6;
        const radiusY = 50;

        return [`M ${props.sourceX} ${props.sourceY} A ${radiusX} ${radiusY} 0 1 0 ${props.targetX} ${props.targetY}`];
      }
    } else if (pathType === 'smoothstep') {
      let centerX: number | undefined, centerY: number | undefined;
      if (props.sourceNode === props.targetNode) {
        if (
          (props.sourcePosition === Position.Bottom && props.targetPosition === Position.Top) ||
          (props.sourcePosition === Position.Top && props.targetPosition === Position.Bottom)
        ) {
          const source = props.sourceNode;
          centerX = props.sourceX - 40 - source.dimensions.width / 2;
          centerY = (props.sourceY + props.targetY) / 2;
        } else if (
          (props.sourcePosition === Position.Left && props.targetPosition === Position.Right) ||
          (props.sourcePosition === Position.Right && props.targetPosition === Position.Left)
        ) {
          const source = props.sourceNode;
          centerX = (props.sourceX + props.targetX) / 2;
          centerY = props.sourceY + 40 + source.dimensions.height / 2;
        }
      }

      if (centerX !== undefined && centerY !== undefined) {
        return getSmoothStepPath({
          sourcePosition: props.sourcePosition,
          targetPosition: props.targetPosition,
          centerX,
          centerY,
          sourceX: props.sourceX,
          sourceY: props.sourceY,
          targetX: props.targetX,
          targetY: props.targetY,
        });
      }
    }
  }

  // 默认使用贝塞尔曲线路径
  return getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  });
});
</script>

<script lang="ts">
export default {
  inheritAttrs: false,
};
</script>

<template>
  <path :d="path[0]" fill="none" stroke="#b1b1b7" stroke-width="2" />
</template>
