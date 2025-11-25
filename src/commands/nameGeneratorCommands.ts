import * as vscode from 'vscode';
import * as path from 'path';
import { nameGeneratorService } from '../services/nameGeneratorService';
import { NameGenerationOptions } from '../types/names';
import { selectOrCreateFile } from './addRoleFileSelector';
import { addRoleToFile } from '../utils/roleFileHandler';
import { generateRoleNameHash } from '../utils/uuidUtils';
import { loadRoles } from '../activate';
import { updateDecorations } from '../events/updateDecorations';
import { translateTextWithClientLLM } from '../typo/typoClientLLM';
import { showTranslationStatus, hideTranslationStatus } from '../typo/typoService';


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

	context.subscriptions.push(generateNamesCommand, quickGenerateCommand, showStatsCommand, generateCharacterCommand);
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
	const countInput = await vscode.window.showInputBox({
		prompt: '输入生成数量',
		value: '5',
		validateInput: (value) => {
			const num = parseInt(value);
			if (isNaN(num) || num < 1 || num > 50) {
				return '请输入1-50之间的数字';
			}
			return null;
		}
	});

	if (!countInput) {
		return;
	}

	const count = parseInt(countInput);

	// 是否包含姓氏
	const includeSurname = await vscode.window.showQuickPick([
		{ label: '包含姓氏', value: true },
		{ label: '仅名字', value: false }
	], {
		placeHolder: '是否包含姓氏',
		canPickMany: false
	});

	if (!includeSurname) {
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
				includeSurname: includeSurname.value
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
 * 显示名字选择界面
 */
async function showNameSelection(names: any[]): Promise<void> {
	if (names.length === 0) {
		vscode.window.showInformationMessage('没有生成任何名字');
		return;
	}

	const nameOptions = names.map((name, index) => ({
		label: name.fullName,
		description: `${name.culture} | ${name.gender} | ${name.style}`,
		detail: `名: ${name.firstName}${name.lastName ? ` | 姓: ${name.lastName}` : ''} | 起源: ${name.origin}`,
		name: name
	}));

	const selected = await vscode.window.showQuickPick(nameOptions, {
		placeHolder: `已生成 ${names.length} 个名字，选择要使用的名字`,
		canPickMany: true
	});

	if (selected && selected.length > 0) {
		const selectedNames = selected.map(s => s.name.fullName);
		const action = await vscode.window.showQuickPick([
			{ label: '复制到剪贴板', value: 'clipboard' },
			{ label: '插入到当前文档', value: 'insert' },
			{ label: '显示详细选项', value: 'details' }
		], {
			placeHolder: '选择如何处理选中的名字',
			canPickMany: false
		});

		if (action) {
			switch (action.value) {
				case 'clipboard':
					await vscode.env.clipboard.writeText(selectedNames.join('\n'));
					vscode.window.showInformationMessage(`已复制 ${selectedNames.length} 个名字到剪贴板`);
					break;

				case 'insert':
					await insertNamesToDocument(selectedNames);
					break;

				case 'details':
					await showNameDetails(selected.map(s => s.name));
					break;
			}
		}
	}
}

/**
 * 将名字插入到当前文档
 */
async function insertNamesToDocument(names: string[]): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showWarningMessage('没有活动的编辑器');
		return;
	}

	const selection = editor.selection;
	const position = selection.isEmpty ? selection.start : selection.active;

	await editor.edit(editBuilder => {
		names.forEach((name, index) => {
			if (index > 0) {
				editBuilder.insert(position, '\n');
			}
			editBuilder.insert(position, name);
		});
	});

	vscode.window.showInformationMessage(`已插入 ${names.length} 个名字到文档`);
}

/**
 * 显示名字详细信息
 */
