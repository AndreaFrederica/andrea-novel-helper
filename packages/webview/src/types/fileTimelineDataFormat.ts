/**
 * 文件时间线数据格式定义
 * 用于气泡图和文件时间线可视化
 */

// 文件信息接口
export interface FileTimelineItem {
  id: string;                    // 唯一标识符
  name: string;                  // 文件名/显示名称
  path: string;                  // 文件路径
  wordCount: number;             // 字数统计
  isDirectory: boolean;          // 是否为目录
  orderIndex?: number;           // 排序索引（可选）
  lastModified?: string;         // 最后修改时间（ISO格式）
  created?: string;              // 创建时间（ISO格式）
  metadata?: Record<string, any>; // 扩展元数据
}

// 角色引用范围（序列化格式）
export type SerializedRange = [number, number, number, number]; // [startLine, startChar, endLine, endChar]

// 角色使用条目（兼容后端RoleUsageRoleEntry）
export interface RoleUsageEntry {
  key: string;                   // 角色键值
  name: string;                  // 角色名称
  type?: string;                 // 角色类型
  occurrences: number;           // 出现次数
  ranges: SerializedRange[];     // 引用位置范围
  sourcePath?: string;           // 源文件路径
  uuid?: string;                 // 角色UUID
}

// 文档角色使用条目（兼容后端RoleUsageDocEntry）
export interface DocumentRoleUsage {
  uri: string;                   // 文档URI
  fsPath?: string;               // 文件系统路径
  version: number;               // 文档版本
  updatedAt: number;             // 更新时间戳
  roles: RoleUsageEntry[];       // 角色使用列表
  hash: string;                  // 内容哈希
}

// 角色文档出现次数
export interface RoleDocumentAppearance {
  documentId: string;            // 文档ID或UUID
  documentName: string;          // 文档名称（用于显示）
  documentUri?: string;          // 文档URI（可选）
  documentPath?: string;         // 文档路径（可选）
  count: number;                 // 出现次数
}

// 角色文档出现统计
export interface RoleDocumentAppearances {
  roleId: string;                // 角色ID或UUID
  roleName: string;              // 角色名称
  roleType?: string;             // 角色类型（可选）
  documentAppearances: RoleDocumentAppearance[]; // 各文档出现次数
}

// 文件时间线序列
export interface FileTimelineSequence {
  title: string;                 // 序列标题
  description?: string;          // 序列描述
  sortBy: 'order' | 'name' | 'wordCount' | 'date'; // 排序方式
  sortOrder: 'asc' | 'desc';     // 排序顺序
  files: FileTimelineItem[];     // 文件列表
}

// 文件时间线数据
export interface FileTimelineData {
  sequence: FileTimelineSequence;                    // 文件序列
  roleAppearances?: RoleDocumentAppearances[];        // 角色出现统计（可选）
  documentRoleUsages?: DocumentRoleUsage[];          // 文档角色使用详情（可选）
  metadata?: {                                       // 元数据
    totalWordCount?: number;                         // 总字数
    totalFiles?: number;                             // 文件总数
    lastUpdated?: string;                            // 最后更新时间
    [key: string]: any;                              // 其他扩展字段
  };
}

// 数据验证函数
export function validateFileTimelineItem(item: any): item is FileTimelineItem {
  return (
    typeof item === 'object' &&
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.path === 'string' &&
    typeof item.wordCount === 'number' &&
    typeof item.isDirectory === 'boolean'
  );
}

export function validateRoleUsageEntry(entry: any): entry is RoleUsageEntry {
  return (
    typeof entry === 'object' &&
    typeof entry.key === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.occurrences === 'number' &&
    Array.isArray(entry.ranges)
  );
}

export function validateDocumentRoleUsage(doc: any): doc is DocumentRoleUsage {
  return (
    typeof doc === 'object' &&
    typeof doc.uri === 'string' &&
    typeof doc.version === 'number' &&
    typeof doc.updatedAt === 'number' &&
    typeof doc.hash === 'string' &&
    Array.isArray(doc.roles) &&
    doc.roles.every(validateRoleUsageEntry)
  );
}

