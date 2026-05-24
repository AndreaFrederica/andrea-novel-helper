/* eslint-disable semi */
/* eslint-disable curly */
/**
 * Novel Helper MCP Server
 *
 * Exposes novel project data (roles, comments, active document) as an
 * MCP server so that VSCode Copilot, Cursor, Claude Desktop and other
 * AI-powered editors can query the project's structured knowledge.
 *
 * Resources
 *   novel://roles/all           – all roles (tiered by count / sensitivity)
 *   novel://document/active     – active document text + roles present in it
 *
 * Tools
 *   get_roles_by_type           – paginated list for a specific role type
 *   search_roles                – fuzzy search by name / alias
 *   find_roles_in_document      – list roles appearing in a given file
 *   get_comments_for_file       – comment thread list for a file
 *   get_comment_content         – full text of a single comment thread
 */

import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import JSON5 from 'json5'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { Role } from '../extension'
import { BUNDLED_COPILOT_DOC_IDS, listBundledCopilotDocs, readBundledCopilotDoc } from '../copilot/assets'
import { getAllRoleUsageDocEntries } from '../context/roleUsageStore'
import { getDocumentRoleOccurrences } from '../context/documentRolesCache'
import { loadComments, loadCommentContent, listAllCommentDocUuids, updateThread, updateThreadStatus } from '../comments/storage'
import { collectRoleUsageRanges } from '../utils/roleUsageCollector'
import { getFileUuid, getFileByUuid } from '../utils/tracker/globalFileTracking'
import { getSupportedExtensions, getSupportedLanguages, isHugeFile, typeColorMap, isRoleFile, isExternalResourceMarkerFile } from '../utils/utils'
import { addRoleToFile, readRoleFile, writeRoleFile, type RoleFileData } from '../utils/roleFileHandler'
import { mdToPlainText } from '../utils/md_plain'
import { txtToPlainText } from '../utils/txt_plain'
import { tryLosslessJson5UpdateText } from '../utils/json5Lossless'
import { RESOURCE_KIND_NAME_KEYWORDS } from '../projectConfig/resourceFileNaming'

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const SENSITIVE_TYPE = '敏感词'
/** Roles ≤ this threshold → return full detail; otherwise → category index */
const FULL_DETAIL_THRESHOLD = 50
/** Per-type list threshold – types with more roles than this get a summary hint */
const TYPE_LIST_THRESHOLD = 50
const NOVEL_HELPER_IGNORED_DIRS = new Set(['.anh-fsdb', 'outline', 'typo', 'comments'])
const RESOURCE_KIND_NAME_RE = new RegExp(
  RESOURCE_KIND_NAME_KEYWORDS
    .map(keyword => keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|'),
  'i'
)
const MANAGED_RESOURCE_EXTS = new Set(['.json5', '.txt', '.md', '.csv', '.ojson', '.rjson', '.rjson5', '.ojson5', '.tjson5', '.toml'])

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Return the Role array supplied by the caller (a live reference to the
 * extension's global roles array so it is always up-to-date).
 */
type RolesGetter = () => Role[]

function isSensitive(role: Role): boolean {
  return role.type === SENSITIVE_TYPE
}

/** Names that appear in the current active document text (raw search). */
function getNamesInActiveDoc(roles: Role[]): Set<string> {
  const doc = vscode.window.activeTextEditor?.document
  if (!doc) return new Set()
  const text = doc.getText()
  const present = new Set<string>()
  for (const r of roles) {
    if (text.includes(r.name)) { present.add(r.name); continue }
    if (Array.isArray(r.aliases)) {
      for (const a of r.aliases) { if (text.includes(a)) { present.add(r.name); break } }
    }
  }
  return present
}

/** Build a full-detail object for a single role (no sensitive data hidden). */
function roleDetail(r: Role): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    name: r.name,
    type: r.type,
  }
  if (r.uuid) obj.uuid = r.uuid
  if (r.affiliation) obj.affiliation = r.affiliation
  if (Array.isArray(r.aliases) && r.aliases.length) obj.aliases = r.aliases
  if (r.description) obj.description = r.description
  if (r.color) obj.color = r.color
  if (r.packagePath) obj.packagePath = r.packagePath
  return obj
}

interface TextStyleOptions {
  color?: string
  backgroundColor?: string
  bold?: boolean
  italic?: boolean
  strikethrough?: boolean
  underline?: boolean
}

function getTextStyleFromRole(role: Role): TextStyleOptions {
  if (role.style && typeof role.style === 'object') {
    return role.style as TextStyleOptions
  }

  const style: TextStyleOptions = {}
  if (role.color) style.color = role.color
  if (role.backgroundColor) style.backgroundColor = role.backgroundColor
  if (role.bold) style.bold = true
  if (role.italic) style.italic = true
  if (role.strikethrough) style.strikethrough = true
  if (role.underline) style.underline = true
  return style
}

function buildTextDecoration(style: TextStyleOptions): string | undefined {
  const parts: string[] = []
  if (style.underline) parts.push('underline')
  if (style.strikethrough) parts.push('line-through')
  return parts.length > 0 ? parts.join(' ') : undefined
}

function getRoleDecorationStyle(role: Role): Record<string, unknown> {
  const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper')
  const defaultColor = cfg.get<string>('defaultColor') || '#E60033'
  const textStyle = getTextStyleFromRole(role)
  const color = textStyle.color ?? role.color ?? typeColorMap[role.type] ?? defaultColor
  const textDecoration = buildTextDecoration(textStyle)

  return {
    color,
    backgroundColor: textStyle.backgroundColor ?? null,
    bold: Boolean(textStyle.bold),
    italic: Boolean(textStyle.italic),
    strikethrough: Boolean(textStyle.strikethrough),
    underline: Boolean(textStyle.underline),
    fontWeight: textStyle.bold ? 'bold' : null,
    fontStyle: textStyle.italic ? 'italic' : null,
    textDecoration: textDecoration ?? null,
  }
}

function serializePosition(pos: vscode.Position, offset: number): Record<string, unknown> {
  return {
    line: pos.line,
    character: pos.character,
    offset,
  }
}

function getDocExtension(doc: vscode.TextDocument): string {
  const source = (doc.fileName || doc.uri.path || '').toLowerCase()
  const match = source.match(/\.([a-z0-9_\-]+)$/)
  return match ? match[1] : ''
}

