/* eslint-disable semi */
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
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Role } from '../extension'
import { getDocumentRoleOccurrences } from '../context/documentRolesCache'
import { loadComments, loadCommentContent } from '../comments/storage'
import { getFileUuid } from '../utils/tracker/globalFileTracking'
import { mdToPlainText } from '../utils/md_plain'
import { txtToPlainText } from '../utils/txt_plain'

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const SENSITIVE_TYPE = '敏感词'
/** Roles ≤ this threshold → return full detail; otherwise → category index */
const FULL_DETAIL_THRESHOLD = 50
/** Per-type list threshold – types with more roles than this get a summary hint */
const TYPE_LIST_THRESHOLD = 50

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
// Factory
// --------------------------------------------------------------------------

/**
 * Create and configure the McpServer instance.
 *
 * @param rolesGetter  A zero-argument function returning the live roles array.
 *                     Called on every request so it always reflects latest state.
 */
export function createNovelMcpServer(rolesGetter: RolesGetter): McpServer {
  const server = new McpServer(
    { name: 'andrea-novel-helper', version: '1.0.0' },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
      instructions:
        'Novel Helper MCP server — provides structured access to the novel project: characters, roles, comments, and the active document. Use the tools to query specific data; use resources for a snapshot overview.',
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
        '返回指定类型（如"配角"、"主角"、"词汇"）的角色列表，支持分页。适合 novel://roles/all 返回索引后按需查询某一类型的详情。参数: type(string), page(number, 默认1), pageSize(number, 默认50, 最大200)。',
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
        '按名称关键字模糊搜索角色。支持搜索别名（includeAliases=true）。敏感词默认不返回，除非 includeSensitive=true 或其出现在当前活跃文档中。参数: keyword(string), includeAliases(boolean, 默认true), includeSensitive(boolean, 默认false)。',
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
    'find_roles_in_document',
    {
      title: '查找文档中出现的角色',
      description:
        '扫描指定文件并返回出现的所有角色（含计数），包括敏感词（因为调用方已提供文件路径，说明有读取权限）。参数: filePath(string, 文件的完整绝对路径)。',
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
        '返回指定文件的所有批注线程的摘要（id、状态、锚定文本、消息数量等）。参数: filePath(string, 文件的完整绝对路径)。',
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
        '返回单个批注线程的完整 Markdown 内容。参数: threadId(string，从 get_comments_for_file 返回的列表中获取)。',
    },
    async (args: any) => {
      const threadId: string = String(args?.threadId ?? '')
      const payload = await getCommentContentPayload(threadId)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  return server
}