async function showNameDetails(names: any[]): Promise<void> {
	const panel = vscode.window.createWebviewPanel(
		'nameDetails',
		'名字详情',
		vscode.ViewColumn.One,
		{}
	);

	const html = `
	<!DOCTYPE html>
	<html lang="zh-CN">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>名字详情</title>
		<style>
			body { font-family: var(--vscode-font-family); padding: 20px; }
			.name-item { margin-bottom: 20px; padding: 15px; border: 1px solid var(--vscode-panel-border); border-radius: 5px; }
			.full-name { font-size: 18px; font-weight: bold; margin-bottom: 10px; color: var(--vscode-editor-foreground); }
			.details { font-size: 14px; color: var(--vscode-descriptionForeground); }
			.detail-item { margin: 5px 0; }
		</style>
	</head>
	<body>
		<h2>名字详情</h2>
		${names.map(name => `
			<div class="name-item">
				<div class="full-name">${name.fullName}</div>
				<div class="details">
					<div class="detail-item"><strong>名:</strong> ${name.firstName}</div>
					${name.lastName ? `<div class="detail-item"><strong>姓:</strong> ${name.lastName}</div>` : ''}
					<div class="detail-item"><strong>文化:</strong> ${name.culture}</div>
					<div class="detail-item"><strong>性别:</strong> ${name.gender}</div>
					<div class="detail-item"><strong>风格:</strong> ${name.style}</div>
					<div class="detail-item"><strong>起源:</strong> ${name.origin}</div>
				</div>
			</div>
		`).join('')}
	</body>
	</html>
	`;

	panel.webview.html = html;
}

/**
 * 显示统计对话框
 */
async function showStatsDialog(stats: any): Promise<void> {
	const panel = vscode.window.createWebviewPanel(
		'nameStats',
		'名字生成统计',
		vscode.ViewColumn.One,
		{}
	);

	const html = `
	<!DOCTYPE html>
	<html lang="zh-CN">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>名字生成统计</title>
		<style>
			body { font-family: var(--vscode-font-family); padding: 20px; }
			.stats-section { margin-bottom: 30px; }
			.stats-title { font-size: 16px; font-weight: bold; margin-bottom: 15px; color: var(--vscode-editor-foreground); }
			.stat-item { display: flex; justify-content: space-between; margin: 8px 0; padding: 5px 0; border-bottom: 1px solid var(--vscode-panel-border); }
			.stat-label { color: var(--vscode-descriptionForeground); }
			.stat-value { font-weight: bold; color: var(--vscode-editor-foreground); }
		</style>
	</head>
	<body>
		<h2>名字生成统计</h2>

		<div class="stats-section">
			<div class="stats-title">总体统计</div>
			<div class="stat-item">
				<span class="stat-label">总生成次数:</span>
				<span class="stat-value">${stats.totalGenerated}</span>
			</div>
		</div>

		<div class="stats-section">
			<div class="stats-title">按文化分类</div>
			${Object.entries(stats.byCulture).map(([culture, count]) => `
				<div class="stat-item">
					<span class="stat-label">${culture}:</span>
					<span class="stat-value">${count}</span>
				</div>
			`).join('')}
		</div>

		<div class="stats-section">
			<div class="stats-title">按性别分类</div>
			${Object.entries(stats.byGender).map(([gender, count]) => `
				<div class="stat-item">
					<span class="stat-label">${gender}:</span>
					<span class="stat-value">${count}</span>
				</div>
			`).join('')}
		</div>

		<div class="stats-section">
			<div class="stats-title">按风格分类</div>
			${Object.entries(stats.byStyle).map(([style, count]) => `
				<div class="stat-item">
					<span class="stat-label">${style}:</span>
					<span class="stat-value">${count}</span>
				</div>
			`).join('')}
		</div>
	</body>
	</html>
	`;

	panel.webview.html = html;
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

/**
 * 随机生成角色完整工作流程
 */
async function generateRandomCharacterWorkflow(): Promise<void> {
	try {
		// 步骤1：选择文化风格
		const cultureSelection = await showCultureSelection();
		if (!cultureSelection) return;

		// 步骤2：选择性别
		const genderSelection = await showGenderSelection();
		if (!genderSelection) return;

		// 步骤3：选择名字风格
		const styleSelection = await showStyleSelection(cultureSelection.culture);
		if (!styleSelection) return;

		// 步骤4：生成名字列表
		const generationOptions = {
			culture: cultureSelection.culture,
			gender: genderSelection.value,
			style: styleSelection.value,
			count: 10
		};
		const names = await generateCharacterNames(generationOptions);

		// 步骤5：显示名字选择界面
		const selectedName = await showCharacterNameSelection(names, generationOptions);
		if (!selectedName) return;

		// 步骤6：创建角色文件
		await createCharacterName(selectedName, generationOptions);

	} catch (error) {
		vscode.window.showErrorMessage(`角色生成失败: ${error}`);
	}
}

/**
 * 显示文化选择界面
 */
async function showCultureSelection(): Promise<{label: string, culture: string} | undefined> {
	const cultures = nameGeneratorService.getSupportedCultures();

	// 获取语言的本地名称（语言自己的表述）
	const getNativeName = (cultureCode: string): string => {
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
		const nativeName = getNativeName(c.code);
		const localizedName = c.displayName; // 已经是根据当前界面语言本地化的名称
		const label = `${nativeName} (${c.code}) [${localizedName}]`;

		return {
			label,
			culture: c.code
		};
	});

	const selectedCulture = await vscode.window.showQuickPick(cultureOptions, {
		placeHolder: '选择角色的文化背景',
		title: '随机生成角色 - 步骤 1/5: 选择文化背景'
	});

	return selectedCulture;
}