function shouldDecorateDoc(doc: vscode.TextDocument): { ok: true } | { ok: false; reason: string } {
  const supportedLangs = getSupportedLanguages()
  const supportedExts = new Set(getSupportedExtensions().map(ext => ext.toLowerCase()))
  const ext = getDocExtension(doc)
  if (!supportedLangs.includes(doc.languageId) && !supportedExts.has(ext)) {
    return { ok: false, reason: 'unsupported_document_type' }
  }

  const hugeTh = vscode.workspace.getConfiguration('AndreaNovelHelper').get<number>('hugeFile.thresholdBytes', 50 * 1024) || 50 * 1024
  if (isHugeFile(doc, hugeTh)) {
    return { ok: false, reason: 'huge_file_skipped' }
  }

  return { ok: true }
}

async function resolveDocumentForTool(filePath?: string): Promise<{ doc?: vscode.TextDocument; source?: string; error?: string }> {
  if (!filePath) {
    const active = vscode.window.activeTextEditor?.document
    if (!active) return { error: 'no_active_editor' }
    return { doc: active, source: 'active_editor' }
  }

  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath))
    return { doc, source: 'file_path' }
  } catch (e: any) {
    return { error: `cannot_open_document: ${e?.message || String(e)}` }
  }
}

async function getDocumentDecorationsPayload(filePath: string | undefined, maxEntries: number, includeLineText: boolean): Promise<unknown> {
  const resolved = await resolveDocumentForTool(filePath)
  if (!resolved.doc) {
    return { error: resolved.error || 'cannot_resolve_document' }
  }

  const doc = resolved.doc
  const eligibility = shouldDecorateDoc(doc)
  if (!eligibility.ok) {
    return {
      uri: doc.uri.toString(),
      filePath: doc.fileName || undefined,
      fileName: path.basename(doc.fileName || doc.uri.path),
      languageId: doc.languageId,
      source: resolved.source,
      skipped: true,
      reason: eligibility.reason,
      decorationCount: 0,
      decorations: [],
    }
  }

  const result = await collectRoleUsageRanges(doc)
  const limitedEntries = maxEntries > 0 ? result.decorationEntries.slice(0, maxEntries) : result.decorationEntries
  const truncated = limitedEntries.length < result.decorationEntries.length
  const styleGroups = new Map<string, { style: Record<string, unknown>; count: number; roleNames: Set<string> }>()

  const decorations = limitedEntries.map(entry => {
    const startOffset = doc.offsetAt(entry.range.start)
    const endOffset = doc.offsetAt(entry.range.end)
    const style = getRoleDecorationStyle(entry.role)
    const styleKey = JSON.stringify(style)
    const group = styleGroups.get(styleKey)
    if (group) {
      group.count += 1
      group.roleNames.add(entry.role.name)
    } else {
      styleGroups.set(styleKey, { style, count: 1, roleNames: new Set([entry.role.name]) })
    }

    return {
      role: roleDetail(entry.role),
      matchedText: entry.matchedText,
      matchSource: entry.matchSource,
      pattern: entry.pattern,
      priority: entry.priority,
      partial: entry.partial,
      range: {
        start: serializePosition(entry.range.start, startOffset),
        end: serializePosition(entry.range.end, endOffset),
      },
      lineText: includeLineText ? doc.lineAt(entry.range.start.line).text : undefined,
      style,
      reason: {
        type: entry.matchSource,
        roleType: entry.role.type,
        sourcePath: entry.role.sourcePath,
        packagePath: entry.role.packagePath,
        regexFlags: entry.matchSource === 'regex' ? entry.role.regexFlags || 'g' : undefined,
        sensitive: entry.role.type === SENSITIVE_TYPE,
      },
    }
  })

  return {
    uri: doc.uri.toString(),
    filePath: doc.fileName || undefined,
    fileName: path.basename(doc.fileName || doc.uri.path),
    languageId: doc.languageId,
    source: resolved.source,
    decorationCount: result.decorationEntries.length,
    returnedCount: decorations.length,
    truncated,
    styleGroups: Array.from(styleGroups.values()).map(group => ({
      style: group.style,
      count: group.count,
      roleNames: Array.from(group.roleNames),
    })),
    decorations,
  }
}

// --------------------------------------------------------------------------
// Resource: novel://roles/all
// --------------------------------------------------------------------------

function buildRolesAllPayload(rolesGetter: RolesGetter): unknown {
  const roles = rolesGetter()
  const presentInDoc = getNamesInActiveDoc(roles)

  // Separate sensitive roles that are NOT in the active document
  const sensitive = roles.filter(r => isSensitive(r) && !presentInDoc.has(r.name))
  const exposed = roles.filter(r => !isSensitive(r) || presentInDoc.has(r.name))

  const total = roles.length

  if (exposed.length <= FULL_DETAIL_THRESHOLD && sensitive.length === 0) {
    // Small project, no hidden sensitives → return everything in detail
    return {
      mode: 'full',
      totalCount: total,
      roles: exposed.map(roleDetail),
    }
  }

  if (exposed.length <= FULL_DETAIL_THRESHOLD) {
    // Small non-sensitive set, but there are hidden sensitives
    return {
      mode: 'full_with_hidden_sensitive',
      totalCount: total,
      roles: exposed.map(roleDetail),
      hiddenSensitive: { count: sensitive.length },
    }
  }

  // Large list → return category index
  const typeMap = new Map<string, Role[]>()
  for (const r of exposed) {
    const t = r.type || 'unknown'
    if (!typeMap.has(t)) typeMap.set(t, [])
    typeMap.get(t)!.push(r)
  }

  const categories: unknown[] = []
  for (const [type, list] of typeMap) {
    if (list.length <= TYPE_LIST_THRESHOLD) {
      categories.push({ type, count: list.length, names: list.map(r => r.name) })
    } else {
      categories.push({
        type,
        count: list.length,
        summary: `数量较多，请用 get_roles_by_type 工具按类型分页查询`,
      })
    }
  }

  if (sensitive.length > 0) {
    categories.push({ type: SENSITIVE_TYPE, count: sensitive.length })
  }

  return {
    mode: 'index',
    totalCount: total,
    categories,
  }
}

// --------------------------------------------------------------------------
// Resource: novel://document/active
// --------------------------------------------------------------------------

