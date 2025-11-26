import * as vscode from 'vscode';
import { translateTextWithClientLLM } from '../../typo/typoClientLLM';
import { showTranslationStatus, hideTranslationStatus } from '../../typo/typoService';

/**
 * 改进的姓名翻译函数，确保翻译结果符合目标语言习惯
 */
export async function translateTextWithLLM(text: string, targetLanguage: string): Promise<string> {
	try {
		// 构建改进的翻译提示词
		const prompt = `请将以下姓名翻译为地道的${targetLanguage}姓名：

原文：${text}

翻译要求：
1. 翻译结果必须完全使用${targetLanguage}
2. 如果目标是中文，必须使用纯中文字符，不要出现日文、英文等其他文字
3. 保持姓名的文化特色和含义
4. 如果是日文姓名，翻译成中文时可以选择：
   - 意译（保留含义）
   - 音译（使用汉字发音）
   - 既有中文姓氏又有中文名字
5. 只返回翻译结果，不要任何解释

示例：
- 安田アニー → 安田安妮 或 安田安倪
- 佐藤誠 → 佐藤诚 或 左藤诚
- Smith约翰 → 史密斯约翰

请直接翻译：`;

		const result = await translateTextWithClientLLM(prompt, targetLanguage);

		// 清理结果，只取第一行或第一个有效翻译
		const cleanedResult = result.trim().split('\n')[0].trim();
		return cleanedResult || text; // 如果翻译失败，返回原文

	} catch (error) {
		console.error('姓名翻译失败:', error);
		return text; // 翻译失败时返回原文
	}
}

/**
 * 将非罗马字姓名转换为罗马字转写
 */
export async function generateRomanizedName(name: string, culture: string): Promise<string> {
	try {
		// 构建LLM提示词
		const prompt = `请将以下${culture}姓名转换为罗马字转写（使用标准转写系统）：

姓名：${name}

要求：
1. 使用标准的罗马字转写系统
2. 中文使用汉语拼音，带声调符号
3. 日文使用平文式罗马字
4. 韩文使用 Revised Romanization of Korean
5. 只返回转写结果，不要其他解释

示例：
- 张三 → Zhāng Sān
- 佐藤誠 → Satō Makoto
- 김철수 → Gim Cheol-su

请直接返回转写结果：`;

		const romanizedResult = await translateTextWithClientLLM(prompt, '英文');

		// 清理结果，只取第一行或第一个有效转写
		const cleanedResult = romanizedResult.trim().split('\n')[0].trim();
		return cleanedResult || name; // 如果转写失败，返回原姓名

	} catch (error) {
		console.error('罗马字转写失败:', error);
		return name; // 转写失败时返回原姓名
	}
}

/**
 * 使用LLM将混合文化姓名映射回统一文化背景
 */
export async function mapMixedCultureNameWithLLM(
	compositeName: string,
	targetCulture: string,
	firstNameCulture: string,
	surnameCulture: string
): Promise<string> {
	try {
		// 构建LLM提示词
		const prompt = `请将以下混合文化背景的姓名映射为${targetCulture === 'zh_CN' ? '中文' : targetCulture === 'ja' ? '日文' : targetCulture === 'ko' ? '韩文' : targetCulture}风格的姓名：

姓名：${compositeName}
姓氏文化：${surnameCulture}
名字文化：${firstNameCulture}

要求：
1. 保持姓名的识别度和记忆点
2. 适配${targetCulture === 'zh_CN' ? '中文' : targetCulture === 'ja' ? '日文' : targetCulture === 'ko' ? '韩文' : targetCulture}姓名的命名习惯
3. 如果是日韩姓名，可以保留部分原文特征
4. 只返回映射后的姓名，不要其他解释

示例：
- 御門マリア -> 御门玛丽 或 御门玛利亚
- 李John -> 李约翰 或 李约翰逊
- Smith明 -> 史密斯明 或 史密斯阿明

请直接返回映射结果：`;

		showTranslationStatus('文化映射中');
		const mappedResult = await translateTextWithClientLLM(prompt, targetCulture === 'zh_CN' ? '中文' : '日文');
		hideTranslationStatus();

		// 清理结果，只取第一行或第一个有效姓名
		const cleanedResult = mappedResult.trim().split('\n')[0].trim();
		return cleanedResult || compositeName; // 如果映射失败，返回原姓名

	} catch (error) {
		hideTranslationStatus();
		console.error('文化映射失败:', error);
		return compositeName; // 映射失败时返回原姓名
	}
}