export function validateRoleDocumentAppearance(appearance: any): appearance is RoleDocumentAppearance {
  return (
    typeof appearance === 'object' &&
    typeof appearance.documentId === 'string' &&
    typeof appearance.documentName === 'string' &&
    typeof appearance.count === 'number'
  );
}

export function validateRoleDocumentAppearances(role: any): role is RoleDocumentAppearances {
  return (
    typeof role === 'object' &&
    typeof role.roleId === 'string' &&
    typeof role.roleName === 'string' &&
    Array.isArray(role.documentAppearances) &&
    role.documentAppearances.every(validateRoleDocumentAppearance)
  );
}

export function validateFileTimelineSequence(sequence: any): sequence is FileTimelineSequence {
  return (
    typeof sequence === 'object' &&
    typeof sequence.title === 'string' &&
    ['order', 'name', 'wordCount', 'date'].includes(sequence.sortBy) &&
    ['asc', 'desc'].includes(sequence.sortOrder) &&
    Array.isArray(sequence.files) &&
    sequence.files.every(validateFileTimelineItem)
  );
}

export function validateFileTimelineData(data: any): data is FileTimelineData {
  if (!validateFileTimelineSequence(data.sequence)) return false;

  if (data.roleAppearances) {
    if (!Array.isArray(data.roleAppearances)) return false;
    if (!data.roleAppearances.every(validateRoleDocumentAppearances)) return false;
  }

  if (data.documentRoleUsages) {
    if (!Array.isArray(data.documentRoleUsages)) return false;
    if (!data.documentRoleUsages.every(validateDocumentRoleUsage)) return false;
  }

  return true;
}

// 数据转换工具函数
export function convertToFileTimelineItems(files: any[]): FileTimelineItem[] {
  return files.map(file => ({
    id: file.id || file.path,
    name: file.name || file.path.split('/').pop() || 'Unknown',
    path: file.path,
    wordCount: file.wordCount || 0,
    isDirectory: file.isDirectory || false,
    orderIndex: file.orderIndex,
    lastModified: file.lastModified,
    created: file.created,
    metadata: file.metadata
  })).filter(validateFileTimelineItem);
}

// 从后端角色使用数据转换为角色文档出现统计
export function convertRoleUsageToDocumentAppearances(
  documentRoleUsages: DocumentRoleUsage[],
  fileItems: FileTimelineItem[]
): RoleDocumentAppearances[] {
  const roleMap = new Map<string, RoleDocumentAppearances>();

  // 创建文件路径到文件信息的映射
  const filePathToInfo = new Map<string, FileTimelineItem>();
  fileItems.forEach(file => {
    filePathToInfo.set(file.path, file);
  });

  documentRoleUsages.forEach(doc => {
    if (!doc.fsPath) return;

    const fileInfo = filePathToInfo.get(doc.fsPath);
    if (!fileInfo) return;

    doc.roles.forEach(role => {
      let roleAppearances = roleMap.get(role.key);
      if (!roleAppearances) {
        const newRoleAppearances: RoleDocumentAppearances = {
          roleId: role.uuid || role.key,
          roleName: role.name,
          documentAppearances: []
        };
        // 只有当role.type存在时才添加roleType
        if (role.type !== undefined) {
          newRoleAppearances.roleType = role.type;
        }
        roleMap.set(role.key, newRoleAppearances);
        roleAppearances = newRoleAppearances;
      }

      // 查找是否已有该文档的记录
      const documentAppearance = roleAppearances!.documentAppearances.find(
        da => da.documentId === fileInfo.id
      );

      if (!documentAppearance) {
        const newDocumentAppearance: RoleDocumentAppearance = {
          documentId: fileInfo.id,
          documentName: fileInfo.name,
          documentUri: doc.uri,
          count: role.occurrences
        };

        // 只有当documentPath存在时才添加
        if (doc.fsPath !== undefined) {
          newDocumentAppearance.documentPath = doc.fsPath;
        }
        roleAppearances!.documentAppearances.push(newDocumentAppearance);
      } else {
        // 增加出现次数
        documentAppearance.count += role.occurrences;
      }
    });
  });

  return Array.from(roleMap.values());
}