function buildActiveDocPayload(rolesGetter: RolesGetter): unknown {
  const editor = vscode.window.activeTextEditor
  if (!editor) return { error: 'no_active_editor' }
  const doc = editor.document
  const raw = doc.getText()
  let processed = raw
  if (doc.languageId === 'markdown' || /\.md(i|own)?$/i.test(doc.fileName)) {
    processed = mdToPlainText(raw).text
  } else if (doc.languageId === 'plaintext') {
    processed = txtToPlainText(raw).text
  }

  // All roles present in the document (including sensitives – they are
  // readable because the AI already has access to this document text)
  const occ = getDocumentRoleOccurrences(doc)
  const presentRoles: unknown[] = []
  if (occ) {
    for (const [role] of occ) {
      presentRoles.push(roleDetail(role))
    }
  }

  return {
    uri: doc.uri.toString(),
    fileName: path.basename(doc.fileName),
    languageId: doc.languageId,
    charCount: raw.length,
    // Return full text only for reasonably sized files (≤ 64 KB)
    text: raw.length <= 64 * 1024 ? processed : `[文件过大，不在此返回全文，共 ${raw.length} 字符]`,
    rolesPresent: presentRoles,
  }
}

// --------------------------------------------------------------------------
// Tool: find_roles_in_document
// --------------------------------------------------------------------------

function findRolesInDocumentPayload(rolesGetter: RolesGetter, filePath: string): unknown {
  // Sensitives are allowed here because the caller is explicitly passing a
  // file path, meaning the AI agent has read access to that file.
  const roles = rolesGetter()
  let text: string
  try {
    text = fs.readFileSync(filePath, 'utf-8')
  } catch (e: any) {
    return { error: `cannot_read_file: ${e?.message}` }
  }

  const found: Array<{ name: string; type: string; count: number }> = []
  for (const r of roles) {
    let count = 0
    const terms = [r.name, ...(Array.isArray(r.aliases) ? r.aliases : [])]
    for (const t of terms) {
      let idx = 0
      while ((idx = text.indexOf(t, idx)) !== -1) { count++; idx += t.length }
    }
    if (count > 0) found.push({ name: r.name, type: r.type, count })
  }
  found.sort((a, b) => b.count - a.count)
  return { filePath, roleCount: found.length, roles: found }
}

// --------------------------------------------------------------------------
// Tool: get_roles_by_type
// --------------------------------------------------------------------------

function getRolesByTypePayload(
  rolesGetter: RolesGetter,
  type: string,
  page: number,
  pageSize: number,
): unknown {
  const roles = rolesGetter()
  const filtered = roles.filter(r => r.type === type)

  // Sensitive roles are only returned in full if not matching SENSITIVE_TYPE,
  // or if the caller explicitly requests that type (they know what they're asking for).
  const start = (page - 1) * pageSize
  const slice = filtered.slice(start, start + pageSize)

  return {
    type,
    totalCount: filtered.length,
    page,
    pageSize,
    pageCount: Math.ceil(filtered.length / pageSize),
    roles: slice.map(roleDetail),
  }
}

// --------------------------------------------------------------------------
// Tool: search_roles
// --------------------------------------------------------------------------

function searchRolesPayload(
  rolesGetter: RolesGetter,
  keyword: string,
  includeAliases: boolean,
  includeSensitive: boolean,
): unknown {
  const roles = rolesGetter()
  const kw = keyword.toLowerCase()
  const presentInDoc = includeSensitive ? null : getNamesInActiveDoc(roles)

  const results: unknown[] = []
  for (const r of roles) {
    // Filter sensitives unless explicitly requested or present in active doc
    if (isSensitive(r) && !includeSensitive) {
      if (!presentInDoc?.has(r.name)) continue
    }

    const nameMatch = r.name.toLowerCase().includes(kw)
    const aliasMatch =
      includeAliases &&
      Array.isArray(r.aliases) &&
      r.aliases.some(a => a.toLowerCase().includes(kw))

    if (nameMatch || aliasMatch) {
      results.push(roleDetail(r))
    }
  }

  return { keyword, count: results.length, roles: results }
}

function listSkillDocumentsPayload(): unknown {
  const docs = listBundledCopilotDocs().map(doc => ({
    id: doc.id,
    title: doc.title,
    description: doc.description,
    kind: doc.kind,
    workspaceRelativePath: doc.workspaceRelativePath,
  }))

  return {
    count: docs.length,
    documents: docs,
  }
}

function getSkillDocumentPayload(extensionPath: string, id: string): unknown {
  const doc = readBundledCopilotDoc(extensionPath, id)
  if (!doc) {
    return {
      error: 'skill_document_not_found',
      id,
      availableIds: BUNDLED_COPILOT_DOC_IDS,
    }
  }

  return {
    id: doc.id,
    title: doc.title,
    description: doc.description,
    kind: doc.kind,
    workspaceRelativePath: doc.workspaceRelativePath,
    content: doc.content,
  }
}

// --------------------------------------------------------------------------
// Tool: get_comments_for_file
// --------------------------------------------------------------------------

async function getCommentsForFilePayload(filePath: string): Promise<unknown> {
  const uuid = getFileUuid(filePath)
  if (!uuid) return { error: 'file_not_tracked', filePath }
  const threads = await loadComments(uuid)
  return {
    filePath,
    threadCount: threads.length,
    threads: threads.map(t => ({
      id: t.id,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      anchorTexts: t.anchor.selTexts,
      messageCount: t.messages.length,
    })),
  }
}

// --------------------------------------------------------------------------
// Tool: get_comment_content
// --------------------------------------------------------------------------

async function getCommentContentPayload(threadId: string): Promise<unknown> {
  const content = await loadCommentContent(threadId)
  return { threadId, content }
}

// --------------------------------------------------------------------------
// Tool: get_project_comments_summary
// --------------------------------------------------------------------------

async function getProjectCommentsSummaryPayload(): Promise<unknown> {
  const docUuids = listAllCommentDocUuids()
  let totalThreads = 0
  let openThreads = 0
  let resolvedThreads = 0
  const files: Array<{
    docUuid: string
    filePath?: string
    fileName?: string
    threadCount: number
    openCount: number
    resolvedCount: number
  }> = []

  for (const uuid of docUuids) {
    let threads: Awaited<ReturnType<typeof loadComments>>
    try {
      threads = await loadComments(uuid)
    } catch {
      continue
    }
    if (!threads.length) continue

    const fileInfo = getFileByUuid(uuid)
    const open = threads.filter(t => t.status !== 'resolved').length
    const resolved = threads.filter(t => t.status === 'resolved').length

    totalThreads += threads.length
    openThreads += open
    resolvedThreads += resolved

    files.push({
      docUuid: uuid,
      filePath: fileInfo?.filePath,
      fileName: fileInfo?.fileName,
      threadCount: threads.length,
      openCount: open,
      resolvedCount: resolved,
    })
  }

  files.sort((a, b) => b.threadCount - a.threadCount)

  return {
    totalDocuments: files.length,
    totalThreads,
    openThreads,
    resolvedThreads,
    files,
  }
}

