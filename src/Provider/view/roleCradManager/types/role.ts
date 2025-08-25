/** ====== 类型声明（与约束一致） ====== */
export type BuiltinType = '主角' | '配角' | '联动角色' | '敏感词' | '词汇' | '正则表达式';
export type RoleType = BuiltinType | string;
export type JsonValue = string | number | boolean | null | string[];

export interface BaseFieldsCommon {
  name: string;
  type: RoleType;
  color?: string;
  priority?: number;
  description?: string;
  affiliation?: string;
  aliases?: string[] | undefined; // 独立：基础字段
  fixes?: string[] | undefined; // 独立：基础字段（仅敏感词可编辑）
  regex?: string | undefined; // 正则专用：基础字段
  regexFlags?: string | undefined; // 正则专用：基础字段
}

export type ExtendedFields = Record<string, JsonValue>;
export type CustomFields = Record<string, JsonValue>;
export interface RoleCardModel {
  base: BaseFieldsCommon;
  extended?: ExtendedFields | undefined;
  custom?: CustomFields | undefined;
}
