import * as vscode from 'vscode';
import { nameGeneratorService } from '../../services/nameGeneratorService';
import { NameGenerationOptions, GeneratedName } from '../../types/names';

/**
 * 获取语言的本机名称映射
 */
export function getNativeNames(): Record<string, string> {
	return {
		'zh_CN': '简体中文',
		'zh_TW': '繁體中文',
		'en_US': 'English (US)',
		'en_GB': 'English (UK)',
		'en_AU': 'English (Australia)',
		'en_CA': 'English (Canada)',
		'en_IE': 'English (Ireland)',
		'en_IN': 'English (India)',
		'en_NG': 'English (Nigeria)',
		'en_ZA': 'English (South Africa)',
		'fr': 'Français',
		'fr_CA': 'Français (Canada)',
		'fr_BE': 'Français (Belgique)',
		'fr_CH': 'Français (Suisse)',
		'de': 'Deutsch',
		'de_AT': 'Deutsch (Österreich)',
		'de_CH': 'Deutsch (Schweiz)',
		'es': 'Español',
		'es_MX': 'Español (México)',
		'it': 'Italiano',
		'pt_BR': 'Português (Brasil)',
		'pt_PT': 'Português (Portugal)',
		'ru': 'Русский',
		'ja': '日本語',
		'ko': '한국어',
		'th': 'ไทย',
		'vi': 'Tiếng Việt',
		'ar': 'العربية',
		'fa': 'فارسی',
		'ur': 'اردو',
		'hi': 'हिन्दी',
		'pl': 'Polski',
		'cs_CZ': 'Čeština',
		'hu': 'Magyar',
		'hr': 'Hrvatski',
		'ro': 'Română',
		'sk': 'Slovenčina',
		'uk': 'Українська',
		'sv': 'Svenska',
		'nb_NO': 'Norsk',
		'da': 'Dansk',
		'fi': 'Suomi',
		'is': 'Íslenska',
		'nl': 'Nederlands',
		'el': 'Ελληνικά',
		'tr': 'Türkçe',
		'he': 'עברית',
		'fantasy': 'Fantasy'
	};
}

/**
 * 显示文化选择界面
 */
export async function showCultureSelection(title?: string): Promise<{label: string, culture: string} | undefined> {
	const cultures = nameGeneratorService.getSupportedCultures();
	const nativeNames = getNativeNames();

	// 根据当前界面语言决定显示格式
	const cultureOptions = cultures.map(c => {
		const nativeName = nativeNames[c.code] || c.code;
		const localizedName = c.displayName; // 已经是根据当前界面语言本地化的名称
		const label = `${nativeName} (${c.code}) [${localizedName}]`;

		return {
			label,
			culture: c.code
		};
	});

	const selectedCulture = await vscode.window.showQuickPick(cultureOptions, {
		placeHolder: '选择角色的文化背景',
		title: title || '选择文化背景'
	});

	return selectedCulture;
}

/**
 * 显示单独的文化选择界面（用于姓氏或名字）
 */
export async function showSeparateCultureSelection(partName: string, title?: string): Promise<{label: string, culture: string} | undefined> {
	const cultures = nameGeneratorService.getSupportedCultures();
	const nativeNames = getNativeNames();

	// 根据当前界面语言决定显示格式
	const cultureOptions = cultures.map(c => {
		const nativeName = nativeNames[c.code] || c.code;
		const localizedName = c.displayName; // 已经是根据当前界面语言本地化的名称
		const label = `${nativeName} (${c.code}) [${localizedName}]`;

		return {
			label,
			culture: c.code
		};
	});

	const selectedCulture = await vscode.window.showQuickPick(cultureOptions, {
		placeHolder: `选择${partName}的文化背景`,
		title: title || `选择${partName}文化背景`
	});

	return selectedCulture;
}

/**
 * 显示性别选择界面
 */
export async function showGenderSelection(title?: string): Promise<{label: string, value: 'male' | 'female' | 'neutral' | 'any'} | undefined> {
	const genderOptions = [
		{ label: '男性', value: 'male' as const },
		{ label: '女性', value: 'female' as const },
		{ label: '中性', value: 'neutral' as const },
		{ label: '随机', value: 'any' as const }
	];

	const selectedGender = await vscode.window.showQuickPick(genderOptions, {
		placeHolder: '选择角色性别',
		title: title || '选择性别'
	});

	return selectedGender;
}

/**
 * 显示风格选择界面
 */
export async function showStyleSelection(culture: string, title?: string): Promise<{label: string, value: string} | undefined> {
	const availableStyles = nameGeneratorService.getAvailableStyles(culture);
	const styleOptions = availableStyles.map(style => ({
		label: getStyleDisplayName(style),
		value: style
	}));

	const selectedStyle = await vscode.window.showQuickPick(styleOptions, {
		placeHolder: '选择名字风格',
		title: title || '选择风格'
	});

	return selectedStyle;
}

/**
 * 获取风格的显示名称
 */
export function getStyleDisplayName(style: string): string {
	const styleNames: Record<string, string> = {
		'modern': '现代',
		'classic': '经典',
		'fantasy': '奇幻',
		'sci-fi': '科幻',
		'historical': '历史',
		'high-fantasy': '高等奇幻',
		'dark-fantasy': '黑暗奇幻'
	};

	return styleNames[style] || style;
}

/**
 * 显示生成顺序选择界面
 */
