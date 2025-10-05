import type { FileTimelineData, FileTimelineItem, RoleDocumentAppearances, DocumentRoleUsage } from '../types/fileTimelineDataFormat'

// 默认文件时间线数据
export const defaultFileTimelineData: FileTimelineData = {
  sequence: {
    title: '小说章节时间线',
    description: '展示小说各章节的写作进度和字数统计',
    sortBy: 'order',
    sortOrder: 'asc',
    files: [
      {
        id: 'file-1',
        name: '序章：黎明之前',
        path: '/chapters/序章：黎明之前.md',
        wordCount: 3250,
        isDirectory: false,
        orderIndex: 10,
        lastModified: '2024-01-01T10:00:00Z',
        created: '2024-01-01T09:00:00Z'
      },
      {
        id: 'file-2',
        name: '第一章：初遇',
        path: '/chapters/第一章：初遇.md',
        wordCount: 5420,
        isDirectory: false,
        orderIndex: 20,
        lastModified: '2024-01-02T15:30:00Z',
        created: '2024-01-01T16:00:00Z'
      },
      {
        id: 'file-3',
        name: '第二章：谜团',
        path: '/chapters/第二章：谜团.md',
        wordCount: 6180,
        isDirectory: false,
        orderIndex: 30,
        lastModified: '2024-01-03T18:45:00Z',
        created: '2024-01-02T20:00:00Z'
      },
      {
        id: 'file-4',
        name: '第三章：转折',
        path: '/chapters/第三章：转折.md',
        wordCount: 4890,
        isDirectory: false,
        orderIndex: 40,
        lastModified: '2024-01-04T14:20:00Z',
        created: '2024-01-03T22:00:00Z'
      },
      {
        id: 'file-5',
        name: '第四章：危机',
        path: '/chapters/第四章：危机.md',
        wordCount: 5720,
        isDirectory: false,
        orderIndex: 50,
        lastModified: '2024-01-05T16:10:00Z',
        created: '2024-01-04T19:00:00Z'
      },
      {
        id: 'file-6',
        name: '第五章：联盟',
        path: '/chapters/第五章：联盟.md',
        wordCount: 6310,
        isDirectory: false,
        orderIndex: 60,
        lastModified: '2024-01-06T17:30:00Z',
        created: '2024-01-05T21:00:00Z'
      },
      {
        id: 'file-7',
        name: '第六章：真相',
        path: '/chapters/第六章：真相.md',
        wordCount: 7050,
        isDirectory: false,
        orderIndex: 70,
        lastModified: '2024-01-07T19:45:00Z',
        created: '2024-01-06T23:00:00Z'
      },
      {
        id: 'file-8',
        name: '第七章：决战',
        path: '/chapters/第七章：决战.md',
        wordCount: 8420,
        isDirectory: false,
        orderIndex: 80,
        lastModified: '2024-01-08T20:15:00Z',
        created: '2024-01-07T18:00:00Z'
      },
      {
        id: 'file-9',
        name: '第八章：结局',
        path: '/chapters/第八章：结局.md',
        wordCount: 5680,
        isDirectory: false,
        orderIndex: 90,
        lastModified: '2024-01-09T12:30:00Z',
        created: '2024-01-08T22:00:00Z'
      },
      {
        id: 'file-10',
        name: '尾声：新的开始',
        path: '/chapters/尾声：新的开始.md',
        wordCount: 2950,
        isDirectory: false,
        orderIndex: 100,
        lastModified: '2024-01-10T11:00:00Z',
        created: '2024-01-09T14:00:00Z'
      }
    ]
  },
  roleAppearances: [
    {
      roleId: 'role-1',
      roleName: '主角',
      roleType: '主角',
      documentAppearances: [
        { documentId: 'file-1', documentName: '序章：黎明之前', count: 15, documentUri: 'file:///chapters/序章：黎明之前.md', documentPath: '/chapters/序章：黎明之前.md' },
        { documentId: 'file-2', documentName: '第一章：初遇', count: 42, documentUri: 'file:///chapters/第一章：初遇.md', documentPath: '/chapters/第一章：初遇.md' },
        { documentId: 'file-3', documentName: '第二章：谜团', count: 38, documentUri: 'file:///chapters/第二章：谜团.md', documentPath: '/chapters/第二章：谜团.md' },
        { documentId: 'file-4', documentName: '第三章：转折', count: 35, documentUri: 'file:///chapters/第三章：转折.md', documentPath: '/chapters/第三章：转折.md' },
        { documentId: 'file-5', documentName: '第四章：危机', count: 48, documentUri: 'file:///chapters/第四章：危机.md', documentPath: '/chapters/第四章：危机.md' },
        { documentId: 'file-6', documentName: '第五章：联盟', count: 52, documentUri: 'file:///chapters/第五章：联盟.md', documentPath: '/chapters/第五章：联盟.md' },
        { documentId: 'file-7', documentName: '第六章：真相', count: 45, documentUri: 'file:///chapters/第六章：真相.md', documentPath: '/chapters/第六章：真相.md' },
        { documentId: 'file-8', documentName: '第七章：决战', count: 58, documentUri: 'file:///chapters/第七章：决战.md', documentPath: '/chapters/第七章：决战.md' },
        { documentId: 'file-9', documentName: '第八章：结局', count: 40, documentUri: 'file:///chapters/第八章：结局.md', documentPath: '/chapters/第八章：结局.md' },
        { documentId: 'file-10', documentName: '尾声：新的开始', count: 25, documentUri: 'file:///chapters/尾声：新的开始.md', documentPath: '/chapters/尾声：新的开始.md' }
      ]
    },
    {
      roleId: 'role-2',
      roleName: '配角A',
      roleType: '配角',
      documentAppearances: [
        { documentId: 'file-1', documentName: '序章：黎明之前', count: 5, documentUri: 'file:///chapters/序章：黎明之前.md', documentPath: '/chapters/序章：黎明之前.md' },
        { documentId: 'file-2', documentName: '第一章：初遇', count: 12, documentUri: 'file:///chapters/第一章：初遇.md', documentPath: '/chapters/第一章：初遇.md' },
        { documentId: 'file-3', documentName: '第二章：谜团', count: 18, documentUri: 'file:///chapters/第二章：谜团.md', documentPath: '/chapters/第二章：谜团.md' },
        { documentId: 'file-4', documentName: '第三章：转折', count: 15, documentUri: 'file:///chapters/第三章：转折.md', documentPath: '/chapters/第三章：转折.md' },
        { documentId: 'file-5', documentName: '第四章：危机', count: 22, documentUri: 'file:///chapters/第四章：危机.md', documentPath: '/chapters/第四章：危机.md' },
        { documentId: 'file-6', documentName: '第五章：联盟', count: 20, documentUri: 'file:///chapters/第五章：联盟.md', documentPath: '/chapters/第五章：联盟.md' },
        { documentId: 'file-7', documentName: '第六章：真相', count: 25, documentUri: 'file:///chapters/第六章：真相.md', documentPath: '/chapters/第六章：真相.md' },
        { documentId: 'file-8', documentName: '第七章：决战', count: 30, documentUri: 'file:///chapters/第七章：决战.md', documentPath: '/chapters/第七章：决战.md' },
        { documentId: 'file-9', documentName: '第八章：结局', count: 18, documentUri: 'file:///chapters/第八章：结局.md', documentPath: '/chapters/第八章：结局.md' },
        { documentId: 'file-10', documentName: '尾声：新的开始', count: 8, documentUri: 'file:///chapters/尾声：新的开始.md', documentPath: '/chapters/尾声：新的开始.md' }
      ]
    },
    {
      roleId: 'role-3',
      roleName: '反派',
      roleType: '反派',
      documentAppearances: [
        { documentId: 'file-1', documentName: '序章：黎明之前', count: 3, documentUri: 'file:///chapters/序章：黎明之前.md', documentPath: '/chapters/序章：黎明之前.md' },
        { documentId: 'file-2', documentName: '第一章：初遇', count: 0, documentUri: 'file:///chapters/第一章：初遇.md', documentPath: '/chapters/第一章：初遇.md' },
        { documentId: 'file-3', documentName: '第二章：谜团', count: 8, documentUri: 'file:///chapters/第二章：谜团.md', documentPath: '/chapters/第二章：谜团.md' },
        { documentId: 'file-4', documentName: '第三章：转折', count: 12, documentUri: 'file:///chapters/第三章：转折.md', documentPath: '/chapters/第三章：转折.md' },
        { documentId: 'file-5', documentName: '第四章：危机', count: 18, documentUri: 'file:///chapters/第四章：危机.md', documentPath: '/chapters/第四章：危机.md' },
        { documentId: 'file-6', documentName: '第五章：联盟', count: 15, documentUri: 'file:///chapters/第五章：联盟.md', documentPath: '/chapters/第五章：联盟.md' },
        { documentId: 'file-7', documentName: '第六章：真相', count: 22, documentUri: 'file:///chapters/第六章：真相.md', documentPath: '/chapters/第六章：真相.md' },
        { documentId: 'file-8', documentName: '第七章：决战', count: 35, documentUri: 'file:///chapters/第七章：决战.md', documentPath: '/chapters/第七章：决战.md' },
        { documentId: 'file-9', documentName: '第八章：结局', count: 10, documentUri: 'file:///chapters/第八章：结局.md', documentPath: '/chapters/第八章：结局.md' },
        { documentId: 'file-10', documentName: '尾声：新的开始', count: 0, documentUri: 'file:///chapters/尾声：新的开始.md', documentPath: '/chapters/尾声：新的开始.md' }
      ]
    }
  ],
  metadata: {
    totalWordCount: 55870,
    totalFiles: 10,
    lastUpdated: '2024-01-10T11:00:00Z'
  }
}

