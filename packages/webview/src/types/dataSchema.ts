/**
 * 统一数据格式规约
 * 用于气泡图和引用趋势图的数据结构定义
 */

// 基础项目数据结构
export interface BaseItem {
  id: string          // 唯一标识符
  label: string       // 显示名称
  count: number       // 引用次数/权重值
  group?: string      // 分组类别（可选）
  color?: string      // 自定义颜色（可选）
  metadata?: Record<string, any> // 扩展元数据（可选）
}

// 时间序列数据点
export interface TimeSeriesDataPoint {
  timestamp: string | number  // 时间戳或章节标识
  value: number              // 数值
  label?: string             // 自定义标签（可选）
}

// 完整的数据结构，包含基础信息和时间序列数据
export interface CompleteItem extends BaseItem {
  timeSeriesData?: TimeSeriesDataPoint[] // 时间序列数据（可选）
}

// 分组配置
export interface GroupConfig {
  id: string          // 分组ID
  name: string        // 分组显示名称
  color?: string      // 分组颜色（可选）
  description?: string // 分组描述（可选）
}

// 数据集配置
export interface DatasetConfig {
  title: string                 // 数据集标题
  description?: string          // 数据集描述（可选）
  groups?: GroupConfig[]        // 分组配置（可选）
  items: CompleteItem[]         // 数据项列表
  timeSeriesConfig?: {          // 时间序列配置（可选）
    label: string               // 轴标签
    unit?: string               // 单位
    startTime?: string | number // 起始时间
    endTime?: string | number   // 结束时间
  }
}

// 数据验证函数
export function validateBaseItem(item: any): item is BaseItem {
  return (
    typeof item === 'object' &&
    typeof item.id === 'string' &&
    typeof item.label === 'string' &&
    typeof item.count === 'number'
  )
}

export function validateTimeSeriesDataPoint(point: any): point is TimeSeriesDataPoint {
  return (
    typeof point === 'object' &&
    (typeof point.timestamp === 'string' || typeof point.timestamp === 'number') &&
    typeof point.value === 'number'
  )
}

export function validateCompleteItem(item: any): item is CompleteItem {
  if (!validateBaseItem(item)) return false

  const itemAsComplete = item as CompleteItem
  if (itemAsComplete.timeSeriesData) {
    return Array.isArray(itemAsComplete.timeSeriesData) &&
           itemAsComplete.timeSeriesData.every(validateTimeSeriesDataPoint)
  }

  return true
}

export function validateDatasetConfig(dataset: any): dataset is DatasetConfig {
  return (
    typeof dataset === 'object' &&
    typeof dataset.title === 'string' &&
    Array.isArray(dataset.items) &&
    dataset.items.every(validateCompleteItem)
  )
}

// 数据转换工具函数
export function convertToTimeSeriesData(points: TimeSeriesDataPoint[]): [string | number, number][] {
  return points.map(point => [point.timestamp, point.value])
}

export function generateTimeSeriesDataFromItem(
  item: BaseItem,
  chapterCount: number = 30,
  variance: number = 0.5
): TimeSeriesDataPoint[] {
  const baseValue = Math.floor(item.count / chapterCount)
  const varianceValue = baseValue * variance
  const data: TimeSeriesDataPoint[] = []

  for (let i = 1; i <= chapterCount; i++) {
    const chapterName = `第${i}章`
    const value = Math.max(0, Math.round(
      baseValue + (Math.random() - 0.5) * varianceValue * 2
    ))
    data.push({
      timestamp: chapterName,
      value,
      label: `${chapterName} - ${item.label}`
    })
  }

  return data
}