// --------------------------------------------------------------------------
// Tool: get_project_role_usage_stats
// --------------------------------------------------------------------------

function getProjectRoleUsageStatsPayload(topN: number): unknown {
  const allDocs = getAllRoleUsageDocEntries()

  // Aggregate occurrences per role key across all documents
  const roleAgg = new Map<
    string,
    { key: string; name: string; type?: string; totalOccurrences: number; docCount: number }
  >()

  for (const doc of allDocs) {
    for (const roleEntry of doc.roles) {
      const existing = roleAgg.get(roleEntry.key)
      if (existing) {
        existing.totalOccurrences += roleEntry.occurrences
        existing.docCount += 1
      } else {
        roleAgg.set(roleEntry.key, {
          key: roleEntry.key,
          name: roleEntry.name,
          type: roleEntry.type,
          totalOccurrences: roleEntry.occurrences,
          docCount: 1,
        })
      }
    }
  }

  const sorted = Array.from(roleAgg.values()).sort(
    (a, b) => b.totalOccurrences - a.totalOccurrences,
  )

  const top = topN > 0 ? sorted.slice(0, topN) : sorted

  return {
    indexedDocuments: allDocs.length,
    totalRoles: roleAgg.size,
    roles: top,
  }
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
}

function getNovelHelperRoot(): string | undefined {
  const wsRoot = getWorkspaceRoot()
  if (!wsRoot) return undefined
  return path.join(wsRoot, 'novel-helper')
}

function normalizeFsPathForCompare(p: string): string {
  const normalized = path.resolve(p).replace(/[\\/]+/g, path.sep)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isPathInside(parentPath: string, targetPath: string): boolean {
  const parent = normalizeFsPathForCompare(parentPath)
  const target = normalizeFsPathForCompare(targetPath)
  return target === parent || target.startsWith(parent + path.sep)
}

function ensureManagedFilePath(filePath: string, allowedExts?: string[]): { ok: true; resolvedPath: string; novelHelperRoot: string } | { ok: false; error: string } {
  const novelRoot = getNovelHelperRoot()
  if (!novelRoot) return { ok: false, error: 'workspace_not_opened' }
  const resolved = path.resolve(filePath)
  if (!isPathInside(novelRoot, resolved)) {
    return { ok: false, error: 'file_must_be_under_novel_helper' }
  }
  if (Array.isArray(allowedExts) && allowedExts.length > 0) {
    const ext = path.extname(resolved).toLowerCase()
    if (!allowedExts.includes(ext)) {
      return { ok: false, error: `invalid_file_extension: ${ext}` }
    }
  }
  return { ok: true, resolvedPath: resolved, novelHelperRoot: novelRoot }
}

function detectResourceKind(filePath: string): 'role' | 'relationship' | 'timeline' | 'external-marker' | 'general' {
  const fileName = path.basename(filePath)
  const ext = path.extname(fileName).toLowerCase()
  if (ext === '.rjson5' || ext === '.rjson') return 'relationship'
  if (ext === '.tjson5') return 'timeline'
  if (ext === '.ojson5' || ext === '.ojson') return 'role'
  if (isExternalResourceMarkerFile(fileName)) return 'external-marker'

  if (MANAGED_RESOURCE_EXTS.has(ext) && RESOURCE_KIND_NAME_RE.test(fileName)) {
    if (ext === '.tjson5') return 'timeline'
    if (ext === '.rjson' || ext === '.rjson5') return 'relationship'
    return 'role'
  }

  if (isRoleFile(fileName, filePath)) return 'role'
  return 'general'
}

interface ResourceTreeNode {
  type: 'directory' | 'file'
  name: string
  path: string
  relativePath: string
  kind?: string
  children?: ResourceTreeNode[]
}

function buildResourceTreeNode(baseDir: string, currentDir: string, includeGeneralFiles: boolean): ResourceTreeNode {
  const relativePath = path.relative(baseDir, currentDir) || '.'
  const node: ResourceTreeNode = {
    type: 'directory',
    name: path.basename(currentDir),
    path: currentDir,
    relativePath,
    children: [],
  }

  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true })
  } catch {
    return node
  }

  const sorted = entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  for (const entry of sorted) {
    const fullPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      if (NOVEL_HELPER_IGNORED_DIRS.has(entry.name)) continue
      const childDir = buildResourceTreeNode(baseDir, fullPath, includeGeneralFiles)
      if ((childDir.children?.length || 0) > 0 || includeGeneralFiles) {
        node.children?.push(childDir)
      }
      continue
    }

    if (!entry.isFile()) continue
    const kind = detectResourceKind(fullPath)
    if (!includeGeneralFiles && kind === 'general') continue
    node.children?.push({
      type: 'file',
      name: entry.name,
      path: fullPath,
      relativePath: path.relative(baseDir, fullPath),
      kind,
    })
  }

  return node
}

function summarizeResourceTree(node: ResourceTreeNode): { directories: number; files: number; roleFiles: number; relationshipFiles: number; timelineFiles: number; tomlRoleFiles: number } {
  let directories = 0
  let files = 0
  let roleFiles = 0
  let relationshipFiles = 0
  let timelineFiles = 0
  let tomlRoleFiles = 0

  const walk = (n: ResourceTreeNode) => {
    if (n.type === 'directory') {
      directories += 1
      for (const c of n.children || []) walk(c)
      return
    }
    files += 1
    if (n.kind === 'role') {
      roleFiles += 1
      if (path.extname(n.name).toLowerCase() === '.toml') tomlRoleFiles += 1
    }
    if (n.kind === 'relationship') relationshipFiles += 1
    if (n.kind === 'timeline') timelineFiles += 1
  }
  walk(node)

  return { directories, files, roleFiles, relationshipFiles, timelineFiles, tomlRoleFiles }
}