/**
 * 显示性别选择界面
 */
async function showGenderSelection(): Promise<{label: string, value: 'male' | 'female' | 'neutral' | 'any'} | undefined> {
	const genderOptions = [
		{ label: '男性', value: 'male' as const },
		{ label: '女性', value: 'female' as const },
		{ label: '中性', value: 'neutral' as const },
		{ label: '随机', value: 'any' as const }
	];

	const selectedGender = await vscode.window.showQuickPick(genderOptions, {
		placeHolder: '选择角色性别',
		title: '随机生成角色 - 步骤 2/5: 选择性别'
	});

	return selectedGender;
}

/**
 * 显示风格选择界面
 */
async function showStyleSelection(culture: string): Promise<{label: string, value: string} | undefined> {
	const availableStyles = nameGeneratorService.getAvailableStyles(culture);
	const styleOptions = availableStyles.map(style => ({
		label: getStyleDisplayName(style),
		value: style
	}));

	const selectedStyle = await vscode.window.showQuickPick(styleOptions, {
		placeHolder: '选择名字风格',
		title: '随机生成角色 - 步骤 3/5: 选择风格'
	});

	return selectedStyle;
}

/**
 * 生成角色名字列表
 */
async function generateCharacterNames(options: any): Promise<any[]> {
	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: '正在生成角色名字...',
		cancellable: false
	}, async (progress) => {
		progress.report({ increment: 0 });

		const names = await nameGeneratorService.generateNames(options);

		progress.report({ increment: 100 });
		return names;
	});

	return nameGeneratorService.generateNames(options);
}

/**
 * 显示角色名字选择界面（增强版，支持翻译和光标插入）
 */
