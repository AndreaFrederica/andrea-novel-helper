// src/types/timeline.ts
// 时间线数据类型定义

export interface BindingReference {
  uuid: string;
  type: 'character' | 'article' | 'location' | 'item' | 'other';
  label?: string;
}

export interface TimelineEvent {
  id: string;
  title: string;
  group: string;
  type: 'main' | 'side';
  date: string; // 开始日期 (ISO 8601 格式，支持到秒: YYYY-MM-DDTHH:mm:ss)
  endDate?: string; // 结束日期 (可选，用于时间区间，格式同上)
  description: string;
  timeless?: boolean;
  position?: { x: number; y: number };
  bindings?: BindingReference[];
  data?: {
    type: 'main' | 'side';
  };
  // 嵌套节点支持
  parentNode?: string; // 父节点ID
  width?: number; // 节点宽度 (仅对父节点有效)
  height?: number; // 节点高度 (仅对父节点有效)
  extent?: 'parent'; // 限制子节点在父节点内移动
  expandParent?: boolean; // 拖动子节点时自动扩展父节点
}

export interface TimelineConnection {
  id: string;
  source: string;
  target: string;
  label?: string;
  connectionType?: 'normal' | 'time-travel' | 'reincarnation' | 'parallel' | 'dream' | 'flashback' | 'other';
}

export interface TimelineData {
  events: TimelineEvent[];
  connections: TimelineConnection[];
}
