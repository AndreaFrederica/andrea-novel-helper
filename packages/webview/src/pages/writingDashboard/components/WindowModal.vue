<template>
  <Teleport to="body">
    <Transition name="window-modal">
      <div
        v-if="modelValue"
        class="window-modal-wrapper"
        :style="wrapperStyle"
      >
        <!-- 遮罩层（仅模态时显示） -->
        <div
          v-if="modal"
          class="window-modal-mask"
          @click="onMaskClick"
        />
        <!-- 弹窗窗体 -->
        <div
          ref="modalRef"
          class="window-modal"
          :class="{ maximized, active: isActive }"
          :style="modalStyle"
          @pointerdown.stop="onModalPointerDown"
        >
          <div
            class="window-modal-titlebar"
            :class="{ draggable: !maximized }"
            @pointerdown.stop="startDrag"
          >
            <div class="modal-title">
              <q-icon v-if="icon" :name="icon" size="16px" />
              <span>{{ title }}</span>
            </div>
            <div class="modal-actions" @pointerdown.stop="activateLayer">
              <q-btn
                v-if="maximizable && !maximized"
                dense
                flat
                round
                icon="fullscreen"
                size="sm"
                @click="maximized = true"
              />
              <q-btn
                v-if="maximizable && maximized"
                dense
                flat
                round
                icon="fullscreen_exit"
                size="sm"
                @click="maximized = false"
              />
              <q-btn
                v-if="closable !== false"
                dense
                flat
                round
                icon="close"
                size="sm"
                @click="close"
              />
            </div>
          </div>
          <div class="window-modal-body" :class="{ 'no-padding': noPadding }">
            <slot />
          </div>
          <div v-if="$slots.footer" class="window-modal-footer">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{
  modelValue: boolean
  title?: string
  icon?: string
  x?: number
  y?: number
  width?: number
  height?: number
  ownerId?: string
  modalId?: string
  modal?: boolean
  persistent?: boolean
  closable?: boolean
  maximizable?: boolean
  noPadding?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:maximized': [value: boolean]
  close: []
}>()

const layerMgr = inject<{
  activateFloating(id: string): void
  deactivateFloating(id: string): void
  activateModal(modalId: string, ownerId: string): void
  deactivateModal(modalId: string): string | undefined
  activateWindow(id: string): void
  getCssZ(id: string): number
  getTopId?(): string | undefined
  layerVersion?: { value: number }
}>('layerManager') ?? null

const DEFAULT_WIDTH = 420
const resolvedModalId = computed(() => props.modalId ?? 'modal')
const hasModalOwner = computed(() => !!props.modal && !!props.ownerId)
const TITLEBAR_H = 36
const VIEWPORT_MARGIN = 20
const ESTIMATED_AUTO_HEIGHT = 300

const visible = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v)
})

const maximized = ref(false)

const posX = ref(0)
const posY = ref(0)
const dragState = ref<{ active: boolean; sx: number; sy: number; px: number; py: number } | null>(null)
const modalRef = ref<HTMLElement | null>(null)
const measuredModalHeight = ref(0)
let modalResizeObserver: ResizeObserver | null = null
let taskbarResizeObserver: ResizeObserver | null = null

function getUsableViewportRect() {
  const taskbar = document.querySelector<HTMLElement>('.dashboard-taskbar')
  const taskbarRect = taskbar?.getBoundingClientRect()
  const taskbarVisibleAtBottom = !!taskbarRect &&
    taskbarRect.height > 0 &&
    taskbarRect.width > 0 &&
    taskbarRect.top < window.innerHeight &&
    taskbarRect.bottom > 0

  return {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: taskbarVisibleAtBottom ? Math.max(0, taskbarRect.top) : window.innerHeight,
  }
}

function getViewportSize() {
  const rect = getUsableViewportRect()
  return {
    width: Math.max(280 + VIEWPORT_MARGIN * 2, rect.right - rect.left),
    height: Math.max(120 + VIEWPORT_MARGIN * 2, rect.bottom - rect.top)
  }
}

function fitModalSize() {
  const viewport = getViewportSize()
  const maxW = viewport.width - VIEWPORT_MARGIN * 2
  const maxH = viewport.height - VIEWPORT_MARGIN * 2
  const measuredHeight = measuredModalHeight.value > 0
    ? Math.min(measuredModalHeight.value, maxH)
    : undefined
  return {
    width: Math.max(280, Math.min(props.width ?? DEFAULT_WIDTH, maxW)),
    height: props.height === undefined ? undefined : Math.max(120, Math.min(props.height, maxH)),
    placementHeight: Math.max(120, measuredHeight ?? Math.min(props.height ?? ESTIMATED_AUTO_HEIGHT, maxH)),
    maxHeight: maxH
  }
}

