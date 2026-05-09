import * as vscode from 'vscode';
import { pinyin as toPinyin } from 'pinyin-pro';
import { transliterate } from 'transliteration';
import { toRomaji } from 'wanakana';
import Kuroshiro from 'kuroshiro';
import KuromojiAnalyzer from 'kuroshiro-analyzer-kuromoji';
import { translateTextWithClientLLM } from '../typo/typoClientLLM';

export interface LookupKeyGeneratableRole {
	name?: string;
	aliases?: string[];
	lookupKeys_pinyin?: string[];
	lookupKeys_romanized?: string[];
}

export type LookupKeyGenerationKind = 'pinyin' | 'romanized';

export interface GeneratedLookupKeyCandidate {
	group: string;
	value: string;
	label: string;
	detail: string;
}

interface LookupKeySourceEntry {
	label: string;
	value: string;
}

interface LookupKeyVariant {
	value: string;
	label: string;
}

type SourceScriptKind = 'han' | 'kana' | 'latin' | 'other';

interface SourceScriptSegment {
	kind: Exclude<SourceScriptKind, 'other'>;
	value: string;
}

const HAN_CHARACTER_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
const JAPANESE_KANA_RE = /[\u3040-\u30ff\u31f0-\u31ff]/;
const JAPANESE_GUESS_RE = /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u9fff\uf900-\ufaff]/;

let kuroshiroPromise: Promise<Kuroshiro> | undefined;

function containsNonAscii(value: string): boolean {
	return Array.from(value).some(char => (char.codePointAt(0) ?? 0) > 0x7f);
}

function normalizeStringList(values: Array<string | undefined | null>): string[] {
	const seen = new Set<string>();
	const result: string[] = [];

	for (const value of values) {
		const normalized = String(value ?? '').trim();
		if (!normalized) {
			continue;
		}
		const dedupeKey = normalized.toLowerCase();
		if (seen.has(dedupeKey)) {
			continue;
		}
		seen.add(dedupeKey);
		result.push(normalized);
	}

	return result;
}