export async function showGenerationOrderSelection(title?: string): Promise<{ label: string, value: string } | undefined> {
	const orderOptions = [
		{ label: '先随机姓氏，再随机名字', value: 'surname-first' },
		{ label: '先随机名字，再随机姓氏', value: 'firstname-first' },
		{ label: '输入自定义姓氏，然后随机名字', value: 'custom-surname' },
		{ label: '输入自定义名字，然后随机姓氏', value: 'custom-firstname' }
	];

	const selectedOrder = await vscode.window.showQuickPick(orderOptions, {
		placeHolder: '选择姓名生成顺序',
		title: title || '选择生成顺序'
	});

	return selectedOrder;
}

/**
 * 显示是否使用混合文化选择界面
 */
export async function showMixedCultureSelection(title?: string): Promise<boolean | undefined> {
	const mixedOptions = [
		{ label: '使用同一文化背景', value: false },
		{ label: '为姓氏和名字选择不同文化背景（生成复合姓名）', value: true }
	];

	const selectedOption = await vscode.window.showQuickPick(mixedOptions, {
		placeHolder: '选择文化背景设置',
		title: title || '文化背景设置'
	});

	return selectedOption?.value;
}

/**
 * 显示翻译选项选择界面
 */
export async function showTranslationSelection(title?: string): Promise<{ label: string, value: boolean } | undefined> {
	const translationOptions = [
		{ label: '是，生成本地化翻译别名', value: true },
		{ label: '否，仅使用原名', value: false }
	];

	const selectedOption = await vscode.window.showQuickPick(translationOptions, {
		placeHolder: '是否为生成的名字添加本地化翻译别名？',
		title: title || '选择翻译选项'
	});

	return selectedOption;
}

/**
 * 显示罗马字转写选项选择界面
 */
export async function showRomanizationSelection(title?: string): Promise<{ label: string, value: boolean } | undefined> {
	const romanizationOptions = [
		{ label: '是，生成罗马字转写别名', value: true },
		{ label: '否，跳过罗马字转写', value: false }
	];

	const selectedOption = await vscode.window.showQuickPick(romanizationOptions, {
		placeHolder: '是否为非罗马字姓名生成罗马字转写？（如中文姓名生成拼音）',
		title: title || '罗马字转写选项'
	});

	return selectedOption;
}

/**
 * 显示目标语言选择界面
 */
export async function showTargetLanguageSelection(title?: string): Promise<string | undefined> {
	const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
	const targets = cfg.get<string[]>('translate.targets', ['中文', '英文', '日语', '德语', '法语', '韩语', '繁体中文', '拉丁语', '希腊语']);

	const selectedTarget = await vscode.window.showQuickPick(targets, {
		placeHolder: '选择翻译目标语言',
		title: title || '选择目标语言'
	});

	return selectedTarget;
}

/**
 * 显示自定义姓氏输入界面
 */
export async function showCustomSurnameInput(options: NameGenerationOptions, title?: string): Promise<GeneratedName | undefined> {
	const customSurname = await vscode.window.showInputBox({
		placeHolder: '输入自定义姓氏',
		prompt: '请输入姓氏',
		title: title || '输入自定义姓氏',
		validateInput: (value) => {
			if (!value.trim()) {
				return '姓氏不能为空';
			}
			if (value.trim().length > 10) {
				return '姓氏长度不能超过10个字符';
			}
			return null;
		}
	});

	if (!customSurname) return undefined;

	return {
		fullName: customSurname.trim(),
		firstName: '',
		lastName: customSurname.trim(),
		culture: options.culture || 'zh_CN',
		gender: (options.gender === 'any' ? 'neutral' : (options.gender || 'neutral')) as 'male' | 'female' | 'neutral',
		style: options.style || 'modern',
		origin: '用户输入'
	};
}

/**
 * 显示自定义名字输入界面
 */
export async function showCustomFirstNameInput(options: NameGenerationOptions, title?: string): Promise<GeneratedName | undefined> {
	const customFirstName = await vscode.window.showInputBox({
		placeHolder: '输入自定义名字',
		prompt: '请输入名字',
		title: title || '输入自定义名字',
		validateInput: (value) => {
			if (!value.trim()) {
				return '名字不能为空';
			}
			if (value.trim().length > 20) {
				return '名字长度不能超过20个字符';
			}
			return null;
		}
	});

	if (!customFirstName) return undefined;

	return {
		fullName: customFirstName.trim(),
		firstName: customFirstName.trim(),
		lastName: '',
		culture: options.culture || 'zh_CN',
		gender: (options.gender === 'any' ? 'neutral' : (options.gender || 'neutral')) as 'male' | 'female' | 'neutral',
		style: options.style || 'modern',
		origin: '用户输入'
	};
}

/**
 * 显示数量输入界面
 */
export async function showCountInput(title?: string, defaultValue: string = '5'): Promise<number | undefined> {
	const countInput = await vscode.window.showInputBox({
		prompt: '输入生成数量',
		value: defaultValue,
		title: title || '输入生成数量',
		validateInput: (value) => {
			const num = parseInt(value);
			if (isNaN(num) || num < 1 || num > 50) {
				return '请输入1-50之间的数字';
			}
			return null;
		}
	});

	if (!countInput) return undefined;
	return parseInt(countInput);
}

/**
 * 显示是否包含姓氏选择界面
 */
export async function showIncludeSurnameSelection(title?: string): Promise<boolean | undefined> {
	const surnameOptions = [
		{ label: '包含姓氏', value: true },
		{ label: '仅名字', value: false }
	];

	const selectedOption = await vscode.window.showQuickPick(surnameOptions, {
		placeHolder: '是否包含姓氏',
		title: title || '是否包含姓氏'
	});

	return selectedOption?.value;
}