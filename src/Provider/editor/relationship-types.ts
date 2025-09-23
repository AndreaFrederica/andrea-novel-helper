/**
 * 角色关系编辑器类型定义
 * 参考角色卡编辑器的实现模式
 */

export type RelationshipType = 
  | '朋友' | '恋人' | '夫妻' | '父子' | '母子' | '父女' | '母女' | '兄弟' | '姐妹' | '师父' | '师傅' 
  | '同事' | '上司' | '下属' | '敌人' | '仇人' | '竞争对手' | '合作伙伴' | '盟友'
  | string; // 允许自定义关系类型

export type JsonValue = string | number | boolean | null | string[];

/** ==== 前端模型 ==== */
export interface BaseRelationshipFields {
    id?: string; // 关系唯一标识符
    uuid?: string; // 关系UUID (v7)
    fromRoleId: string; // 源角色ID或名称
    toRoleId: string; // 目标角色ID或名称
    relationshipType: RelationshipType; // 关系类型
    description?: string; // 关系描述
    strength?: number; // 关系强度 (1-10)
    isDirectional?: boolean; // 是否为单向关系
    startTime?: string; // 关系开始时间
    endTime?: string; // 关系结束时间
    status?: 'active' | 'inactive' | 'ended'; // 关系状态
    tags?: string[]; // 关系标签
    notes?: string; // 备注
}

export type ExtendedRelationshipFields = Record<string, JsonValue>;
export type CustomRelationshipFields = Record<string, JsonValue>;

export interface RelationshipCardModel {
    base: BaseRelationshipFields;
    extended?: ExtendedRelationshipFields;
    custom?: CustomRelationshipFields;
}

export type RelationshipCardModelWithId = RelationshipCardModel & { id?: string };

/** ==== 后端模型 ==== */
export interface Relationship {
    id?: string; // 仅内存使用
    uuid?: string; // 关系UUID (v7)
    fromRoleId: string; // 源角色ID或名称
    toRoleId: string; // 目标角色ID或名称
    relationshipType: RelationshipType; // 关系类型
    description?: string; // 关系描述
    strength?: number; // 关系强度 (1-10)
    isDirectional?: boolean; // 是否为单向关系
    startTime?: string; // 关系开始时间
    endTime?: string; // 关系结束时间
    status?: 'active' | 'inactive' | 'ended'; // 关系状态
    tags?: string[]; // 关系标签
    notes?: string; // 备注
    // 后端隐藏字段
    packagePath?: string;
    sourcePath?: string;
}

// 平铺后的后端对象（允许动态键）
export type RelationshipFlat = (Relationship & Record<string, JsonValue | undefined>) & { id?: string };

/** ==== 预定义关系类型 ==== */
export const BUILTIN_RELATIONSHIP_TYPES: RelationshipType[] = [
    '朋友', '恋人', '夫妻', 
    '父子', '母子', '父女', '母女', 
    '兄弟', '姐妹', 
    '师父', '师傅', 
    '同事', '上司', '下属', 
    '敌人', '仇人', '竞争对手', 
    '合作伙伴', '盟友'
];

/** ==== 关系强度定义 ==== */
export const RELATIONSHIP_STRENGTH_LABELS = {
    1: '极弱',
    2: '很弱', 
    3: '弱',
    4: '较弱',
    5: '一般',
    6: '较强',
    7: '强',
    8: '很强',
    9: '极强',
    10: '最强'
};

/** ==== 关系状态定义 ==== */
export const RELATIONSHIP_STATUS_LABELS = {
    'active': '活跃',
    'inactive': '不活跃',
    'ended': '已结束'
};