function normalizeLookupValue(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim()
		.replace(/[·・]/g, ' ')
		.replace(/[^A-Za-z0-9\s'-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

function dedupeLookupVariants(variants: LookupKeyVariant[]): LookupKeyVariant[] {
	const seen = new Set<string>();
	const result: LookupKeyVariant[] = [];

	for (const variant of variants) {
		if (!variant.value || seen.has(variant.value)) {
			continue;
		}
		seen.add(variant.value);
		result.push(variant);
	}

	return result;
}

function getCandidateDedupKey(candidate: GeneratedLookupKeyCandidate): string {
	return `${candidate.group}\n${candidate.value}`;
}

function buildLookupKeyVariants(value: string): LookupKeyVariant[] {
	const normalized = normalizeLookupValue(value);

	if (!normalized) {
		return [];
	}

	const tokens = normalized.split(/[\s'-]+/g).filter(Boolean);
	const variants: LookupKeyVariant[] = [
		{ value: normalized, label: '标准写法' },
	];

	const compact = tokens.join('');
	if (compact && compact !== normalized) {
		variants.push({ value: compact, label: '紧凑写法' });
	}

	const initials = tokens.length > 1 ? tokens.map(token => token[0]).join('') : '';
	if (initials && initials !== compact) {
		variants.push({ value: initials, label: '首字母缩写' });
	}

	const deduped = new Set<string>();
	return variants.filter(variant => {
		if (!variant.value || deduped.has(variant.value)) {
			return false;
		}
		deduped.add(variant.value);
		return true;
	});
}

function toLookupKeyVariants(value: string): string[] {
	return buildLookupKeyVariants(value).map(variant => variant.value);
}

function buildCandidateItems(
	entry: LookupKeySourceEntry,
	group: string,
	variants: LookupKeyVariant[],
	detail = `来源：${entry.value}`,
): GeneratedLookupKeyCandidate[] {
	return dedupeLookupVariants(variants).map(variant => ({
		group,
		value: variant.value,
		label: `${entry.label} · ${variant.label}`,
		detail,
	}));
}

async function getKuroshiroInstance(): Promise<Kuroshiro> {
	if (!kuroshiroPromise) {
		const instance = new Kuroshiro();
		kuroshiroPromise = instance.init(new KuromojiAnalyzer()).then(() => instance);
	}

	return kuroshiroPromise;
}

function shouldGuessJapanese(source: string): boolean {
	return JAPANESE_GUESS_RE.test(source);
}

function getSourceScriptKind(char: string): SourceScriptKind {
	if (HAN_CHARACTER_RE.test(char)) {
		return 'han';
	}
	if (JAPANESE_KANA_RE.test(char)) {
		return 'kana';
	}
	if (/[A-Za-z0-9]/.test(char)) {
		return 'latin';
	}
	return 'other';
}

function splitSourceByScript(source: string): SourceScriptSegment[] {
	const segments: SourceScriptSegment[] = [];
	let currentKind: Exclude<SourceScriptKind, 'other'> | undefined;
	let buffer = '';

	const flush = () => {
		const normalized = buffer.trim();
		if (currentKind && normalized) {
			segments.push({ kind: currentKind, value: normalized });
		}
		currentKind = undefined;
		buffer = '';
	};

	for (const char of Array.from(source)) {
		const kind = getSourceScriptKind(char);
		if (kind === 'other') {
			flush();
			continue;
		}
		if (currentKind !== kind) {
			flush();
			currentKind = kind;
		}
		buffer += char;
	}

	flush();
	return segments;
}

function getSourceSegmentsByKind(source: string, kind: SourceScriptSegment['kind']): string[] {
	return splitSourceByScript(source)
		.filter(segment => segment.kind === kind)
		.map(segment => segment.value);
}

function hasSegmentedHanReading(source: string): boolean {
	const segments = splitSourceByScript(source);
	return segments.some(segment => segment.kind === 'han') && segments.some(segment => segment.kind !== 'han');
}

function hasMixedHanKanaSource(source: string): boolean {
	const segments = splitSourceByScript(source);
	return segments.some(segment => segment.kind === 'han') && segments.some(segment => segment.kind === 'kana');
}

function describeSourceSegments(source: string): string {
	const kindLabel: Record<SourceScriptSegment['kind'], string> = {
		han: '汉字段',
		kana: '假名段',
		latin: '拉丁段',
	};

	return splitSourceByScript(source)
		.map(segment => `${kindLabel[segment.kind]}=${segment.value}`)
		.join(' / ');
}

function buildSegmentedPinyinText(source: string): string {
	const hanSegments = getSourceSegmentsByKind(source, 'han');
	if (hanSegments.length === 0) {
		return '';
	}

	return hanSegments
		.map(segment => toPinyin(segment, { toneType: 'none', v: true }))
		.join(' ')
		.trim();
}

function buildMixedScriptRomanizedText(source: string): string {
	const romanizedSegments = splitSourceByScript(source)
		.map(segment => {
			switch (segment.kind) {
				case 'han':
					return toPinyin(segment.value, { toneType: 'none', v: true });
				case 'kana':
					return toRomaji(segment.value.replace(/[·・]/g, ' ').trim(), { passRomaji: true });
				case 'latin':
					return segment.value;
			}
		})
		.map(value => String(value ?? '').trim())
		.filter(Boolean);

	if (romanizedSegments.length <= 1) {
		return '';
	}

	return romanizedSegments.join(' ');
}

function buildSegmentedSourceDetail(source: string): string {
	const description = describeSourceSegments(source);
	return description ? `来源：${source} · 分段：${description}` : `来源：${source}`;
}


function collectGenerationSources(role: LookupKeyGeneratableRole): string[] {
	return normalizeStringList([role.name, ...(role.aliases ?? [])]);
}

function collectGenerationSourceEntries(role: LookupKeyGeneratableRole): LookupKeySourceEntry[] {
	const entries: LookupKeySourceEntry[] = [];
	const name = String(role.name ?? '').trim();
	if (name) {
		entries.push({ label: '名称', value: name });
	}

	(role.aliases ?? []).forEach((alias, index) => {
		const normalized = String(alias ?? '').trim();
		if (!normalized) {
			return;
		}
		entries.push({ label: `别名 ${index + 1}`, value: normalized });
	});

	return entries;
}

function generatePinyinCandidates(source: string): string[] {
	if (!HAN_CHARACTER_RE.test(source)) {
		return [];
	}

	const segmentedPinyin = buildSegmentedPinyinText(source);
	if (!segmentedPinyin) {
		return [];
	}

	return toLookupKeyVariants(segmentedPinyin);
}

function generatePinyinCandidateVariants(source: string): LookupKeyVariant[] {
	if (!HAN_CHARACTER_RE.test(source)) {
		return [];
	}

	const segmentedPinyin = buildSegmentedPinyinText(source);
	if (!segmentedPinyin) {
		return [];
	}

	return buildLookupKeyVariants(segmentedPinyin);
}

function generateJapaneseRomajiCandidateVariants(source: string): LookupKeyVariant[] {
	if (!JAPANESE_KANA_RE.test(source)) {
		return [];
	}

	const normalizedSource = source.replace(/[·・]/g, ' ').trim();
	return buildLookupKeyVariants(toRomaji(normalizedSource, { passRomaji: true }));
}

function generateRomanizedCandidates(source: string): string[] {
	if (!containsNonAscii(source)) {
		return [];
	}
	const segmentedRomanized = hasMixedHanKanaSource(source) ? buildMixedScriptRomanizedText(source) : '';
	if (segmentedRomanized) {
		return toLookupKeyVariants(segmentedRomanized);
	}

	return toLookupKeyVariants(transliterate(source));
}

function generateRomanizedCandidateVariants(source: string): LookupKeyVariant[] {
	if (!containsNonAscii(source)) {
		return [];
	}
	const segmentedRomanized = hasMixedHanKanaSource(source) ? buildMixedScriptRomanizedText(source) : '';

	return dedupeLookupVariants([
		...buildLookupKeyVariants(segmentedRomanized),
		...generateJapaneseRomajiCandidateVariants(source),
		...(segmentedRomanized ? [] : buildLookupKeyVariants(transliterate(source))),
	]);
}

function generateRomanizedLocalCandidates(role: LookupKeyGeneratableRole): GeneratedLookupKeyCandidate[] {
	const entries = collectGenerationSourceEntries(role);
	const candidates: GeneratedLookupKeyCandidate[] = [];

	for (const entry of entries) {
		const segmentedDetail = buildSegmentedSourceDetail(entry.value);
		const mixedHanKana = hasMixedHanKanaSource(entry.value);
		const segmentedRomanized = mixedHanKana ? buildMixedScriptRomanizedText(entry.value) : '';

		if (segmentedRomanized) {
			candidates.push(
				...buildCandidateItems(
					entry,
					'混合文本 · 分段转写',
					buildLookupKeyVariants(segmentedRomanized),
					segmentedDetail,
				),
			);
		}

		if (HAN_CHARACTER_RE.test(entry.value)) {
			candidates.push(
				...buildCandidateItems(
					entry,
					hasSegmentedHanReading(entry.value) ? '混合文本 · 汉字段拼音' : '中文拼音推定',
					generatePinyinCandidateVariants(entry.value),
					hasSegmentedHanReading(entry.value) ? segmentedDetail : undefined,
				),
			);
		}

		if (JAPANESE_KANA_RE.test(entry.value)) {
			candidates.push(
				...buildCandidateItems(
					entry,
					'日语假名转写',
					generateJapaneseRomajiCandidateVariants(entry.value),
					mixedHanKana ? segmentedDetail : undefined,
				),
			);
		}

		if (containsNonAscii(entry.value) && !segmentedRomanized) {
			candidates.push(...buildCandidateItems(entry, '通用转写', buildLookupKeyVariants(transliterate(entry.value))));
		}
	}

	return mergeGeneratedCandidates(candidates);
}

async function generateJapaneseGuessCandidates(role: LookupKeyGeneratableRole): Promise<GeneratedLookupKeyCandidate[]> {
	const entries = collectGenerationSourceEntries(role).filter(entry => shouldGuessJapanese(entry.value));
	if (entries.length === 0) {
		return [];
	}

	try {
		const kuroshiro = await getKuroshiroInstance();
		const systems: Array<{ system: 'hepburn' | 'passport' | 'nippon'; group: string }> = [
			{ system: 'hepburn', group: '日语推定 · Hepburn' },
			{ system: 'passport', group: '日语推定 · Passport' },
			{ system: 'nippon', group: '日语推定 · Nippon' },
		];
		const candidates: GeneratedLookupKeyCandidate[] = [];

		for (const entry of entries) {
			const normalizedSource = entry.value.replace(/[·・]/g, ' ').trim();
			for (const config of systems) {
				try {
					const romanized = await kuroshiro.convert(normalizedSource, {
						to: 'romaji',
						mode: 'spaced',
						romajiSystem: config.system,
					});
					candidates.push(...buildCandidateItems(entry, config.group, buildLookupKeyVariants(romanized)));
				} catch {
					// ignore per-system conversion failure
				}
			}
		}

		return mergeGeneratedCandidates(candidates);
	} catch {
		return [];
	}
}

function llmRomanizationEnabled(resourcePath?: string): boolean {
	const resource = resourcePath ? vscode.Uri.file(resourcePath) : undefined;
	const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper', resource);
	return cfg.get<boolean>('lookupKeys.useLlmRomanization', false) === true;
}

function parseLlmRomanizationReply(reply: string): string[] {
	return normalizeStringList(
		reply
			.split(/\r?\n/)
			.map(line => line.replace(/^\s*(?:[-*+]|\d+[.)、．])\s*/, '').trim())
			.filter(Boolean)
			.slice(0, 3)
	);
}

async function requestRomanizationCandidatesFromLLM(
	primarySource: LookupKeySourceEntry,
	prompt: string,
	group: string,
): Promise<GeneratedLookupKeyCandidate[]> {
	try {
		const reply = await translateTextWithClientLLM(prompt, '英文（仅输出拉丁字母转写）', {
			requireEnabled: false,
		});

		return parseLlmRomanizationReply(reply).flatMap(value =>
			buildCandidateItems(primarySource, group, buildLookupKeyVariants(value))
		);
	} catch {
		return [];
	}
}

async function generateRomanizedCandidatesWithLLM(
	role: LookupKeyGeneratableRole,
	resourcePath?: string,
): Promise<GeneratedLookupKeyCandidate[]> {
	if (!llmRomanizationEnabled(resourcePath)) {
		return [];
	}

	const primarySource = collectGenerationSourceEntries(role).find(entry => containsNonAscii(entry.value));
	if (!primarySource) {
		return [];
	}

	const candidates = await requestRomanizationCandidatesFromLLM(
		primarySource,
		`请将下面这个姓名转换成适合检索的拉丁字母转写候选：

姓名：${primarySource.value}

规则：
1. 如果是日语，请优先给出常见的平文式或通用 romaji。
2. 如果是中文，请给出不带声调的拼音。
3. 如果是韩语，请给出 Revised Romanization。
4. 如果存在多种常见写法，返回最多 3 个候选，每行一个。
5. 不要解释，不要编号，只返回候选文本。`,
		'智能转写',
	);

	if (HAN_CHARACTER_RE.test(primarySource.value) && !JAPANESE_KANA_RE.test(primarySource.value)) {
		const japaneseCandidates = await requestRomanizationCandidatesFromLLM(
			primarySource,
			`请把下面这个纯汉字姓名按日文姓名处理，并给出适合检索的罗马字候选：

姓名：${primarySource.value}

规则：
1. 按日文姓名推定读音。
2. 优先使用常见的平文式或通用 romaji。
3. 如果存在多种常见读法，返回最多 3 个候选，每行一个。
4. 不要解释，不要编号，只返回候选文本。`,
			'日语读音推定 · LLM',
		);

		return mergeGeneratedCandidates(candidates, japaneseCandidates);
	}

	return candidates;
}

function mergeGeneratedCandidates(...groups: GeneratedLookupKeyCandidate[][]): GeneratedLookupKeyCandidate[] {
	const seen = new Set<string>();
	const merged: GeneratedLookupKeyCandidate[] = [];

	for (const group of groups) {
		for (const candidate of group) {
			const dedupeKey = getCandidateDedupKey(candidate);
			if (!candidate.value || seen.has(dedupeKey)) {
				continue;
			}
			seen.add(dedupeKey);
			merged.push(candidate);
		}
	}

	return merged;
}

export function getGeneratedLookupKeyCandidates(
	role: LookupKeyGeneratableRole,
	kind: LookupKeyGenerationKind,
): GeneratedLookupKeyCandidate[] {
	const entries = collectGenerationSourceEntries(role);
	if (entries.length === 0) {
		return [];
	}

	if (kind === 'romanized') {
		return generateRomanizedLocalCandidates(role);
	}

	const seen = new Set<string>();
	const candidates: GeneratedLookupKeyCandidate[] = [];

	for (const entry of entries) {
		const mixedHanSource = hasSegmentedHanReading(entry.value);
		const detail = mixedHanSource ? buildSegmentedSourceDetail(entry.value) : `来源：${entry.value}`;
		for (const variant of generatePinyinCandidateVariants(entry.value)) {
			if (seen.has(variant.value)) {
				continue;
			}
			seen.add(variant.value);
			candidates.push({
				group: mixedHanSource ? '混合文本 · 汉字段拼音' : '中文拼音',
				value: variant.value,
				label: `${entry.label} · ${variant.label}`,
				detail: detail,
			});
		}
	}

	return candidates;
}

export async function getRequestedLookupKeyCandidates(
	role: LookupKeyGeneratableRole,
	kind: LookupKeyGenerationKind,
	resourcePath?: string,
): Promise<GeneratedLookupKeyCandidate[]> {
	const localCandidates = getGeneratedLookupKeyCandidates(role, kind);
	if (kind !== 'romanized') {
		return localCandidates;
	}

	const japaneseGuessCandidates = await generateJapaneseGuessCandidates(role);
	const llmCandidates = await generateRomanizedCandidatesWithLLM(role, resourcePath);
	return mergeGeneratedCandidates(localCandidates, japaneseGuessCandidates, llmCandidates);
}

function getLookupKeyGenerationConfig(resourcePath?: string): { pinyin: boolean; romanized: boolean } {
	const resource = resourcePath ? vscode.Uri.file(resourcePath) : undefined;
	const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper', resource);
	return {
		pinyin: cfg.get<boolean>('lookupKeys.autoGeneratePinyin', false),
		romanized: cfg.get<boolean>('lookupKeys.autoGenerateRomanized', false),
	};
}

export function applyGeneratedLookupKeys<T extends LookupKeyGeneratableRole>(role: T, resourcePath?: string): T {
	const config = getLookupKeyGenerationConfig(resourcePath);
	if (!config.pinyin && !config.romanized) {
		return role;
	}

	const sources = collectGenerationSources(role);
	if (sources.length === 0) {
		return role;
	}

	if (config.pinyin) {
		const generatedPinyin = normalizeStringList(sources.flatMap(generatePinyinCandidates));
		const mergedPinyin = normalizeStringList([...(role.lookupKeys_pinyin ?? []), ...generatedPinyin]);
		role.lookupKeys_pinyin = mergedPinyin.length ? mergedPinyin : undefined;
	}

	if (config.romanized) {
		const generatedRomanized = normalizeStringList(sources.flatMap(generateRomanizedCandidates));
		const mergedRomanized = normalizeStringList([...(role.lookupKeys_romanized ?? []), ...generatedRomanized]);
		role.lookupKeys_romanized = mergedRomanized.length ? mergedRomanized : undefined;
	}

	return role;
}
