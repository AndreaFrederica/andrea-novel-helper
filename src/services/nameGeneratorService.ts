import * as vscode from 'vscode';
import {
	NameGenerationOptions,
	GeneratedName,
	NameGenerationStrategy,
	CultureConfig,
	NameStats
} from '../types/names';

/**
 * 名字生成服务
 * 基于MPL-2.0兼容的开源库实现
 */
export class NameGeneratorService {
	private strategies: Map<string, NameGenerationStrategy> = new Map();
	private cultureConfigs: Map<string, CultureConfig> = new Map();
	private stats: NameStats = {
		totalGenerated: 0,
		byCulture: {},
		byGender: {},
		byStyle: {}
	};

	constructor() {
		this.initializeCultureConfigs();
		this.initializeStrategies();
	}

	/**
	 * 生成随机名字
	 */
	async generateNames(options: NameGenerationOptions = {}): Promise<GeneratedName[]> {
		const count = options.count || 1;
		const results: GeneratedName[] = [];

		// 选择最适合的策略
		const strategy = this.selectStrategy(options);

		for (let i = 0; i < count; i++) {
			try {
				const generated = await strategy.generate(options);
				results.push(...generated);
				this.updateStats(generated);
			} catch (error) {
				console.error('Name generation failed:', error);
				// 如果策略失败，尝试回退到默认策略
				if (strategy.name !== 'fallback') {
					const fallbackStrategy = this.strategies.get('fallback');
					if (fallbackStrategy) {
						const generated = await fallbackStrategy.generate(options);
						results.push(...generated);
						this.updateStats(generated);
					}
				}
			}
		}

		return results.slice(0, count);
	}

	/**
	 * 分离生成姓氏
	 */
	async generateSurnames(options: NameGenerationOptions = {}): Promise<GeneratedName[]> {
		const count = options.count || 1;
		const results: GeneratedName[] = [];

		// 选择最适合的策略
		const strategy = this.selectStrategy(options);

		try {
			const generated = await (strategy.generateSurnames ? strategy.generateSurnames(options) : this.generateSurnamesFallback(options));
			results.push(...generated);
			this.updateStats(generated);
		} catch (error) {
			console.error('Surname generation failed:', error);
			// 如果策略失败，使用回退方法
			const fallback = await this.generateSurnamesFallback(options);
			results.push(...fallback);
			this.updateStats(fallback);
		}

		return results.slice(0, count);
	}

	/**
	 * 分离生成名字
	 */
	async generateFirstNames(options: NameGenerationOptions = {}): Promise<GeneratedName[]> {
		const count = options.count || 1;
		const results: GeneratedName[] = [];

		// 选择最适合的策略
		const strategy = this.selectStrategy(options);

		try {
			const generated = await (strategy.generateFirstNames ? strategy.generateFirstNames(options) : this.generateFirstNamesFallback(options));
			results.push(...generated);
			this.updateStats(generated);
		} catch (error) {
			console.error('First name generation failed:', error);
			// 如果策略失败，使用回退方法
			const fallback = await this.generateFirstNamesFallback(options);
			results.push(...fallback);
			this.updateStats(fallback);
		}

		return results.slice(0, count);
	}

	/**
	 * 姓氏生成回退方法
	 */
	private async generateSurnamesFallback(options: NameGenerationOptions): Promise<GeneratedName[]> {
		const culture = options.culture || 'zh_CN';

		// 使用现有策略生成完整名字，然后提取姓氏
		const fullNames = await this.generateNames({ ...options, count: 10 });

		return fullNames.map(name => ({
			...name,
			firstName: '', // 清空名字字段，只保留姓氏
			fullName: name.lastName || ''
		})).filter(name => name.fullName); // 过滤掉没有姓氏的情况
	}

	/**
	 * 名字生成回退方法
	 */
	private async generateFirstNamesFallback(options: NameGenerationOptions): Promise<GeneratedName[]> {
		const culture = options.culture || 'zh_CN';

		// 使用现有策略生成完整名字，然后提取名字
		const fullNames = await this.generateNames({ ...options, count: 10 });

		return fullNames.map(name => ({
			...name,
			lastName: '', // 清空姓氏字段，只保留名字
			fullName: name.firstName
		}));
	}

