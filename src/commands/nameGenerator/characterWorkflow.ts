/* eslint-disable curly */
import * as vscode from 'vscode';
import * as path from 'path';
import { nameGeneratorService } from '../../services/nameGeneratorService';
import { NameGenerationOptions, GeneratedName } from '../../types/names';
import { translateTextWithLLM, generateRomanizedName, mapMixedCultureNameWithLLM } from './translationUtils';
import { showTranslationStatus, hideTranslationStatus } from '../../typo/typoService';
import {
	showCultureSelection,
	showGenderSelection,
	showStyleSelection,
	showGenerationOrderSelection,
	showMixedCultureSelection,
	showSeparateCultureSelection,
	showCustomSurnameInput,
	showCustomFirstNameInput,
	showTranslationSelection,
	showTargetLanguageSelection,
	showRomanizationSelection
} from './uiComponents';
import { showSurnameSelection, showFirstNameSelection, showCharacterNameSelection, showFinalNameConfirmation } from './selectionComponents';
import { selectOrCreateFile } from '../addRoleFileSelector';
import { generateRoleNameHash } from '../../utils/uuidUtils';
import { addRoleToFile } from '../../utils/roleFileHandler';
import { loadRoles } from '../../activate';
import { updateDecorations } from '../../events/updateDecorations';
import { uniqueRoleKeys } from '../../utils/roleLookupKeys';

