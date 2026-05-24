import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as chardet from 'jschardet';
import * as iconv from 'iconv-lite';
import JSON5 from 'json5';
import * as fastGlob from 'fast-glob';

/* eslint-disable curly */
import { Role, segmenter } from "../extension";
import { getLastWord } from './segmenter';
import { _onDidChangeRoles, _onDidFinishRoles, cleanRoles, roles, sensitiveSourceFiles } from '../activate';
import { globalFileCache } from '../context/fileCache';
import { FIELD_ALIASES, parseMarkdownRoles } from './Parser/markdownParser';
import { parseTomlRoles } from './Parser/tomlParser';
import { generateCSpellDictionary } from './generateCSpellDictionary';
import { generateUUIDv7, generateRoleNameHash } from './uuidUtils';
import { ensureRoleUUIDs, fixInvalidRoleUUIDs, setRoleUuidAutoFixWriteHook, type RoleUuidAutoFixWrite } from './roleUuidManager';
import { loadRelationships, updateRelationships } from './relationshipLoader';
import { enhanceAllRolesWithRelationships, clearRelationshipProperties } from './roleRelationshipEnhancer';
import { SmartRoleAdder } from './roleMerger';
import { isLikelyDelimitedRoleFileContent, parseDelimitedRoleFile } from './delimitedRoleFile';
import { getProjectKeywordConfig, mergeProjectKeywordConfigs, type ProjectKeywordConfig } from '../projectConfig/projectKeywordConfig';
import { DEFAULT_PROJECT_KEYWORD_CONFIG } from '../projectConfig/resourceFileNaming';
import { applyGeneratedLookupKeys } from './roleLookupKeyGeneration';
import { shouldIncrementalRoleLoad } from './roleLoadMode';
import { flattenJsonRoleTree } from './roleHierarchy';
import { applyRoleLineage } from './roleLineage';

// 创建全局的角色管理器
export let roleManager: SmartRoleAdder | null = null;

const ROLE_FILE_LOOP_WINDOW_MS = 10_000;
const ROLE_FILE_LOOP_MAX_REPEATED_SMALL_DIFFS = 3;
const ROLE_FILE_SMALL_DIFF_MAX_CHARS = 256;
const ROLE_FILE_SMALL_DIFF_MAX_RATIO = 0.03;
type RoleFileAutoFixSnapshot = {
	ts: number;
	diffStart?: number;
	diffEnd?: number;
	streak: number;
};
const roleFileAutoFixSnapshots = new Map<string, RoleFileAutoFixSnapshot>();
const isolatedRoleFiles = new Map<string, { reason: string; detail?: string; ts: number }>();
const notifiedRoleFileIssues = new Set<string>();
let roleFileDiagnosticCollection: vscode.DiagnosticCollection | undefined;
const roleFileIsolationDiagnostics = new Map<string, vscode.Diagnostic[]>();
const roleFileValidationDiagnostics = new Map<string, Map<string, vscode.Diagnostic[]>>();

function normalizeRoleFileKey(filePath: string): string {
	const resolved = path.resolve(filePath);
	return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function getRoleFileDiagnostics(): vscode.DiagnosticCollection {
	if (!roleFileDiagnosticCollection) {
		roleFileDiagnosticCollection = vscode.languages.createDiagnosticCollection('Andrea Novel Helper Role Files');
	}
	return roleFileDiagnosticCollection;
}

function severityFromConfig(value: string | undefined, fallback: vscode.DiagnosticSeverity): vscode.DiagnosticSeverity {
	switch ((value || '').toLowerCase()) {
		case 'error': return vscode.DiagnosticSeverity.Error;
		case 'warning': return vscode.DiagnosticSeverity.Warning;
		case 'information': return vscode.DiagnosticSeverity.Information;
		case 'hint': return vscode.DiagnosticSeverity.Hint;
		case 'off':
		case 'none': return fallback;
		default: return fallback;
	}
}

function roleFileBasicFieldSeverity(filePath: string): vscode.DiagnosticSeverity | undefined {
	const configured = vscode.workspace.getConfiguration('AndreaNovelHelper', vscode.Uri.file(filePath))
		.get<string>('roleFile.basicFieldsDiagnosticLevel', 'warning');
	if (configured === 'off' || configured === 'none') {
		return undefined;
	}
	return severityFromConfig(configured, vscode.DiagnosticSeverity.Warning);
}

function syncRoleFileDiagnostics(filePath: string): void {
	const key = normalizeRoleFileKey(filePath);
	const diagnostics = [
		...(roleFileIsolationDiagnostics.get(key) || []),
		...Array.from(roleFileValidationDiagnostics.get(key)?.values() || []).flat(),
	];
	try {
		const collection = getRoleFileDiagnostics();
		const uri = vscode.Uri.file(filePath);
		if (diagnostics.length) {
			collection.set(uri, diagnostics);
		} else {
			collection.delete(uri);
		}
	} catch { /* ignore */ }
}

function clearRoleFileIssue(filePath: string): void {
	const key = normalizeRoleFileKey(filePath);
	isolatedRoleFiles.delete(key);
	notifiedRoleFileIssues.delete(key);
	roleFileIsolationDiagnostics.delete(key);
	syncRoleFileDiagnostics(filePath);
}

export function clearRoleFileLoadIssues(): void {
	isolatedRoleFiles.clear();
	notifiedRoleFileIssues.clear();
	roleFileAutoFixSnapshots.clear();
	roleFileIsolationDiagnostics.clear();
	roleFileValidationDiagnostics.clear();
	try { roleFileDiagnosticCollection?.clear(); } catch { /* ignore */ }
}

function isolateRoleFile(filePath: string, reason: string, detail?: string): void {
	const key = normalizeRoleFileKey(filePath);
	isolatedRoleFiles.set(key, { reason, detail, ts: Date.now() });

	const message = detail ? `${reason}: ${detail}` : reason;
	const diagnostic = new vscode.Diagnostic(
		new vscode.Range(0, 0, 0, 0),
		`角色文件已被临时隔离。${message}`,
		vscode.DiagnosticSeverity.Error
	);
	diagnostic.source = 'Andrea Novel Helper';
	diagnostic.code = 'role-file-isolated';
	roleFileIsolationDiagnostics.set(key, [diagnostic]);
	syncRoleFileDiagnostics(filePath);

	if (notifiedRoleFileIssues.has(key)) {
		return;
	}
	notifiedRoleFileIssues.add(key);
	const fileName = path.basename(filePath);
	void vscode.window.showWarningMessage(
		`角色文件格式错误或反复触发加载，已临时跳过：${fileName}`,
		'打开文件',
		'重新加载角色库'
	).then(action => {
		if (action === '打开文件') {
			void vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: false });
		} else if (action === '重新加载角色库') {
			void vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
		}
	});
}

function isRoleFileIsolated(filePath: string): boolean {
	return isolatedRoleFiles.has(normalizeRoleFileKey(filePath));
}

function getChangedRange(previous: string, next: string): { start: number; prevEnd: number; nextEnd: number; prevLen: number; nextLen: number } | undefined {
	if (previous === next) {
		return undefined;
	}
	let start = 0;
	const prevLength = previous.length;
	const nextLength = next.length;
	while (start < prevLength && start < nextLength && previous.charCodeAt(start) === next.charCodeAt(start)) {
		start++;
	}

	let prevEnd = prevLength;
	let nextEnd = nextLength;
	while (prevEnd > start && nextEnd > start && previous.charCodeAt(prevEnd - 1) === next.charCodeAt(nextEnd - 1)) {
		prevEnd--;
		nextEnd--;
	}

	return {
		start,
		prevEnd,
		nextEnd,
		prevLen: prevEnd - start,
		nextLen: nextEnd - start,
	};
}

function rangesOverlapLoosely(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
	const slack = 64;
	return Math.max(aStart, bStart) <= Math.min(aEnd, bEnd) + slack;
}

function recordRoleUuidAutoFixWrite(event: RoleUuidAutoFixWrite): void {
	if (isRoleFileIsolated(event.filePath)) {
		return;
	}
	const diff = getChangedRange(event.before, event.after);
	if (!diff) {
		return;
	}

	const key = normalizeRoleFileKey(event.filePath);
	const now = Date.now();
	const previous = roleFileAutoFixSnapshots.get(key);

	const elapsed = previous ? now - previous.ts : Number.POSITIVE_INFINITY;
	const changedChars = Math.max(diff.prevLen, diff.nextLen);
	const smallEnough = changedChars <= ROLE_FILE_SMALL_DIFF_MAX_CHARS
		|| changedChars <= Math.max(event.before.length, event.after.length) * ROLE_FILE_SMALL_DIFF_MAX_RATIO;
	const sameRegion = !previous || previous.diffStart === undefined || previous.diffEnd === undefined
		? true
		: rangesOverlapLoosely(previous.diffStart, previous.diffEnd, diff.start, diff.nextEnd);
	const countsAsLoopMutation = !!previous && elapsed <= ROLE_FILE_LOOP_WINDOW_MS && smallEnough && sameRegion;
	const streak = countsAsLoopMutation ? previous.streak + 1 : 0;

	roleFileAutoFixSnapshots.set(key, {
		ts: now,
		diffStart: diff.start,
		diffEnd: diff.nextEnd,
		streak,
	});

	if (streak >= ROLE_FILE_LOOP_MAX_REPEATED_SMALL_DIFFS) {
		isolateRoleFile(
			event.filePath,
			'角色文件同一小段内容短时间内反复变化，疑似解析/自动修复回环',
			`${Math.round(ROLE_FILE_LOOP_WINDOW_MS / 1000)} 秒内同一区域发生 ${streak + 1} 次小范围变更`
		);
	}
}

setRoleUuidAutoFixWriteHook(recordRoleUuidAutoFixWrite);

function reportRoleFileFormatError(filePath: string, fileName: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	isolateRoleFile(filePath, `角色文件格式错误，已跳过 ${fileName}`, message);
}

function lineOfFirstMatch(content: string, needle: string | undefined): number {
	if (!needle) {
		return 0;
	}
	const index = content.indexOf(needle);
	if (index < 0) {
		return 0;
	}
	return content.slice(0, index).split(/\r?\n/).length - 1;
}

