/**
 * 窗口层级管理器（Window Manager Layer Manager）
 *
 * 职责：
 * 1. 内部 layer 分配 —— 紧凑的整数序列（0, 1, 2, ...）
 * 2. 回收 —— 窗口关闭时回收 layer，优先复用
 * 3. 压缩（compact）—— 当 layer 分布稀疏时重新整理为紧凑序列
 * 4. CSS z-index 映射 —— 内部 layer → 外部渲染层级（带间隔，预留系统空间）
 *
 * 设计原则：
 * - DashboardWindow.z 存储的是「内部 layer 索引」，不是 CSS z-index
 * - CSS z-index 通过 toCssZ() 映射得到，留间隔便于中间插入
 */

export interface WindowLayerState {
  /** 窗口 ID → 内部 layer */
  layers: Record<string, number>
  /** 下一个可用 layer（当回收池为空时使用） */
  nextLayer: number
  /** 回收的 layer 列表 */
  recycled: number[]
  /** 弹窗 ID → 所属窗口 ID */
  modalOwner?: Record<string, string>
}

export class WindowLayerManager {
  private layers = new Map<string, number>()
  private transientLayers = new Set<string>()
  private modalOwner = new Map<string, string>()
  private nextLayer = 0
  private recycled: number[] = []

  /** CSS z-index 步进间隔 */
  private readonly Z_STEP = 10
  /** 为系统组件预留的 z-index 空间 */
  private readonly SYSTEM_RESERVED = 1000
  /** 触发 compact 的 layer 值阈值 */
  private readonly COMPACT_THRESHOLD = 500
  /** 触发 compact 的「稀疏度」阈值（最大 layer / 窗口数） */
  private readonly SPARSE_RATIO = 3

  /** 从持久化状态恢复 */
  static restore(state: WindowLayerState): WindowLayerManager {
    const mgr = new WindowLayerManager()
    const persistedTransientIds = new Set(Object.keys(state.modalOwner ?? {}))
    for (const [id, layer] of Object.entries(state.layers)) {
      if (persistedTransientIds.has(id)) continue
      mgr.layers.set(id, layer)
    }
    mgr.nextLayer = state.nextLayer
    mgr.recycled = [...state.recycled]
    return mgr
  }

  /** 序列化为可持久化的状态 */
  serialize(): WindowLayerState {
    const layers: Record<string, number> = {}
    for (const [id, layer] of this.layers) {
      if (this.transientLayers.has(id)) continue
      layers[id] = layer
    }
    return {
      layers,
      nextLayer: Math.max(0, ...Object.values(layers).map(layer => layer + 1)),
      recycled: []
    }
  }

  /** 注册一批现有窗口（初始化用），按传入顺序分配 layer */
  registerAll(windowIds: string[]): void {
    for (const id of windowIds) {
      if (!this.layers.has(id)) {
        this.layers.set(id, this.allocLayer())
      }
    }
  }

  /** 激活/提升窗口层级（点击、拖拽、新建时调用） */
  activate(id: string): number {
    // 如果已经是最高层，不需要重新分配，避免无意义地拉大 layer 序列
    const old = this.layers.get(id)
    if (old !== undefined && old === this.getMaxLayer()) {
      this.raiseOwnedModals(id)
      return this.toCssZ(old)
    }

    // 如果已存在，先释放旧 layer。置顶不能复用回收池，否则会拿回刚释放的低 layer。
    // 这里直接分配 max + 1，保证激活窗口一定浮到最上层。
    if (old !== undefined) {
      this.layers.delete(id)
      this.recycled.push(old)
    }
    const layer = this.allocTopLayer()
    this.layers.set(id, layer)

    this.raiseOwnedModals(id)

    // 检查是否需要 compact
    this.maybeCompact()

    return this.toCssZ(this.layers.get(id) ?? layer)
  }

  /** 移除窗口/弹窗（关闭时调用） */
  remove(id: string): void {
    this.transientLayers.delete(id)
    this.modalOwner.delete(id)
    const layer = this.layers.get(id)
    if (layer !== undefined) {
      this.layers.delete(id)
      this.recycled.push(layer)
      this.maybeCompact()
    }
  }

  /** 获取窗口当前的 CSS z-index */
  getCssZ(id: string): number {
    const layer = this.layers.get(id)
    return layer !== undefined ? this.toCssZ(layer) : 1
  }

  /** 获取窗口当前的内部 layer（用于持久化到 DashboardWindow.z） */
  getLayer(id: string): number | undefined {
    return this.layers.get(id)
  }

  /** 获取当前最大 layer */
  getMaxLayer(): number {
    let max = -1
    for (const layer of this.layers.values()) {
      max = Math.max(max, layer)
    }
    return max
  }

  /** 获取当前最上层窗口/弹窗 ID */
  getTopId(): string | undefined {
    let topId: string | undefined
    let topLayer = -1
    for (const [id, layer] of this.layers) {
      if (layer > topLayer) {
        topLayer = layer
        topId = id
      }
    }
    return topId
  }