async function showCharacterNameSelection(names: any[], generationOptions: any, wantTranslation?: { value: boolean }, targetLang?: string): Promise<any | undefined> {
	// 如果是第一次调用，需要询问翻译选项
	if (wantTranslation === undefined) {
		// 步骤1：询问是否需要翻译别名
		wantTranslation = await vscode.window.showQuickPick([
			{ label: '是，生成本地化翻译别名', value: true },
			{ label: '否，仅使用原名', value: false }
		], {
			placeHolder: '是否为生成的名字添加本地化翻译别名？',
			title: '随机生成角色 - 步骤 4/6: 选择翻译选项'
		});

		if (!wantTranslation) return undefined;
	}

	// 步骤2：如果需要翻译且还没有选择目标语言，询问目标语言
	if (wantTranslation.value && !targetLang) {
		const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
		const targets = cfg.get<string[]>('translate.targets', ['中文', '英文', '日语', '德语', '法语', '韩语', '繁体中文', '拉丁语', '希腊语']);

		const selectedTarget = await vscode.window.showQuickPick(targets, {
			placeHolder: '选择翻译目标语言',
			title: '随机生成角色 - 步骤 5/6: 选择目标语言'
		});

		if (!selectedTarget) return undefined;
		targetLang = selectedTarget;
	}

	// 步骤3：为所有名字生成翻译（如果需要）
	const namesWithTranslations = [];
	if (wantTranslation.value && targetLang) {
		try {
			showTranslationStatus('生成名字翻译');
			for (const name of names) {
				try {
					const translated = await translateTextWithClientLLM(name.fullName, targetLang);
					namesWithTranslations.push({
						...name,
						translatedName: translated.trim()
					});
				} catch {
					// 如果单个名字翻译失败，使用空字符串
					namesWithTranslations.push({
						...name,
						translatedName: ''
					});
				}
			}
			hideTranslationStatus();
		} catch (error) {
			hideTranslationStatus();
			vscode.window.showErrorMessage(`翻译失败: ${error}`);
			return undefined;
		}
	} else {
		// 不需要翻译，直接使用原名
		namesWithTranslations.push(...names.map(name => ({ ...name, translatedName: '' })));
	}

	// 步骤4：构建选择列表，第一项是重新生成
	type NameOption = { label: string; description: string; detail: string; name: any; index: number } | { label: string; value: string };

	const nameOptions: NameOption[] = [
		{ label: '🎲 重新生成', value: 'regenerate' },
		...namesWithTranslations.map((name, index) => ({
			label: name.alternativeFullName || name.fullName, // 对于日语名字，显示带空格的版本
			description: `${name.culture} | ${name.gender} | ${name.style}`,
			detail: wantTranslation.value && name.translatedName
				? `翻译: ${name.translatedName} | 名: ${name.firstName}${name.lastName ? ` | 姓: ${name.lastName}` : ''} | 起源: ${name.origin}`
				: `名: ${name.firstName}${name.lastName ? ` | 姓: ${name.lastName}` : ''} | 起源: ${name.origin}`,
			name: name,
			index: index
		}))
	];

	const selectedName = await vscode.window.showQuickPick(nameOptions, {
		placeHolder: '选择要创建的角色名字（第一项可重新生成）',
		title: `随机生成角色 - 步骤 6/6: 选择最终名字${wantTranslation.value ? ` (目标语言: ${targetLang})` : ''}`
	});

	if (!selectedName) return undefined;

	if ('value' in selectedName && selectedName.value === 'regenerate') {
		// 重新生成（保持之前的翻译选择，不重复询问）
		const newNames = await generateCharacterNames(generationOptions);
		return await showCharacterNameSelection(newNames, generationOptions, wantTranslation, targetLang);
	}

	// 步骤5：询问如何处理选中的名字
	const actionOptions = [
		{ label: '创建角色文件', value: 'createRole' },
		{ label: '插入名字到光标位置', value: 'insert' }
	];

	const action = await vscode.window.showQuickPick(actionOptions, {
		placeHolder: '选择如何处理选中的名字',
		title: '处理选中的名字'
	});

	if (!action) return undefined;

	if (action.value === 'insert') {
		// 直接插入到光标位置
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage('没有活动的编辑器');
			return undefined;
		}

		// 确保selectedName包含name属性
		if (!('name' in selectedName)) {
			vscode.window.showErrorMessage('选择的名字格式错误');
			return undefined;
		}

		// 对于日语名字，使用非空格版本进行插入
		let finalName = selectedName.name.fullName;

		if (wantTranslation.value && selectedName.name.translatedName) {
			// 如果有翻译，询问使用哪个版本
			const nameChoice = await vscode.window.showQuickPick([
				{ label: `使用原名: ${finalName}`, value: 'original' },
				{ label: `使用翻译: ${selectedName.name.translatedName}`, value: 'translated' },
				{ label: `同时使用: ${finalName} (${selectedName.name.translatedName})`, value: 'both' }
			], {
				placeHolder: '选择要插入的名字版本'
			});

			if (!nameChoice) return undefined;

			switch (nameChoice.value) {
				case 'translated':
					finalName = selectedName.name.translatedName;
					break;
				case 'both':
					finalName = `${finalName} (${selectedName.name.translatedName})`;
					break;
			}
		}

		const selection = editor.selection;
		const position = selection.isEmpty ? selection.start : selection.active;

		await editor.edit(editBuilder => {
			editBuilder.insert(position, finalName);
		});

		vscode.window.showInformationMessage(`已插入名字 "${finalName}" 到文档`);
		return undefined; // 不创建角色文件
	}

	// 默认行为：创建角色文件
	// 确保selectedName包含name属性
	if (!('name' in selectedName)) {
		vscode.window.showErrorMessage('选择的名字格式错误');
		return undefined;
	}
		return selectedName.name;
}

/**
 * 创建角色文件（增强版，支持翻译别名和光标插入）
 */