	/**
	 * 获取支持的文化列表
	 */
	getSupportedCultures(): CultureConfig[] {
		return Array.from(this.cultureConfigs.values());
	}

	/**
	 * 获取可用的风格列表
	 */
	getAvailableStyles(culture?: string): string[] {
		if (culture) {
			const config = this.cultureConfigs.get(culture);
			return config ? config.supportedStyles : [];
		}

		const allStyles = new Set<string>();
		for (const config of this.cultureConfigs.values()) {
			config.supportedStyles.forEach(style => allStyles.add(style));
		}
		return Array.from(allStyles);
	}

	/**
	 * 获取生成统计
	 */
	getStats(): NameStats {
		return { ...this.stats };
	}

	/**
	 * 重置统计
	 */
	resetStats(): void {
		this.stats = {
			totalGenerated: 0,
			byCulture: {},
			byGender: {},
			byStyle: {}
		};
	}

	/**
	 * 注册新的生成策略
	 */
	registerStrategy(strategy: NameGenerationStrategy): void {
		this.strategies.set(strategy.name, strategy);
	}

	/**
	 * 选择最适合的生成策略
	 */
	private selectStrategy(options: NameGenerationOptions): NameGenerationStrategy {
		const culture = options.culture || 'zh_CN';
		const style = options.style || 'modern';

		// 首先寻找完全匹配的策略
		for (const strategy of this.strategies.values()) {
			if (strategy.supports(options)) {
				return strategy;
			}
		}

		// 回退到通用策略
		const fallback = this.strategies.get('fallback');
		if (fallback) {
			return fallback;
		}

		// 最后的保障
		const strategies = this.strategies.values();
		const nextStrategy = strategies.next();
		return nextStrategy.value || this.strategies.get('fallback')!;
	}

	/**
	 * 更新统计信息
	 */
	private updateStats(names: GeneratedName[]): void {
		this.stats.totalGenerated += names.length;

		names.forEach(name => {
			this.stats.byCulture[name.culture] = (this.stats.byCulture[name.culture] || 0) + 1;
			this.stats.byGender[name.gender] = (this.stats.byGender[name.gender] || 0) + 1;
			this.stats.byStyle[name.style] = (this.stats.byStyle[name.style] || 0) + 1;
		});
	}

