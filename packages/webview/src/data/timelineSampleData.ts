// src/data/timelineSampleData.ts
// 时间线示例数据

import type { TimelineEvent, TimelineConnection } from '../types/timeline';

// 示例数据使用预生成的 UUIDv7 格式 ID
// 格式: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx (其中第13位是版本号7)

export const sampleEvents: TimelineEvent[] = [
  {
    id: '0192a5e0-0000-7000-8000-000000000001',
    title: '故事开始',
    group: '主要情节',
    type: 'main',
    date: '2024-01-01T00:00:00',
    description: '主角出场',
    position: {
      x: 0,
      y: 100,
    },
    data: {
      type: 'main',
    },
  },
  {
    id: '0192a5e0-0001-7000-8000-000000000002',
    title: '冲突出现',
    group: '主要情节',
    type: 'main',
    date: '2024-01-05T12:00:00',
    endDate: '2024-01-08T18:00:00',
    description: '主角面临第一个挑战',
    position: {
      x: 452.2784178761628,
      y: -6.792457906617564,
    },
    width: 300,
    height: 200,
    data: {
      type: 'main',
    },
    bindings: [],
    expandParent: false,
  },
  {
    id: '0192a5e0-0002-7000-8000-000000000003',
    title: '配角背景',
    group: '背景故事',
    type: 'side',
    date: '2024-01-03T08:30:00',
    description: '配角的过去经历',
    position: {
      x: 200,
      y: 250,
    },
    data: {
      type: 'side',
    },
  },
  {
    id: '0192a5e0-0003-7000-8000-000000000004',
    title: '初次交锋',
    group: '冲突细节',
    type: 'main',
    date: '2024-01-06T09:00:00',
    description: '主角与反派的初次交锋',
    position: {
      x: 84.7485348507717,
      y: 126.04945580171517,
    },
    parentNode: '0192a5e0-0001-7000-8000-000000000002',
    extent: 'parent',
    bindings: [],
    data: {
      type: 'main',
    },
    expandParent: true,
  },
  {
    id: '0192a5e0-0004-7000-8000-000000000005',
    title: '主角背景',
    group: '故事背景',
    type: 'side',
    date: '2024-01-03T14:00:00',
    description: '主角的背景',
    position: {
      x: 203.33007671711712,
      y: 381.29720194882486,
    },
    bindings: [],
    data: {
      type: 'side',
    },
  },
  {
    id: '0192a5e0-0005-7000-8000-000000000006',
    title: '结局',
    group: '主要',
    type: 'main',
    date: '2025-10-03T00:00:00',
    description: '',
    position: {
      x: 505.40672040555535,
      y: 328.94605868495506,
    },
    data: {
      type: 'main',
    },
  },
];

export const sampleConnections: TimelineConnection[] = [
  {
    id: '0192a5e0-1000-7000-8000-000000000001',
    source: '0192a5e0-0000-7000-8000-000000000001',
    target: '0192a5e0-0001-7000-8000-000000000002',
  },
  {
    id: '0192a5e0-1001-7000-8000-000000000002',
    source: '0192a5e0-0000-7000-8000-000000000001',
    target: '0192a5e0-0002-7000-8000-000000000003',
  },
  {
    id: '0192a5e0-1002-7000-8000-000000000003',
    source: '0192a5e0-0002-7000-8000-000000000003',
    target: '0192a5e0-0001-7000-8000-000000000002',
  },
  {
    id: '0192a5e0-1005-7000-8000-000000000006',
    source: '0192a5e0-0004-7000-8000-000000000005',
    target: '0192a5e0-0001-7000-8000-000000000002',
    connectionType: 'normal',
  },
  {
    id: '0192a5e0-1007-7000-8000-000000000008',
    source: '0192a5e0-0005-7000-8000-000000000006',
    target: '0192a5e0-0000-7000-8000-000000000001',
    connectionType: 'reincarnation',
  },
  {
    id: '0199aa62-302e-7a-8c1a-9d672a5bd474',
    source: '0192a5e0-0001-7000-8000-000000000002',
    target: '0192a5e0-0003-7000-8000-000000000004',
    connectionType: 'normal',
  },
  {
    id: '0199aa62-3aac-70-a192-4b4098fd1b57',
    source: '0192a5e0-0003-7000-8000-000000000004',
    target: '0192a5e0-0005-7000-8000-000000000006',
    connectionType: 'normal',
  },
];