function clampModalPosition(x: number, y: number) {
  const usableRect = getUsableViewportRect()
  const size = fitModalSize()
  const minX = usableRect.left + VIEWPORT_MARGIN
  const minY = usableRect.top + VIEWPORT_MARGIN
  const maxX = Math.max(minX, usableRect.right - size.width - VIEWPORT_MARGIN)
  const maxY = Math.max(minY, usableRect.bottom - size.placementHeight - VIEWPORT_MARGIN)
  return {
    x: Math.min(Math.max(minX, x), maxX),
    y: Math.min(Math.max(minY, y), maxY)
  }
}

/* 计算默认居中位置 */
function calcCenter() {
  const usableRect = getUsableViewportRect()
  const size = fitModalSize()
  return {
    x: Math.max(usableRect.left + VIEWPORT_MARGIN, usableRect.left + (usableRect.right - usableRect.left - size.width) / 2),
    y: Math.max(usableRect.top + VIEWPORT_MARGIN, usableRect.top + (usableRect.bottom - usableRect.top - size.placementHeight) / 2)
  }
}

function measureModalHeight() {
  if (!modalRef.value) return
  measuredModalHeight.value = modalRef.value.getBoundingClientRect().height
}

function normalizeModalPosition() {
  const nextPos = clampModalPosition(posX.value, posY.value)
  posX.value = nextPos.x
  posY.value = nextPos.y
}

function observeModalSize() {
  modalResizeObserver?.disconnect()
  modalResizeObserver = null
  if (!modalRef.value) return
  modalResizeObserver = new ResizeObserver(() => {
    measureModalHeight()
    normalizeModalPosition()
  })
  modalResizeObserver.observe(modalRef.value)
}

function observeTaskbarSafeArea() {
  taskbarResizeObserver?.disconnect()
  taskbarResizeObserver = null
  const taskbar = document.querySelector<HTMLElement>('.dashboard-taskbar')
  if (!taskbar) return
  taskbarResizeObserver = new ResizeObserver(() => {
    normalizeModalPosition()
  })
  taskbarResizeObserver.observe(taskbar)
}

async function settleModalPosition() {
  await nextTick()
  measureModalHeight()
  normalizeModalPosition()
  observeModalSize()
  observeTaskbarSafeArea()
}

/* 打开时初始化位置 + 层级激活 */
watch(() => props.modelValue, (v) => {
  if (v) {
    maximized.value = false
    measuredModalHeight.value = 0
    let nextPos: { x: number; y: number }
    if (props.x !== undefined && props.y !== undefined) {
      nextPos = clampModalPosition(props.x, props.y)
    } else {
      nextPos = clampModalPosition(calcCenter().x, calcCenter().y)
    }
    posX.value = nextPos.x
    posY.value = nextPos.y
    void settleModalPosition()
    activateLayer()
  } else {
    modalResizeObserver?.disconnect()
    modalResizeObserver = null
    taskbarResizeObserver?.disconnect()
    taskbarResizeObserver = null
    const owner = deactivateLayer()
    if (hasModalOwner.value && owner && layerMgr) {
      layerMgr.activateWindow(owner)
    }
  }
})

function close() {
  visible.value = false
  emit('close')
}

function onMaskClick() {
  if (!props.persistent) close()
}

function activateLayer() {
  if (!layerMgr) return
  if (hasModalOwner.value && props.ownerId) {
    layerMgr.activateModal(resolvedModalId.value, props.ownerId)
    return
  }
  layerMgr.activateFloating(resolvedModalId.value)
}

function deactivateLayer() {
  if (!layerMgr) return undefined
  if (hasModalOwner.value) {
    return layerMgr.deactivateModal(resolvedModalId.value)
  }
  layerMgr.deactivateFloating(resolvedModalId.value)
  return undefined
}

function onModalPointerDown() {
  activateLayer()
}

/* 拖动 */
function startDrag(e: PointerEvent) {
  activateLayer()
  if (maximized.value) return
  dragState.value = {
    active: true,
    sx: e.clientX,
    sy: e.clientY,
    px: posX.value,
    py: posY.value
  }
  window.addEventListener('pointermove', onDrag)
  window.addEventListener('pointerup', stopDrag)
}

function onDrag(e: PointerEvent) {
  const s = dragState.value
  if (!s?.active) return
  const nextPos = clampModalPosition(s.px + e.clientX - s.sx, s.py + e.clientY - s.sy)
  posX.value = nextPos.x
  posY.value = nextPos.y
}