function buildSpellingLookupVariants(values: Array<string | undefined | null>): string[] {
	const variants: string[] = [];

	for (const value of values) {
		const trimmed = value?.trim();
		if (!trimmed) {
			continue;
		}
		if (!/[A-Za-z\u00C0-\u024F]/.test(trimmed)) {
			continue;
		}

		const noDots = trimmed.replace(/[·・]/g, ' ');
		const noDiacritics = noDots.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
		const collapsed = noDiacritics.replace(/[\s\-_'’]+/g, '');
		const hyphenless = noDiacritics.replace(/[\-_'’]+/g, ' ');

		variants.push(trimmed, noDots, noDiacritics, hyphenless, collapsed);
		variants.push(trimmed.toLowerCase(), noDots.toLowerCase(), noDiacritics.toLowerCase(), hyphenless.toLowerCase(), collapsed.toLowerCase());
	}

	return uniqueRoleKeys(variants.filter(Boolean));
}

function shouldPopulatePinyinLookup(selectedName: any): boolean {
	const signals = [
		selectedName?.origin,
		selectedName?.culture,
		selectedName?.targetCulture,
		selectedName?.sourceCulture,
		selectedName?.cultureDisplayName,
	].filter(Boolean).join(' ').toLowerCase();

	return /(chinese|china|mandarin|pinyin|zhong|han)/.test(signals);
}

/**
 * 随机生成角色完整工作流程
 */
export async function generateRandomCharacterWorkflow(): Promise<void> {
	try {
		// 步骤1：选择文化风格
		const cultureSelection = await showCultureSelection('随机生成角色 - 步骤 1/5: 选择文化背景');
		if (!cultureSelection) return;

		// 步骤2：选择性别
		const genderSelection = await showGenderSelection('随机生成角色 - 步骤 2/5: 选择性别');
		if (!genderSelection) return;

		// 步骤3：选择名字风格
		const styleSelection = await showStyleSelection(cultureSelection.culture, '随机生成角色 - 步骤 3/5: 选择风格');
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

		// 步骤6：为非罗马字文化背景生成罗马字转写
		const needsRomanization = ['zh_CN', 'zh_TW', 'ja', 'ko', 'th', 'vi', 'ar', 'fa', 'ur', 'hi', 'ru', 'he', 'uk'];
		if (needsRomanization.includes(generationOptions.culture)) {
			const wantRomanization = await showRomanizationSelection('随机生成角色 - 罗马字转写选项');

			if (wantRomanization?.value) {
				try {
					showTranslationStatus('生成罗马字转写');
					const romanizedName = await generateRomanizedName(selectedName.fullName, generationOptions.culture);
					hideTranslationStatus();

					// 将罗马字转写添加到selectedName中
					if (romanizedName && romanizedName.trim()) {
						selectedName.romanizedName = romanizedName.trim();
					}
				} catch (error) {
					hideTranslationStatus();
					vscode.window.showErrorMessage(`罗马字转写失败: ${error}`);
					// 转写失败时继续执行，不中断整个流程
				}
			}
		}

		// 步骤7：创建角色文件
		await createCharacterName(selectedName, generationOptions);

	} catch (error) {
		vscode.window.showErrorMessage(`角色生成失败: ${error}`);
	}
}

/**
 * 分步随机生成角色完整工作流程 - 新增
 */
export async function generateStepByStepCharacterWorkflow(): Promise<void> {
	try {
		// 步骤1：选择文化风格
		const cultureSelection = await showCultureSelection('分步随机生成角色 - 步骤 1/8: 选择文化背景');
		if (!cultureSelection) return;

		// 步骤2：选择性别
		const genderSelection = await showGenderSelection('分步随机生成角色 - 步骤 2/8: 选择性别');
		if (!genderSelection) return;

		// 步骤3：选择名字风格
		const styleSelection = await showStyleSelection(cultureSelection.culture, '分步随机生成角色 - 步骤 3/8: 选择风格');
		if (!styleSelection) return;

		const generationOptions = {
			culture: cultureSelection.culture,
			gender: genderSelection.value,
			style: styleSelection.value
		};

		// 步骤4：选择生成顺序
		const orderSelection = await showGenerationOrderSelection('分步随机生成角色 - 步骤 4/8: 选择生成顺序');
		if (!orderSelection) return;

		// 步骤4.5：选择是否使用不同文化背景
		const useMixedCultures = await showMixedCultureSelection('分步随机生成角色 - 步骤 4.5/8: 文化背景设置');
		if (useMixedCultures === undefined) return;

		let selectedSurname: GeneratedName | undefined;
		let selectedFirstName: GeneratedName | undefined;
		let firstNameCulture = generationOptions.culture;
		let surnameCulture = generationOptions.culture;

		if (orderSelection.value === 'surname-first') {
			// 先生成姓氏，再生成名字
			if (useMixedCultures) {
				// 为姓氏选择文化背景
				const surnameCultureSelection = await showSeparateCultureSelection('姓氏', '分步随机生成角色 - 选择姓氏文化背景');
				if (!surnameCultureSelection) return;
				surnameCulture = surnameCultureSelection.culture;

				selectedSurname = await showSurnameSelection({ ...generationOptions, culture: surnameCulture }, '分步随机生成角色 - 选择姓氏');
				if (!selectedSurname) return;

				// 为名字选择文化背景
				const firstNameCultureSelection = await showSeparateCultureSelection('名字', '分步随机生成角色 - 选择名字文化背景');
				if (!firstNameCultureSelection) return;
				firstNameCulture = firstNameCultureSelection.culture;

				selectedFirstName = await showFirstNameSelection({ ...generationOptions, culture: firstNameCulture }, '分步随机生成角色 - 选择名字');
				if (!selectedFirstName) return;
			} else {
				selectedSurname = await showSurnameSelection(generationOptions, '分步随机生成角色 - 选择姓氏');
				if (!selectedSurname) return;

				selectedFirstName = await showFirstNameSelection(generationOptions, '分步随机生成角色 - 选择名字');
				if (!selectedFirstName) return;
			}
		} else if (orderSelection.value === 'firstname-first') {
			// 先生成名字，再生成姓氏
			if (useMixedCultures) {
				// 为名字选择文化背景
				const firstNameCultureSelection = await showSeparateCultureSelection('名字', '分步随机生成角色 - 选择名字文化背景');
				if (!firstNameCultureSelection) return;
				firstNameCulture = firstNameCultureSelection.culture;

				selectedFirstName = await showFirstNameSelection({ ...generationOptions, culture: firstNameCulture }, '分步随机生成角色 - 选择名字');
				if (!selectedFirstName) return;

				// 为姓氏选择文化背景
				const surnameCultureSelection = await showSeparateCultureSelection('姓氏', '分步随机生成角色 - 选择姓氏文化背景');
				if (!surnameCultureSelection) return;
				surnameCulture = surnameCultureSelection.culture;

				selectedSurname = await showSurnameSelection({ ...generationOptions, culture: surnameCulture }, '分步随机生成角色 - 选择姓氏');
				if (!selectedSurname) return;
			} else {
				selectedFirstName = await showFirstNameSelection(generationOptions, '分步随机生成角色 - 选择名字');
				if (!selectedFirstName) return;

				selectedSurname = await showSurnameSelection(generationOptions, '分步随机生成角色 - 选择姓氏');
				if (!selectedSurname) return;
			}
		} else if (orderSelection.value === 'custom-surname') {
			// 输入自定义姓氏，然后生成名字
			selectedSurname = await showCustomSurnameInput(generationOptions, '分步随机生成角色 - 输入自定义姓氏');
			if (!selectedSurname) return;

			if (useMixedCultures) {
				// 为名字选择文化背景
				const firstNameCultureSelection = await showSeparateCultureSelection('名字', '分步随机生成角色 - 选择名字文化背景');
				if (!firstNameCultureSelection) return;
				firstNameCulture = firstNameCultureSelection.culture;
			}

			selectedFirstName = await showFirstNameSelection({ ...generationOptions, culture: firstNameCulture }, '分步随机生成角色 - 选择名字');
			if (!selectedFirstName) return;
		} else if (orderSelection.value === 'custom-firstname') {
			// 输入自定义名字，然后生成姓氏
			selectedFirstName = await showCustomFirstNameInput(generationOptions, '分步随机生成角色 - 输入自定义名字');
			if (!selectedFirstName) return;

			if (useMixedCultures) {
				// 为姓氏选择文化背景
				const surnameCultureSelection = await showSeparateCultureSelection('姓氏', '分步随机生成角色 - 选择姓氏文化背景');
				if (!surnameCultureSelection) return;
				surnameCulture = surnameCultureSelection.culture;
			}

			selectedSurname = await showSurnameSelection({ ...generationOptions, culture: surnameCulture }, '分步随机生成角色 - 选择姓氏');
			if (!selectedSurname) return;
		}

		// 步骤5：组合最终名字
		if (!selectedFirstName || !selectedSurname) {
			return;
		}

		let finalName: string;
		let mappedName = '';
		let originalCompositeName = '';

		if (useMixedCultures && (firstNameCulture !== surnameCulture)) {
			// 使用混合文化背景组合姓名
			finalName = combineMixedCultureNames(selectedFirstName, selectedSurname, firstNameCulture, surnameCulture);
			originalCompositeName = finalName; // 保存原始复合姓名

			// 步骤5.5：使用LLM将复合姓名映射回统一文化背景
			mappedName = await mapMixedCultureNameWithLLM(finalName, generationOptions.culture, firstNameCulture, surnameCulture);
		} else {
			// 使用单一文化背景组合姓名
			finalName = combineFirstNameAndSurname(selectedFirstName, selectedSurname, generationOptions.culture);
			originalCompositeName = finalName; // 单一文化情况下，复合姓名就是最终姓名
		}

		// 步骤6：显示翻译选项
		const wantTranslation = await showTranslationSelection('分步随机生成角色 - 步骤 6/9: 选择翻译选项');

		if (!wantTranslation) return;

		let translatedName = '';
		let translatedSurname = '';
		let translatedFirstName = '';
		let romanizedName = '';

		if (wantTranslation.value) {
			const selectedTarget = await showTargetLanguageSelection('分步随机生成角色 - 步骤 7/9: 选择目标语言');

			if (!selectedTarget) return;

			try {
				showTranslationStatus('生成姓氏翻译');
				// 为姓氏生成翻译
				if (selectedSurname && selectedSurname.fullName) {
					translatedSurname = await translateTextWithLLM(selectedSurname.fullName, selectedTarget);
				}

				showTranslationStatus('生成名字翻译');
				// 为名字生成翻译
				if (selectedFirstName && selectedFirstName.fullName) {
					translatedFirstName = await translateTextWithLLM(selectedFirstName.fullName, selectedTarget);
				}

				hideTranslationStatus();

				// 组合翻译后的姓名
				if (translatedSurname.trim() && translatedFirstName.trim()) {
					// 根据目标文化习惯组合翻译后的姓名
					if (selectedTarget === '中文' || selectedTarget === '日文' || selectedTarget === '韩语') {
						translatedName = `${translatedSurname.trim()}${translatedFirstName.trim()}`;
					} else {
						// 西方语言：名 + 姓
						translatedName = `${translatedFirstName.trim()} ${translatedSurname.trim()}`;
					}
				} else if (finalName) {
					// 如果分开翻译失败，则对完整姓名进行翻译
					showTranslationStatus('生成完整姓名翻译');
					translatedName = await translateTextWithLLM(finalName, selectedTarget);
					hideTranslationStatus();
				}

			} catch (error) {
				hideTranslationStatus();
				vscode.window.showErrorMessage(`翻译失败: ${error}`);
			}
		}

		// 步骤6.5：询问是否为非罗马字文化背景生成罗马字转写
		const needsRomanization = ['zh_CN', 'zh_TW', 'ja', 'ko', 'th', 'vi', 'ar', 'fa', 'ur', 'hi', 'ru', 'he', 'uk'];
		if (needsRomanization.includes(generationOptions.culture) ||
			needsRomanization.includes(firstNameCulture) ||
			needsRomanization.includes(surnameCulture)) {

			const wantRomanization = await showRomanizationSelection('分步随机生成角色 - 步骤 6.5/9: 罗马字转写选项');

			if (wantRomanization?.value) {
				try {
					showTranslationStatus('生成罗马字转写');
					romanizedName = await generateRomanizedName(finalName, generationOptions.culture);
					hideTranslationStatus();
				} catch (error) {
					hideTranslationStatus();
					vscode.window.showErrorMessage(`罗马字转写失败: ${error}`);
					// 转写失败时继续执行，不中断整个流程
				}
			}
		}

		// 步骤7：显示最终确认
		let displayFinalName = finalName;
		if (mappedName && mappedName !== finalName) {
			// 如果有映射后的姓名，让用户选择使用哪个版本
			const nameVersionChoice = await vscode.window.showQuickPick([
				{ label: `使用复合姓名: ${finalName}`, value: 'composite' },
				{ label: `使用映射姓名: ${mappedName}`, value: 'mapped' }
			], {
				placeHolder: '选择要使用的姓名版本',
				title: '分步随机生成角色 - 步骤 8/10: 选择姓名版本'
			});

			if (!nameVersionChoice) return;
			displayFinalName = nameVersionChoice.value === 'mapped' ? mappedName : finalName;
		}

		const finalChoice = await showFinalNameConfirmation(displayFinalName, translatedName, generationOptions, '分步随机生成角色 - 步骤 9/10: 确认最终名字');
		if (!finalChoice) return;

		// 步骤8：创建角色文件或插入到文档
		if (finalChoice.action === 'createRole') {
			let actualName = finalName;
			let allAliases: string[] = [];

			// 收集所有版本的别名
			if (originalCompositeName && originalCompositeName !== finalName) {
				allAliases.push(originalCompositeName);
			}
			if (mappedName && mappedName !== finalName && mappedName !== originalCompositeName) {
				allAliases.push(mappedName);
			}
			if (translatedName && translatedName.trim() &&
				translatedName.trim() !== finalName &&
				translatedName.trim() !== originalCompositeName &&
				translatedName.trim() !== mappedName) {
				allAliases.push(translatedName.trim());
			}
			if (romanizedName && romanizedName.trim() &&
				romanizedName.trim() !== finalName &&
				romanizedName.trim() !== originalCompositeName &&
				romanizedName.trim() !== mappedName &&
				romanizedName.trim() !== translatedName?.trim()) {
				allAliases.push(romanizedName.trim());
			}

			// 处理不同的翻译选项
			if (finalChoice.useTranslation === 'onlyTranslation' && translatedName.trim()) {
				actualName = translatedName.trim();
				// 将其他版本作为别名
				if (finalName !== actualName) allAliases.unshift(finalName);
				if (originalCompositeName && originalCompositeName !== actualName && !allAliases.includes(originalCompositeName)) {
					allAliases.push(originalCompositeName);
				}
				if (mappedName && mappedName !== actualName && !allAliases.includes(mappedName)) {
					allAliases.push(mappedName);
				}
			} else if (finalChoice.useTranslation === true) {
				// 双语模式，保持原姓名，其他版本作为别名
				if (translatedName.trim() && !allAliases.includes(translatedName.trim())) {
					allAliases.push(translatedName.trim());
				}
			}
			// 如果 useTranslation 为 false，只使用其他版本作为别名

			const nameData: GeneratedName = {
				fullName: actualName,
				firstName: selectedFirstName.firstName || selectedFirstName.fullName,
				lastName: selectedSurname.lastName || selectedSurname.fullName,
				culture: generationOptions.culture,
				gender: generationOptions.gender as 'male' | 'female' | 'neutral',
				style: generationOptions.style,
				origin: '分步生成',
				translation: allAliases.length > 0 ? allAliases.join(', ') : undefined
			};

			// 传递所有名字版本信息用于插入选项
			const nameVersionData = {
				...nameData,
				originalCompositeName,
				mappedName,
				translatedName: translatedName.trim() || undefined,
				romanizedName: romanizedName.trim() || undefined
			};

			await createCharacterName(nameVersionData, generationOptions);
		} else if (finalChoice.action === 'insert') {
			await insertNameToDocument(finalName, translatedName, finalChoice.useTranslation, originalCompositeName, mappedName, romanizedName);
		}

	} catch (error) {
		vscode.window.showErrorMessage(`分步角色生成失败: ${error}`);
	}
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
 * 组合名字和姓氏
 */
function combineFirstNameAndSurname(firstName: GeneratedName, surname: GeneratedName, culture: string): string {
	if (!firstName || !surname) return '';

	const givenName = firstName.firstName || firstName.fullName;
	const familyName = surname.lastName || surname.fullName;

	// 根据不同文化组合姓名
	if (culture === 'zh_CN' || culture === 'zh_TW') {
		// 中文：姓 + 名
		return `${familyName}${givenName}`;
	} else if (culture === 'ja') {
		// 日语：姓 + 名
		return `${familyName}${givenName}`;
	} else if (culture === 'ko') {
		// 韩语：姓 + 名
		return `${familyName}${givenName}`;
	} else {
		// 西方：名 + 姓
		return `${givenName} ${familyName}`;
	}
}

/**
 * 组合混合文化背景的名字和姓氏
 */
function combineMixedCultureNames(firstName: GeneratedName, surname: GeneratedName, firstNameCulture: string, surnameCulture: string): string {
	if (!firstName || !surname) return '';

	const givenName = firstName.firstName || firstName.fullName;
	const familyName = surname.lastName || surname.fullName;

	// 优先采用姓氏的文化背景来组合姓名
	if (surnameCulture === 'zh_CN' || surnameCulture === 'zh_TW') {
		// 如果姓氏是中文，采用中文格式：姓 + 名
		return `${familyName}${givenName}`;
	} else if (surnameCulture === 'ja') {
		// 如果姓氏是日文，采用日文格式：姓 + 名
		return `${familyName}${givenName}`;
	} else if (surnameCulture === 'ko') {
		// 如果姓氏是韩文，采用韩文格式：姓 + 名
		return `${familyName}${givenName}`;
	} else {
		// 如果姓氏是西方文化，采用西方格式：名 + 姓
		return `${givenName} ${familyName}`;
	}
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
			includeCsv: true,
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

	// 收集所有版本的别名
	const allAliases: string[] = [];

	// 添加翻译名
	const translatedName = selectedName.translatedName || selectedName.translation;
	if (translatedName && translatedName.trim() && translatedName.trim() !== selectedName.fullName) {
		allAliases.push(translatedName.trim());
	}

	// 添加原始复合姓名
	if (selectedName.originalCompositeName && selectedName.originalCompositeName !== selectedName.fullName) {
		allAliases.push(selectedName.originalCompositeName);
	}

	// 添加映射姓名
	if (selectedName.mappedName &&
		selectedName.mappedName !== selectedName.fullName &&
		selectedName.mappedName !== selectedName.originalCompositeName &&
		!allAliases.includes(selectedName.mappedName)) {
		allAliases.push(selectedName.mappedName);
	}

	// 添加罗马字转写
	if (selectedName.romanizedName && selectedName.romanizedName.trim() &&
		selectedName.romanizedName.trim() !== selectedName.fullName &&
		selectedName.romanizedName.trim() !== selectedName.originalCompositeName &&
		selectedName.romanizedName.trim() !== selectedName.mappedName &&
		selectedName.romanizedName.trim() !== translatedName?.trim() &&
		!allAliases.includes(selectedName.romanizedName.trim())) {
		allAliases.push(selectedName.romanizedName.trim());
	}

	// 创建新角色对象，复用现有的数据结构
	const newRole: any = {
		name: selectedName.fullName,
		type,
		uuid: generateRoleNameHash(selectedName.fullName),
		gender: selectedName.gender
	};

	// 如果有别名，添加到aliases中
	if (allAliases.length > 0) {
		newRole.aliases = allAliases;
	}

	const spellingLookupKeys = buildSpellingLookupVariants([
		selectedName.fullName,
		selectedName.romanizedName,
		translatedName,
		selectedName.originalCompositeName,
		selectedName.mappedName,
		...allAliases,
	]);
	if (spellingLookupKeys.length > 0) {
		newRole.lookupKeys_spelling = spellingLookupKeys;
		newRole.lookupKeys_romanized = spellingLookupKeys;
		if (shouldPopulatePinyinLookup(selectedName)) {
			newRole.lookupKeys_pinyin = spellingLookupKeys;
		}
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

		// 收集所有可用版本的名字用于插入选项
		const nameVersions: Array<{ label: string, value: string, description?: string }> = [
			{ label: `最终姓名: ${selectedName.fullName}`, value: 'final' }
		];

		if (selectedName.originalCompositeName && selectedName.originalCompositeName !== selectedName.fullName) {
			nameVersions.push({ label: `原始复合姓名: ${selectedName.originalCompositeName}`, value: 'originalComposite' });
		}

		if (selectedName.mappedName && selectedName.mappedName !== selectedName.fullName && selectedName.mappedName !== selectedName.originalCompositeName) {
			nameVersions.push({ label: `映射姓名: ${selectedName.mappedName}`, value: 'mapped' });
		}

		if (selectedName.translatedName && selectedName.translatedName.trim()) {
			const cleanTranslation = selectedName.translatedName.trim();
			if (cleanTranslation !== selectedName.fullName && cleanTranslation !== selectedName.originalCompositeName && cleanTranslation !== selectedName.mappedName) {
				nameVersions.push({ label: `翻译姓名: ${cleanTranslation}`, value: 'translated' });
			}
		}

		if (selectedName.romanizedName && selectedName.romanizedName.trim()) {
			const cleanRomanization = selectedName.romanizedName.trim();
			if (cleanRomanization !== selectedName.fullName &&
				cleanRomanization !== selectedName.originalCompositeName &&
				cleanRomanization !== selectedName.mappedName &&
				cleanRomanization !== selectedName.translatedName?.trim()) {
				nameVersions.push({ label: `罗马字转写: ${cleanRomanization}`, value: 'romanized' });
			}
		}

		nameVersions.push({ label: '不插入', value: 'none' });

		// 询问是否要插入名字到光标位置
		const insertChoice = await vscode.window.showQuickPick(nameVersions, {
			placeHolder: '选择要插入的名字版本',
			title: '插入名字到文档'
		});

		if (insertChoice && insertChoice.value !== 'none') {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showWarningMessage('没有活动的编辑器');
				return;
			}

			let insertText = selectedName.fullName;

			// 根据用户选择确定要插入的文字
			switch (insertChoice.value) {
				case 'originalComposite':
					insertText = selectedName.originalCompositeName;
					break;
				case 'mapped':
					insertText = selectedName.mappedName;
					break;
				case 'translated':
					insertText = selectedName.translatedName.trim();
					break;
				case 'romanized':
					insertText = selectedName.romanizedName.trim();
					break;
				case 'final':
				default:
					insertText = selectedName.fullName;
					break;
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

/**
 * 将名字插入到文档（支持不同翻译选项、罗马字转写和所有版本的名字）
 */
async function insertNameToDocument(
	name: string,
	translatedName: string,
	useTranslation?: boolean | string,
	originalCompositeName?: string,
	mappedName?: string,
	romanizedName?: string
): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showWarningMessage('没有活动的编辑器');
		return;
	}

	// 收集所有可用版本的名字
	const nameVersions: Array<{ label: string, value: string, description?: string }> = [
		{ label: `最终姓名: ${name}`, value: name }
	];

	if (originalCompositeName && originalCompositeName !== name) {
		nameVersions.push({ label: `原始复合姓名: ${originalCompositeName}`, value: originalCompositeName });
	}

	if (mappedName && mappedName !== name && mappedName !== originalCompositeName) {
		nameVersions.push({ label: `映射姓名: ${mappedName}`, value: mappedName });
	}

	if (translatedName && translatedName.trim()) {
		const cleanTranslation = translatedName.trim();
		if (cleanTranslation !== name && cleanTranslation !== originalCompositeName && cleanTranslation !== mappedName) {
			nameVersions.push({ label: `翻译姓名: ${cleanTranslation}`, value: cleanTranslation });
		}
	}

	if (romanizedName && romanizedName.trim()) {
		const cleanRomanization = romanizedName.trim();
		if (cleanRomanization !== name &&
			cleanRomanization !== originalCompositeName &&
			cleanRomanization !== mappedName &&
			cleanRomanization !== translatedName?.trim()) {
			nameVersions.push({ label: `罗马字转写: ${cleanRomanization}`, value: cleanRomanization });
		}
	}

	let insertText = name;

	if (useTranslation === 'onlyTranslation' && translatedName && translatedName.trim()) {
		// 仅使用翻译名
		insertText = translatedName.trim();
	} else if (useTranslation === true && nameVersions.length > 1) {
		// 如果有多个版本，让用户选择
		const selectedVersion = await vscode.window.showQuickPick(nameVersions, {
			placeHolder: '选择要插入的名字版本'
		});

		if (!selectedVersion) {
			return;
		}
		insertText = selectedVersion.value;
	} else if (nameVersions.length > 1 && (useTranslation === undefined || useTranslation === true)) {
		// 如果有多个版本但没有明确指定，让用户选择
		const selectedVersion = await vscode.window.showQuickPick(nameVersions, {
			placeHolder: '选择要插入的名字版本'
		});

		if (!selectedVersion) {
			return;
		}
		insertText = selectedVersion.value;
	}
	// 如果 useTranslation 为 false 或只有一个版本，使用默认值

	const selection = editor.selection;
	const position = selection.isEmpty ? selection.start : selection.active;

	await editor.edit(editBuilder => {
		editBuilder.insert(position, insertText);
	});

	vscode.window.showInformationMessage(`已插入名字 "${insertText}" 到文档`);
}