function getRoleLibraryStructurePayload(includeGeneralFiles: boolean): unknown {
  const wsRoot = getWorkspaceRoot()
  const novelRoot = getNovelHelperRoot()
  if (!wsRoot || !novelRoot) {
    return { error: 'workspace_not_opened' }
  }
  if (!fs.existsSync(novelRoot)) {
    return { error: 'novel_helper_not_found', expectedPath: novelRoot }
  }

  const tree = buildResourceTreeNode(novelRoot, novelRoot, includeGeneralFiles)
  const summary = summarizeResourceTree(tree)
  return {
    workspaceRoot: wsRoot,
    novelHelperRoot: novelRoot,
    includeGeneralFiles,
    summary,
    tree,
  }
}

function collectFilesByExt(rootDir: string, exts: Set<string>): string[] {
  const results: string[] = []
  const stack: string[] = [rootDir]
  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir) continue
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (NOVEL_HELPER_IGNORED_DIRS.has(entry.name)) continue
        stack.push(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (exts.has(ext)) results.push(fullPath)
    }
  }
  results.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  return results
}

function listTimelineFilesPayload(): unknown {
  const novelRoot = getNovelHelperRoot()
  if (!novelRoot) return { error: 'workspace_not_opened' }
  if (!fs.existsSync(novelRoot)) return { error: 'novel_helper_not_found', expectedPath: novelRoot }
  const files = collectFilesByExt(novelRoot, new Set(['.tjson5']))
  return {
    root: novelRoot,
    count: files.length,
    files: files.map(filePath => ({ filePath, relativePath: path.relative(novelRoot, filePath) })),
  }
}

function listRelationshipFilesPayload(): unknown {
  const novelRoot = getNovelHelperRoot()
  if (!novelRoot) return { error: 'workspace_not_opened' }
  if (!fs.existsSync(novelRoot)) return { error: 'novel_helper_not_found', expectedPath: novelRoot }
  const files = collectFilesByExt(novelRoot, new Set(['.rjson5', '.rjson']))
  return {
    root: novelRoot,
    count: files.length,
    files: files.map(filePath => ({ filePath, relativePath: path.relative(novelRoot, filePath) })),
  }
}

function getJson5LikeFilePayload(filePath: string, expectedExts: string[]): unknown {
  const checked = ensureManagedFilePath(filePath, expectedExts)
  if (!checked.ok) return { error: checked.error }
  if (!fs.existsSync(checked.resolvedPath)) return { error: 'file_not_found', filePath: checked.resolvedPath }

  try {
    const raw = fs.readFileSync(checked.resolvedPath, 'utf-8')
    const parsed = JSON5.parse(raw)
    return {
      filePath: checked.resolvedPath,
      relativePath: path.relative(checked.novelHelperRoot, checked.resolvedPath),
      parsed,
      raw,
    }
  } catch (e: any) {
    return { error: `cannot_parse_json5: ${e?.message || String(e)}`, filePath: checked.resolvedPath }
  }
}

function saveJson5LikeFilePayload(filePath: string, expectedExts: string[], content: unknown): unknown {
  const checked = ensureManagedFilePath(filePath, expectedExts)
  if (!checked.ok) return { error: checked.error }

  const dir = path.dirname(checked.resolvedPath)
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch (e: any) {
    return { error: `cannot_create_directory: ${e?.message || String(e)}` }
  }

  try {
    let text: string
    if (fs.existsSync(checked.resolvedPath)) {
      const original = fs.readFileSync(checked.resolvedPath, 'utf-8')
      const lossless = tryLosslessJson5UpdateText(original, content, vscode.Uri.file(checked.resolvedPath))
      if (lossless.text) {
        text = lossless.text.trimEnd()
      } else {
        if (lossless.error) {
          console.warn('[novelServer] Lossless JSON5 update fallback:', lossless.error)
        }
        text = JSON5.stringify(content, null, 2)
      }
    } else {
      text = JSON5.stringify(content, null, 2)
    }
    fs.writeFileSync(checked.resolvedPath, `${text}\n`, 'utf-8')
    return {
      ok: true,
      filePath: checked.resolvedPath,
      relativePath: path.relative(checked.novelHelperRoot, checked.resolvedPath),
    }
  } catch (e: any) {
    return { error: `cannot_write_file: ${e?.message || String(e)}`, filePath: checked.resolvedPath }
  }
}

function appendJson5ArrayItemPayload(filePath: string, expectedExts: string[], arrayField: string, item: unknown): unknown {
  const checked = ensureManagedFilePath(filePath, expectedExts)
  if (!checked.ok) return { error: checked.error }
  if (!fs.existsSync(checked.resolvedPath)) return { error: 'file_not_found', filePath: checked.resolvedPath }

  try {
    const raw = fs.readFileSync(checked.resolvedPath, 'utf-8')
    const parsed = JSON5.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { error: 'invalid_json5_root: expected_object' }
    }

    const root = parsed as Record<string, unknown>
    if (!Array.isArray(root[arrayField])) root[arrayField] = []
    ;(root[arrayField] as unknown[]).push(item)

    const lossless = tryLosslessJson5UpdateText(raw, root, vscode.Uri.file(checked.resolvedPath))
    if (lossless.error) {
      console.warn('[novelServer] Lossless JSON5 update fallback:', lossless.error)
    }
    const text = (lossless.text ?? JSON5.stringify(root, null, 2)).trimEnd()
    fs.writeFileSync(checked.resolvedPath, `${text}\n`, 'utf-8')

    return {
      ok: true,
      filePath: checked.resolvedPath,
      relativePath: path.relative(checked.novelHelperRoot, checked.resolvedPath),
      field: arrayField,
      count: (root[arrayField] as unknown[]).length,
    }
  } catch (e: any) {
    return { error: `cannot_append_item: ${e?.message || String(e)}`, filePath: checked.resolvedPath }
  }
}

function resolveRoleFileTypeByPath(filePath: string): RoleFileData['fileType'] | undefined {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.json5') return 'json5'
  if (ext === '.ojson5') return 'ojson5'
  if (ext === '.md') return 'markdown'
  if (ext === '.csv') return 'csv'
  if (ext === '.toml') return 'toml'
  return undefined
}