function stopDrag() {
  if (dragState.value) dragState.value.active = false
  dragState.value = null
  window.removeEventListener('pointermove', onDrag)
  window.removeEventListener('pointerup', stopDrag)
}

/* ESC 关闭 */
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.closable !== false && !props.persistent) {
    close()
  }
}

watch(visible, (v) => {
  if (v) {
    window.addEventListener('keydown', onKeyDown)
  } else {
    window.removeEventListener('keydown', onKeyDown)
  }
})

function onViewportResize() {
  if (!visible.value || maximized.value) return
  measureModalHeight()
  const nextPos = clampModalPosition(posX.value, posY.value)
  posX.value = nextPos.x
  posY.value = nextPos.y
}

onMounted(() => {
  window.addEventListener('resize', onViewportResize)
})

onBeforeUnmount(() => {
  modalResizeObserver?.disconnect()
  modalResizeObserver = null
  taskbarResizeObserver?.disconnect()
  taskbarResizeObserver = null
  window.removeEventListener('resize', onViewportResize)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('pointermove', onDrag)
  window.removeEventListener('pointerup', stopDrag)
  if (visible.value && layerMgr) {
    const owner = deactivateLayer()
    if (hasModalOwner.value && owner) layerMgr.activateWindow(owner)
  }
})

/* 样式 */
const z = computed(() => {
  void layerMgr?.layerVersion?.value
  return layerMgr?.getCssZ(resolvedModalId.value) ?? 1000
})

const isActive = computed(() => {
  void layerMgr?.layerVersion?.value
  return layerMgr?.getTopId?.() === resolvedModalId.value || !layerMgr
})

const wrapperStyle = computed(() => ({
  position: 'fixed' as const,
  inset: 0,
  zIndex: z.value,
  pointerEvents: 'none' as const
}))

const modalStyle = computed(() => {
  if (maximized.value) {
    const usableRect = getUsableViewportRect()
    return {
      position: 'absolute' as const,
      left: `${usableRect.left + VIEWPORT_MARGIN}px`,
      top: `${usableRect.top + VIEWPORT_MARGIN}px`,
      right: `${Math.max(VIEWPORT_MARGIN, window.innerWidth - usableRect.right + VIEWPORT_MARGIN)}px`,
      bottom: `${Math.max(VIEWPORT_MARGIN, window.innerHeight - usableRect.bottom + VIEWPORT_MARGIN)}px`,
      width: 'auto',
      height: 'auto',
      zIndex: z.value + 1
    }
  }
  const size = fitModalSize()
  const pos = clampModalPosition(posX.value, posY.value)
  return {
    position: 'absolute' as const,
    left: `${pos.x}px`,
    top: `${pos.y}px`,
    width: `${size.width}px`,
    height: size.height ? `${size.height}px` : 'auto',
    maxHeight: `${size.maxHeight}px`,
    zIndex: z.value + 1
  }
})
</script>

<style scoped>
.window-modal-wrapper {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
}

.window-modal-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  pointer-events: auto;
}

.window-modal {
  display: grid;
  grid-template-rows: auto 1fr auto;
  border: 1px solid var(--dash-window-border);
  border-radius: 10px;
  background: var(--dash-window-bg);
  box-shadow: 0 12px 30px var(--dash-shadow);
  overflow: hidden;
  pointer-events: auto;
  backdrop-filter: blur(12px);
}

.window-modal.active {
  border-color: var(--dash-accent);
  box-shadow: 0 20px 50px var(--dash-shadow-active);
}

.window-modal-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 10px 0 14px;
  height: v-bind(TITLEBAR_H + 'px');
  border-bottom: 1px solid var(--dash-titlebar-border);
  background: var(--dash-titlebar-bg);
  user-select: none;
}

.window-modal-titlebar.draggable {
  cursor: move;
}

.modal-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--dash-title-fg);
  font-size: 13px;
  font-weight: 700;
  min-width: 0;
}

.modal-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.modal-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 2px;
}

.window-modal-body {
  min-height: 0;
  padding: 14px;
  overflow: auto;
}

.window-modal-body.no-padding {
  padding: 0;
}

.window-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--dash-titlebar-border);
}

/* 动画 */
.window-modal-enter-active,
.window-modal-leave-active {
  transition: opacity 0.2s ease;
}

.window-modal-enter-active .window-modal,
.window-modal-leave-active .window-modal {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.window-modal-enter-from,
.window-modal-leave-to {
  opacity: 0;
}

.window-modal-enter-from .window-modal,
.window-modal-leave-to .window-modal {
  transform: scale(0.94);
  opacity: 0;
}
</style>