async function createCharacterName(selectedName: any, generationOptions?: any): Promise<void> {
	// 从配置获取默认文件名
	const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
	let defaultFileName = cfg.get<string>('rolesFile') || '角色库.json5';

	// 如果配置路径包含novel-helper/前缀，移除它
	if (defaultFileName.startsWith('novel-helper/')) {
		defaultFileName = defaultFileName.substring('novel-helper/'.length);
	}

	// 使用现有的文件选择器
	const fullPath = await selectOrCreateFile(
		'角色',
		defaultFileName,
		{
			includeMd: true,
			includeOjson5: true,
			customFilter: (fileName: string) => {
				const lowerFileName = fileName.toLowerCase();
				const vocabKeywords = ['vocabulary', 'vocab', 'term', '词汇', '术语'];
				return !vocabKeywords.some(keyword => lowerFileName.includes(keyword));
			}
		}
	);

	if (!fullPath) {
		return; // 用户取消或出错
	}

	// 收集角色信息
	const type = await vscode.window.showQuickPick(
		['主角', '配角', '联动角色'],
		{ placeHolder: '选择角色类型' }
	);
	if (!type) return;

	const affiliation = await vscode.window.showInputBox({
		placeHolder: '输入从属标签（可选）'
	});

	const description = await vscode.window.showInputBox({
		placeHolder: `输入角色简介（默认：${selectedName.fullName} - ${selectedName.origin}）`
	});

	const color = await vscode.window.showInputBox({
		placeHolder: '输入十六进制颜色，如 #E60033（可选）',
		validateInput: v => v && !/^#([0-9A-Fa-f]{6})$/.test(v) ? '请输入合法的 #RRGGBB 形式' : null
	});

	// 创建新角色对象，复用现有的数据结构
	const newRole: any = {
		name: selectedName.fullName,
		type,
		uuid: generateRoleNameHash(selectedName.fullName),
		gender: selectedName.gender
	};

	// 如果有翻译名，添加到aliases中
	if (selectedName.translatedName && selectedName.translatedName.trim()) {
		newRole.aliases = [selectedName.translatedName.trim()];
	}

	if (affiliation) newRole.affiliation = affiliation;
	if (description) newRole.description = description;
	else newRole.description = `${selectedName.fullName} - ${selectedName.origin}`;
	if (color) newRole.color = color;

	// 添加生成元数据（展开 generationOptions，便于追溯）
	const generationMeta = {
		...(generationOptions || {}),
		origin: selectedName.origin
	};
	for (const [key, value] of Object.entries(generationMeta)) {
		if (value === undefined || value === null || value === '') {
			continue;
		}
		const metaKey = `generation_${key[0].toUpperCase()}${key.slice(1)}`;
		(newRole as any)[metaKey] = value;
	}

	// 添加生成元数据（简短标记）
	newRole.origin = 'Andrea Novel Helper - 随机生成';

	// 使用统一的文件处理函数添加角色
	const success = addRoleToFile(fullPath, newRole);

	if (success) {
		const fileName = path.basename(fullPath);
		vscode.window.showInformationMessage(`已添加角色 "${selectedName.fullName}" 到 ${fileName}`);

		// 刷新角色系统和装饰
		loadRoles();
		updateDecorations();

		// 询问是否要插入名字到光标位置
		const insertChoice = await vscode.window.showQuickPick([
			{ label: `插入原名: ${selectedName.fullName}`, value: 'original' },
			{ label: selectedName.translatedName ? `插入翻译名: ${selectedName.translatedName}` : '插入翻译名（无）', value: 'translated', disabled: !selectedName.translatedName },
			{ label: selectedName.translatedName ? `插入双语: ${selectedName.fullName} (${selectedName.translatedName})` : '插入双语（无翻译）', value: 'both', disabled: !selectedName.translatedName },
			{ label: '不插入', value: 'none' }
		], {
			placeHolder: '是否将名字插入到光标位置？',
			title: '插入名字到文档'
		});

		if (insertChoice && insertChoice.value !== 'none') {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showWarningMessage('没有活动的编辑器');
				return;
			}

			let insertText = selectedName.fullName;
			if (insertChoice.value === 'translated' && selectedName.translatedName) {
				insertText = selectedName.translatedName;
			} else if (insertChoice.value === 'both' && selectedName.translatedName) {
				insertText = `${selectedName.fullName} (${selectedName.translatedName})`;
			}

			const selection = editor.selection;
			const position = selection.isEmpty ? selection.start : selection.active;

			await editor.edit(editBuilder => {
				editBuilder.insert(position, insertText);
			});

			vscode.window.showInformationMessage(`已插入名字 "${insertText}" 到文档`);
		}
	} else {
		vscode.window.showErrorMessage(`添加角色失败`);
	}
}