  /** 获取当前所有窗口中最大的 CSS z-index */
  getMaxCssZ(): number {
    return this.toCssZ(this.getMaxLayer())
  }

  /** 当前窗口/弹窗总数 */
  get count(): number {
    return this.layers.size
  }

  /* ── 弹窗支持 ─────────────────────────── */

  /** 激活非模态浮动窗口：行为和普通窗口一样，但不持久化到布局层级。 */
  activateFloating(id: string): number {
    this.transientLayers.add(id)
    this.modalOwner.delete(id)
    return this.activate(id)
  }

  /** 关闭非模态浮动窗口。 */
  deactivateFloating(id: string): void {
    this.remove(id)
  }

  /** 激活模态弹窗：注册到层级管理器并给予最高层级。 */
  activateModal(modalId: string, ownerId: string): number {
    this.transientLayers.add(modalId)
    this.modalOwner.set(modalId, ownerId)

    const old = this.layers.get(modalId)
    if (old !== undefined && old === this.getMaxLayer()) {
      return this.toCssZ(old)
    }

    if (old !== undefined) {
      this.layers.delete(modalId)
      this.recycled.push(old)
    }

    const layer = this.allocTopLayer()
    this.layers.set(modalId, layer)
    this.maybeCompact()
    return this.toCssZ(this.layers.get(modalId) ?? layer)
  }

  /** 关闭弹窗：从层级管理器移除，返回所属窗口 ID */
  deactivateModal(modalId: string): string | undefined {
    const owner = this.modalOwner.get(modalId)
    this.modalOwner.delete(modalId)
    this.remove(modalId)
    return owner
  }

  /** 获取弹窗所属窗口 */
  getOwner(modalId: string): string | undefined {
    return this.modalOwner.get(modalId)
  }

  /** ── 内部方法 ───────────────────────────── */

  private allocLayer(): number {
    // 优先使用回收的 layer
    if (this.recycled.length > 0) {
      // 弹出最小的，保持 compact 后的顺序感
      this.recycled.sort((a, b) => a - b)
      return this.recycled.shift()!
    }
    return this.nextLayer++
  }

  private allocTopLayer(): number {
    const layer = this.getMaxLayer() + 1
    this.nextLayer = Math.max(this.nextLayer, layer + 1)
    this.recycled = this.recycled.filter(item => item !== layer)
    return layer
  }

  private raiseOwnedModals(ownerId: string): void {
    for (const [modalId, currentOwnerId] of this.modalOwner) {
      if (currentOwnerId !== ownerId || !this.layers.has(modalId)) continue
      const old = this.layers.get(modalId)
      if (old !== undefined) {
        this.layers.delete(modalId)
        this.recycled.push(old)
      }
      this.layers.set(modalId, this.allocTopLayer())
    }
  }

  private toCssZ(layer: number): number {
    // 映射公式：内部 layer → CSS z-index
    // 间隔 = Z_STEP，为系统组件预留 SYSTEM_RESERVED 以上空间
    return (layer + 1) * this.Z_STEP
  }

  /** 检查是否需要 compact，必要时执行 */
  private maybeCompact(): void {
    if (this.layers.size === 0) {
      // 全部清空，重置
      this.nextLayer = 0
      this.recycled = []
      return
    }

    const maxLayer = this.getMaxLayer()

    // 触发条件1：最大 layer 超过阈值
    if (maxLayer >= this.COMPACT_THRESHOLD) {
      this.compact()
      return
    }

    // 触发条件2：稀疏度太高（最大 layer / 窗口数 > 阈值）
    const sparseRatio = maxLayer / this.layers.size
    if (sparseRatio > this.SPARSE_RATIO && maxLayer > 20) {
      this.compact()
      return
    }
  }

  /**
   * 压缩（compact）：将当前所有窗口的 layer 重新整理为 0, 1, 2, ...
   * 保持现有的相对顺序不变
   */
  compact(): void {
    if (this.layers.size === 0) {
      this.nextLayer = 0
      this.recycled = []
      return
    }

    // 按当前 layer 排序，保持堆叠顺序
    const entries = Array.from(this.layers.entries())
    entries.sort((a, b) => a[1] - b[1])

    // 重新分配为紧凑的 0, 1, 2, ...
    this.layers.clear()
    let newLayer = 0
    for (const [id] of entries) {
      this.layers.set(id, newLayer++)
    }

    this.nextLayer = newLayer
    this.recycled = []
  }
}

/** localStorage key */
const LS_LAYER_KEY = 'anh-dashboard-layers'

/** 从 localStorage 恢复层级管理器 */
export function loadLayerManager(): WindowLayerManager {
  try {
    const raw = localStorage.getItem(LS_LAYER_KEY)
    if (raw) {
      const state = JSON.parse(raw) as WindowLayerState
      return WindowLayerManager.restore(state)
    }
  } catch { /* ignore */ }
  return new WindowLayerManager()
}

/** 保存层级管理器到 localStorage */
export function saveLayerManager(mgr: WindowLayerManager): void {
  try {
    localStorage.setItem(LS_LAYER_KEY, JSON.stringify(mgr.serialize()))
  } catch { /* ignore */ }
}
