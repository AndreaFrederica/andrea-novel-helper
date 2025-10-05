import type { FileTimelineData, FileTimelineItem, FileTimelineSequence, RoleDocumentAppearances, DocumentRoleUsage, RoleUsageEntry } from '../types/fileTimelineDataFormat'
import { convertRoleUsageToDocumentAppearances } from '../types/fileTimelineDataFormat'

// 定义后端角色使用文档条目类型（避免直接导入后端文件）
interface BackendRoleUsageDocEntry {
  uri: string;
  fsPath?: string;
  version: number;
  updatedAt: number;
  hash: string;
  roles: BackendRoleUsageEntry[];
}

interface BackendRoleUsageEntry {
  key: string;
  name: string;
  type?: string;
  occurrences: number;
  ranges: [number, number, number, number][];
  sourcePath?: string;
  uuid?: string;
}

/**
 * 从后端字数统计数据转换为文件时间线数据
 * @param wordCountData 后端字数统计数据
 * @param roleUsageData 后端角色使用数据
 * @returns 文件时间线数据
 */
export function convertFromBackendData(
  wordCountData: any[],
  roleUsageData?: BackendRoleUsageDocEntry[]
): FileTimelineData {
  // 转换文件数据
  const files: FileTimelineItem[] = wordCountData.map(item => {
    // 检查是否是目录
    const isDirectory = item.collapsibleState !== undefined && item.collapsibleState !== 0

    return {
      id: item.id || item.resourceUri?.fsPath || Math.random().toString(36).substr(2, 9),
      name: item.label || item.resourceUri?.fsPath?.split('/').pop() || 'Unknown',
      path: item.resourceUri?.fsPath || item.path || '',
      wordCount: item.description ? extractWordCount(item.description) : (item.stats?.total || 0),
      isDirectory,
      orderIndex: item.orderIndex,
      lastModified: item.lastModified,
      created: item.created,
      metadata: {
        resourceUri: item.resourceUri,
        collapsibleState: item.collapsibleState,
        stats: item.stats,
        // 保留原始数据以备后用
        originalData: item
      }
    }
  })

  // 创建文件时间线序列
  const sequence: FileTimelineSequence = {
    title: '小说章节时间线',
    description: '展示小说各章节的写作进度和字数统计',
    sortBy: 'order',
    sortOrder: 'asc',
    files
  }

  // 转换角色使用数据
  let roleAppearances: RoleDocumentAppearances[] = []
  let documentRoleUsages: DocumentRoleUsage[] = []

  if (roleUsageData && roleUsageData.length > 0) {
    // 转换为我们的文档角色使用格式
    documentRoleUsages = roleUsageData.map((doc): DocumentRoleUsage => ({
      uri: doc.uri,
      fsPath: doc.fsPath || '',
      version: doc.version,
      updatedAt: doc.updatedAt,
      hash: doc.hash,
      roles: doc.roles.map((role: BackendRoleUsageEntry): RoleUsageEntry => {
        const roleEntry: any = {
          key: role.key,
          name: role.name,
          occurrences: role.occurrences,
          ranges: role.ranges
        }

        // 只有当type存在时才添加
        if (role.type !== undefined) {
          roleEntry.type = role.type
        }

        // 只有当sourcePath存在时才添加
        if (role.sourcePath !== undefined) {
          roleEntry.sourcePath = role.sourcePath
        }

        // 只有当uuid存在时才添加
        if (role.uuid !== undefined) {
          roleEntry.uuid = role.uuid
        }

        return roleEntry as RoleUsageEntry
      })
    }))

    // 转换为角色文档出现统计
    roleAppearances = convertRoleUsageToDocumentAppearances(documentRoleUsages, files)
  }

  // 计算元数据
  const totalWordCount = files.reduce((sum, file) => sum + file.wordCount, 0)
  const totalFiles = files.length

  const result: FileTimelineData = {
    sequence,
    metadata: {
      totalWordCount,
      totalFiles,
      lastUpdated: new Date().toISOString()
    }
  }

  if (roleAppearances.length > 0) {
    result.roleAppearances = roleAppearances
  }

  if (documentRoleUsages.length > 0) {
    result.documentRoleUsages = documentRoleUsages
  }

  return result
}

/**
 * 从描述字符串中提取字数
 * @param description 描述字符串，可能包含格式化后的字数
 * @returns 字数
 */
function extractWordCount(description: string): number {
  if (!description) return 0

  // 尝试从括号中提取字数
  const match = description.match(/\(([\d,]+)\)/)
  if (match && match[1]) {
    return parseInt(match[1].replace(/,/g, ''), 10)
  }

  // 尝试从描述中直接提取数字
  const numberMatch = description.match(/(\d+)/)
  if (numberMatch && numberMatch[1]) {
    return parseInt(numberMatch[1], 10)
  }

  return 0
}

