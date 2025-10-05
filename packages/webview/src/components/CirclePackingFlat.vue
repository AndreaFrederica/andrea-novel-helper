<template>
  <div ref="wrapperRef" class="cp-wrapper">
    <svg ref="svgRef" class="cp-svg">
      <g>
        <template v-for="n in nodes" :key="n.data.name + '-' + n.depth + '-' + n.x + '-' + n.y">
          <circle
            v-if="n.depth > 0"
            :cx="n.x" :cy="n.y" :r="n.r"
            :fill="colorOf(n)"
            :fill-opacity="n.children ? 0.88 : 0.95"
            :stroke="strokeColor"
            stroke-width="1"
            :style="{ cursor: n.data.item ? 'pointer' : (n.children ? 'default' : 'default') }"
            @mouseenter="onMouseEnter(n)"
            @mouseleave="onMouseLeave"
            @click="onClick(n)"
          />
          <text
            v-if="!n.children && n.r >= (minLabelRadius ?? 26)"
            :x="n.x" :y="n.y + 4"
            text-anchor="middle"
            :fill="textColor"
            font-weight="700"
            :font-size="Math.min(22, n.r * 0.38)"
            style="pointer-events:none;"
          >
            {{ n.data.name }}
          </text>
          <text
            v-if="n.children && n.depth === 1 && n.r >= 40"
            :x="n.x" :y="n.y - n.r + 14"
            text-anchor="middle"
            :fill="groupLabelColor"
            font-size="12"
            font-weight="600"
            style="pointer-events:none;"
          >
            {{ n.data.name }}
          </text>
        </template>
      </g>
    </svg>
    <div
      v-if="hoverNode && hoverNode.data.item"
      class="cp-tip"
      :style="{ left: (hoverNode.x + 12) + 'px', top: (hoverNode.y + 12) + 'px' }"
    >
      <div class="cp-tip-title">{{ hoverNode.data.item.label }}</div>
      <div class="cp-tip-sub">引用次数：{{ hoverNode.data.item.count }}</div>
      <div v-if="hoverNode.data.item.group" class="cp-tip-sub">分组：{{ hoverNode.data.item.group }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { hierarchy, pack } from 'd3-hierarchy'
import type { BaseItem } from '../types/dataSchema'

type Item = BaseItem

const props = defineProps<{
  items: Item[]
  padding?: number
  minLabelRadius?: number
  palette?: string[]
}>()
const emit = defineEmits<{
  (e: 'nodeClick', item: Item): void
  (e: 'nodeHover', item: Item | null): void
}>()

const wrapperRef = ref<HTMLDivElement | null>(null)
const svgRef = ref<SVGSVGElement | null>(null)
const width = ref(800)
const height = ref(600)
let ro: ResizeObserver | null = null

const defaultPalette = [
  '#a5b4fc', '#fbcfe8', '#fdba74', '#bef264', '#93c5fd',
  '#fca5a5', '#fde68a', '#86efac', '#c4b5fd', '#fcd34d'
]

// 从 CSS 变量获取颜色
const textColor = computed(() => {
  if (typeof window === 'undefined') return '#0f172a'
  const style = getComputedStyle(document.documentElement)
  return style.getPropertyValue('#0f172a')
})

const groupLabelColor = computed(() => {
  if (typeof window === 'undefined') return 'rgba(255,255,255,0.8)'
  const style = getComputedStyle(document.documentElement)
  // return style.getPropertyValue('--vscode-descriptionForeground') || 'rgba(255,255,255,0.8)'
  return style.getPropertyValue('rgba(255,255,255,0.8)')
})

const strokeColor = computed(() => {
  if (typeof window === 'undefined') return 'rgba(0,0,0,0.25)'
  const style = getComputedStyle(document.documentElement)
  const borderColor = style.getPropertyValue('--vscode-panel-border') || 'rgba(128,128,128,0.35)'
  return borderColor
})

type HNode = {
  name: string
  value?: number
  item?: Item
  children?: HNode[]
  group?: string
}

// 根节点数据
const rootData = computed<HNode>(() => {
  if (!props.items?.length) return { name: 'root', children: [] }
  const groups = new Map<string, HNode>()
  const children: HNode[] = []
  for (const it of props.items) {
    if (it.group) {
      if (!groups.has(it.group)) {
        groups.set(it.group, { name: it.group, group: it.group, children: [] })
      }
      groups.get(it.group)!.children!.push({ name: it.label, value: Math.max(0, it.count), item: it })
    } else {
      children.push({ name: it.label, value: Math.max(0, it.count), item: it })
    }
  }
  const groupNodes = Array.from(groups.values())
  const hasGroup = groupNodes.length > 0
  return {
    name: 'root',
    children: hasGroup ? [...groupNodes, ...(children.length ? [{ name: 'Ungrouped', group: '_', children }] : [])] : children
  }
})

type PackedNode = any
const nodes = ref<PackedNode[]>([])

function layout() {
  const pad = props.padding ?? 3
  const root = hierarchy(rootData.value)
    .sum((d: any) => d.value ?? 0)
    .sort((a: any, b: any) => (b.value ?? 0) - (a.value ?? 0))

  const p = pack().size([width.value, height.value]).padding(pad)
  nodes.value = (p(root) as any).descendants()
}

const hoverNode = ref<any>(null)
function onMouseEnter(n: PackedNode) { hoverNode.value = n; if (n.data.item) emit('nodeHover', n.data.item) }
function onMouseLeave() { hoverNode.value = null; emit('nodeHover', null) }
function onClick(n: PackedNode) { if (n.data.item) emit('nodeClick', n.data.item) }

// 指定返回 string，避免 undefined 情况
function colorOf(n: any): string {
  const pal: string[] = props.palette ?? defaultPalette
  if (n.depth === 0) return 'transparent'
  if (n.children) {
    const idx = Math.abs(hash(n.data.group ?? n.data.name)) % pal.length
    return pal[idx]!
  } else {
    const parent = n.parent
    if (parent) {
      const idx = Math.abs(hash(parent.data.group ?? parent.data.name)) % pal.length
      return pal[idx]!
    }
    return pal[0]!
  }
}
function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i); return h | 0 }

function measure() {
  const el = wrapperRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  width.value = Math.max(200, rect.width)
  height.value = Math.max(200, rect.height)
  layout()
  void nextTick(() => { svgRef.value?.setAttribute('viewBox', `0 0 ${width.value} ${height.value}`) })
}

onMounted(() => { measure(); ro = new ResizeObserver(measure); if (wrapperRef.value) ro.observe(wrapperRef.value) })
onBeforeUnmount(() => { ro?.disconnect(); ro = null })
watch(() => [props.items, props.padding], layout, { deep: true })
watch([width, height, rootData], layout)
</script>

<style scoped>
.cp-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--vscode-editor-background, #1e1e1e);
  border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
  overflow: hidden;
}
.cp-svg { width: 100%; height: 100%; display: block; }
.cp-tip {
  position: absolute;
  padding: 8px 10px;
  background: var(--vscode-editorHoverWidget-background, rgba(37,37,38,0.95));
  color: var(--vscode-editorHoverWidget-foreground, #cccccc);
  border: 1px solid var(--vscode-editorHoverWidget-border, rgba(69,69,69,1));
  border-radius: 6px;
  font-size: 12px;
  pointer-events: none;
  box-shadow: 0 4px 12px var(--vscode-widget-shadow, rgba(0,0,0,0.36));
  backdrop-filter: blur(4px);
}
.cp-tip-title { font-weight: 700; margin-bottom: 2px; }
.cp-tip-sub { opacity: 0.85; }
</style>
