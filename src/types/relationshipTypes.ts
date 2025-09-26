/**
 * 角色关系解析器相关的TypeScript类型定义
 */

/**
 * 关系类型 - 直接使用字符串
 */
export type RelationshipType = string;

/**
 * 关系状态枚举
 */
export enum RelationshipStatus {
    ACTIVE = 'active',
    INACTIVE = 'inactive',
    PENDING = 'pending',
    ENDED = 'ended'
}

/**
 * 图形数据中的角色节点（nodes数组中的元素）
 */
export interface GraphRoleNode {
    /** 节点ID */
    id: string;
    /** 节点显示文本（角色名称） */
    text: string;
    /** 节点类型 */
    type: 'node';
    /** 节点数据 */
    data: {
        /** 角色UUID - 指向真实的角色数据 */
        roleUuid: string;
        /** 角色名称 */
        text: string;
        /** 其他属性 */
        [key: string]: any;
    };
    /** 其他图形属性 */
    [key: string]: any;
}

/**
 * 图形数据中的关系连线（lines数组中的元素）
 */
export interface GraphRelationshipLine {
    /** 连线ID */
    id: string;
    /** 起始节点ID */
    from: string;
    /** 目标节点ID */
    to: string;
    /** 连线显示文本 */
    text: string;
    /** 连线数据 */
    data: {
        /** 关系类型 */
        type: string;
        /** 关系强度 */
        strength?: number;
        /** 关系状态 */
        status?: string;
        /** 关系标签 */
        tags?: string[];
        /** 其他属性 */
        [key: string]: any;
    };
    /** 其他图形属性 */
    [key: string]: any;
}

/**
 * 完整的图形数据结构
 */
export interface GraphData {
    /** 角色节点数组 */
    nodes: GraphRoleNode[];
    /** 关系连线数组 */
    lines: GraphRelationshipLine[];
    /** 其他属性 */
    [key: string]: any;
}

/**
 * 角色关系定义 - 解析后的标准格式
 */
export interface RoleRelationship {
    /** 来源角色名称 */
    sourceRole: string;
    
    /** 目标角色名称 */
    targetRole: string;
    
    /** 字面值 - 关系的具体描述或标签 */
    literalValue: string;
    
    /** 类型 - 关系的分类 */
    type: string;
    
    /** 可选的元数据 */
    metadata?: {
        /** 来源角色UUID */
        sourceRoleUuid?: string;
        /** 目标角色UUID */
        targetRoleUuid?: string;
        /** 连线ID */
        lineId?: string;
        /** 关系强度 */
        strength?: number;
        /** 关系状态 */
        status?: string;
        /** 关系标签 */
        tags?: string[];
        /** 是否有方向性 */
        isDirectional?: boolean;
        /** 其他属性 */
        [key: string]: any;
    };
}

/**
 * 关系定义（兼容旧版本）
 */
export interface Relationship extends RoleRelationship {
    /** 关系ID */
    id?: string;
    /** 关系状态 */
    status?: RelationshipStatus;
}

/**
 * 关系查询条件
 */
export interface RelationshipQuery {
  /** 角色ID/名称 */
  roleId?: string;
  /** 关系类型过滤 */
  relationshipType?: string;
  /** 关系状态 */
  status?: RelationshipStatus;
  /** 标签过滤 */
  tags?: string[];
  /** 是否包含双向关系 */
  includeBidirectional?: boolean;
}

/**
 * 关系查询结果
 */
export interface RelationshipQueryResult {
  /** 匹配的关系列表 */
  relationships: Relationship[];
  /** 涉及的角色ID列表 */
  involvedRoles: string[];
  /** 查询统计信息 */
  stats: {
    totalCount: number;
    byType: Record<string, number>;
    byStatus: Record<RelationshipStatus, number>;
  };
}

/**
 * 角色关系网络节点
 */
export interface RelationshipNode {
  /** 角色ID */
  roleId: string;
  /** 角色名称 */
  roleName: string;
  /** 连接的关系列表 */
  relationships: Relationship[];
  /** 直接连接的角色数量 */
  connectionCount: number;
}

/**
 * 角色关系网络
 */
export interface RelationshipNetwork {
  /** 网络中的所有节点 */
  nodes: RelationshipNode[];
  /** 网络中的所有关系 */
  relationships: Relationship[];
  /** 网络统计信息 */
  stats: {
    nodeCount: number;
    relationshipCount: number;
    averageConnections: number;
    maxConnections: number;
  };
}

/**
 * 关系解析器配置
 */
export interface RelationshipParserConfig {
  /** 是否严格模式（严格验证数据格式） */
  strictMode?: boolean;
  /** 是否自动生成UUID */
  autoGenerateUuid?: boolean;
  /** 默认关系状态 */
  defaultStatus?: RelationshipStatus;
  /** 是否允许自引用关系 */
  allowSelfReference?: boolean;
  /** 是否合并重复关系 */
  mergeDuplicates?: boolean;
}

/**
 * 关系解析结果
 */
export interface RelationshipParseResult {
  /** 解析成功的关系列表 */
  relationships: Relationship[];
  /** 解析错误列表 */
  errors: Array<{
    line?: number;
    message: string;
    data?: any;
  }>;
  /** 解析统计信息 */
  stats: {
    totalParsed: number;
    successCount: number;
    errorCount: number;
    duplicateCount: number;
  };
}