/**
 * 将文件时间线数据转换为后端兼容格式
 * @param fileTimelineData 文件时间线数据
 * @returns 后端兼容的数据格式
 */
export function convertToBackendFormat(fileTimelineData: FileTimelineData): {
  files: any[]
  roleUsages?: any[]
} {
  // 转换文件数据
  const files = fileTimelineData.sequence.files.map(file => ({
    id: file.id,
    label: file.name,
    resourceUri: { fsPath: file.path },
    description: `(${file.wordCount.toLocaleString()})`,
    wordCount: file.wordCount,
    isDirectory: file.isDirectory,
    orderIndex: file.orderIndex,
    lastModified: file.lastModified,
    created: file.created,
    stats: {
      total: file.wordCount,
      cjkChars: Math.floor(file.wordCount * 0.8), // 估算
      asciiChars: Math.floor(file.wordCount * 0.2), // 估算
      words: Math.floor(file.wordCount * 0.6), // 估算
      nonWSChars: file.wordCount // 估算
    },
    ...file.metadata
  }))

  // 转换角色使用数据
  let roleUsages: any[] | undefined
  if (fileTimelineData.documentRoleUsages) {
    roleUsages = fileTimelineData.documentRoleUsages.map(doc => ({
      uri: doc.uri,
      fsPath: doc.fsPath,
      version: doc.version,
      updatedAt: doc.updatedAt,
      hash: doc.hash,
      roles: doc.roles.map(role => ({
        key: role.key,
        name: role.name,
        type: role.type,
        occurrences: role.occurrences,
        ranges: role.ranges,
        sourcePath: role.sourcePath,
        uuid: role.uuid
      }))
    }))
  }

  const result: { files: any[], roleUsages?: any[] } = { files }

  if (roleUsages && roleUsages.length > 0) {
    result.roleUsages = roleUsages
  }

  return result
}

/**
 * 合并两个文件时间线数据
 * @param data1 第一个数据
 * @param data2 第二个数据
 * @returns 合并后的数据
 */
export function mergeFileTimelineData(data1: FileTimelineData, data2: FileTimelineData): FileTimelineData {
  // 合并文件列表，去重（基于路径）
  const fileMap = new Map<string, FileTimelineItem>()
  data1.sequence.files.forEach(file => fileMap.set(file.path, file))
  data2.sequence.files.forEach(file => {
    if (!fileMap.has(file.path)) {
      fileMap.set(file.path, file)
    }
  })

  // 合并角色出现数据，去重（基于角色ID）
  const roleMap = new Map<string, RoleDocumentAppearances>()
  if (data1.roleAppearances) {
    data1.roleAppearances.forEach(role => roleMap.set(role.roleId, role))
  }
  if (data2.roleAppearances) {
    data2.roleAppearances.forEach(role => {
      if (!roleMap.has(role.roleId)) {
        roleMap.set(role.roleId, role)
      } else {
        // 合并文档出现数据
        const existingRole = roleMap.get(role.roleId)!
        const documentMap = new Map<string, number>()

        // 添加现有角色的文档出现数据
        existingRole.documentAppearances.forEach(doc => {
          documentMap.set(doc.documentId, doc.count)
        })

        // 添加新角色的文档出现数据
        role.documentAppearances.forEach(doc => {
          const existingCount = documentMap.get(doc.documentId) || 0
          documentMap.set(doc.documentId, existingCount + doc.count)
        })

        // 更新现有角色的文档出现数据
        existingRole.documentAppearances = Array.from(documentMap.entries()).map(([documentId, count]) => {
          // 找到对应的文档信息
          const docInfo = existingRole.documentAppearances.find(d => d.documentId === documentId) ||
                         role.documentAppearances.find(d => d.documentId === documentId)

          const result: any = {
            documentId,
            documentName: docInfo?.documentName || 'Unknown',
            count
          }

          // 只有当documentUri存在时才添加
          if (docInfo?.documentUri !== undefined) {
            result.documentUri = docInfo.documentUri
          }

          // 只有当documentPath存在时才添加
          if (docInfo?.documentPath !== undefined) {
            result.documentPath = docInfo.documentPath
          }

          return result
        })
      }
    })
  }

  // 计算合并后的元数据
  const mergedFiles = Array.from(fileMap.values())
  const totalWordCount = mergedFiles.reduce((sum, file) => sum + file.wordCount, 0)
  const totalFiles = mergedFiles.length

  const result: FileTimelineData = {
    sequence: {
      ...data1.sequence,
      files: mergedFiles
    },
    roleAppearances: Array.from(roleMap.values()),
    metadata: {
      totalWordCount,
      totalFiles,
      lastUpdated: new Date().toISOString()
    }
  }

  if (data1.documentRoleUsages) {
    result.documentRoleUsages = data1.documentRoleUsages
  } else if (data2.documentRoleUsages) {
    result.documentRoleUsages = data2.documentRoleUsages
  }

  return result
}