function ensureRoleFileExists(filePath: string): { ok: true } | { ok: false; error: string } {
  if (fs.existsSync(filePath)) return { ok: true }

  const fileType = resolveRoleFileTypeByPath(filePath)
  if (!fileType) return { ok: false, error: 'unsupported_role_file_extension' }

  const dir = path.dirname(filePath)
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    writeRoleFile(filePath, [], fileType)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: `cannot_create_role_file: ${e?.message || String(e)}` }
  }
}

function readRoleFilePayload(filePath: string): unknown {
  const checked = ensureManagedFilePath(filePath, ['.json5', '.ojson5', '.md', '.csv', '.toml'])
  if (!checked.ok) return { error: checked.error }

  if (!fs.existsSync(checked.resolvedPath)) {
    return {
      filePath: checked.resolvedPath,
      relativePath: path.relative(checked.novelHelperRoot, checked.resolvedPath),
      exists: false,
      roles: [],
    }
  }

  try {
    const fileData = readRoleFile(checked.resolvedPath)
    return {
      filePath: checked.resolvedPath,
      relativePath: path.relative(checked.novelHelperRoot, checked.resolvedPath),
      exists: true,
      fileType: fileData.fileType,
      count: fileData.roles.length,
      roles: fileData.roles.map(roleDetail),
    }
  } catch (e: any) {
    return { error: `cannot_read_role_file: ${e?.message || String(e)}`, filePath: checked.resolvedPath }
  }
}

function upsertRoleInFilePayload(filePath: string, roleInput: Record<string, unknown>, createIfMissing: boolean): unknown {
  const checked = ensureManagedFilePath(filePath, ['.json5', '.ojson5', '.md', '.csv', '.toml'])
  if (!checked.ok) return { error: checked.error }

  if (!roleInput || typeof roleInput !== 'object') {
    return { error: 'invalid_role_payload' }
  }

  const name = String(roleInput.name ?? '').trim()
  if (!name) return { error: 'role_name_required' }

  if (!fs.existsSync(checked.resolvedPath)) {
    if (!createIfMissing) {
      return { error: 'file_not_found', filePath: checked.resolvedPath }
    }
    const created = ensureRoleFileExists(checked.resolvedPath)
    if (!created.ok) return { error: created.error, filePath: checked.resolvedPath }
  }

  let beforeExists = false
  try {
    const before = readRoleFile(checked.resolvedPath)
    beforeExists = before.roles.some(r => r.name === name)
  } catch {
    // ignore pre-read failures and rely on addRoleToFile result
  }

  const normalizedRole = {
    ...(roleInput as Record<string, unknown>),
    name,
    type: String(roleInput.type ?? '角色'),
  } as Role

  const ok = addRoleToFile(checked.resolvedPath, normalizedRole)
  if (!ok) {
    return { error: 'cannot_upsert_role', filePath: checked.resolvedPath, roleName: name }
  }

  return {
    ok: true,
    action: beforeExists ? 'updated' : 'created',
    filePath: checked.resolvedPath,
    relativePath: path.relative(checked.novelHelperRoot, checked.resolvedPath),
    roleName: name,
  }
}

function buildCommentMessageId(): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `mcp-${Date.now()}-${rand}`
}

async function appendCommentMessagePayload(threadId: string, author: string, body: string): Promise<unknown> {
  const trimmedId = threadId.trim()
  if (!trimmedId) return { error: 'thread_id_required' }
  if (!body.trim()) return { error: 'body_required' }

  const updated = await updateThread(trimmedId, metadata => {
    if (!Array.isArray(metadata.messages)) metadata.messages = []
    metadata.messages.push({
      id: buildCommentMessageId(),
      author: author.trim() || 'AI Assistant',
      body,
      createdAt: Date.now(),
    })
  })

  if (!updated) return { error: 'thread_not_found', threadId: trimmedId }
  return {
    ok: true,
    threadId: trimmedId,
    docUuid: updated.docUuid,
    messageCount: updated.messages?.length || 0,
  }
}

