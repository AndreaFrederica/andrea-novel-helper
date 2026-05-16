import * as vscode from 'vscode';
import { setWebviewPanelIcon } from '../../Provider/utils/webviewPanelIcon';
import { nameGeneratorService } from '../../services/nameGeneratorService';
import { NameGenerationOptions, GeneratedName } from '../../types/names';
import { translateTextWithLLM, generateRomanizedName } from './translationUtils';
import { showTranslationSelection, showTargetLanguageSelection } from './uiComponents';
import { showTranslationStatus, hideTranslationStatus } from '../../typo/typoService';

/**
 * 显示姓氏选择界面
 */
export async function showSurnameSelection(options: NameGenerationOptions, title?: string): Promise<GeneratedName | undefined> {
	try {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: '正在生成姓氏...',
			cancellable: false
		}, async (progress) => {
			progress.report({ increment: 0 });
			return new Promise<void>(resolve => setTimeout(resolve, 500));
		});

		const surnames = await nameGeneratorService.generateSurnames({ ...options, count: 10 });

		const surnameOptions = surnames.map((surname, index) => ({
			label: surname.fullName,
			description: `${surname.culture} | ${surname.style}`,
			detail: `姓氏: ${surname.fullName} | 起源: ${surname.origin}`,
			surname: surname
		}));

		surnameOptions.unshift({ label: '🎲 重新生成姓氏', value: 'regenerate' } as any);

		const selectedSurname = await vscode.window.showQuickPick(surnameOptions, {
			placeHolder: '选择姓氏',
			title: title || '选择姓氏'
		});

		if (!selectedSurname) return undefined;

		if ('value' in selectedSurname && selectedSurname.value === 'regenerate') {
			return await showSurnameSelection(options, title);
		}

		return 'surname' in selectedSurname ? selectedSurname.surname : undefined;
	} catch (error) {
		vscode.window.showErrorMessage(`姓氏生成失败: ${error}`);
		return undefined;
	}
}

/**
 * 显示名字选择界面
 */
export async function showFirstNameSelection(options: NameGenerationOptions, title?: string): Promise<GeneratedName | undefined> {
	try {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: '正在生成名字...',
			cancellable: false
		}, async (progress) => {
			progress.report({ increment: 0 });
			return new Promise<void>(resolve => setTimeout(resolve, 500));
		});

		const firstNames = await nameGeneratorService.generateFirstNames({ ...options, count: 10 });

		const nameOptions = firstNames.map((firstName, index) => ({
			label: firstName.fullName,
			description: `${firstName.culture} | ${firstName.gender} | ${firstName.style}`,
			detail: `名字: ${firstName.fullName} | 起源: ${firstName.origin}`,
			firstName: firstName
		}));

		nameOptions.unshift({ label: '🎲 重新生成名字', value: 'regenerate' } as any);

		const selectedFirstName = await vscode.window.showQuickPick(nameOptions, {
			placeHolder: '选择名字',
			title: title || '选择名字'
		});

		if (!selectedFirstName) return undefined;

		if ('value' in selectedFirstName && selectedFirstName.value === 'regenerate') {
			return await showFirstNameSelection(options, title);
		}

		return 'firstName' in selectedFirstName ? selectedFirstName.firstName : undefined;
	} catch (error) {
		vscode.window.showErrorMessage(`名字生成失败: ${error}`);
		return undefined;
	}
}

/**
 * 显示角色名字选择界面（增强版，支持翻译和光标插入）
 */
export async function showCharacterNameSelection(
	names: any[],
	generationOptions: any,
	wantTranslation?: { value: boolean },
	targetLang?: string
): Promise<any | undefined> {
	// 如果是第一次调用，需要询问翻译选项
	if (wantTranslation === undefined) {
		// 步骤1：询问是否需要翻译别名
		wantTranslation = await showTranslationSelection('随机生成角色 - 步骤 4/6: 选择翻译选项');

		if (!wantTranslation) return undefined;
	}

	// 步骤2：如果需要翻译且还没有选择目标语言，询问目标语言
	if (wantTranslation.value && !targetLang) {
		targetLang = await showTargetLanguageSelection('随机生成角色 - 步骤 5/6: 选择目标语言');

		if (!targetLang) return undefined;
	}

	// 步骤3：为所有名字生成翻译（如果需要）
	const namesWithTranslations = [];
	if (wantTranslation.value && targetLang) {
		try {
			showTranslationStatus('生成名字翻译');
			for (const name of names) {
				try {
					const translated = await translateTextWithLLM(name.fullName, targetLang);
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
		const newNames = await nameGeneratorService.generateNames(generationOptions);
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
 * 显示名字选择界面
 */
export async function showNameSelection(names: any[]): Promise<void> {
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
	setWebviewPanelIcon(panel, '', 'settings');

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
 * 显示最终名字确认界面
 */
export async function showFinalNameConfirmation(
	finalName: string,
	translatedName: string,
	generationOptions: any,
	title?: string
): Promise<{ action: string, useTranslation?: boolean | string } | undefined> {
	const displayOptions: Array<{ label: string, value: string, useTranslation: boolean | string }> = [
		{ label: `创建角色文件: ${finalName}`, value: 'createRole', useTranslation: false },
		{ label: `插入名字到光标位置: ${finalName}`, value: 'insert', useTranslation: false }
	];

	if (translatedName && translatedName.trim()) {
		displayOptions.push(
			{ label: `创建角色文件: ${finalName} (${translatedName})`, value: 'createRole', useTranslation: true },
			{ label: `插入双语名字: ${finalName} (${translatedName})`, value: 'insert', useTranslation: true },
			{ label: `仅使用翻译名: ${translatedName}`, value: 'createRole', useTranslation: 'onlyTranslation' },
			{ label: `仅插入翻译名: ${translatedName}`, value: 'insert', useTranslation: 'onlyTranslation' }
		);
	}

	const finalAction = await vscode.window.showQuickPick(displayOptions, {
		placeHolder: '确认最终名字和处理方式',
		title: title || '确认最终名字'
	});

	if (!finalAction) return undefined;

	const action = finalAction.value.includes('createRole') ? 'createRole' : 'insert';
	return { action, useTranslation: finalAction.useTranslation };
}