	/**
	 * 获取文化的本地化显示名称
	 */
	public static getLocalizedName(culture: string): string {
		// 获取 VS Code 当前显示语言，并进行规范化（如 zh-cn -> zh）
		const currentLangRaw = vscode.env.language || '';
		const normalized = currentLangRaw.toLowerCase();
		const baseLang = normalized.split('-')[0]; // 只取主语言部分

		// 文化显示名称映射（支持多语言）
		const displayNames = {
			'zh_CN': {
				'zh': '中文（简体）',
				'en': 'Chinese (Simplified)',
				'ja': '中国語（簡体）',
				'ko': '중국어 (간체)',
				'default': '中文（简体）'
			},
			'zh_TW': {
				'zh': '中文（繁體）',
				'en': 'Chinese (Traditional)',
				'ja': '中国語（繁體）',
				'ko': '중국어 (번체)',
				'default': '中文（繁體）'
			},
			'en_US': {
				'zh': '英文（美国）',
				'en': 'English (US)',
				'ja': '英語（アメリカ）',
				'ko': '영어 (미국)',
				'default': 'English (US)'
			},
			'en_GB': {
				'zh': '英文（英国）',
				'en': 'English (UK)',
				'ja': '英語（イギリス）',
				'ko': '영어 (영국)',
				'default': 'English (UK)'
			},
			'fr': {
				'zh': '法文',
				'en': 'French',
				'ja': 'フランス語',
				'ko': '프랑스어',
				'default': 'Français'
			},
			'fr_CA': {
				'zh': '法文（加拿大）',
				'en': 'French (Canada)',
				'ja': 'フランス語（カナダ）',
				'ko': '프랑스어 (캐나다)',
				'default': 'Français (Canada)'
			},
			'de': {
				'zh': '德文',
				'en': 'German',
				'ja': 'ドイツ語',
				'ko': '독일어',
				'default': 'Deutsch'
			},
			'de_AT': {
				'zh': '德文（奥地利）',
				'en': 'German (Austria)',
				'ja': 'ドイツ語（オーストリア）',
				'ko': '독일어 (오스트리아)',
				'default': 'Deutsch (Österreich)'
			},
			'de_CH': {
				'zh': '德文（瑞士）',
				'en': 'German (Switzerland)',
				'ja': 'ドイツ語（スイス）',
				'ko': '독일어 (스위스)',
				'default': 'Deutsch (Schweiz)'
			},
			'es': {
				'zh': '西班牙文',
				'en': 'Spanish',
				'ja': 'スペイン語',
				'ko': '스페인어',
				'default': 'Español'
			},
			'es_MX': {
				'zh': '西班牙文（墨西哥）',
				'en': 'Spanish (Mexico)',
				'ja': 'スペイン語（メキシコ）',
				'ko': '스페인어 (멕시코)',
				'default': 'Español (México)'
			},
			'it': {
				'zh': '意大利文',
				'en': 'Italian',
				'ja': 'イタリア語',
				'ko': '이탈리아어',
				'default': 'Italiano'
			},
			'pt_BR': {
				'zh': '葡萄牙文（巴西）',
				'en': 'Portuguese (Brazil)',
				'ja': 'ポルトガル語（ブラジル）',
				'ko': '포르투갈어 (브라질)',
				'default': 'Português (Brasil)'
			},
			'pt_PT': {
				'zh': '葡萄牙文（葡萄牙）',
				'en': 'Portuguese (Portugal)',
				'ja': 'ポルトガル語（ポルトガル）',
				'ko': '포르투갈어 (포르투갈)',
				'default': 'Português (Portugal)'
			},
			'ru': {
				'zh': '俄文',
				'en': 'Russian',
				'ja': 'ロシア語',
				'ko': '러시아어',
				'default': 'Русский'
			},
			'ja': {
				'zh': '日语',
				'en': 'Japanese',
				'ja': '日本語',
				'ko': '일본어',
				'default': '日本語'
			},
			'ja_JP': {
				'zh': '日语',
				'en': 'Japanese',
				'ja': '日本語',
				'ko': '일본어',
				'default': '日本語'
			},
			'ko': {
				'zh': '韩文',
				'en': 'Korean',
				'ja': '韓国語',
				'ko': '한국어',
				'default': '한국어'
			},
			'ar': {
				'zh': '阿拉伯文',
				'en': 'Arabic',
				'ja': 'アラビア語',
				'ko': '아랍어',
				'default': 'العربية'
			},
			'he': {
				'zh': '希伯来文',
				'en': 'Hebrew',
				'ja': 'ヘブライ語',
				'ko': '히브리어',
				'default': 'עברית'
			},
			'th': {
				'zh': '泰文',
				'en': 'Thai',
				'ja': 'タイ語',
				'ko': '태국어',
				'default': 'ไทย'
			},
			'vi': {
				'zh': '越南文',
				'en': 'Vietnamese',
				'ja': 'ベトナム語',
				'ko': '베트남어',
				'default': 'Tiếng Việt'
			},
			'ne': {
				'zh': '尼泊尔文',
				'en': 'Nepali',
				'ja': 'ネパール語',
				'ko': '네팔르어',
				'default': 'नेपाली'
			},
			'hi': {
				'zh': '印地文',
				'en': 'Hindi',
				'ja': 'ヒンディー語',
				'ko': '힌디어',
				'default': 'हिन्दी'
			},
			'sv': {
				'zh': '瑞典文',
				'en': 'Swedish',
				'ja': 'スウェーデン語',
				'ko': '스웨덴어',
				'default': 'Svenska'
			},
			'nb_NO': {
				'zh': '挪威文',
				'en': 'Norwegian',
				'ja': 'ノルウェー語',
				'ko': '노르웨이어',
				'default': 'Norsk'
			},
			'da': {
				'zh': '丹麦文',
				'en': 'Danish',
				'ja': 'デンマーク語',
				'ko': '덴마마크어',
				'default': 'Dansk'
			},
			'fi': {
				'zh': '芬兰文',
				'en': 'Finnish',
				'ja': 'フィンランド語',
				'ko': '핀란드어',
				'default': 'Suomi'
			},
			'nl': {
				'zh': '荷兰文',
				'en': 'Dutch',
				'ja': 'オランダ語',
				'ko': '네덜란드어',
				'default': 'Nederlands'
			},
			'pl': {
				'zh': '波兰文',
				'en': 'Polish',
				'ja': 'ポーランド語',
				'ko': '폴란드어',
				'default': 'Polski'
			},
			'cs_CZ': {
				'zh': '捷克文',
				'en': 'Czech',
				'ja': 'チェコ語',
				'ko': '체코어',
				'default': 'Čeština'
			},
			'hu': {
				'zh': '匈牙利文',
				'en': 'Hungarian',
				'ja': 'ハンガリー語',
				'ko': '헝가리어',
				'default': 'Magyar'
			},
			'hr': {
				'zh': '克罗地亚文',
				'en': 'Croatian',
				'ja': 'クロアチア語',
				'ko': '크로아티아어',
				'default': 'Hrvatski'
			},
			'ro': {
				'zh': '罗马尼亚文',
				'en': 'Romanian',
				'ja': 'ルーマニア語',
				'ko': '루마니아어',
				'default': 'Română'
			},
			'el': {
				'zh': '希腊文',
				'en': 'Greek',
				'ja': 'ギリシャ語',
				'ko': '그리스어',
				'default': 'Ελληνικά'
			},
			'tr': {
				'zh': '土耳其文',
				'en': 'Turkish',
				'ja': 'トルコ語',
				'ko': '터키어',
				'default': 'Türkçe'
			}
		};

		// 辅助函数：获取本地化显示名称
		const nameMap = displayNames[culture as keyof typeof displayNames];
		if (nameMap) {
			// 尝试按规范化后的主语言（如 zh/en/ja/ko）查找，否则回退到默认（自称）
			return (nameMap[baseLang as keyof typeof nameMap]) || nameMap['default'];
		}
		return culture;
	}