function setRoleFileValidationDiagnostics(filePath: string, diagnostics: vscode.Diagnostic[], bucket = 'basic'): void {
	const key = normalizeRoleFileKey(filePath);
	let buckets = roleFileValidationDiagnostics.get(key);
	if (!buckets) {
		buckets = new Map<string, vscode.Diagnostic[]>();
		roleFileValidationDiagnostics.set(key, buckets);
	}
	if (diagnostics.length) {
		buckets.set(bucket, diagnostics);
	} else {
		buckets.delete(bucket);
		if (buckets.size === 0) {
			roleFileValidationDiagnostics.delete(key);
		}
	}
	syncRoleFileDiagnostics(filePath);
}

function validateLoadedRoleBasics(
	filePath: string,
	content: string,
	rolesToValidate: Array<Role | Partial<Role>>,
	options?: { requireExplicitType?: boolean; explicitType?: (role: Role | Partial<Role>, index: number) => boolean }
): void {
	if (filePath.toLowerCase().endsWith('.txt')) {
		setRoleFileValidationDiagnostics(filePath, []);
		return;
	}
	const severity = roleFileBasicFieldSeverity(filePath);
	if (severity === undefined) {
		setRoleFileValidationDiagnostics(filePath, []);
		return;
	}

	const diagnostics: vscode.Diagnostic[] = [];
	rolesToValidate.forEach((role, index) => {
		const missing: string[] = [];
		if (!role.name || String(role.name).trim() === '') {
			missing.push('name/名称');
		}
		const hasType = options?.requireExplicitType
			? !!options.explicitType?.(role, index)
			: !!role.type && String(role.type).trim() !== '';
		if (!hasType) {
			missing.push('type/类型');
		}
		if (!missing.length) {
			return;
		}

		const line = lineOfFirstMatch(content, role.name ? String(role.name) : undefined);
		const diagnostic = new vscode.Diagnostic(
			new vscode.Range(line, 0, line, 0),
			`角色条目缺少基础字段：${missing.join(', ')}`,
			severity
		);
		diagnostic.source = 'Andrea Novel Helper';
		diagnostic.code = 'role-file-basic-fields';
		diagnostics.push(diagnostic);
	});
	setRoleFileValidationDiagnostics(filePath, diagnostics);
}

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function markdownRoleHasTypeField(content: string, roleName: string | undefined): boolean {
	if (!roleName) {
		return false;
	}
	const heading = new RegExp(`^(#{1,6})\\s+${escapeRegex(roleName)}\\s*$`, 'm').exec(content);
	if (!heading || heading.index === undefined) {
		return false;
	}
	const level = heading[1].length;
	const bodyStart = heading.index + heading[0].length;
	const nextHeading = new RegExp(`^#{1,${level}}\\s+`, 'm').exec(content.slice(bodyStart));
	const body = nextHeading ? content.slice(bodyStart, bodyStart + nextHeading.index) : content.slice(bodyStart);
	return new RegExp(`^#{${level + 1},6}\\s+(?:type|类型)\\s*$`, 'mi').test(body);
}

type MarkdownHeadingInfo = { line: number; level: number; text: string };
type MarkdownHeadingWithField = MarkdownHeadingInfo & { field: string };

function normalizeMarkdownSemanticField(headerText: string): string | undefined {
	const trimmed = headerText.trim();
	const lower = trimmed.toLowerCase();
	for (const key of Object.keys(FIELD_ALIASES)) {
		if (key.toLowerCase() === lower) {
			return key;
		}
	}
	for (const [key, value] of Object.entries(FIELD_ALIASES)) {
		if (value === trimmed) {
			return key;
		}
	}
	return undefined;
}

