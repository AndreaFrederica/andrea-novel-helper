/** ====== 类型声明（与约束一致） ====== */
export type BuiltinType = '主角' | '配角' | '联动角色' | '敏感词' | '词汇' | '正则表达式';
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export type RoleType = BuiltinType | string;
export type JsonValue = string | number | boolean | null | string[];

/** 文本样式配置 */
export interface TextStyleOptions {
  /** 前景色 */
  color?: string;
  /** 背景色 */
  backgroundColor?: string;
  /** 是否粗体 */
  bold?: boolean;
  /** 是否斜体 */
  italic?: boolean;
  /** 是否删除线 */
  strikethrough?: boolean;
  /** 是否下划线 */
  underline?: boolean;
}

export interface BaseFieldsCommon {
  name: string;
  type: RoleType;
  uuid?: string; // UUID字段
  /** 前景色（旧字段，保持兼容） */
  color?: string;
  /** 文本样式（新字段，支持多种样式） */
  style?: TextStyleOptions;
  priority?: number;
  description?: string;
  affiliation?: string;
  wordSegmentFilter?: boolean; // 是否受到分词器影响
  aliases?: string[] | undefined; // 独立：基础字段
  lookupKeys_pinyin?: string[] | undefined;
  lookupKeys_romanized?: string[] | undefined;
  lookupKeys_spelling?: string[] | undefined;
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