// 角色文档出现次数的示例数据（独立导出，便于直接使用）
export const defaultRoleDocumentAppearances: RoleDocumentAppearances[] = [
  {
    roleId: 'role-1',
    roleName: '主角',
    roleType: '主角',
    documentAppearances: [
      { documentId: 'file-1', documentName: '序章：黎明之前', count: 15, documentUri: 'file:///chapters/序章：黎明之前.md', documentPath: '/chapters/序章：黎明之前.md' },
      { documentId: 'file-2', documentName: '第一章：初遇', count: 42, documentUri: 'file:///chapters/第一章：初遇.md', documentPath: '/chapters/第一章：初遇.md' },
      { documentId: 'file-3', documentName: '第二章：谜团', count: 38, documentUri: 'file:///chapters/第二章：谜团.md', documentPath: '/chapters/第二章：谜团.md' },
      { documentId: 'file-4', documentName: '第三章：转折', count: 35, documentUri: 'file:///chapters/第三章：转折.md', documentPath: '/chapters/第三章：转折.md' },
      { documentId: 'file-5', documentName: '第四章：危机', count: 48, documentUri: 'file:///chapters/第四章：危机.md', documentPath: '/chapters/第四章：危机.md' },
      { documentId: 'file-6', documentName: '第五章：联盟', count: 52, documentUri: 'file:///chapters/第五章：联盟.md', documentPath: '/chapters/第五章：联盟.md' },
      { documentId: 'file-7', documentName: '第六章：真相', count: 45, documentUri: 'file:///chapters/第六章：真相.md', documentPath: '/chapters/第六章：真相.md' },
      { documentId: 'file-8', documentName: '第七章：决战', count: 58, documentUri: 'file:///chapters/第七章：决战.md', documentPath: '/chapters/第七章：决战.md' },
      { documentId: 'file-9', documentName: '第八章：结局', count: 40, documentUri: 'file:///chapters/第八章：结局.md', documentPath: '/chapters/第八章：结局.md' },
      { documentId: 'file-10', documentName: '尾声：新的开始', count: 25, documentUri: 'file:///chapters/尾声：新的开始.md', documentPath: '/chapters/尾声：新的开始.md' }
    ]
  },
  {
    roleId: 'role-2',
    roleName: '配角A',
    roleType: '配角',
    documentAppearances: [
      { documentId: 'file-1', documentName: '序章：黎明之前', count: 5, documentUri: 'file:///chapters/序章：黎明之前.md', documentPath: '/chapters/序章：黎明之前.md' },
      { documentId: 'file-2', documentName: '第一章：初遇', count: 12, documentUri: 'file:///chapters/第一章：初遇.md', documentPath: '/chapters/第一章：初遇.md' },
      { documentId: 'file-3', documentName: '第二章：谜团', count: 18, documentUri: 'file:///chapters/第二章：谜团.md', documentPath: '/chapters/第二章：谜团.md' },
      { documentId: 'file-4', documentName: '第三章：转折', count: 15, documentUri: 'file:///chapters/第三章：转折.md', documentPath: '/chapters/第三章：转折.md' },
      { documentId: 'file-5', documentName: '第四章：危机', count: 22, documentUri: 'file:///chapters/第四章：危机.md', documentPath: '/chapters/第四章：危机.md' },
      { documentId: 'file-6', documentName: '第五章：联盟', count: 20, documentUri: 'file:///chapters/第五章：联盟.md', documentPath: '/chapters/第五章：联盟.md' },
      { documentId: 'file-7', documentName: '第六章：真相', count: 25, documentUri: 'file:///chapters/第六章：真相.md', documentPath: '/chapters/第六章：真相.md' },
      { documentId: 'file-8', documentName: '第七章：决战', count: 30, documentUri: 'file:///chapters/第七章：决战.md', documentPath: '/chapters/第七章：决战.md' },
      { documentId: 'file-9', documentName: '第八章：结局', count: 18, documentUri: 'file:///chapters/第八章：结局.md', documentPath: '/chapters/第八章：结局.md' },
      { documentId: 'file-10', documentName: '尾声：新的开始', count: 8, documentUri: 'file:///chapters/尾声：新的开始.md', documentPath: '/chapters/尾声：新的开始.md' }
    ]
  },
  {
    roleId: 'role-3',
    roleName: '反派',
    roleType: '反派',
    documentAppearances: [
      { documentId: 'file-1', documentName: '序章：黎明之前', count: 3, documentUri: 'file:///chapters/序章：黎明之前.md', documentPath: '/chapters/序章：黎明之前.md' },
      { documentId: 'file-2', documentName: '第一章：初遇', count: 0, documentUri: 'file:///chapters/第一章：初遇.md', documentPath: '/chapters/第一章：初遇.md' },
      { documentId: 'file-3', documentName: '第二章：谜团', count: 8, documentUri: 'file:///chapters/第二章：谜团.md', documentPath: '/chapters/第二章：谜团.md' },
      { documentId: 'file-4', documentName: '第三章：转折', count: 12, documentUri: 'file:///chapters/第三章：转折.md', documentPath: '/chapters/第三章：转折.md' },
      { documentId: 'file-5', documentName: '第四章：危机', count: 18, documentUri: 'file:///chapters/第四章：危机.md', documentPath: '/chapters/第四章：危机.md' },
      { documentId: 'file-6', documentName: '第五章：联盟', count: 15, documentUri: 'file:///chapters/第五章：联盟.md', documentPath: '/chapters/第五章：联盟.md' },
      { documentId: 'file-7', documentName: '第六章：真相', count: 22, documentUri: 'file:///chapters/第六章：真相.md', documentPath: '/chapters/第六章：真相.md' },
      { documentId: 'file-8', documentName: '第七章：决战', count: 35, documentUri: 'file:///chapters/第七章：决战.md', documentPath: '/chapters/第七章：决战.md' },
      { documentId: 'file-9', documentName: '第八章：结局', count: 10, documentUri: 'file:///chapters/第八章：结局.md', documentPath: '/chapters/第八章：结局.md' },
      { documentId: 'file-10', documentName: '尾声：新的开始', count: 0, documentUri: 'file:///chapters/尾声：新的开始.md', documentPath: '/chapters/尾声：新的开始.md' }
    ]
  }
]

