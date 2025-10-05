import type { DatasetConfig, CompleteItem } from '../types/dataSchema'
import { generateTimeSeriesDataFromItem } from '../types/dataSchema'
import { defaultRoleDocumentAppearances } from './fileTimelineDefaultData'
import type { RoleDocumentAppearances } from '../types/fileTimelineDataFormat'

// 默认分组配置
export const defaultGroups = [
  { id: 'main-characters', name: '主要角色', color: '#a5b4fc', description: '故事中的主要角色' },
  { id: 'supporting-characters', name: '配角', color: '#fbcfe8', description: '故事中的配角角色' },
  { id: 'antagonists', name: '反派角色', color: '#fdba74', description: '故事中的反派角色' }
]

// 从角色文档出现数据转换为气泡图数据
function convertRoleAppearancesToItems(roleAppearances: RoleDocumentAppearances[]): CompleteItem[] {
  return roleAppearances.map(role => {
    // 确定角色分组
    let group = 'supporting-characters'
    if (role.roleType === '主角') {
      group = 'main-characters'
    } else if (role.roleType === '反派') {
      group = 'antagonists'
    }

    // 计算总出现次数
    const totalCount = role.documentAppearances.reduce((sum, doc) => sum + doc.count, 0)

    return {
      id: role.roleId,
      label: role.roleName,
      count: totalCount,
      group,
      metadata: {
        roleType: role.roleType,
        documentAppearances: role.documentAppearances
      }
    }
  })
}

// 基础项目数据 - 只包含角色数据
const baseItems: CompleteItem[] = convertRoleAppearancesToItems(defaultRoleDocumentAppearances)

// 为每个项目生成时间序列数据
const itemsWithTimeSeries: CompleteItem[] = baseItems.map(item => {
  let timeSeriesData = item.timeSeriesData

  // 根据文档出现次数生成时间序列数据
  if (item.metadata?.documentAppearances) {
    const documentAppearances = item.metadata.documentAppearances as any[]
    timeSeriesData = documentAppearances.map(doc => ({
      timestamp: doc.documentName,
      value: doc.count,
      label: `${item.label} 在 ${doc.documentName} 中出现 ${doc.count} 次`
    }))
  }

  return {
    ...item,
    timeSeriesData: timeSeriesData || []
  }
})

// 默认数据集配置
export const defaultDatasetConfig: DatasetConfig = {
  title: '角色引用分析',
  description: '展示各角色在不同章节中的出现次数',
  groups: defaultGroups,
  items: itemsWithTimeSeries,
  timeSeriesConfig: {
    label: '章节',
    unit: '出现次数',
    startTime: 1,
    endTime: 30
  }
}

// 简化版数据，仅包含基础信息（用于向后兼容）
export const defaultItems = baseItems

// 导出角色文档出现数据（便于直接使用）
export { defaultRoleDocumentAppearances }

// 颜色映射
export const colorMap: Record<string, string> = {
  views: '#a5b4fc',
  providers: '#fbcfe8',
  data: '#fdba74',
  infra: '#bef264',
  default: '#93c5fd'
}

// 获取项目颜色的工具函数
export function getColorForItem(item: CompleteItem): string {
  if (item.color) return item.color

  const groupConfig = defaultGroups.find(g => g.id === item.group)
  if (groupConfig?.color) return groupConfig.color

  const key = item.group || 'default'
  return colorMap[key] || colorMap.default!
}

// 生成时间序列数据的工具函数（向后兼容）
export function generateTimeSeriesData(item: CompleteItem): [string, number][] {
  if (item.timeSeriesData) {
    return item.timeSeriesData.map(point => [String(point.timestamp), point.value])
  }

  // 如果没有预生成的时间序列数据，但有文档出现数据，则使用文档出现数据
  if (item.metadata?.documentAppearances) {
    const documentAppearances = item.metadata.documentAppearances as any[]
    return documentAppearances.map(doc => [doc.documentName, doc.count])
  }

  // 最后的备选方案：动态生成，但只用于没有文档出现数据的情况
  const generatedData = generateTimeSeriesDataFromItem(item, 30, 0.5)
  return generatedData.map(point => [String(point.timestamp), point.value])
}