	/**
	 * 初始化文化配置
	 */
	private initializeCultureConfigs(): void {
		// 中文配置
		this.cultureConfigs.set('zh_CN', {
			code: 'zh_CN',
			displayName: NameGeneratorService.getLocalizedName('zh_CN'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'zh_cn'
		});

		// 繁体中文配置
		this.cultureConfigs.set('zh_TW', {
			code: 'zh_TW',
			displayName: NameGeneratorService.getLocalizedName('zh_TW'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'zh_tw'
		});

		// 英文配置
		this.cultureConfigs.set('en_US', {
			code: 'en_US',
			displayName: NameGeneratorService.getLocalizedName('en_US'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'sci-fi'],
			defaultStrategy: 'en_us'
		});

		// 英文（英国）配置
		this.cultureConfigs.set('en_GB', {
			code: 'en_GB',
			displayName: NameGeneratorService.getLocalizedName('en_GB'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'en_gb'
		});

		// 法文配置
		this.cultureConfigs.set('fr', {
			code: 'fr',
			displayName: NameGeneratorService.getLocalizedName('fr'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'fr'
		});

		// 法文（加拿大）配置
		this.cultureConfigs.set('fr_CA', {
			code: 'fr_CA',
			displayName: NameGeneratorService.getLocalizedName('fr_CA'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'fr_ca'
		});

		// 德文配置
		this.cultureConfigs.set('de', {
			code: 'de',
			displayName: NameGeneratorService.getLocalizedName('de'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'de'
		});

		// 德文（奥地利）配置
		this.cultureConfigs.set('de_AT', {
			code: 'de_AT',
			displayName: NameGeneratorService.getLocalizedName('de_AT'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'de_at'
		});

		// 德文（瑞士）配置
		this.cultureConfigs.set('de_CH', {
			code: 'de_CH',
			displayName: NameGeneratorService.getLocalizedName('de_CH'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'de_ch'
		});

		// 西班牙文配置
		this.cultureConfigs.set('es', {
			code: 'es',
			displayName: NameGeneratorService.getLocalizedName('es'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'es'
		});

		// 西班牙文（墨西哥）配置
		this.cultureConfigs.set('es_MX', {
			code: 'es_MX',
			displayName: NameGeneratorService.getLocalizedName('es_MX'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'es_mx'
		});

		// 意大利文配置
		this.cultureConfigs.set('it', {
			code: 'it',
			displayName: NameGeneratorService.getLocalizedName('it'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'it'
		});

		// 葡萄牙文（巴西）配置
		this.cultureConfigs.set('pt_BR', {
			code: 'pt_BR',
			displayName: NameGeneratorService.getLocalizedName('pt_BR'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'pt_br'
		});

		// 葡萄牙文（葡萄牙）配置
		this.cultureConfigs.set('pt_PT', {
			code: 'pt_PT',
			displayName: NameGeneratorService.getLocalizedName('pt_PT'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'pt_pt'
		});

		// 俄文配置
		this.cultureConfigs.set('ru', {
			code: 'ru',
			displayName: NameGeneratorService.getLocalizedName('ru'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'ru'
		});

		// 日语配置
		this.cultureConfigs.set('ja', {
			code: 'ja',
			displayName: NameGeneratorService.getLocalizedName('ja'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'faker_locale'
		});

		// 韩文配置
		this.cultureConfigs.set('ko', {
			code: 'ko',
			displayName: NameGeneratorService.getLocalizedName('ko'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'ko'
		});

		// 阿拉伯文配置
		this.cultureConfigs.set('ar', {
			code: 'ar',
			displayName: NameGeneratorService.getLocalizedName('ar'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'ar'
		});

		// 印地文配置
		this.cultureConfigs.set('ne', {
			code: 'ne',
			displayName: NameGeneratorService.getLocalizedName('ne'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'ne'
		});

		// 北欧语言配置
		this.cultureConfigs.set('sv', {
			code: 'sv',
			displayName: NameGeneratorService.getLocalizedName('sv'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'sv'
		});

		this.cultureConfigs.set('nb_NO', {
			code: 'nb_NO',
			displayName: NameGeneratorService.getLocalizedName('nb_NO'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'nb_no'
		});

		this.cultureConfigs.set('da', {
			code: 'da',
			displayName: NameGeneratorService.getLocalizedName('da'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'da'
		});

		this.cultureConfigs.set('fi', {
			code: 'fi',
			displayName: NameGeneratorService.getLocalizedName('fi'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'fi'
		});

		// 东欧语言配置
		this.cultureConfigs.set('pl', {
			code: 'pl',
			displayName: NameGeneratorService.getLocalizedName('pl'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'pl'
		});

		this.cultureConfigs.set('cs_CZ', {
			code: 'cs_CZ',
			displayName: NameGeneratorService.getLocalizedName('cs_CZ'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'cs_cz'
		});

		this.cultureConfigs.set('hu', {
			code: 'hu',
			displayName: NameGeneratorService.getLocalizedName('hu'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'hu'
		});

		this.cultureConfigs.set('hr', {
			code: 'hr',
			displayName: NameGeneratorService.getLocalizedName('hr'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'hr'
		});

		this.cultureConfigs.set('ro', {
			code: 'ro',
			displayName: NameGeneratorService.getLocalizedName('ro'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'ro'
		});

		// 南欧语言配置
		this.cultureConfigs.set('el', {
			code: 'el',
			displayName: NameGeneratorService.getLocalizedName('el'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'el'
		});

		this.cultureConfigs.set('tr', {
			code: 'tr',
			displayName: NameGeneratorService.getLocalizedName('tr'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'tr'
		});

		this.cultureConfigs.set('he', {
			code: 'he',
			displayName: NameGeneratorService.getLocalizedName('he'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'he'
		});

		// 亚洲其他语言
		this.cultureConfigs.set('th', {
			code: 'th',
			displayName: NameGeneratorService.getLocalizedName('th'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'th'
		});

		this.cultureConfigs.set('vi', {
			code: 'vi',
			displayName: NameGeneratorService.getLocalizedName('vi'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'vi'
		});

		this.cultureConfigs.set('id_ID', {
			code: 'id_ID',
			displayName: NameGeneratorService.getLocalizedName('id_ID'),
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['modern', 'classic', 'fantasy', 'historical'],
			defaultStrategy: 'id_id'
		});

		// 奇幻风格配置
		this.cultureConfigs.set('fantasy', {
			code: 'fantasy',
			displayName: '奇幻风格',
			supportedGenders: ['male', 'female', 'neutral'],
			supportedStyles: ['fantasy', 'high-fantasy', 'dark-fantasy'],
			defaultStrategy: 'fantasy'
		});
	}

	/**
	 * 初始化生成策略
	 */
	private initializeStrategies(): void {
		// 奇幻策略
		this.registerStrategy(new FantasyNameStrategy());

		// 通用 Faker 策略（支持所有 faker 本地化，包括中文和日语）
		this.registerStrategy(new FakerLocaleStrategy());

		// 回退策略
		this.registerStrategy(new FallbackNameStrategy());
	}
}



/**
 * 奇幻名字生成策略
 */
class FantasyNameStrategy implements NameGenerationStrategy {
	name = 'fantasy';

	supportedCultures = ['fantasy'];

	supports(options: NameGenerationOptions): boolean {
		return options.culture === 'fantasy' || (options.style?.includes('fantasy') ?? false);
	}

	async generate(options: NameGenerationOptions): Promise<GeneratedName[]> {
		const results: GeneratedName[] = [];
		const count = options.count || 1;

		// 奇幻风格的音节库
		const prefixes = ['Al', 'El', 'Mor', 'Gal', 'Ara', 'Sil', 'Val', 'Lor', 'Cel', 'Nim'];
		const middles = ['dor', 'wen', 'ian', 'eth', 'ara', 'riel', 'dor', 'gorn', 'dil', 'las'];
		const suffixes = ['as', 'ion', 'iel', 'orn', 'eth', 'ara', 'wen', 'dor', 'las', 'th'];

		const titles = ['the Brave', 'the Wise', 'Shadow', 'Light', 'Storm', 'Star', 'Moon', 'Sun'];

		for (let i = 0; i < count; i++) {
			const gender = options.gender === 'any' ?
				(['male', 'female', 'neutral'] as const)[Math.floor(Math.random() * 3)] :
				(options.gender as 'male' | 'female' | 'neutral') || 'male';

			const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
			const middle = middles[Math.floor(Math.random() * middles.length)];
			const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];

			let firstName = prefix + middle + suffix;
			if (gender === 'female' && Math.random() > 0.5) {
				firstName += Math.random() > 0.5 ? 'a' : 'ia';
			}

			const useTitle = options.style?.includes('high-fantasy') && Math.random() > 0.7;
			const title = useTitle ? ' ' + titles[Math.floor(Math.random() * titles.length)] : '';

			const fullName = firstName + title;

			results.push({
				fullName: fullName.trim(),
				firstName,
				culture: 'fantasy',
				gender,
				style: options.style || 'fantasy',
				origin: 'Fantasy'
			});
		}

		return results;
	}
}

/**
 * 通用 Faker 本地化名字生成策略
 * 支持所有 faker 本地化，包括各种欧洲语言和其他语言
 */
class FakerLocaleStrategy implements NameGenerationStrategy {
	name = 'faker_locale';

	// 支持除了特殊处理（奇幻）之外的所有文化
	supportedCultures = [
		'en_US', 'en_GB', 'en_AU', 'en_CA', 'en_IE', 'en_IN', 'en_NG', 'en_ZA',
		'fr', 'fr_CA', 'fr_BE', 'fr_CH',
		'de', 'de_AT', 'de_CH',
		'es', 'es_MX',
		'it', 'pt_BR', 'pt_PT',
		'ru', 'pl', 'cs_CZ', 'hu', 'hr', 'ro', 'sk', 'uk',
		'sv', 'nb_NO', 'da', 'fi', 'is',
		'nl',
		'el', 'tr', 'he',
		'zh_CN', 'zh_TW',
		'ja', 'ko', 'th', 'vi',
		'ar', 'fa', 'ur', 'hi'
	];

	supports(options: NameGenerationOptions): boolean {
		return this.supportedCultures.includes(options.culture as string);
	}

	async generate(options: NameGenerationOptions): Promise<GeneratedName[]> {
		const results: GeneratedName[] = [];
		const count = options.count || 1;
		const culture = options.culture || 'en_US';

		// 使用模块化导入获取正确的本地化 faker 实例
		let faker: any;
		try {
			// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
			const localeModule = require(`@faker-js/faker/locale/${this.getFakerModulePath(culture)}`);
			faker = localeModule.faker;
		} catch (error) {
			console.warn(`Failed to load locale ${culture} for faker:`, error);
			// 如果加载失败，回退到英文
			try {
				// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
				const fallbackModule = require('@faker-js/faker/locale/en');
				faker = fallbackModule.faker;
			} catch (fallbackError) {
				console.warn(`Failed to load fallback locale for faker:`, fallbackError);
				return Promise.resolve(this.createFallbackNames(culture, count));
			}
		}

		for (let i = 0; i < count; i++) {
			try {
				let firstName: string;
				let lastName: string;

				// 根据性别选择名字
				const selectedGender = options.gender === 'any' ?
					(['male', 'female', 'neutral'] as const)[Math.floor(Math.random() * 3)] :
					(options.gender as 'male' | 'female' | 'neutral') || 'male';

				// 尝试使用本地化的 faker API
				if (faker.person) {
					firstName = faker.person.firstName(selectedGender === 'neutral' ? undefined : selectedGender);
					lastName = faker.person.lastName();
				} else if (faker.name) {
					firstName = faker.name.firstName(selectedGender === 'neutral' ? undefined : selectedGender);
					lastName = faker.name.lastName();
				} else {
					throw new Error('Faker API not available');
				}

				let fullName: string;
				let alternativeFullName: string | undefined;

				if (culture === 'zh_CN' || culture === 'zh_TW') {
					// 中文名字：姓氏 + 名字
					fullName = `${lastName}${firstName}`;
				} else if (culture === 'ja') {
					// 日语姓氏：姓氏 + 名字（中间无空格用于插入）
					fullName = `${lastName}${firstName}`;
					// 但在别名中使用带空格的版本（用于显示）
					alternativeFullName = `${lastName} ${firstName}`;
				} else if (culture === 'ko') {
					// 韩文姓氏：姓氏 + 名字（中间无空格）
					fullName = `${lastName}${firstName}`;
				} else {
					// 西方名字：名字 + 姓氏
					fullName = `${firstName} ${lastName}`;
				}

				const generatedName: GeneratedName = {
					firstName,
					fullName,
					lastName,
					culture,
					gender: selectedGender,
					style: options.style || 'modern',
					origin: `Faker (${culture})`,
					original: firstName,
					translation: alternativeFullName || fullName
				};

				// 如果有替代全名，添加到结果中
				if (alternativeFullName) {
					generatedName.alternativeFullName = alternativeFullName;
				}

				results.push(generatedName);
			} catch (error) {
				console.error(`Error generating name for culture ${culture}:`, error);
				// 如果失败，生成一个简单的回退名字
				results.push(this.createFallbackName(culture, i));
			}
		}

		return results;
	}

	/**
	 * 获取对应文化在 faker 模块中的路径
	 */
	private getFakerModulePath(culture: string): string {
		const cultureMap: { [key: string]: string } = {
			'en_US': 'en_US',
			'en_GB': 'en_GB',
			'en_AU': 'en_AU',
			'en_CA': 'en_CA',
			'en_IE': 'en_IE',
			'en_IN': 'en_IN',
			'en_NG': 'en_NG',
			'en_ZA': 'en_ZA',
			'fr': 'fr',
			'fr_CA': 'fr_CA',
			'fr_BE': 'fr_BE',
			'fr_CH': 'fr_CH',
			'de': 'de',
			'de_AT': 'de_AT',
			'de_CH': 'de_CH',
			'es': 'es',
			'es_MX': 'es_MX',
			'it': 'it',
			'pt': 'pt_PT',
			'pt_BR': 'pt_BR',
			'ru': 'ru',
			'pl': 'pl',
			'cs_CZ': 'cs_CZ',
			'hu': 'hu',
			'hr': 'hr',
			'ro': 'ro',
			'sk': 'sk',
			'uk': 'uk',
			'sv': 'sv',
			'nb_NO': 'nb_NO',
			'da': 'da',
			'fi': 'fi',
			'is': 'is',
			'nl': 'nl',
			'el': 'el',
			'tr': 'tr',
			'he': 'he',
			'zh_CN': 'zh_CN',
			'zh_TW': 'zh_TW',
			'ja': 'ja',
			'ko': 'ko',
			'th': 'th',
			'vi': 'vi',
			'ar': 'ar',
			'fa': 'fa',
			'ur': 'ur',
			'hi': 'hi'
		};

		return cultureMap[culture] || 'en';
	}

	/**
	 * 创建后备名字（当本地化加载失败时使用）
	 */
	private createFallbackNames(culture: string, count: number): GeneratedName[] {
		const names: GeneratedName[] = [];
		for (let i = 0; i < count; i++) {
			names.push(this.createFallbackName(culture, i));
		}
		return names;
	}

	/**
	 * 创建单个后备名字
	 */
	private createFallbackName(culture: string, index: number): GeneratedName {
		const fallbackNames: { [key: string]: string[] } = {
			'zh_CN': ['张伟', '李娜', '王芳', '刘洋', '陈静'],
			'zh_TW': ['張偉', '李娜', '王芳', '劉洋', '陳靜'],
			'ja': ['佐藤誠', '鈴木恵子', '高橋大輔', '田中あや', '伊藤隆'],
			'ko': ['김철수', '이영희', '박민준', '최서윤', '정지원'],
			'ar': ['أحمد علي', 'فاطمة محمد', 'عمر خالد', 'مريم إبراهيم', 'يوسف حسن'],
			'hi': ['राम कुमार', 'सीता देवी', 'मोहन सिंह', 'लक्ष्मी बाई', 'गोपाल प्रसाद'],
			'ru': ['Александр Иванов', 'Мария Петрова', 'Дмитрий Сидоров', 'Елена Кузнецова', 'Сергей Попов']
		};

		const defaultFallback = ['Alex Chen', 'Maria Silva', 'John Smith', 'Sarah Johnson', 'Carlos Rodriguez'];
		const nameList = fallbackNames[culture] || defaultFallback;
		const name = nameList[index % nameList.length];

		const firstName = culture === 'zh_CN' || culture === 'zh_TW' || culture === 'ja' || culture === 'ko' ?
			name.substring(1) : name.split(' ')[0];
		const lastName = culture === 'zh_CN' || culture === 'zh_TW' || culture === 'ja' || culture === 'ko' ?
			name.substring(0, 1) : name.split(' ').slice(-1)[0];

		return {
			firstName,
			fullName: name,
			lastName,
			culture,
			gender: 'neutral',
			style: 'modern',
			origin: 'Fallback',
			original: firstName,
			translation: name
		};
	}
}

/**
 * 回退名字生成策略
 */
class FallbackNameStrategy implements NameGenerationStrategy {
	name = 'fallback';

	supportedCultures = ['fallback'];

	supports(options: NameGenerationOptions): boolean {
		return true; // 总是支持
	}

	async generate(options: NameGenerationOptions): Promise<GeneratedName[]> {
		const results: GeneratedName[] = [];
		const count = options.count || 1;

		// 最简单的名字生成
		const baseNames = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Avery'];

		for (let i = 0; i < count; i++) {
			const firstName = baseNames[Math.floor(Math.random() * baseNames.length)];
			const number = Math.floor(Math.random() * 999);
			const fullName = `${firstName}${number}`;

			results.push({
				firstName,
				fullName,
				culture: 'fallback',
				gender: 'neutral',
				style: 'neutral',
				origin: 'Fallback',
				original: firstName,
				translation: fullName
			});
		}

		return results;
	}
}

// 导出单例实例
export const nameGeneratorService = new NameGeneratorService();