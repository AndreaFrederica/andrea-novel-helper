/**
 * 名字生成系统的类型定义
 */

export interface NameGenerationOptions {
	/** 文化背景，如 'zh_CN', 'en_US', 'ja_JP', 'fantasy' */
	culture?: string;
	/** 性别：'male', 'female', 'neutral', 'any' */
	gender?: 'male' | 'female' | 'neutral' | 'any';
	/** 风格：'modern', 'classic', 'fantasy', 'sci-fi', 'historical' */
	style?: string;
	/** 生成数量，默认1 */
	count?: number;
	/** 包含姓氏，默认true */
	includeSurname?: boolean;
	/** 名字长度限制 */
	maxLength?: number;
}

export interface GeneratedName {
	/** 完整名字 */
	fullName: string;
	/** 名 */
	firstName: string;
	/** 姓 */
	lastName?: string;
	/** 文化背景 */
	culture: string;
	/** 性别 */
	gender: 'male' | 'female' | 'neutral';
	/** 风格 */
	style: string;
	/** 起源 */
	origin: string;
	/** 原始名字（通常是firstName） */
	original?: string;
	/** 翻译或本地化版本 */
	translation?: string;
	/** 替代全名（用于日语显示等场景） */
	alternativeFullName?: string;
}

export interface NameGenerationStrategy {
	/** 策略名称 */
	name: string;
	/** 支持的文化列表 */
	supportedCultures: string[];
	/** 生成名字的方法 */
	generate(options: NameGenerationOptions): Promise<GeneratedName[]>;
	/** 生成姓氏的方法（可选） */
	generateSurnames?(options: NameGenerationOptions): Promise<GeneratedName[]>;
	/** 生成名字的方法（可选） */
	generateFirstNames?(options: NameGenerationOptions): Promise<GeneratedName[]>;
	/** 检查是否支持指定选项 */
	supports(options: NameGenerationOptions): boolean;
}

export interface CultureConfig {
	/** 文化代码 */
	code: string;
	/** 显示名称 */
	displayName: string;
	/** 支持的性别 */
	supportedGenders: ('male' | 'female' | 'neutral')[];
	/** 支持的风格 */
	supportedStyles: string[];
	/** 默认策略 */
	defaultStrategy: string;
}

export interface NameStats {
	/** 总生成次数 */
	totalGenerated: number;
	/** 按文化分类的统计 */
	byCulture: Record<string, number>;
	/** 按性别分类的统计 */
	byGender: Record<string, number>;
	/** 按风格分类的统计 */
	byStyle: Record<string, number>;
}