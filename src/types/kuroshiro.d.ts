declare module 'kuroshiro' {
	export interface KuroshiroConvertOptions {
		to?: 'hiragana' | 'katakana' | 'romaji';
		mode?: 'normal' | 'spaced' | 'okurigana' | 'furigana';
		romajiSystem?: 'hepburn' | 'passport' | 'nippon';
	}

	export default class Kuroshiro {
		init(analyzer: unknown): Promise<void>;
		convert(text: string, options?: KuroshiroConvertOptions): Promise<string>;
	}
}

declare module 'kuroshiro-analyzer-kuromoji' {
	export interface KuromojiAnalyzerOptions {
		dicPath?: string;
	}

	export default class KuromojiAnalyzer {
		constructor(options?: KuromojiAnalyzerOptions);
	}
}