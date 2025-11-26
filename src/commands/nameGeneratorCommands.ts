import * as vscode from 'vscode';
import { nameGeneratorService } from '../services/nameGeneratorService';
import { NameGenerationOptions } from '../types/names';
import { generateRandomCharacterWorkflow, generateStepByStepCharacterWorkflow } from './nameGenerator/characterWorkflow';
import { showCountInput, showIncludeSurnameSelection } from './nameGenerator/uiComponents';
import { showNameSelection } from './nameGenerator/selectionComponents';
import { showStatsDialog } from './nameGenerator/statsDialog';

/**
 * 注册名字生成相关的命令
 */
export function registerNameGeneratorCommands(context: vscode.ExtensionContext): void {

	// 生成随机名字命令
	const generateNamesCommand = vscode.commands.registerCommand('andrea-novel-helper.generateRandomNames', async () => {
		await showNameGenerationDialog();
	});

	// 快速生成名字命令（使用默认设置）
	const quickGenerateCommand = vscode.commands.registerCommand('andrea-novel-helper.quickGenerateName', async () => {
		try {
			const names = await nameGeneratorService.generateNames({ count: 5 });
			await showNameSelection(names);
		} catch (error) {
			vscode.window.showErrorMessage(`生成名字失败: ${error}`);
		}
	});

	// 显示名字生成统计命令
	const showStatsCommand = vscode.commands.registerCommand('andrea-novel-helper.showNameGeneratorStats', async () => {
		const stats = nameGeneratorService.getStats();
		await showStatsDialog(stats);
	});

	// 随机生成角色命令
	const generateCharacterCommand = vscode.commands.registerCommand('andrea-novel-helper.generateRandomCharacter', async () => {
		await generateRandomCharacterWorkflow();
	});

	// 分步随机生成角色命令 - 新增
	const generateStepByStepCharacterCommand = vscode.commands.registerCommand('andrea-novel-helper.generateStepByStepCharacter', async () => {
		await generateStepByStepCharacterWorkflow();
	});

	context.subscriptions.push(generateNamesCommand, quickGenerateCommand, showStatsCommand, generateCharacterCommand, generateStepByStepCharacterCommand);
}

/**
 * 显示名字生成对话框
 */
async function showNameGenerationDialog(): Promise<void> {
	// 获取支持的文化列表
	const cultures = nameGeneratorService.getSupportedCultures();

	// 获取语言的本地名称（语言自己的表述）
	const getNativeNameForRegular = (cultureCode: string): string => {
		const nativeNames: { [key: string]: string } = {
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
		return nativeNames[cultureCode] || cultureCode;
	};

	// 根据当前界面语言决定显示格式
	const cultureOptions = cultures.map(c => {
		const nativeName = getNativeNameForRegular(c.code);
		const localizedName = c.displayName; // 已经是根据当前界面语言本地化的名称
		const label = `${nativeName} (${c.code}) [${localizedName}]`;

		return {
			label,
			description: c.code,
			culture: c.code
		};
	});

	// 文化选择
	const selectedCulture = await vscode.window.showQuickPick(cultureOptions, {
		placeHolder: '选择文化背景',
		canPickMany: false
	});

	if (!selectedCulture) {
		return;
	}

	// 性别选择
	const genderOptions = [
		{ label: '男性', value: 'male' as const },
		{ label: '女性', value: 'female' as const },
		{ label: '中性', value: 'neutral' as const },
		{ label: '任意', value: 'any' as const }
	];

	const selectedGender = await vscode.window.showQuickPick(genderOptions, {
		placeHolder: '选择性别',
		canPickMany: false
	});

	if (!selectedGender) {
		return;
	}

	// 风格选择
	const availableStyles = nameGeneratorService.getAvailableStyles(selectedCulture.culture);
	const styleOptions = availableStyles.map(style => ({
		label: getStyleDisplayName(style),
		value: style
	}));

	const selectedStyle = await vscode.window.showQuickPick(styleOptions, {
		placeHolder: '选择风格',
		canPickMany: false
	});

	if (!selectedStyle) {
		return;
	}

	// 数量输入
	const count = await showCountInput();
	if (!count) {
		return;
	}

	// 是否包含姓氏
	const includeSurname = await showIncludeSurnameSelection();
	if (includeSurname === undefined) {
		return;
	}

	// 生成名字
	try {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: '正在生成名字...',
			cancellable: false
		}, async (progress) => {
			progress.report({ increment: 0 });

			const options: NameGenerationOptions = {
				culture: selectedCulture.culture,
				gender: selectedGender.value,
				style: selectedStyle.value,
				count: count,
				includeSurname: includeSurname
			};

			const names = await nameGeneratorService.generateNames(options);

			progress.report({ increment: 100 });

			// 显示生成的名字
			await showNameSelection(names);
		});
	} catch (error) {
		vscode.window.showErrorMessage(`名字生成失败: ${error}`);
	}
}

/**
 * 获取风格的显示名称
 */
function getStyleDisplayName(style: string): string {
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