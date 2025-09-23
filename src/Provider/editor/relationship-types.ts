/**
 * 角色关系编辑器类型定义
 * 以前端RGJsonData格式为准的数据结构
 */

export type RelationshipType = 
  | '朋友' | '恋人' | '夫妻' | '父子' | '母子' | '父女' | '母女' | '兄弟' | '姐妹' | '师父' | '师傅' 
  | '同事' | '上司' | '下属' | '敌人' | '仇人' | '竞争对手' | '合作伙伴' | '盟友'
  | string; // 允许自定义关系类型

export type JsonValue = string | number | boolean | null | string[];

/** ==== 前端图形数据格式 (RGJsonData) ==== */
export interface RGNode {
    id: string; // 节点唯一标识符
    text: string; // 节点显示文本
    roleUuid?: string; // 角色UUID，用于匹配角色数据
    x?: number; // X坐标
    y?: number; // Y坐标
    color?: string; // 节点颜色
    borderColor?: string; // 边框颜色
    fontColor?: string; // 字体颜色
    nodeShape?: number; // 节点形状
    width?: number; // 节点宽度
    height?: number; // 节点高度
    data?: {
        sexType?: 'male' | 'female' | 'none' | 'other'; // 性别类型
        isGoodMan?: boolean | 'other'; // 正负角色
        [key: string]: any; // 其他自定义数据
    };
}

export interface RGLine {
    from: string; // 源节点ID
    to: string; // 目标节点ID
    text?: string; // 连线显示文本
    color?: string; // 连线颜色
    lineWidth?: number; // 连线宽度
    lineShape?: number; // 连线形状
    startArrow?: boolean; // 起始箭头
    endArrow?: boolean; // 结束箭头
    isDashed?: boolean; // 是否虚线
    data?: {
        type?: string; // 关系类型
        [key: string]: any; // 其他自定义数据
    };
}

export interface RGJsonData {
    rootId?: string; // 根节点ID
    nodes: RGNode[]; // 节点数组
    lines: RGLine[]; // 连线数组
}



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