async function setCommentStatusPayload(threadId: string, status: 'open' | 'resolved'): Promise<unknown> {
  const trimmedId = threadId.trim()
  if (!trimmedId) return { error: 'thread_id_required' }
  const updated = await updateThreadStatus(trimmedId, status)
  if (!updated) return { error: 'thread_not_found', threadId: trimmedId }
  return {
    ok: true,
    threadId: trimmedId,
    status: updated.status,
    updatedAt: updated.updatedAt,
    docUuid: updated.docUuid,
  }
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

/**
 * Create and configure the McpServer instance.
 *
 * @param rolesGetter  A zero-argument function returning the live roles array.
 *                     Called on every request so it always reflects latest state.
 */
export function createNovelMcpServer(rolesGetter: RolesGetter, extensionPath: string): McpServer {
  const server = new McpServer(
    { name: 'andrea-novel-helper', version: '1.0.0' },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
      instructions:
        'Novel Helper MCP server — provides structured access to the novel project: characters, roles, comments, the active document, and bundled Copilot skill documents. Use the tools to query specific data; use resources for a snapshot overview.',
    },
  )

  // ── Resources ────────────────────────────────────────────────────────────

  server.registerResource(
    'roles-all',
    'novel://roles/all',
    {
      title: '全部角色',
      description:
        '返回项目角色库。≤50个非敏感角色时返回完整详情；更多时返回按类型分类的索引；敏感词默认只给计数（若当前文档包含则可见）。',
      mimeType: 'application/json',
    },
    async (_uri) => {
      const payload = buildRolesAllPayload(rolesGetter)
      return {
        contents: [
          {
            uri: 'novel://roles/all',
            mimeType: 'application/json',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      }
    },
  )

  server.registerResource(
    'active-document',
    'novel://document/active',
    {
      title: '当前活跃文档',
      description:
        '返回当前在编辑器中打开的文档的元信息、文本内容（≤64KB）和在其中出现的角色列表（含敏感词，因为文档已对调用方可见）。',
      mimeType: 'application/json',
    },
    async (_uri) => {
      const payload = buildActiveDocPayload(rolesGetter)
      return {
        contents: [
          {
            uri: 'novel://document/active',
            mimeType: 'application/json',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      }
    },
  )

  // ── Tools ─────────────────────────────────────────────────────────────────

  server.registerTool(
    'get_roles_by_type',
    {
      title: '按类型分页获取角色',
      description:
        '返回指定类型（如"配角"、"主角"、"词汇"）的角色列表，支持分页。适合 novel://roles/all 返回索引后按需查询某一类型的详情。',
      inputSchema: z.object({
        type: z.string().describe('角色类型，如"配角"、"主角"、"词汇"'),
        page: z.number().optional().default(1).describe('页码，默认1'),
        pageSize: z.number().optional().default(50).describe('每页数量，默认50，最大200'),
      }),
    },
    async (args: any) => {
      const type: string = String(args?.type ?? '')
      const page: number = Math.max(1, Number(args?.page ?? 1))
      const pageSize: number = Math.min(200, Math.max(1, Number(args?.pageSize ?? 50)))
      const payload = getRolesByTypePayload(rolesGetter, type, page, pageSize)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'search_roles',
    {
      title: '搜索角色',
      description:
        '按名称关键字模糊搜索角色。支持搜索别名（includeAliases=true）。敏感词默认不返回，除非 includeSensitive=true 或其出现在当前活跃文档中。',
      inputSchema: z.object({
        keyword: z.string().describe('搜索关键词'),
        includeAliases: z.boolean().optional().default(true).describe('是否搜索别名，默认true'),
        includeSensitive: z.boolean().optional().default(false).describe('是否包含敏感词，默认false'),
      }),
    },
    async (args: any) => {
      const keyword: string = String(args?.keyword ?? '')
      const includeAliases: boolean = Boolean(args?.includeAliases ?? true)
      const includeSensitive: boolean = Boolean(args?.includeSensitive ?? false)
      const payload = searchRolesPayload(rolesGetter, keyword, includeAliases, includeSensitive)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'get_role_file_roles',
    {
      title: '读取角色文件内容（通用）',
      description:
        '读取单个角色文件中的角色列表，支持 .json5/.ojson5/.md/.csv/.toml。',
      inputSchema: z.object({
        filePath: z.string().describe('角色文件完整绝对路径，必须位于 novel-helper 下'),
      }),
    },
    async (args: any) => {
      const filePath = String(args?.filePath ?? '')
      const payload = readRoleFilePayload(filePath)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'upsert_role_in_file',
    {
      title: '写入角色文件（通用）',
      description:
        '按角色名在目标文件中新增或更新角色，支持 .json5/.ojson5/.md/.csv/.toml。',
      inputSchema: z.object({
        filePath: z.string().describe('目标角色文件完整绝对路径，必须位于 novel-helper 下'),
        role: z.record(z.string(), z.unknown()).describe('角色对象，至少需要 name；可包含 type/description/aliases/color 等字段'),
        createIfMissing: z.boolean().optional().default(true).describe('文件不存在时是否自动创建，默认true'),
      }),
    },
    async (args: any) => {
      const filePath = String(args?.filePath ?? '')
      const role = (args?.role && typeof args.role === 'object' ? args.role : {}) as Record<string, unknown>
      const createIfMissing = Boolean(args?.createIfMissing ?? true)
      const payload = upsertRoleInFilePayload(filePath, role, createIfMissing)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'find_roles_in_document',
    {
      title: '查找文档中出现的角色',
      description:
        '扫描指定文件并返回出现的所有角色（含计数），包括敏感词（因为调用方已提供文件路径，说明有读取权限）。',
      inputSchema: z.object({
        filePath: z.string().describe('文件的完整绝对路径'),
      }),
    },
    async (args: any) => {
      const filePath: string = String(args?.filePath ?? '')
      const payload = findRolesInDocumentPayload(rolesGetter, filePath)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'get_comments_for_file',
    {
      title: '获取文件的批注列表',
      description:
        '返回指定文件的所有批注线程的摘要（id、状态、锚定文本、消息数量等）。',
      inputSchema: z.object({
        filePath: z.string().describe('文件的完整绝对路径'),
      }),
    },
    async (args: any) => {
      const filePath: string = String(args?.filePath ?? '')
      const payload = await getCommentsForFilePayload(filePath)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'get_comment_content',
    {
      title: '获取批注详细内容',
      description:
        '返回单个批注线程的完整 Markdown 内容。',
      inputSchema: z.object({
        threadId: z.string().describe('批注线程ID，从 get_comments_for_file 返回的列表中获取'),
      }),
    },
    async (args: any) => {
      const threadId: string = String(args?.threadId ?? '')
      const payload = await getCommentContentPayload(threadId)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'get_project_comments_summary',
    {
      title: '获取整个项目的批注汇总',
      description:
        '扫描整个项目，统计所有有批注记录的文档及各自的线程数量、开放/已解决批注数。返回按线程数降序排列的文件列表。无需参数。',
      inputSchema: z.object({}),
    },
    async (_args: any) => {
      const payload = await getProjectCommentsSummaryPayload()
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'get_project_role_usage_stats',
    {
      title: '获取整个项目的角色应用统计',
      description:
        '汇总所有已索引文档中的角色出现次数，返回按总出现次数降序排列的角色列表（含角色名、类型、总出现次数、出现文档数）。',
      inputSchema: z.object({
        topN: z.number().optional().default(50).describe('返回前N个角色，默认50，0表示全部'),
      }),
    },
    async (args: any) => {
      const topN: number = Math.max(0, Number(args?.topN ?? 50))
      const payload = getProjectRoleUsageStatsPayload(topN)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'get_document_decorations',
    {
      title: '获取文档着色结果',
      description:
        '返回当前文档或指定文件中，ANH 角色/敏感词/正则等文本装饰的范围、颜色样式、匹配来源和原因元数据。可用于让模型理解“哪些文本被什么颜色标记”。',
      inputSchema: z.object({
        filePath: z.string().optional().describe('可选。要分析的文件完整绝对路径；不传则使用当前活跃编辑器文档'),
        maxEntries: z.number().optional().default(500).describe('最多返回多少个着色条目，默认500；传0或负数表示返回全部'),
        includeLineText: z.boolean().optional().default(true).describe('是否返回命中所在行文本，默认true'),
      }),
    },
    async (args: any) => {
      const filePathValue = String(args?.filePath ?? '').trim()
      const filePath = filePathValue || undefined
      const maxEntriesRaw = Number(args?.maxEntries ?? 500)
      const maxEntries = Number.isFinite(maxEntriesRaw) ? Math.trunc(maxEntriesRaw) : 500
      const includeLineText = Boolean(args?.includeLineText ?? true)
      const payload = await getDocumentDecorationsPayload(filePath, maxEntries, includeLineText)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'list_skill_documents',
    {
      title: '列出内置 Skill 文档',
      description:
        '列出扩展内置的 Copilot 指令与 Prompt 文档，可用于导出到当前项目或进一步读取具体文档内容。',
      inputSchema: z.object({}),
    },
    async (_args: any) => {
      const payload = listSkillDocumentsPayload()
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'get_skill_document',
    {
      title: '获取内置 Skill 文档内容',
      description:
        '读取扩展内置的 Copilot 指令或 Prompt 文档全文。可用 id: copilot-instructions, anh-project, anh-script-runtime, anh-typst-templates。',
      inputSchema: z.object({
        id: z.enum(BUNDLED_COPILOT_DOC_IDS).describe('要读取的 Skill 文档 ID'),
      }),
    },
    async (args: any) => {
      const id: string = String(args?.id ?? '')
      const payload = getSkillDocumentPayload(extensionPath, id)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'get_role_library_structure',
    {
      title: '获取角色库文件结构',
      description:
        '返回 novel-helper 目录下的文件结构树，包含文件分类（角色/关系/时间线/普通）。结构形态对齐包管理器的目录层级。',
      inputSchema: z.object({
        includeGeneralFiles: z.boolean().optional().default(true).describe('是否包含普通文件，默认true；false时仅返回角色相关文件与目录'),
      }),
    },
    async (args: any) => {
      const includeGeneralFiles = Boolean(args?.includeGeneralFiles ?? true)
      const payload = getRoleLibraryStructurePayload(includeGeneralFiles)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'list_timeline_files',
    {
      title: '列出时间线文件',
      description:
        '扫描 novel-helper 下的 .tjson5 文件，返回绝对路径与相对路径。',
      inputSchema: z.object({}),
    },
    async (_args: any) => {
      const payload = listTimelineFilesPayload()
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'get_timeline_file',
    {
      title: '读取时间线文件',
      description:
        '读取并解析 .tjson5 时间线文件，返回 parsed 与 raw。',
      inputSchema: z.object({
        filePath: z.string().describe('时间线文件的完整绝对路径（.tjson5，且必须位于 novel-helper 下）'),
      }),
    },
    async (args: any) => {
      const filePath = String(args?.filePath ?? '')
      const payload = getJson5LikeFilePayload(filePath, ['.tjson5'])
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'save_timeline_file',
    {
      title: '写入时间线文件',
      description:
        '将 data 按 JSON5 格式写入 .tjson5 文件（覆盖写入）。',
      inputSchema: z.object({
        filePath: z.string().describe('时间线文件完整绝对路径（.tjson5，且必须位于 novel-helper 下）'),
        data: z.unknown().describe('要写入的 JSON 对象内容'),
      }),
    },
    async (args: any) => {
      const filePath = String(args?.filePath ?? '')
      const payload = saveJson5LikeFilePayload(filePath, ['.tjson5'], args?.data)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'append_timeline_event',
    {
      title: '追加时间线事件',
      description:
        '向 .tjson5 文件的 events 数组追加一条事件；若 events 不存在则自动创建。',
      inputSchema: z.object({
        filePath: z.string().describe('时间线文件完整绝对路径（.tjson5）'),
        event: z.unknown().describe('要追加的事件对象'),
      }),
    },
    async (args: any) => {
      const filePath = String(args?.filePath ?? '')
      const payload = appendJson5ArrayItemPayload(filePath, ['.tjson5'], 'events', args?.event)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'list_relationship_files',
    {
      title: '列出关系文件',
      description:
        '扫描 novel-helper 下的 .rjson5/.rjson 文件。',
      inputSchema: z.object({}),
    },
    async (_args: any) => {
      const payload = listRelationshipFilesPayload()
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'get_relationship_file',
    {
      title: '读取关系文件',
      description:
        '读取并解析 .rjson5/.rjson 关系文件，返回 parsed 与 raw。',
      inputSchema: z.object({
        filePath: z.string().describe('关系文件完整绝对路径（.rjson5/.rjson）'),
      }),
    },
    async (args: any) => {
      const filePath = String(args?.filePath ?? '')
      const payload = getJson5LikeFilePayload(filePath, ['.rjson5', '.rjson'])
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'save_relationship_file',
    {
      title: '写入关系文件',
      description:
        '将 data 按 JSON5 格式写入 .rjson5/.rjson 文件（覆盖写入）。',
      inputSchema: z.object({
        filePath: z.string().describe('关系文件完整绝对路径（.rjson5/.rjson）'),
        data: z.unknown().describe('要写入的关系文件对象内容'),
      }),
    },
    async (args: any) => {
      const filePath = String(args?.filePath ?? '')
      const payload = saveJson5LikeFilePayload(filePath, ['.rjson5', '.rjson'], args?.data)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'append_relationship_entry',
    {
      title: '追加关系条目',
      description:
        '向关系文件的 relationships 数组追加一条关系；若不存在则自动创建。',
      inputSchema: z.object({
        filePath: z.string().describe('关系文件完整绝对路径（.rjson5/.rjson）'),
        relationship: z.unknown().describe('要追加的关系对象'),
      }),
    },
    async (args: any) => {
      const filePath = String(args?.filePath ?? '')
      const payload = appendJson5ArrayItemPayload(filePath, ['.rjson5', '.rjson'], 'relationships', args?.relationship)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'set_comment_status',
    {
      title: '设置批注状态',
      description:
        '将批注线程状态设置为 open 或 resolved。',
      inputSchema: z.object({
        threadId: z.string().describe('批注线程ID'),
        status: z.enum(['open', 'resolved']).describe('目标状态'),
      }),
    },
    async (args: any) => {
      const threadId = String(args?.threadId ?? '')
      const status = (String(args?.status ?? 'open') === 'resolved' ? 'resolved' : 'open') as 'open' | 'resolved'
      const payload = await setCommentStatusPayload(threadId, status)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  server.registerTool(
    'append_comment_message',
    {
      title: '追加批注消息',
      description:
        '向指定批注线程追加一条消息。',
      inputSchema: z.object({
        threadId: z.string().describe('批注线程ID'),
        author: z.string().optional().default('AI Assistant').describe('消息作者名，默认 AI Assistant'),
        body: z.string().describe('消息正文'),
      }),
    },
    async (args: any) => {
      const threadId = String(args?.threadId ?? '')
      const author = String(args?.author ?? 'AI Assistant')
      const body = String(args?.body ?? '')
      const payload = await appendCommentMessagePayload(threadId, author, body)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  return server
}