// 文档角色使用详情示例数据（兼容后端格式）
export const defaultDocumentRoleUsages: DocumentRoleUsage[] = [
  {
    uri: 'file:///chapters/序章：黎明之前.md',
    fsPath: '/chapters/序章：黎明之前.md',
    version: 1,
    updatedAt: 1704097200000, // 2024-01-01T10:00:00Z 的毫秒时间戳
    hash: 'hash1',
    roles: [
      {
        key: 'role-1',
        name: '主角',
        type: '主角',
        occurrences: 15,
        ranges: [[0, 0, 0, 2], [1, 5, 1, 7], [2, 10, 2, 12]],
        uuid: 'role-1'
      },
      {
        key: 'role-2',
        name: '配角A',
        type: '配角',
        occurrences: 5,
        ranges: [[3, 0, 3, 3]],
        uuid: 'role-2'
      },
      {
        key: 'role-3',
        name: '反派',
        type: '反派',
        occurrences: 3,
        ranges: [[4, 0, 4, 2]],
        uuid: 'role-3'
      }
    ]
  },
  {
    uri: 'file:///chapters/第一章：初遇.md',
    fsPath: '/chapters/第一章：初遇.md',
    version: 1,
    updatedAt: 1704185400000, // 2024-01-02T15:30:00Z 的毫秒时间戳
    hash: 'hash2',
    roles: [
      {
        key: 'role-1',
        name: '主角',
        type: '主角',
        occurrences: 42,
        ranges: [[0, 0, 0, 2], [1, 5, 1, 7], [2, 10, 2, 12]],
        uuid: 'role-1'
      },
      {
        key: 'role-2',
        name: '配角A',
        type: '配角',
        occurrences: 12,
        ranges: [[3, 0, 3, 3]],
        uuid: 'role-2'
      }
    ]
  }
  // 其他章节的数据省略，实际使用时可以添加完整数据
]

// 导出默认文件列表（便于直接使用）
export const defaultFileTimelineItems: FileTimelineItem[] = defaultFileTimelineData.sequence.files

// 导出工具函数
export function getFileTimelineItems(): FileTimelineItem[] {
  return defaultFileTimelineData.sequence.files
}

export function getRoleDocumentAppearances(): RoleDocumentAppearances[] {
  return defaultFileTimelineData.roleAppearances || []
}

export function getDocumentRoleUsages(): DocumentRoleUsage[] {
  return defaultDocumentRoleUsages
}