function collectMarkdownHeadings(lines: string[]): MarkdownHeadingInfo[] {
	const headings: MarkdownHeadingInfo[] = [];
	lines.forEach((line, index) => {
		const match = line.trim().match(/^(#{1,6})\s+(.+)$/);
		if (!match) {
			return;
		}
		headings.push({ line: index, level: match[1].length, text: match[2].trim() });
	});
	return headings;
}

function markdownHeadingChildren(
	headings: MarkdownHeadingInfo[],
	headingIndex: number,
): { start: number; end: number; children: MarkdownHeadingInfo[] } {
	const heading = headings[headingIndex];
	const nextSameOrParent = headings.findIndex((item, index) => index > headingIndex && item.level <= heading.level);
	const end = nextSameOrParent >= 0 ? nextSameOrParent : headings.length;
	return { start: headingIndex + 1, end, children: headings.slice(headingIndex + 1, end) };
}

function markdownDirectSemanticFields(
	headings: MarkdownHeadingInfo[],
	headingIndex: number,
): MarkdownHeadingWithField[] {
	const heading = headings[headingIndex];
	const { children } = markdownHeadingChildren(headings, headingIndex);
	return children
		.filter(item => item.level === heading.level + 1)
		.map(item => ({ ...item, field: normalizeMarkdownSemanticField(item.text) }))
		.filter((item): item is MarkdownHeadingWithField => !!item.field);
}

function updateMarkdownRoleStructureDiagnostics(filePath: string, content: string): void {
	const diagnostics: vscode.Diagnostic[] = [];
	const lines = content.split(/\r?\n/);
	const headings = collectMarkdownHeadings(lines);

	for (let i = 0; i < headings.length; i++) {
		const heading = headings[i];
		const fieldName = normalizeMarkdownSemanticField(heading.text);
		if (fieldName) {
			continue;
		}

		const { children: childHeadings } = markdownHeadingChildren(headings, i);
		if (!childHeadings.length) {
			continue;
		}

		const directFields = markdownDirectSemanticFields(headings, i);
		const fieldGroups = new Map<string, Array<MarkdownHeadingInfo & { field: string }>>();
		for (const item of directFields) {
			const group = fieldGroups.get(item.field) || [];
			group.push(item);
			fieldGroups.set(item.field, group);
		}
		for (const [field, group] of fieldGroups.entries()) {
			if (group.length <= 1) {
				continue;
			}
			for (const duplicate of group.slice(1)) {
				const diagnostic = new vscode.Diagnostic(
					new vscode.Range(duplicate.line, 0, duplicate.line, Math.max(1, lines[duplicate.line]?.length || 1)),
					`角色条目 "${heading.text}" 内重复定义了语义字段 "${field}"。同一角色的基础语义字段不能重合，请合并或删除重复字段。`,
					vscode.DiagnosticSeverity.Error
				);
				diagnostic.source = 'Andrea Novel Helper';
				diagnostic.code = 'role-file-duplicate-semantic-field';
				diagnostics.push(diagnostic);
			}
		}
	}

	setRoleFileValidationDiagnostics(filePath, diagnostics, 'markdown-structure');
}

function updateMarkdownUuidFieldDiagnostics(filePath: string, content: string): void {
	const diagnostics: vscode.Diagnostic[] = [];
	const lines = content.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const heading = lines[i].trim().match(/^(#{1,6})\s+UUID\s*$/i);
		if (!heading) {
			continue;
		}
		const level = heading[1].length;
		let seenUuid = false;
		for (let j = i + 1; j < lines.length; j++) {
			const trimmed = lines[j].trim();
			const nextHeading = trimmed.match(/^(#{1,6})\s+/);
			if (nextHeading && nextHeading[1].length <= level) {
				break;
			}
			if (!trimmed) {
				continue;
			}
			if (!seenUuid && /\b(?:urn:uuid:)?\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?\b/i.test(trimmed)) {
				seenUuid = true;
				continue;
			}
			if (seenUuid) {
				const diagnostic = new vscode.Diagnostic(
					new vscode.Range(j, 0, j, Math.max(1, lines[j].length)),
					'UUID 字段包含 UUID 之外的内容。解析器只会读取第一枚 UUID；请把表格、正文或其他字段移出 UUID 段，避免角色库格式错误。',
					vscode.DiagnosticSeverity.Error
				);
				diagnostic.source = 'Andrea Novel Helper';
				diagnostic.code = 'role-file-dirty-uuid-field';
				diagnostics.push(diagnostic);
				break;
			}
		}
	}
	setRoleFileValidationDiagnostics(filePath, diagnostics, 'dirty-uuid');
}

function tomlRoleHasTypeField(content: string, roleName: string | undefined): boolean {
	if (!roleName) {
		return false;
	}
	const namePattern = new RegExp(`^\\s*name\\s*=\\s*["']${escapeRegex(roleName)}["']\\s*$`, 'm');
	const nameMatch = namePattern.exec(content);
	if (!nameMatch || nameMatch.index === undefined) {
		return false;
	}
	const sectionStart = content.lastIndexOf('[[', nameMatch.index);
	const from = sectionStart >= 0 ? sectionStart : nameMatch.index;
	const nextSectionRel = content.slice(nameMatch.index + nameMatch[0].length).search(new RegExp('^\\s*\\[\\[', 'm'));
	const to = nextSectionRel >= 0 ? nameMatch.index + nameMatch[0].length + nextSectionRel : content.length;
	return /^\s*type\s*=/m.test(content.slice(from, to));
}

/**
 * 智能添加角色到 roles 数组
 * 如果 roleManager 存在，使用它来处理合并
 */
function addRole(role: Role) {
	applyGeneratedLookupKeys(role, role.sourcePath);
	if (roleManager) {
		roleManager.addRole(role);
	} else {
		// 如果 roleManager 未初始化（例如传统加载），直接添加
		roles.push(role);
	}
}

const DEFAULT_EXTERNAL_FOLDER_IGNORED_DIRECTORIES = [
	'.git', '.vscode', '.idea', 'node_modules', 'dist', 'build', 'out', '.DS_Store', 'Thumbs.db'
];

const DEFAULT_EXTERNAL_FOLDER_MARKER_KEYWORDS = [
	'character-gallery', 'character', 'role', 'roles',
	'sensitive-words', 'sensitive', 'vocabulary', 'vocab',
	'regex-patterns', 'regex',
	'relationship', 'relation', 'connections', 'links',
	'timeline',
	'角色', '人物', '敏感词', '词汇', '词庫', '词库',
	'正则', '正則', '正则表达式', '正則表達式',
	'关系', '关联', '连接', '联系',
	'时间线', '時間線'
];

const EXTERNAL_RESOURCE_AUTO_MARKER_EXTENSIONS = new Set([
	'.ojson5', '.rjson5', '.ojson', '.rjson', '.tjson5'
]);

const EXTERNAL_RESOURCE_KEYWORD_EXTENSIONS = new Set([
	'.json5', '.txt', '.csv', '.ojson', '.rjson', '.rjson5', '.ojson5', '.tjson5', '.toml'
]);

const DEFAULT_EXTERNAL_FOLDER_MD_MARKER_BASENAMES = [
	'character-gallery', 'sensitive-words', 'vocabulary'
];

const DEFAULT_EXTERNAL_FOLDER_MD_MARKER_SUFFIXES = [
	'_character', '_sensitive', '_vocabulary',
	'-character', '-sensitive', '-vocabulary'
];

export interface ExternalRoleFolderScanReport {
	generatedAt: string;
	workspaceRoots: string[];
	ignoredDirectories: string[];
	markerKeywords: string[];
	legacyInitEnabled: boolean;
	totalCandidateFiles: number;
	matchedLegacyInitFiles: number;
	matchedMarkerFiles: number;
	externalFolderCount: number;
	externalFolders: string[];
	sampleMatchedFiles: string[];
	durationMs: number;
}

let lastExternalRoleFolders: string[] = [];
let lastExternalRoleFolderScanReport: ExternalRoleFolderScanReport | undefined;

function normalizePathForCompare(p: string): string {
	const normalized = path.resolve(p).replace(/[\\/]+/g, path.sep);
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function dedupeKeywords(values: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of values) {
		const v = String(raw ?? '').trim();
		if (!v) continue;
		const key = v.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(v);
	}
	return result;
}

function getExternalIgnoredDirectories(): string[] {
	const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
	const values = cfg.get<string[]>('externalFolder.ignoredDirectories', DEFAULT_EXTERNAL_FOLDER_IGNORED_DIRECTORIES) || [];
	const normalized = values.map(v => String(v ?? '').trim()).filter(Boolean);
	return normalized.length ? normalized : [...DEFAULT_EXTERNAL_FOLDER_IGNORED_DIRECTORIES];
}

export function getExternalFolderMarkerKeywords(): string[] {
	const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
	const values = cfg.get<string[]>('externalFolder.markerKeywords', DEFAULT_EXTERNAL_FOLDER_MARKER_KEYWORDS) || [];
	const deduped = dedupeKeywords(values);
	return deduped.length ? deduped : [...DEFAULT_EXTERNAL_FOLDER_MARKER_KEYWORDS];
}

function isMdLibraryMarkerFile(fileName: string): boolean {
	const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
	const enabled = cfg.get<boolean>('externalFolder.enableMdLibraryNameMarkers', true);
	if (!enabled) {
		return false;
	}

	const lowerName = fileName.toLowerCase();
	const ext = path.extname(lowerName);
	if (ext !== '.md') {
		return false;
	}

	const baseName = path.basename(lowerName, ext);
	if (!baseName) {
		return false;
	}

	if (DEFAULT_EXTERNAL_FOLDER_MD_MARKER_BASENAMES.includes(baseName)) {
		return true;
	}

	return DEFAULT_EXTERNAL_FOLDER_MD_MARKER_SUFFIXES.some(suffix => baseName.endsWith(suffix));
}

function hasMarkerKeyword(fileName: string, markerKeywordsLower: readonly string[]): boolean {
	const lowerName = fileName.toLowerCase();
	return markerKeywordsLower.some(k => lowerName.includes(k));
}

export function isExternalResourceMarkerFile(fileName: string, markerKeywords?: readonly string[]): boolean {
	const lowerName = fileName.toLowerCase();
	const ext = path.extname(lowerName);
	if (EXTERNAL_RESOURCE_AUTO_MARKER_EXTENSIONS.has(ext)) {
		return true;
	}
	if (ext === '.md') {
		return isMdLibraryMarkerFile(fileName);
	}
	if (!EXTERNAL_RESOURCE_KEYWORD_EXTENSIONS.has(ext)) {
		return false;
	}
	const keywords = (markerKeywords && markerKeywords.length ? markerKeywords : getExternalFolderMarkerKeywords())
		.map(k => k.toLowerCase());
	return hasMarkerKeyword(fileName, keywords);
}

export function isPathUnderAnyRoot(filePath: string, roots: readonly string[]): boolean {
	const target = normalizePathForCompare(filePath);
	for (const root of roots) {
		const normalizedRoot = normalizePathForCompare(root);
		if (target === normalizedRoot || target.startsWith(normalizedRoot + path.sep)) {
			return true;
		}
	}
	return false;
}

export function getLastExternalRoleFolders(): string[] {
	return [...lastExternalRoleFolders];
}

export function getLastExternalRoleFolderScanReport(): ExternalRoleFolderScanReport | undefined {
	return lastExternalRoleFolderScanReport ? { ...lastExternalRoleFolderScanReport, externalFolders: [...lastExternalRoleFolderScanReport.externalFolders], sampleMatchedFiles: [...lastExternalRoleFolderScanReport.sampleMatchedFiles] } : undefined;
}

/**
 * 扫描外部资源目录（保留 __init__.ojson5 兼容，同时支持可配置关键字 + rjson/ojson/tjson 等标识）
 */
export function scanExternalRoleFoldersWithReport(workspaceFolders?: readonly vscode.WorkspaceFolder[]): { externalFolders: string[]; report: ExternalRoleFolderScanReport; } {
	const startedAt = Date.now();
	const folders = workspaceFolders || vscode.workspace.workspaceFolders || [];
	const ignoredDirectories = getExternalIgnoredDirectories();
	const markerKeywords = getExternalFolderMarkerKeywords();
	const markerKeywordsLower = markerKeywords.map(k => k.toLowerCase());
	const externalFolderSet = new Set<string>();
	const ignoredFolderSet = new Set<string>(); // 被 .anh-ignore 标记排除的目录
	const sampleMatchedFiles: string[] = [];
	let totalCandidateFiles = 0;
	let matchedLegacyInitFiles = 0;
	let matchedMarkerFiles = 0;

	// 先扫描 .anh-ignore 文件，收集被排除的目录
	for (const folder of folders) {
		const workspaceRoot = folder.uri.fsPath;
		const ignoreFiles = fastGlob.sync('**/.anh-ignore', {
			cwd: workspaceRoot,
			absolute: true,
			onlyFiles: true,
			dot: true,
			ignore: [
				'novel-helper/**',
				...ignoredDirectories.map(dir => `**/${dir}/**`)
			]
		});
		for (const ignoreFile of ignoreFiles) {
			ignoredFolderSet.add(path.dirname(ignoreFile));
		}
	}

	for (const folder of folders) {
		const workspaceRoot = folder.uri.fsPath;
		const candidates = fastGlob.sync('**/*.{ojson5,rjson5,ojson,rjson,tjson5,json5,md,txt,csv}', {
			cwd: workspaceRoot,
			absolute: true,
			onlyFiles: true,
			dot: false,
			ignore: [
				'novel-helper/**',
				...ignoredDirectories.map(dir => `**/${dir}/**`)
			]
		});

		totalCandidateFiles += candidates.length;

		for (const filePath of candidates) {
			const dirPath = path.dirname(filePath);

			// 如果目录被 .anh-ignore 排除，跳过
			if (ignoredFolderSet.has(dirPath)) {
				continue;
			}

			const baseName = path.basename(filePath);
			const lowerName = baseName.toLowerCase();
			if (lowerName === '__init__.ojson5') {
				matchedLegacyInitFiles++;
				externalFolderSet.add(dirPath);
				sampleMatchedFiles.push(filePath);
				continue;
			}
			const matchedRoleFile = isRoleFile(baseName, filePath);
			if (!matchedRoleFile && !isExternalResourceMarkerFile(baseName, markerKeywordsLower)) {
				continue;
			}
			matchedMarkerFiles++;
			externalFolderSet.add(dirPath);
			sampleMatchedFiles.push(filePath);
		}
	}

	const externalFolders = Array.from(externalFolderSet).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
	const report: ExternalRoleFolderScanReport = {
		generatedAt: new Date().toISOString(),
		workspaceRoots: folders.map(f => f.uri.fsPath),
		ignoredDirectories: [...ignoredDirectories],
		markerKeywords: [...markerKeywords],
		legacyInitEnabled: true,
		totalCandidateFiles,
		matchedLegacyInitFiles,
		matchedMarkerFiles,
		externalFolderCount: externalFolders.length,
		externalFolders,
		sampleMatchedFiles,
		durationMs: Date.now() - startedAt
	};

	lastExternalRoleFolders = externalFolders;
	lastExternalRoleFolderScanReport = report;
	return { externalFolders, report };
}

export interface TextStats {
    cjkChars: number;
    asciiChars: number;
    words: number;
    nonWSChars: number;
    nonWSNoPunct: number;
    total: number;
}

/**
 * 用分词器拆分成词，取最后一个词作为补全前缀
 */
export function getPrefix(line: string): string {
	// 使用增强的分词器获取最后一个词
	const last = getLastWord(line);

	// 可选调试输出
	try {
		const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
		if (cfg.get<boolean>('debugCompletion', false)) {
			console.log('[ANH][getPrefix] line=', line, ' -> prefix=', last);
		}
	} catch { /* ignore */ }
	return last;
}

// 类型到默认颜色映射
export const typeColorMap: Record<string, string> = {
	主角: '#FFD700',       // 金色
	配角: '#ADD8E6',       // 淡蓝
	'联动角色': '#90EE90', // 淡绿
	'正则表达式': '#FFA500' // 橙色
};

/**
 * 从用户设置中获取支持的语言 ID 列表
 * @returns 支持的 VS Code 语言 ID 数组
 */
export const getSupportedLanguages = (): string[] => {
	const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
	// 默认包含 markdown / plaintext / json5 / csv / ojson / ojson5 / rjson / rjson5 / tjson5
	const fileTypes = cfg.get<string[]>('supportedFileTypes', ['markdown', 'plaintext', 'json5', 'csv', 'ojson', 'ojson5', 'rjson', 'rjson5', 'tjson5', 'toml'])!;
	return fileTypes.map((t: string): string =>
		t === 'txt' ? 'plaintext' : t
	);
};

/**
 * 语言 ID → 文件扩展名 的映射表
 */
const langToExt: Record<string, string> = {
	markdown: 'md',
	plaintext: 'txt',
	csv: 'csv',
	javascript: 'js',
	typescript: 'ts',
	ojson: 'ojson',
	ojson5: 'ojson5',
	rjson: 'rjson',
	rjson5: 'rjson5',
	tjson5: 'tjson5',
	toml: 'toml',
	// ……后缀名和语言id不一样的放在这里
};

/**
 * 从用户设置中获取支持的文件扩展名列表
 * @returns 不含 “.” 的小写扩展名数组，例如 ['md','txt']
 */
export const getSupportedExtensions = (): string[] => {
	const langs = getSupportedLanguages();
	// 如果映射表里没有就原样返回 lang
	return langs
		.map(lang => langToExt[lang] ?? lang)
		.filter((ext): ext is string => !!ext);
};

// 判定是否为超大文件
export function isHugeFile(doc: vscode.TextDocument | { getText(): string }, threshold?: number): boolean {
	try {
		const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
		const th = threshold ?? cfg.get<number>('hugeFile.thresholdBytes', 50 * 1024)!;
		// 使用 UTF-16 length 近似; 更精确可用 Buffer.byteLength 但多一次分配
		const len = doc.getText().length; // 对大文件 doc.getText 仍然可能昂贵, 但 VSCode 已经把内容载入内存
		// 估算字节: 绝大多数中文占 3 bytes UTF-8, 英文 1 byte; 用平均 1.8 做一个快速估计避免再次编码
		const approxBytes = Math.round(len * 1.8);
		return approxBytes > th;
	} catch {
		return false;
	}
}

// 分词函数：处理罗马字、英文、拼音等混合格式
export function tokenizeComplexNames(name: string): string[] {
	const tokens: string[] = [];

	// 1. 处理常见的复合词分隔符（连字符、下划线、空格）
	const separatorRegex = /[-_\s]+/;
	if (separatorRegex.test(name)) {
		tokens.push(...name.split(separatorRegex));
	}

	// 2. 处理驼峰命名法（camelCase 或 PascalCase）
	const camelCaseParts = name.split(/(?=[A-Z][a-z]|[\d])/);
	if (camelCaseParts.length > 1) {
		tokens.push(...camelCaseParts);
	}

	// 3. 处理拼音（带声调和不带声调）
	const pinyinRegex = /[a-z]+[1-5]?/g;
	const pinyinMatches = name.match(pinyinRegex);
	if (pinyinMatches && pinyinMatches.join('') === name.toLowerCase()) {
		tokens.push(...pinyinMatches);
	}

	// 4. 处理罗马字（日语）
	const romajiRegex = /[a-z]+/g;
	const romajiMatches = name.match(romajiRegex);
	if (romajiMatches && romajiMatches.join('') === name.toLowerCase()) {
		tokens.push(...romajiMatches);
	}

	// 5. 处理数字+字母组合（如 R2D2, GPT4）
	const alphanumericRegex = /([a-z]+|\d+)/gi;
	const alphanumericMatches = name.match(alphanumericRegex);
	if (alphanumericMatches && alphanumericMatches.length > 1) {
		tokens.push(...alphanumericMatches);
	}

	// 返回去重的有效token（长度至少为2）
	return [...new Set(tokens.filter(token => token.length > 1))];
}

// 工具：检查两个区间 [s1,e1) 和 [s2,e2) 是否有重叠
export function rangesOverlap(
	s1: number, e1: number,
	s2: number, e2: number
): boolean {
	return s1 < e2 && s2 < e1;
}

// 工具：转义正则特殊字符
export function escapeRegExp(str: string): string {
	return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * 读取一个文本文件，并根据内容自动检测并按正确编码解码
 * @param filePath 文件完整路径
 * @returns 文本内容
 */
export async function readTextFileDetectEncoding(filePath: string): Promise<string> {
	// 1. 读成 Buffer（不做 utf8 强制）
	const buffer = await fs.promises.readFile(filePath);
	const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
	const debug = cfg.get<boolean>('wordCount.debug', false);

	// 2. 检测最可能的编码（有时短中文文本会被误判为 ASCII / windows-1252）
	const detect = chardet.detect(buffer);
	const rawEncoding = (detect && detect.encoding) ? detect.encoding : 'utf-8';
	let encoding = rawEncoding;
	let text = iconv.decode(buffer, encoding);

	// 3. 质量评估：若出现大量替换符 � 或 明显丢失 CJK，则尝试 UTF-8 / GB18030 回退
	const replacementCount = (text.match(/�/g) || []).length;
	const cjkCount = (text.match(/[\p{Script=Han}]/gu) || []).length;
	// 判定条件：
	//  - 有中文扩展名常见 (.md/.txt) & 文件尺寸 >0
	//  - (替换符占比 > 2%) 或 (检测编码不是 UTF 系且 cjkCount = 0 且 buffer 中包含 >=2 个 >=0x80 字节)
	const looksBinary = buffer.every(b => b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126));
	if (buffer.length > 0) {
		const highBytes = buffer.filter(b => b >= 0x80).length;
		const replRatio = replacementCount / Math.max(1, text.length);
		const needFallback = (
			replRatio > 0.02 ||
			((/^(GB2312|GBK|windows-1252|ISO-8859-1)$/i.test(encoding)) && cjkCount === 0 && highBytes >= 2)
		);
		if (needFallback) {
			// 先试 UTF-8
			try {
				const utf8 = iconv.decode(buffer, 'utf-8');
				const utf8Cjk = (utf8.match(/[\p{Script=Han}]/gu) || []).length;
				const utf8Repl = (utf8.match(/�/g) || []).length;
				if (utf8Cjk > cjkCount && utf8Repl / Math.max(1, utf8.length) < replRatio) {
					text = utf8; encoding = 'utf-8';
				} else if (/^(GB2312|GBK|windows-1252|ISO-8859-1)$/i.test(rawEncoding)) {
					// 再试 GB18030（超集编码）
					const gb18030 = iconv.decode(buffer, 'GB18030');
					const gbCjk = (gb18030.match(/[\p{Script=Han}]/gu) || []).length;
					if (gbCjk > cjkCount) { text = gb18030; encoding = 'GB18030'; }
				}
			} catch {/* 忽略回退异常 */}
		}
	}

	if (debug) {
		console.log('[WordCount][decode]', path.basename(filePath), {
			len: buffer.length,
			encoding: rawEncoding,
			finalEncoding: encoding,
			replacementCount,
			cjkCount: (text.match(/[\p{Script=Han}]/gu) || []).length,
			looksBinary
		});
	}

	return text;
}

/**
 * 统计文本中的“中文字符（CJK）”+“英文单词”数量
 * @param text 任意中英混排文本
 * @returns 中文字符数 + 英文单词数
 */
export function countWordsMixed(text: string): number {
	// 1) 中文字符（CJK）：使用 Unicode 脚本属性，匹配所有汉字
	//    需要 Node >=12 开启 Unicode 属性转义
	const cjkMatches = text.match(/[\p{Script=Han}]/gu) || [];

	// 2) 英文单词：字母/数字/下划线序列，按单词边界切分
	const enMatches = text.match(/\b[A-Za-z0-9_]+\b/g) || [];

	return cjkMatches.length + enMatches.length;
}

export function analyzeText(text: string): TextStats {
    const cjkMatch = text.match(/[\p{Script=Han}]/gu) || [];
    const wordMatch = text.match(/\b[A-Za-z0-9_]+\b/g) || [];
    const nonWS = text.match(/\S/gu) || [];
    const ascii = text.match(/[\x00-\x7F]/g) || [];
    const nonPunctNonWS = text.match(/[^\s\p{P}]/gu) || [];

    const cjkChars = cjkMatch.length;
    const words = wordMatch.length;
    const nonWSChars = nonWS.length;
    const nonWSNoPunct = nonPunctNonWS.length;
    const asciiChars = ascii.filter(ch => !/[\p{Script=Han}]/u.test(ch)).length;
    const total = cjkChars + words;

    return { cjkChars, asciiChars, words, nonWSChars, nonWSNoPunct, total };
}

export async function countAndAnalyze(fullPath: string): Promise<TextStats> {
    const text = await readTextFileDetectEncoding(fullPath);
    return analyzeText(text);
}


/**
 * 把两个 TextStats 累加
 */
export function mergeStats(a: TextStats, b: TextStats): TextStats {
    return {
        cjkChars: a.cjkChars + b.cjkChars,
        asciiChars: a.asciiChars + b.asciiChars,
        words: a.words + b.words,
        nonWSChars: a.nonWSChars + b.nonWSChars,
        nonWSNoPunct: a.nonWSNoPunct + b.nonWSNoPunct,
        total: a.total + b.total
    };
}



/**
 * 包管理器方式加载角色库：递归扫描 novel-helper 目录下的所有包
 * @param forceRefresh 是否强制刷新所有文件（不使用缓存）
 * @param changedFiles 指定只更新这些文件（用于增量更新）
 */
export function loadRoles(forceRefresh: boolean = false, changedFiles?: string[]) {

	// 如果传入 changedFiles 仍按原先同步增量路径（保持兼容），否则启动异步批次扫描。
	if (forceRefresh && !changedFiles) {
		clearRoleFileLoadIssues();
	}

	const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || !folders.length) {
		console.error('loadRoles: 未找到工作区文件夹');
		return;
	}
	const root = folders[0].uri.fsPath;
	const novelHelperRoot = path.join(root, 'novel-helper');

	console.log(`loadRoles: workspace root = ${root}`);
	console.log(`loadRoles: novel-helper root = ${novelHelperRoot}`);

	// 使用 fast-glob 扫描外部资源文件夹（兼容 __init__.ojson5 + 关键字标识）
	const scanResult = scanExternalRoleFoldersWithReport(folders);
	const externalRoleFolders = scanResult.externalFolders;
	console.log(`loadRoles: 找到 ${externalRoleFolders.length} 个外部角色文件夹:`, externalRoleFolders);

	const changedRoleFiles = changedFiles ?? [];
	const shouldIncrementalUpdate = shouldIncrementalRoleLoad(forceRefresh, changedRoleFiles);

	// 全量扫描会清空 roles，因此必须同步重建 SmartRoleAdder 的索引。
	if (!shouldIncrementalUpdate) {
		if (forceRefresh) {
			globalFileCache.clear();
		}
		cleanRoles();
		sensitiveSourceFiles.clear();
		roleManager = new SmartRoleAdder(roles);
	} else if (!roleManager) {
		// 首次增量加载时初始化角色管理器
		roleManager = new SmartRoleAdder(roles);
	}
	roleManager?.setExternalFolders(externalRoleFolders);

	// 检查 novel-helper 目录是否存在
	if (!fs.existsSync(novelHelperRoot)) {
		console.warn(`loadRoles: novel-helper 目录不存在: ${novelHelperRoot}`);
		// 仍然尝试加载传统方式的文件（向后兼容）
		loadTraditionalRoles(forceRefresh, shouldIncrementalUpdate ? changedRoleFiles : undefined);
		return;
	}

	// 增量文件更新仍同步处理（避免复杂化调用点）
	if (shouldIncrementalUpdate) {
		console.log(`loadRoles: 增量更新 ${changedRoleFiles.length} 个文件`);
		performIncrementalUpdate(changedRoleFiles, novelHelperRoot);
		finalizeRoleCollection();
		
		// 增量更新关系表
		updateRelationships(changedRoleFiles, novelHelperRoot).then(() => {
			// 关系表更新完成后，先清理所有角色的旧关系属性
			clearRelationshipProperties(roles);
			// 然后为所有角色添加新的关系属性
			const enhanceResult = enhanceAllRolesWithRelationships(roles);
			console.log(`[loadRoles] 增量更新关系属性增强完成: 总角色 ${enhanceResult.totalRoles}, 增强角色 ${enhanceResult.enhancedRoles}, 总关系属性 ${enhanceResult.totalRelationshipProperties}`);

			// 仅在由文件变动触发的增量更新时显示通知（初次全量加载不弹）
			try {
				const relFiles = changedRoleFiles.filter(f => {
					const n = f.toLowerCase();
					return n.endsWith('.rjson5') || n.endsWith('.json5') && /relationship|relation|connections|links|关系|关联|连接|联系/.test(path.basename(n));
				});
				if (relFiles.length > 0) {
					const MAX_SHOW = 5;
					const names = relFiles.map(f => path.basename(f));
					const shown = names.slice(0, MAX_SHOW).join(', ');
					const more = names.length > MAX_SHOW ? ` 等 ${names.length - MAX_SHOW} 个文件` : '';
					vscode.window.showInformationMessage(`检测到关系文件变动: ${shown}${more}`);
				}
			} catch (e) {
				console.error('[loadRoles] 显示关系变动提示失败', e);
			}
		}).catch(error => {
			console.error('[loadRoles] 增量更新关系表失败:', error);
		});
		
		_onDidChangeRoles.fire();
		generateCSpellDictionary();
		return;
	}

	// 全量异步扫描：分批读取目录，避免阻塞主线程

	// 支持目录断点续扫：若一个目录在批次末尾被截断，记录下一个起始索引与缓存的 entries
	let pendingDirs: { abs: string; rel: string; entries?: fs.Dirent[]; index?: number }[] = [];
	let processedFiles = 0; // 已处理角色文件数
	let statusBar: vscode.StatusBarItem | undefined;
	let statusBarTimer: NodeJS.Timeout | undefined;
	function ensureStatusBar() {
		if (!statusBar) {
			statusBar = vscode.window.createStatusBarItem('andrea.characterLoading', vscode.StatusBarAlignment.Left, 0);
			statusBar.name = '角色加载';
			statusBar.text = '$(sync~spin) 角色加载中…';
			statusBar.tooltip = '正在异步扫描 novel-helper 角色库';
			statusBar.show();
		}
	}
	function updateStatusBar(final = false) {
		if (!statusBar) return;
		if (final) {
			statusBar.text = `$(check) 角色加载完成 (${roles.length})`;
			statusBar.tooltip = `已加载 ${roles.length} 个角色文件项`;
			// 1.5 秒后移除
			setTimeout(() => { statusBar?.dispose(); statusBar = undefined; }, 1500);
		} else {
			statusBar.text = `$(sync~spin) 角色加载中… 已加载 ${roles.length}`;
			statusBar.tooltip = `已处理文件 ${processedFiles}，当前累计角色 ${roles.length}，剩余目录队列 ${pendingDirs.length}`;
		}
	}
	if (fs.existsSync(novelHelperRoot)) {
		pendingDirs.push({ abs: novelHelperRoot, rel: '', index: 0 });
	} else {
		console.warn(`loadRoles: novel-helper 目录不存在: ${novelHelperRoot} (异步扫描暂停)`);
	}

	// 添加外部文件夹到扫描队列
	for (const externalFolder of externalRoleFolders) {
		const relPath = path.relative(root, externalFolder);
		pendingDirs.push({ abs: externalFolder, rel: relPath, index: 0 });
		console.log(`loadRoles: 添加外部文件夹到扫描队列: ${externalFolder} (rel: ${relPath})`);
	}

	if (!fs.existsSync(novelHelperRoot) && externalRoleFolders.length === 0) {
		loadTraditionalRoles(forceRefresh, changedFiles); // 仍然尝试传统加载（同步）
		_onDidChangeRoles.fire();
		generateCSpellDictionary();
		return;
	}

	const BATCH_SIZE = 25; // 每批最多处理的文件/子目录项
	function processNextBatch() {
		const start = Date.now();
		let processed = 0;
		while (pendingDirs.length && processed < BATCH_SIZE) {
			const dirTask = pendingDirs.shift()!;
			const { abs, rel } = dirTask;
			if (!fs.existsSync(abs)) continue;
			let entries: fs.Dirent[];
			let startIndex = dirTask.index || 0;
			if (dirTask.entries) {
				entries = dirTask.entries;
			} else {
				try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { continue; }
			}
			for (let i = startIndex; i < entries.length; i++) {
				const entry = entries[i];
				const entryPath = path.join(abs, entry.name);
				console.log(`[loadRoles][scan] dir="${abs}" entry="${entry.name}" rel="${rel}" type=${entry.isDirectory()? 'dir':'file'}`);
				if (entry.isDirectory()) {
					if (entry.name === 'outline' || entry.name === '.anh-fsdb' || entry.name === 'typo' || entry.name === 'comments') continue;
					pendingDirs.push({ abs: entryPath, rel: rel ? path.join(rel, entry.name) : entry.name, index: 0 });
				} else if (entry.isFile()) {
					// 需要传入完整路径以便 isRoleFile 进行内容嗅探（Markdown 无关键词场景）
					const roleCandidate = isRoleFile(entry.name, entryPath);
					console.log(`[loadRoles][scan] file="${entryPath}" roleCandidate=${roleCandidate}`);
					if (roleCandidate) {
						try { loadRoleFile(entryPath, rel, entry.name); processedFiles++; } catch (e) { console.warn('loadRoleFile error', e); }
					} else if (/\.md$/i.test(entry.name)) {
						// 调试：记录未命中关键词且嗅探未触发（因为 isRoleFile 返回 false） 的 .md 文件，帮助定位遗漏
						// （此时 isRoleFile 已做过带路径嗅探；返回 false 说明 header 结构也不符合）
						console.log('[loadRoles] 跳过 Markdown 文件（未识别为角色库）', entryPath);
					}
				}
				processed++;
				if (processed >= BATCH_SIZE) {
					// 目录未扫描完，保存剩余位置以便下批继续
					if (i < entries.length - 1) {
						pendingDirs.unshift({ abs, rel, entries, index: i + 1 });
						console.log(`[loadRoles][scan] pause dir="${abs}" resumeIndex=${i+1}/${entries.length}`);
					}
					break;
				}
			}
		}
		// 批次完成后广播（增量通知）
		if (!statusBar && roles.length === 0) {
			// 延迟 120ms 再显示，避免极小项目闪烁
			if (!statusBarTimer) {
				statusBarTimer = setTimeout(() => { ensureStatusBar(); updateStatusBar(false); }, 120);
			}
		} else if (statusBar) {
			updateStatusBar(false);
		}
		_onDidChangeRoles.fire();
		// 若还有目录未处理，排队下一 microtask / setTimeout(0)
		if (pendingDirs.length) {
			setTimeout(processNextBatch, 0);
		} else {
			// 扫描已全部完成
			console.log(`loadRoles: 异步扫描完成，累计 ${roles.length} 个角色，用时 ${Date.now() - start}ms (最后批次时间)`);
			// 如果最终状态栏尚未创建（例如极小/空目录，扫描在 120ms 延迟前完成），需立即创建再显示完成状态
			if (statusBarTimer) {
				clearTimeout(statusBarTimer);
				statusBarTimer = undefined;
			}
			if (!statusBar) {
				ensureStatusBar();
			}
			updateStatusBar(true);
			finalizeRoleCollection();
			
			// 为角色添加 UUID（异步执行，不阻塞主流程）
			ensureRoleUUIDs(roles, true).catch(error => {
				console.error('[loadRoles] 为角色添加 UUID 失败:', error);
			});

			// 加载关系表（在角色加载完成后）
		loadRelationships(novelHelperRoot).then(() => {
			// 关系表加载完成后，为所有角色添加关系属性
			const enhanceResult = enhanceAllRolesWithRelationships(roles);
			console.log(`[loadRoles] 关系属性增强完成: 总角色 ${enhanceResult.totalRoles}, 增强角色 ${enhanceResult.enhancedRoles}, 总关系属性 ${enhanceResult.totalRelationshipProperties}`);
			
			// 触发角色变更事件，通知UI更新
			_onDidChangeRoles.fire();
		}).catch(error => {
			console.error('[loadRoles] 加载关系表失败:', error);
		});
			
			generateCSpellDictionary();
			// 触发"全量完成"事件（供最终一次装饰/自动机重建）
			_onDidFinishRoles.fire();
		}
	}
	processNextBatch();
}

/**
 * 递归扫描包目录，加载所有角色文件
 * @param currentDir 当前扫描的目录绝对路径
 * @param relativePath 相对于 novel-helper 的路径
 */
function scanPackageDirectory(currentDir: string, relativePath: string) {
	if (!fs.existsSync(currentDir)) {
		return;
	}

	const entries = fs.readdirSync(currentDir, { withFileTypes: true });

	for (const entry of entries) {
		const entryPath = path.join(currentDir, entry.name);
		const entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;

		if (entry.isDirectory()) {
			// 跳过 outline 目录
			if (entry.name === 'outline') {
				continue;
			}
			// 跳过内部文件追踪数据库目录（拆分后的多 JSON 存储）
			if (entry.name === '.anh-fsdb') { // 名称稍后在 fileTrackingDataManager 中保持一致
				continue;
			}
			// 递归扫描子目录
			scanPackageDirectory(entryPath, entryRelativePath);
				} else if (entry.isFile()) {
					// 检查是否是角色文件（带路径以便内容嗅探）
					if (isRoleFile(entry.name, entryPath)) {
						loadRoleFile(entryPath, relativePath, entry.name);
					}
		}
	}
}

/**
 * 递归扫描包目录，返回所有角色文件（使用 fast-glob 优化性能）
 * @param currentDir 当前扫描的目录绝对路径
 * @param relativePath 相对于 novel-helper 的路径
 * @returns 角色文件相对路径数组
 */
export function getPackageDirectory(currentDir: string, relativePath: string): string[] {
	if (!fs.existsSync(currentDir)) {
		return [];
	}

	try {
		// 构建glob模式：递归查找所有文件，排除特定目录
		const globPattern = path.join(currentDir, '**/*').replace(/\\/g, '/');

		// 使用fast-glob并行扫描所有文件
		const allFiles = fastGlob.sync(globPattern, {
			ignore: [
				'**/outline/**',     // 跳过 outline 目录
				'**/.anh-fsdb/**',   // 跳过内部文件追踪数据库目录
				'**/typo/**',        // 跳过 typo 目录
				'**/comments/**'     // 跳过 comments 目录
			],
			dot: false,             // 不包含隐藏文件
			onlyFiles: true,        // 只返回文件
			absolute: true          // 返回绝对路径
		});

		const roleFiles: string[] = [];

		// 并行检查所有文件是否为角色文件
		for (const filePath of allFiles) {
			const fileName = path.basename(filePath);
			// 检查是否是角色文件（带路径以便内容嗅探）
			if (isRoleFile(fileName, filePath)) {
				// 计算相对于传入的 relativePath 的路径
				const relativeFilePath = path.relative(path.join(currentDir, relativePath), filePath);
				roleFiles.push(relativeFilePath);
			}
		}

		return roleFiles;
	} catch (error) {
		console.error(`getPackageDirectory: fast-glob 扫描失败 ${currentDir}:`, error);
		// 降级到原始递归实现
		return getPackageDirectoryRecursive(currentDir, relativePath);
	}
}

/**
 * 递归扫描包目录的降级实现（原始逻辑）
 * @param currentDir 当前扫描的目录绝对路径
 * @param relativePath 相对于 novel-helper 的路径
 * @returns 角色文件相对路径数组
 */
function getPackageDirectoryRecursive(currentDir: string, relativePath: string): string[] {
	const roleFiles: string[] = [];

	if (!fs.existsSync(currentDir)) {
		return roleFiles;
	}

	const entries = fs.readdirSync(currentDir, { withFileTypes: true });

	for (const entry of entries) {
		const entryPath = path.join(currentDir, entry.name);
		const entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;

		if (entry.isDirectory()) {
			// 跳过 outline 目录
			if (entry.name === 'outline') {
				continue;
			}
			// 跳过内部文件追踪数据库目录（拆分后的多 JSON 存储）
			if (entry.name === '.anh-fsdb') { // 名称稍后在 fileTrackingDataManager 中保持一致
				continue;
			}
			// 递归扫描子目录
			const subFiles = getPackageDirectoryRecursive(entryPath, entryRelativePath);
			roleFiles.push(...subFiles);
		} else if (entry.isFile()) {
			// 检查是否是角色文件（带路径以便内容嗅探）
			if (isRoleFile(entry.name, entryPath)) {
				roleFiles.push(entryRelativePath);
			}
		}
	}

	return roleFiles;
}

/**
 * 判断文件是否是角色文件
 */
function isWithinNovelHelperDataPath(fileFullPath: string): boolean {
	const normalizedPath = fileFullPath.replace(/\\/g, '/').toLowerCase();
	return normalizedPath.includes('/novel-helper/');
}

function roleFileDetectionDebugEnabled(): boolean {
	try {
		return vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('debug.roleFileDetection', false) === true;
	} catch {
		return false;
	}
}

function roleFileDetectionLog(message: string): void {
	if (!roleFileDetectionDebugEnabled()) {
		return;
	}
	try {
		console.log(message);
	} catch {
		// ignore logging failures
	}
}

function resolveRoleFileKeywordConfig(fileFullPath?: string): ProjectKeywordConfig {
	return mergeProjectKeywordConfigs(DEFAULT_PROJECT_KEYWORD_CONFIG, getProjectKeywordConfig(fileFullPath));
}

function fileNameContainsKeyword(fileName: string, lowerName: string, keywords: string[]): boolean {
	return keywords.some(keyword => {
		const trimmedKeyword = keyword.trim();
		if (!trimmedKeyword) {
			return false;
		}
		return lowerName.includes(trimmedKeyword.toLowerCase()) || fileName.includes(trimmedKeyword);
	});
}

export function isRoleFile(fileName: string, fileFullPath?: string): boolean {
	const lowerName = fileName.toLowerCase();
	const debugPrefix = `[isRoleFile] name="${fileName}" path="${fileFullPath || ''}"`;
	const keywordConfig = resolveRoleFileKeywordConfig(fileFullPath);
	
	// ojson5 文件一定是角色文件
	if (lowerName.endsWith('.ojson5')) {
		roleFileDetectionLog(`${debugPrefix} ojson5Extension -> true`);
		return true;
	}
	
	// rjson5 文件一定是关系文件，不是角色文件
	if (lowerName.endsWith('.rjson5')) {
		roleFileDetectionLog(`${debugPrefix} rjson5Extension -> false`);
		return false;
	}
	
	// 正则表达式文件支持 JSON5 和 Markdown；TXT 简单列表无法表达 regex 字段。
	if (fileNameContainsKeyword(fileName, lowerName, keywordConfig.regexFileKeywords)) {
		const ok = lowerName.endsWith('.json5') || lowerName.endsWith('.md');
		roleFileDetectionLog(`${debugPrefix} keyword=regex -> ${ok}`);
		return ok;
	}
	
	const validExtensions = ['.json5', '.txt', '.md', '.csv', '.toml'];
	const hasValidExtension = validExtensions.some(ext => lowerName.endsWith(ext));
	
	if (!hasValidExtension) {
		roleFileDetectionLog(`${debugPrefix} invalidExt`);
		return false;
	}

	if (fileNameContainsKeyword(fileName, lowerName, keywordConfig.sensitiveWordsFileKeywords)) { roleFileDetectionLog(`${debugPrefix} matchedSensitiveKeyword`); return true; }
	if (fileNameContainsKeyword(fileName, lowerName, keywordConfig.vocabularyFileKeywords)) { roleFileDetectionLog(`${debugPrefix} matchedVocabularyKeyword`); return true; }
	if (fileNameContainsKeyword(fileName, lowerName, keywordConfig.characterFileKeywords)) { roleFileDetectionLog(`${debugPrefix} matchedCharacterKeyword`); return true; }

	// 兜底：对于 .md 若包含 “gallery” “list” “lib” 也尝试视为角色文件（常见命名）
	if (lowerName.endsWith('.md') && /(gallery|list|library)/.test(lowerName)) { roleFileDetectionLog(`${debugPrefix} mdFallbackNamePattern`); return true; }

	if (fileFullPath && lowerName.endsWith('.csv')) {
		try {
			const stat = fs.statSync(fileFullPath);
			if (isWithinNovelHelperDataPath(fileFullPath)) {
				roleFileDetectionLog(`${debugPrefix} csvWithinNovelHelper -> true`);
				return true;
			}
			if (stat.size <= 512 * 1024) {
				const fd = fs.openSync(fileFullPath, 'r');
				try {
					const buf = Buffer.alloc(8192);
					const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
					const head = buf.slice(0, bytes).toString('utf8');
					if (isLikelyDelimitedRoleFileContent(head)) {
						roleFileDetectionLog(`${debugPrefix} csvSniffMatched`);
						return true;
					}
				} finally { fs.closeSync(fd); }
			}
		} catch { /* ignore sniff errors */ }
	}

	// 进一步内容嗅探：对于 .md 未命中关键词的，读取前若干行检测结构（性能：只同步读取小文件前 4KB）
	if (fileFullPath && lowerName.endsWith('.md')) {
		try {
			const stat = fs.statSync(fileFullPath);
			if (stat.size <= 256 * 1024) { // 仅对 <=256KB 做快速嗅探
				const fd = fs.openSync(fileFullPath, 'r');
				try {
					const buf = Buffer.alloc(4096);
					const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
					const head = buf.slice(0, bytes).toString('utf8');
					// 条件：至少一个一级/二级标题，且后续存在“## 描述”/“## 别名”/“## 类型”或英文 counterpart
					const hasTopHeader = /^#\s+.+/m.test(head) || /^##\s+.+/m.test(head);
					// 扩展字段词汇，提升嗅探宽容度（包含常见自定义章节）
					const sniffFieldWords = [
						'描述','别名','类型','颜色','备注','简介','背景','性格','外貌','关系','标签','地理特征','地理分区','历史沿革','重要国家与地区','自然资源','文化特色',
						'affiliation','alias','aliases','type','color','description','background','personality','appearance','relationships','tags','notes'
					];
					const fieldHeaderRegex = new RegExp('^(#{2,4})\\s+(' + sniffFieldWords.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|') + ')\\b','m');
					const hasFieldHeader = fieldHeaderRegex.test(head);
					if (hasTopHeader && hasFieldHeader) { roleFileDetectionLog(`${debugPrefix} mdSniffMatched hasTopHeader=${hasTopHeader} hasFieldHeader=${hasFieldHeader}`); return true; }
					else { roleFileDetectionLog(`${debugPrefix} mdSniffNoMatch hasTopHeader=${hasTopHeader} hasFieldHeader=${hasFieldHeader}`); }
				} finally { fs.closeSync(fd); }
			}
		} catch { /* ignore sniff errors */ }
	}
	roleFileDetectionLog(`${debugPrefix} noMatch`);
	return false;
}

/**
 * 加载单个角色文件（使用缓存优化）
 * @param filePath 文件绝对路径
 * @param packagePath 包路径（相对于 novel-helper）
 * @param fileName 文件名
 */
function loadRoleFile(filePath: string, packagePath: string, fileName: string) {
	console.log(`loadRoleFile: 加载文件 ${filePath}`);
	if (isRoleFileIsolated(filePath)) {
		console.warn(`loadRoleFile: 文件已被隔离，跳过 ${filePath}`);
		return;
	}
	
	try {
		// 使用缓存获取文件内容
		const content = globalFileCache.getFileContent(filePath);
		if (content === null) {
			console.warn(`loadRoleFile: 无法读取文件 ${filePath}`);
			return;
		}
		
		const fileType = getFileType(fileName, filePath);

		// JSON5-like role/relationship files: .json5, .ojson5, .rjson5
		const lower = fileName.toLowerCase();
		if (lower.endsWith('.json5') || lower.endsWith('.ojson5') || lower.endsWith('.rjson5')) {
			// .rjson5 文件应该只通过关系文件加载器处理，不应该在这里处理
			if (lower.endsWith('.rjson5')) {
				console.warn(`loadRoleFile: .rjson5 文件 ${fileName} 应该通过关系文件加载器处理，跳过角色文件加载`);
				return;
			}
			loadJSON5RoleFile(content, filePath, packagePath, fileType);
		} else if (lower.endsWith('.txt')) {
			loadTXTRoleFile(content, filePath, packagePath, fileType);
		} else if (lower.endsWith('.md')) {
			loadMarkdownRoleFile(content, filePath, packagePath, fileType);
		} else if (lower.endsWith('.csv')) {
			loadDelimitedRoleFile(content, filePath, packagePath, fileType);
		} else if (lower.endsWith('.toml')) {
			loadTomlRoleFile(content, filePath, packagePath, fileType);
		}
		// 记录敏感词库源文件（按解析出的角色类型判定）
		try {
			if (fileType === '敏感词') { sensitiveSourceFiles.add(path.resolve(filePath).toLowerCase()); }
		} catch { /* ignore */ }
		clearRoleFileIssue(filePath);
	} catch (error) {
		console.error(`loadRoleFile: 加载文件失败 ${filePath}: ${error}`);
		reportRoleFileFormatError(filePath, fileName, error);
	}
}

function finalizeRoleCollection(): void {
	applyRoleLineage(roles);
	for (const role of roles) {
		applyGeneratedLookupKeys(role, role.sourcePath);
	}
	roleManager = new SmartRoleAdder(roles);
}

/**
 * 根据文件名判断文件类型
 */
function getFileType(fileName: string, fileFullPath?: string): string {
	const lowerName = fileName.toLowerCase();
	const keywordConfig = resolveRoleFileKeywordConfig(fileFullPath);
	
	if (fileNameContainsKeyword(fileName, lowerName, keywordConfig.sensitiveWordsFileKeywords)) {
		return '敏感词';
	} else if (fileNameContainsKeyword(fileName, lowerName, keywordConfig.vocabularyFileKeywords)) {
		return '词汇';
	} else if (fileNameContainsKeyword(fileName, lowerName, keywordConfig.regexFileKeywords) && (lowerName.endsWith('.json5') || lowerName.endsWith('.md'))) {
		return '正则表达式';
	} else {
		return '角色';
	}
}

/**
 * 加载 JSON5 格式的角色文件
 */
function loadJSON5RoleFile(content: string, filePath: string, packagePath: string, defaultType: string) {
	try {
		// 处理空文件或只包含空白字符的文件
		const trimmedContent = content.trim();
		if (trimmedContent === '') {
			console.log(`loadJSON5RoleFile: ${filePath} 是空文件，跳过解析`);
			return;
		}
		
		const data = JSON5.parse(trimmedContent);
		let rolesArray: Role[] = [];
		
		// 支持数组格式和对象格式
		if (Array.isArray(data)) {
			rolesArray = flattenJsonRoleTree(data, defaultType);
		} else if (typeof data === 'object' && data !== null) {
			// 如果是对象，可能包含元数据，查找角色数组
			if (data.roles && Array.isArray(data.roles)) {
				rolesArray = flattenJsonRoleTree(data.roles, defaultType);
			} else if (data.characters && Array.isArray(data.characters)) {
				rolesArray = flattenJsonRoleTree(data.characters, defaultType);
			} else {
				// 将对象的每个属性作为一个角色
				rolesArray = flattenJsonRoleTree(
					Object.entries(data).map(([name, roleData]) => (
						typeof roleData === 'object' && roleData !== null
							? { name, ...roleData as Record<string, unknown> }
							: { name, type: defaultType }
					)),
					defaultType
				);
			}
		} else {
			console.warn(`loadJSON5RoleFile: ${filePath} 包含无效的数据类型: ${typeof data}`);
			return;
		}

		validateLoadedRoleBasics(filePath, content, rolesArray, {
			requireExplicitType: true,
			explicitType: role => (role as any).__jsonRoleHadExplicitType === true,
		});
		
		// 为每个角色添加路径信息
		for (const role of rolesArray) {
			delete (role as any).__jsonRoleHadExplicitType;
			role.packagePath = packagePath;
			role.sourcePath = filePath;
			
			// 如果没有指定类型，使用默认类型
			if (!role.type) {
				role.type = defaultType;
			}
			if (role.type === '敏感词') {
				try { sensitiveSourceFiles.add(path.resolve(filePath).toLowerCase()); } catch { /* ignore */ }
			}
			addRole(role);
		}
		
		console.log(`loadJSON5RoleFile: 从 ${filePath} 加载了 ${rolesArray.length} 个角色`);

		// 异步校验并修复（如果 UUID 格式不合法则替换为 UUID v7 并写回文件）
		void fixInvalidRoleUUIDs(rolesArray, true).catch(err => {
			console.error('[loadJSON5RoleFile] fixInvalidRoleUUIDs 失败:', err);
			reportRoleFileFormatError(filePath, path.basename(filePath), err);
		});
	} catch (error) {
		// 提供更详细的错误信息
		if (error instanceof SyntaxError) {
			console.error(`loadJSON5RoleFile: JSON5 语法错误 ${filePath}: ${error.message}`);
			throw new Error(`JSON5 语法错误: ${error.message}。请检查文件格式是否正确。`);
		} else {
			console.error(`loadJSON5RoleFile: 解析错误 ${filePath}: ${error}`);
			throw new Error(`解析 JSON5 文件失败: ${error}`);
		}
	}
}

/**
 * 加载 Markdown 格式的角色文件
 */
function loadMarkdownRoleFile(content: string, filePath: string, packagePath: string, defaultType: string) {
	// 如果文件为空，记录日志但不报错
	if (content.trim() === '') {
		console.log(`loadMarkdownRoleFile: ${filePath} 是空文件，跳过加载`);
		return;
	}
	
	try {
		const markdownRoles = parseMarkdownRoles(content, filePath, packagePath, defaultType);
		validateLoadedRoleBasics(filePath, content, markdownRoles, {
			requireExplicitType: true,
			explicitType: role => markdownRoleHasTypeField(content, role.name),
		});
		updateMarkdownRoleStructureDiagnostics(filePath, content);
		updateMarkdownUuidFieldDiagnostics(filePath, content);
		for (const role of markdownRoles) {
			addRole(role);
			if (role.type === '敏感词' && role.sourcePath) {
				try { sensitiveSourceFiles.add(path.resolve(role.sourcePath).toLowerCase()); } catch { /* ignore */ }
			}
		}
		console.log(`loadMarkdownRoleFile: 从 ${filePath} 加载了 ${markdownRoles.length} 个角色`);

		// 异步校验并修复 UUID
		void fixInvalidRoleUUIDs(markdownRoles, true).catch(err => {
			console.error('[loadMarkdownRoleFile] fixInvalidRoleUUIDs 失败:', err);
			reportRoleFileFormatError(filePath, path.basename(filePath), err);
		});
	} catch (error) {
		console.error(`loadMarkdownRoleFile: 解析 Markdown 文件失败 ${filePath}: ${error}`);
		throw new Error(`解析 Markdown 文件失败: ${error}`);
	}
}

function loadDelimitedRoleFile(content: string, filePath: string, packagePath: string, defaultType: string) {
	try {
		const parsed = parseDelimitedRoleFile(content, filePath, packagePath, defaultType);
		const hasTypeHeader = parsed.hasHeader && parsed.headers.some(header => /^(type|类型)$/i.test(header.trim()));
		validateLoadedRoleBasics(filePath, content, parsed.roles, {
			requireExplicitType: true,
			explicitType: () => hasTypeHeader,
		});
		for (const role of parsed.roles) {
			addRole(role);
			if (role.type === '敏感词' && role.sourcePath) {
				try { sensitiveSourceFiles.add(path.resolve(role.sourcePath).toLowerCase()); } catch { /* ignore */ }
			}
		}
		console.log(`loadDelimitedRoleFile: 从 ${filePath} 加载了 ${parsed.roles.length} 个角色`);

		void fixInvalidRoleUUIDs(parsed.roles, true).catch(err => {
			console.error('[loadDelimitedRoleFile] fixInvalidRoleUUIDs 失败:', err);
			reportRoleFileFormatError(filePath, path.basename(filePath), err);
		});
	} catch (error) {
		console.error(`loadDelimitedRoleFile: 解析分隔文本文件失败 ${filePath}: ${error}`);
		throw new Error(`解析 CSV/分隔文本文件失败: ${error}`);
	}
}

function loadTomlRoleFile(content: string, filePath: string, packagePath: string, defaultType: string) {
	if (content.trim() === '') {
		console.log(`loadTomlRoleFile: ${filePath} 是空文件，跳过加载`);
		return;
	}

	try {
		const tomlRoles = parseTomlRoles(content, filePath, packagePath, defaultType);
		validateLoadedRoleBasics(filePath, content, tomlRoles, {
			requireExplicitType: true,
			explicitType: role => tomlRoleHasTypeField(content, role.name),
		});
		for (const role of tomlRoles) {
			addRole(role);
			if (role.type === '敏感词' && role.sourcePath) {
				try { sensitiveSourceFiles.add(path.resolve(role.sourcePath).toLowerCase()); } catch { /* ignore */ }
			}
		}
		console.log(`loadTomlRoleFile: 从 ${filePath} 加载了 ${tomlRoles.length} 个角色`);

		void fixInvalidRoleUUIDs(tomlRoles, true).catch(err => {
			console.error('[loadTomlRoleFile] fixInvalidRoleUUIDs 失败:', err);
			reportRoleFileFormatError(filePath, path.basename(filePath), err);
		});
	} catch (error) {
		console.error(`loadTomlRoleFile: 解析 TOML 文件失败 ${filePath}: ${error}`);
		throw new Error(`解析 TOML 文件失败: ${error}`);
	}
}

function loadTXTRoleFile(content: string, filePath: string, packagePath: string, defaultType: string) {
	const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
	const rawLines = content.split(/\r?\n/);
	let added = 0;

	for (const raw of rawLines) {
		let line = raw.trim();
		if (!line) continue; // 空行
		// 支持注释: # ... 或 // ...
		if (line.startsWith('#') || line.startsWith('//')) continue;
		// 行内注释：允许  name  # comment / name // comment
		const hashIdx = line.indexOf('#');
		const slashesIdx = line.indexOf('//');
		let cutIdx = -1;
		if (hashIdx >= 0 && slashesIdx >= 0) cutIdx = Math.min(hashIdx, slashesIdx);
		else if (hashIdx >= 0) cutIdx = hashIdx; else if (slashesIdx >= 0) cutIdx = slashesIdx;
		if (cutIdx >= 0) {
			line = line.slice(0, cutIdx).trim();
			if (!line) continue;
		}
		const role: Role = {
			name: line,
			type: defaultType,
			uuid: generateRoleNameHash(line), // 为txt角色生成基于名称的UUID哈希
			packagePath: packagePath,
			sourcePath: filePath
		};
		if (defaultType === '敏感词') {
			role.color = '#FF0000';
			try { sensitiveSourceFiles.add(path.resolve(filePath).toLowerCase()); } catch { /* ignore */ }
		} else if (defaultType === '正则表达式') {
			console.warn(`loadTXTRoleFile: 正则表达式类型不支持TXT格式，跳过文件 ${filePath}`);
			return;
		} else if (defaultType === '角色') {
			role.type = 'txt角色';
			role.color = cfg.get<string>('defaultColor')!;
		}
		addRole(role);
		added++;
	}
	if (added === 0) {
		console.log(`loadTXTRoleFile: ${filePath} 无有效条目 (可能全部是注释或空行)`);
	} else {
		console.log(`loadTXTRoleFile: 从 ${filePath} 加载了 ${added} 个角色/词条`);
	}
}

/**
 * 传统方式加载角色（向后兼容）
 * @param forceRefresh 是否强制刷新
 * @param changedFiles 变化的文件列表
 */
function loadTraditionalRoles(forceRefresh: boolean = false, changedFiles?: string[]) {
	const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || !folders.length) {
		return;
	}
	const root = folders[0].uri.fsPath;

	// 初始化角色管理器（如果还没有）
	if (!roleManager) {
		roleManager = new SmartRoleAdder(roles);
	}
	
	// 通用加载函数：fileKey 为配置项键，defaultType 为当 txt 版本加载时使用的类型
	function loadLibrary(fileKey: string, defaultType: string) {
		const fileName = cfg.get<string>(fileKey);
		if (!fileName) {
			console.warn(`loadTraditionalRoles: ${fileKey} 未设置`);
			return;
		}
		const libPath = path.join(root, fileName);
		const txtPath = libPath.replace(/\.[^/.]+$/, ".txt");
		
		// 如果指定了变化文件，只处理相关文件
		if (changedFiles) {
			const shouldProcessJson = changedFiles.includes(libPath);
			const shouldProcessTxt = changedFiles.includes(txtPath);
			
			if (!shouldProcessJson && !shouldProcessTxt) {
				return;
			}
			
			// 移除该文件的角色
			const filePathsToRemove = [libPath, txtPath];
			for (let i = roles.length - 1; i >= 0; i--) {
				if (roles[i].sourcePath && filePathsToRemove.includes(roles[i].sourcePath!)) {
					roles.splice(i, 1);
				}
			}
		}

		// 加载 JSON5 版（如果存在）
		if (fs.existsSync(libPath) && (!changedFiles || changedFiles.includes(libPath))) {
			try {
				const content = forceRefresh ? 
					fs.readFileSync(libPath, 'utf8') : 
					globalFileCache.getFileContent(libPath);
				
				if (content) {
					const arr = JSON5.parse(content) as Role[];
					// 为传统加载的角色添加路径信息
					for (const role of arr) {
						role.packagePath = '';  // 根目录
						role.sourcePath = libPath;
						addRole(role);
					}
					console.log(`loadTraditionalRoles: 成功加载 JSON5库 ${fileName}`);
				}
			} catch (e) {
				vscode.window.showErrorMessage(`解析 ${fileName} 失败: ${e}`);
			}
		}

		// 加载 txt 版
		if (fs.existsSync(txtPath) && (!changedFiles || changedFiles.includes(txtPath))) {
			try {
				const content = forceRefresh ? 
					fs.readFileSync(txtPath, 'utf8') : 
					globalFileCache.getFileContent(txtPath);
				
				if (content) {
					const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
					for (const line of lines) {
						const trimmed = line.trim();
						let role: Role = { 
							name: trimmed, 
							type: defaultType,
							packagePath: '',
							sourcePath: txtPath
						};
						if (fileKey === 'rolesFile') {
							role.type = "txt角色";
							role.color = cfg.get<string>('defaultColor')!;
						} else if (fileKey === 'sensitiveWordsFile') {
							role.type = "敏感词";
							role.color = "#FF0000";
						} else if (fileKey === 'vocabularyFile') {
							role.type = "词汇";
						} else if (fileKey === 'regexPatternsFile') {
							// 正则表达式类型不支持TXT格式，跳过
							console.warn(`loadTraditionalRoles: 正则表达式类型不支持TXT格式，跳过 ${txtPath}`);
							return;
						}
						addRole(role);
					}
					console.log(`loadTraditionalRoles: 成功加载 TXT库 ${fileName}`);
				}
			} catch (e) {
				vscode.window.showErrorMessage(`解析 TXT ${fileName} 失败: ${e}`);
			}
		}
	}
	
	loadLibrary('rolesFile', "角色");
	loadLibrary('sensitiveWordsFile', "敏感词");
	loadLibrary('vocabularyFile', "词汇");
	loadLibrary('regexPatternsFile', "正则表达式");
}

/**
 * 执行增量更新
 * @param changedFiles 变化的文件路径列表
 * @param novelHelperRoot novel-helper 根目录
 */
function performIncrementalUpdate(changedFiles: string[], novelHelperRoot: string) {
	console.log(`performIncrementalUpdate: 处理 ${changedFiles.length} 个变化文件`);

	// 移除变化文件对应的角色
	if (roleManager) {
		for (const filePath of changedFiles) {
			roleManager.removeRolesByFile(filePath);
			try { sensitiveSourceFiles.delete(path.resolve(filePath).toLowerCase()); } catch { /* ignore */ }
			// 刷新文件缓存
			globalFileCache.refreshFile(filePath);
		}
	} else {
		// 如果 roleManager 未初始化，使用旧的删除方式
		for (const filePath of changedFiles) {
			try { sensitiveSourceFiles.delete(path.resolve(filePath).toLowerCase()); } catch { /* ignore */ }
			// 移除该文件的所有角色
			for (let i = roles.length - 1; i >= 0; i--) {
				if (roles[i].sourcePath === filePath) {
					roles.splice(i, 1);
				}
			}
			// 刷新文件缓存
			globalFileCache.refreshFile(filePath);
		}
	}

	// 重新加载变化的文件
	for (const filePath of changedFiles) {
		if (!fs.existsSync(filePath)) {
			// 文件已删除，从缓存中移除
			globalFileCache.removeFile(filePath);
			continue;
		}
		
		const fileName = path.basename(filePath);
		// 只处理角色文件，关系文件由 updateRelationships 处理
		if (!isRoleFile(fileName, filePath)) {
			console.log(`performIncrementalUpdate: 跳过非角色文件 ${fileName}`);
			continue;
		}
		
		const packagePath = path.relative(novelHelperRoot, path.dirname(filePath));
		loadRoleFile(filePath, packagePath, fileName);
	}
	
	// 为新加载的角色添加 UUID（异步执行，不阻塞主流程）
	ensureRoleUUIDs(roles, true).catch(error => {
		console.error('[performIncrementalUpdate] 为角色添加 UUID 失败:', error);
	});

	// 修复可能存在的无效 UUID（异步）
	void fixInvalidRoleUUIDs(roles, true).catch(error => {
		console.error('[performIncrementalUpdate] 修复无效 UUID 失败:', error);
	});
}


/**
 * 给定一个 andrea-outline://outline 下的“文件大纲”URI，
 * 返回它对应的工作区内原始 Markdown 文件的 Uri。
 * 如果不是文件大纲（不以 `_outline.md` 结尾）或无工作区，返回 undefined。
 */
export function getOriginalFileUriFromOutlineUri(outlineUri: vscode.Uri): vscode.Uri | undefined {
	// 只处理 our custom scheme
	if (outlineUri.scheme !== 'andrea-outline') {
		return undefined;
	}

	// 拿到相对路径，例如 "chapter1/foo_outline.md"
	const relOutlinePath = outlineUri.path.replace(/^\/+/, '');
	const suffix = '_outline.md';
	if (!relOutlinePath.endsWith(suffix)) {
		return undefined;
	}

	// 去掉后缀，得到 "chapter1/foo"
	const withoutSuffix = relOutlinePath.slice(0, -suffix.length);
	// 构建原文件相对路径 "chapter1/foo.md"
	const sourceRel = `${withoutSuffix}.md`;

	// 找到工作区根
	const ws = vscode.workspace.workspaceFolders?.[0];
	if (!ws) {
		return undefined;
	}
	const wsRoot = ws.uri.fsPath;

	// 返回 file:// Uri
	return vscode.Uri.file(path.join(wsRoot, sourceRel));
}
