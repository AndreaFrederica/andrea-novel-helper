import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { CommentDocumentIndex, CommentThreadData, CommentMetadata, vscodeRangeToAnchorRange } from './types';
import { getFileUuid } from '../utils/tracker/globalFileTracking';
import { MdCommentStorage } from './mdStorage';

const VERSION = '2.0'; // 升级版本号

type SaveState = { timer?: NodeJS.Timeout; last?: string };
const saveStateByDoc = new Map<string, SaveState>();
const saveStateByComment = new Map<string, SaveState>();

function getWsRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function commentsDir(): string | undefined {
  const ws = getWsRoot();
  if (!ws) return undefined;
  const dir = path.join(ws, 'novel-helper', 'comments');
  ensureDir(dir);
  return dir;
}

function commentsDataDir(): string | undefined {
  const dir = commentsDir();
  if (!dir) return undefined;
  const dataDir = path.join(dir, 'data');
  ensureDir(dataDir);
  return dataDir;
}

function commentsContentDir(): string | undefined {
  const dir = commentsDir();
  if (!dir) return undefined;
  const contentDir = path.join(dir, 'content');
  ensureDir(contentDir);
  return contentDir;
}

export function getDocUuidForDocument(doc: vscode.TextDocument): string | undefined {
  try {
    const filePath = doc.uri.fsPath;
    const uuid = getFileUuid(filePath);
    return uuid || undefined;
  } catch {
    return undefined;
  }
}

// 文档索引文件路径
function indexFilePathForUuid(docUuid: string): string | undefined {
  const dir = commentsDir();
  if (!dir) return undefined;
  return path.join(dir, `${docUuid}.json`);
}

// 批注元数据文件路径
function metadataFilePathForComment(commentId: string): string | undefined {
  const dir = commentsDataDir();
  if (!dir) return undefined;
  return path.join(dir, `${commentId}.json`);
}

// 批注内容文件路径
function contentFilePathForComment(commentId: string): string | undefined {
  const dir = commentsContentDir();
  if (!dir) return undefined;
  return path.join(dir, `${commentId}.md`);
}

// 获取文档对应的md文件路径
function mdFilePathForDocument(docUuid: string): string | undefined {
  const dir = commentsContentDir();
  if (!dir) return undefined;
  return path.join(dir, `${docUuid}.md`);
}

// 加载文档的批注索引
export async function loadCommentIndex(docUuid: string): Promise<CommentDocumentIndex> {
  const fp = indexFilePathForUuid(docUuid);
  if (!fp) { throw new Error('No workspace'); }
  if (!fs.existsSync(fp)) {
    return { version: VERSION, docUuid, threadIds: [] };
  }
  try {
    const txt = fs.readFileSync(fp, 'utf8');
    const data = JSON.parse(txt) as CommentDocumentIndex;
    if (!data.version) data.version = VERSION;
    if (!Array.isArray(data.threadIds)) data.threadIds = [];
    return data;
  } catch {
    return { version: VERSION, docUuid, threadIds: [] };
  }
}

// 加载单个批注的元数据
export async function loadCommentMetadata(commentId: string): Promise<CommentMetadata | null> {
  const fp = metadataFilePathForComment(commentId);
  if (!fp || !fs.existsSync(fp)) return null;
  try {
    const txt = fs.readFileSync(fp, 'utf8');
    const data = JSON.parse(txt) as CommentMetadata;
    if (!data.version) data.version = VERSION;
    return data;
  } catch {
    return null;
  }
}

// 加载批注内容
export async function loadCommentContent(commentId: string): Promise<string> {
  const fp = contentFilePathForComment(commentId);
  if (!fp || !fs.existsSync(fp)) return '';
  try {
    return fs.readFileSync(fp, 'utf8');
  } catch {
    return '';
  }
}

// 加载文档的所有批注数据（兼容旧接口）
export async function loadComments(docUuid: string): Promise<CommentThreadData[]> {
  // 优先从md文件加载
  const mdFilePath = mdFilePathForDocument(docUuid);
  if (mdFilePath && fs.existsSync(mdFilePath)) {
    return loadCommentsFromMd(docUuid);
  }
  
  // 回退到原有的JSON格式加载
  const index = await loadCommentIndex(docUuid);
  const threads: CommentThreadData[] = [];
  
  for (const threadId of index.threadIds) {
    const metadata = await loadCommentMetadata(threadId);
    if (metadata && !metadata.deleted) { // 过滤掉已删除的批注
      const thread: CommentThreadData = {
        id: metadata.id,
        status: metadata.status,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        docUuid: metadata.docUuid,
        anchor: metadata.anchor,
        contentFile: metadata.contentFile,
        messages: metadata.messages
      };
      threads.push(thread);
    }
  }
  
  return threads;
}

// 从md文件加载批注
export async function loadCommentsFromMd(docUuid: string): Promise<CommentThreadData[]> {
  const mdFilePath = mdFilePathForDocument(docUuid);
  if (!mdFilePath) return [];
  
  const parsed = MdCommentStorage.readMdFile(mdFilePath);
  const threads: CommentThreadData[] = [];
  
  for (const mdThread of parsed.threads) {
    // 尝试从JSON元数据文件加载完整信息
    const metadata = await loadCommentMetadata(mdThread.threadId);
    if (metadata) {
      const thread: CommentThreadData = {
        id: metadata.id,
        status: metadata.status,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        docUuid: metadata.docUuid,
        anchor: metadata.anchor,
        contentFile: metadata.contentFile,
        messages: MdCommentStorage.toCommentMessages(mdThread)
      };
      threads.push(thread);
    }
  }
  
  return threads;
}

// 保存文档索引
export async function saveCommentIndex(index: CommentDocumentIndex): Promise<void> {
  const fp = indexFilePathForUuid(index.docUuid);
  if (!fp) return;
  const key = index.docUuid;
  let st = saveStateByDoc.get(key);
  if (!st) { st = {}; saveStateByDoc.set(key, st); }
  const text = JSON.stringify(index, null, 2);
  if (st.last === text) return; // skip identical writes
  st.last = text;
  if (st.timer) clearTimeout(st.timer);
  
  // 立即保存，不使用延迟
  try { 
    fs.writeFileSync(fp, text, 'utf8'); 
  } catch (err) { 
    console.error('Failed to save comment index:', err);
  }
}

// 保存批注元数据
export async function saveCommentMetadata(metadata: CommentMetadata): Promise<void> {
  const fp = metadataFilePathForComment(metadata.id);
  if (!fp) return;
  const key = metadata.id;
  let st = saveStateByComment.get(key);
  if (!st) { st = {}; saveStateByComment.set(key, st); }
  const text = JSON.stringify(metadata, null, 2);
  if (st.last === text) return; // skip identical writes
  st.last = text;
  if (st.timer) clearTimeout(st.timer);
  
  // 立即保存，不使用延迟
  try { 
    fs.writeFileSync(fp, text, 'utf8'); 
  } catch (err) { 
    console.error('Failed to save comment metadata:', err);
  }
}

// 保存批注内容
export async function saveCommentContent(commentId: string, content: string): Promise<void> {
  const fp = contentFilePathForComment(commentId);
  if (!fp) return;
  try {
    fs.writeFileSync(fp, content, 'utf8');
  } catch { /* ignore */ }
}

// 保存注解到md文件
export async function saveCommentToMd(docUuid: string, threadId: string, message: { id: string; author: string; createdAt: number; content: string }): Promise<void> {
  const mdFilePath = mdFilePathForDocument(docUuid);
  if (!mdFilePath) return;
  
  try {
    MdCommentStorage.addOrUpdateMessage(mdFilePath, threadId, message);
  } catch (error) {
    console.error('Failed to save comment to md file:', error);
  }
}

// 从md文件删除注解消息
export async function removeCommentFromMd(docUuid: string, threadId: string, messageId: string): Promise<void> {
  const mdFilePath = mdFilePathForDocument(docUuid);
  if (!mdFilePath) return;
  
  try {
    MdCommentStorage.removeMessage(mdFilePath, threadId, messageId);
  } catch (error) {
    console.error('Failed to remove comment from md file:', error);
  }
}

// 从md文件删除线程的所有条目
export async function removeThreadFromMd(docUuid: string, threadId: string): Promise<void> {
  const mdFilePath = mdFilePathForDocument(docUuid);
  if (!mdFilePath) return;
  
  try {
    MdCommentStorage.removeThread(mdFilePath, threadId);
  } catch (error) {
    console.error('Failed to remove thread from md file:', error);
  }
}

/**
 * 将指定批注线程绑定到新的文档（通过重写 docUuid）
 * - 从旧文档索引移除该线程
 * - 将线程添加到新文档索引
 * - 更新线程元数据中的 docUuid
 * - 将 Markdown 内容从旧文档文件迁移到新文档文件
 */
export async function rebindThreadToDocument(threadId: string, newDocUuid: string): Promise<{ success: boolean; oldDocUuid?: string }>
{
  const metadata = await loadCommentMetadata(threadId);
  if (!metadata) {
    return { success: false };
  }

  const oldDocUuid = metadata.docUuid;
  if (!newDocUuid || oldDocUuid === newDocUuid) {
    return { success: false, oldDocUuid };
  }

  try {
    // 1) 从旧索引移除
    try {
      const oldIndex = await loadCommentIndex(oldDocUuid);
      oldIndex.threadIds = (oldIndex.threadIds || []).filter(id => id !== threadId);
      await saveCommentIndex(oldIndex);
    } catch {/* ignore */}

    // 2) 添加到新索引
    try {
      const newIndex = await loadCommentIndex(newDocUuid);
      const set = new Set(newIndex.threadIds || []);
      set.add(threadId);
      newIndex.docUuid = newDocUuid;
      newIndex.threadIds = Array.from(set);
      await saveCommentIndex(newIndex);
    } catch {/* ignore */}

    // 3) 迁移 MD 内容：先把旧文档中的该线程移除，再把所有消息写入新文档
    try {
      // 移除旧文档中的线程
      await removeThreadFromMd(oldDocUuid, threadId);

      // 写入新文档中的线程所有消息
      const msgs = metadata.messages || [];
      for (const m of msgs) {
        await saveCommentToMd(newDocUuid, threadId, {
          id: m.id || threadId,
          author: m.author || 'Unknown',
          createdAt: m.createdAt || metadata.createdAt,
          content: m.body || ''
        });
      }
    } catch {/* ignore */}

    // 4) 更新元数据中的 docUuid
    metadata.docUuid = newDocUuid;
    metadata.updatedAt = Date.now();
    await saveCommentMetadata(metadata);

    return { success: true, oldDocUuid };
  } catch (err) {
    console.error('rebindThreadToDocument failed:', err);
    return { success: false, oldDocUuid };
  }
}

/**
 * 将某个文档下的全部批注迁移到另一个文档（重写所有线程的 docUuid）
 * - 合并索引：old -> new
 * - 更新所有线程元数据中的 docUuid
 * - 合并/重命名 MD 内容文件
 */
export async function rebindAllThreadsToDocument(oldDocUuid: string, newDocUuid: string): Promise<{ success: boolean; moved: number }>
{
  if (!oldDocUuid || !newDocUuid || oldDocUuid === newDocUuid) {
    return { success: false, moved: 0 };
  }

  try {
    const oldIndex = await loadCommentIndex(oldDocUuid);
    const newIndex = await loadCommentIndex(newDocUuid);

    const oldIds = Array.isArray(oldIndex.threadIds) ? oldIndex.threadIds.slice() : [];
    const newSet = new Set<string>(Array.isArray(newIndex.threadIds) ? newIndex.threadIds : []);

    // 1) 更新每个线程的元数据 docUuid 并保存
    for (const tid of oldIds) {
      const meta = await loadCommentMetadata(tid);
      if (!meta) continue;
      meta.docUuid = newDocUuid;
      meta.updatedAt = Date.now();
      await saveCommentMetadata(meta);
      newSet.add(tid);
    }

    // 2) 保存新/旧索引
    newIndex.docUuid = newDocUuid;
    newIndex.threadIds = Array.from(newSet);
    await saveCommentIndex(newIndex);

    oldIndex.threadIds = [];
    await saveCommentIndex(oldIndex);

    // 3) 合并/转移 MD 文件
    try {
      const oldMd = mdFilePathForDocument(oldDocUuid);
      const newMd = mdFilePathForDocument(newDocUuid);
      if (oldMd && newMd) {
        const oldExists = fs.existsSync(oldMd);
        if (oldExists) {
          const newExists = fs.existsSync(newMd);
          if (!newExists) {
            // 直接重命名迁移（更快）
            try { fs.renameSync(oldMd, newMd); }
            catch {
              // 回退：读写复制
              try {
                const parsed = MdCommentStorage.readMdFile(oldMd);
                MdCommentStorage.writeMdFile(newMd, parsed.preamble, parsed.threads, parsed.otherSections);
                fs.unlinkSync(oldMd);
              } catch {/* ignore */}
            }
          } else {
            // 合并两个文件的线程
            try {
              const oldParsed = MdCommentStorage.readMdFile(oldMd);
              const newParsed = MdCommentStorage.readMdFile(newMd);
              const existing = new Set(newParsed.threads.map(t => t.threadId));
              for (const t of oldParsed.threads) {
                if (!existing.has(t.threadId)) {
                  newParsed.threads.push(t);
                }
              }
              MdCommentStorage.writeMdFile(newMd, newParsed.preamble || oldParsed.preamble, newParsed.threads, newParsed.otherSections);
              try { fs.unlinkSync(oldMd); } catch {/* ignore */}
            } catch {/* ignore */}
          }
        }
      }
    } catch {/* ignore */}

    return { success: true, moved: oldIds.length };
  } catch (err) {
    console.error('rebindAllThreadsToDocument failed:', err);
    return { success: false, moved: 0 };
  }
}

// 支持多个选择范围的addThread函数
export async function addThread(
  doc: vscode.TextDocument, 
  selections: vscode.Selection[], 
  initialBody: string, 
  author: string
): Promise<CommentThreadData | undefined> {
  const docUuid = getDocUuidForDocument(doc);
  if (!docUuid) { 
    vscode.window.showWarningMessage('当前文件尚无 UUID（可能未被追踪）。'); 
    return undefined; 
  }
  
  const fullText = doc.getText();
  const ranges = [];
  const selTexts = [];
  const contexts = [];
  const paras = [];
  
  // 处理多个选择范围
  for (const selection of selections) {
    const beforeCtx = (() => {
      const startOffset = doc.offsetAt(selection.start);
      return fullText.slice(Math.max(0, startOffset - 64), startOffset);
    })();
    const afterCtx = (() => {
      const endOffset = doc.offsetAt(selection.end);
      return fullText.slice(endOffset, Math.min(fullText.length, endOffset + 64));
    })();
    const selText = doc.getText(selection);
    
    ranges.push(vscodeRangeToAnchorRange(new vscode.Range(selection.start, selection.end)));
    selTexts.push(selText);
    contexts.push({ before: beforeCtx, after: afterCtx });
    paras.push(paragraphIndexOfRange(doc, selection));
  }
  
  const now = Date.now();
  const commentId = uuidv4();
  const contentFile = `${commentId}.md`;
  
  // 创建批注元数据
  const metadata: CommentMetadata = {
    version: VERSION,
    id: commentId,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    docUuid,
    anchor: {
      ranges,
      para: paras,
      selTexts,
      contexts
    },
    contentFile,
    messages: [{ id: uuidv4(), author, body: initialBody, createdAt: now }]
  };
  
  // 创建批注线程数据
  const thread: CommentThreadData = {
    id: commentId,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    docUuid,
    anchor: metadata.anchor,
    contentFile,
    messages: metadata.messages
  };
  
  // 保存批注元数据和内容
  await saveCommentMetadata(metadata);
  await saveCommentContent(commentId, initialBody);
  
  // 同时保存到md文件
  await saveCommentToMd(docUuid, commentId, {
    id: commentId,
    author: author,
    createdAt: now,
    content: initialBody
  });
  
  // 更新文档索引
  const index = await loadCommentIndex(docUuid);
  index.threadIds.push(commentId);
  await saveCommentIndex(index);
  
  return thread;
}

// 兼容单选择的addThread函数
export async function addSingleThread(
  doc: vscode.TextDocument, 
  selection: vscode.Selection, 
  initialBody: string, 
  author: string
): Promise<CommentThreadData | undefined> {
  return addThread(doc, [selection], initialBody, author);
}

// 更新批注线程
export async function updateThread(commentId: string, updater: (metadata: CommentMetadata) => void): Promise<CommentMetadata | null> {
  const metadata = await loadCommentMetadata(commentId);
  if (!metadata) return null;
  
  const oldMessages = [...(metadata.messages || [])];
  updater(metadata);
  metadata.updatedAt = Date.now();
  await saveCommentMetadata(metadata);
  
  // 如果消息内容有变化，同时更新md文件
  const newMessages = metadata.messages || [];
  if (newMessages.length > 0 && JSON.stringify(oldMessages) !== JSON.stringify(newMessages)) {
    const latestMessage = newMessages[newMessages.length - 1];
    await saveCommentToMd(metadata.docUuid, commentId, {
      id: latestMessage.id || commentId,
      author: latestMessage.author || 'Unknown',
      createdAt: latestMessage.createdAt || metadata.createdAt,
      content: latestMessage.body || ''
    });
  }
  
  return metadata;
}

// 删除批注
export async function deleteThread(commentId: string): Promise<void> {
  const metadata = await loadCommentMetadata(commentId);
  if (!metadata) return;
  
  // 软删除：标记为已删除而不是物理删除
  metadata.deleted = true;
  metadata.updatedAt = Date.now();
  await saveCommentMetadata(metadata);
  
  // 从md文件中删除注解（保持原有行为）
  await removeThreadFromMd(metadata.docUuid, commentId);
}

// 物理删除已标记删除的批注（垃圾回收）
export async function permanentlyDeleteThread(commentId: string): Promise<void> {
  const metadata = await loadCommentMetadata(commentId);
  if (!metadata || !metadata.deleted) return;
  
  // 从文档索引中移除
  const index = await loadCommentIndex(metadata.docUuid);
  index.threadIds = index.threadIds.filter(id => id !== commentId);
  await saveCommentIndex(index);
  
  // 删除元数据和内容文件
  const metadataPath = metadataFilePathForComment(commentId);
  const contentPath = contentFilePathForComment(commentId);
  
  try {
    if (metadataPath && fs.existsSync(metadataPath)) {
      fs.unlinkSync(metadataPath);
    }
    if (contentPath && fs.existsSync(contentPath)) {
      fs.unlinkSync(contentPath);
    }
  } catch { /* ignore */ }
}

// 垃圾回收：清理所有已标记删除的批注
export async function garbageCollectDeletedComments(docUuid?: string): Promise<{ deletedCount: number; commentIds: string[] }> {
  const deletedComments: string[] = [];
  
  if (docUuid) {
    // 清理指定文档的已删除批注
    const index = await loadCommentIndex(docUuid);
    for (const threadId of index.threadIds) {
      const metadata = await loadCommentMetadata(threadId);
      if (metadata && metadata.deleted) {
        await permanentlyDeleteThread(threadId);
        deletedComments.push(threadId);
      }
    }
  } else {
    // 清理所有文档的已删除批注
    const dataDir = commentsDataDir();
    if (!dataDir || !fs.existsSync(dataDir)) {
      return { deletedCount: 0, commentIds: [] };
    }
    
    const files = fs.readdirSync(dataDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const commentId = file.replace('.json', '');
        const metadata = await loadCommentMetadata(commentId);
        if (metadata && metadata.deleted) {
          await permanentlyDeleteThread(commentId);
          deletedComments.push(commentId);
        }
      }
    }
  }
  
  return { deletedCount: deletedComments.length, commentIds: deletedComments };
}

// 恢复已删除的批注
export async function restoreDeletedThread(commentId: string): Promise<boolean> {
  const metadata = await loadCommentMetadata(commentId);
  if (!metadata || !metadata.deleted) return false;
  
  // 移除删除标记
  metadata.deleted = false;
  metadata.updatedAt = Date.now();
  await saveCommentMetadata(metadata);
  
  return true;
}

// 兼容旧接口的updateThread函数
export async function updateThreadsByDoc(docUuid: string, updater: (threads: CommentThreadData[]) => void): Promise<CommentThreadData[]> {
  const threads = await loadComments(docUuid);
  const oldThreads = JSON.parse(JSON.stringify(threads)); // 深拷贝保存原始状态
  updater(threads);
  
  // 保存所有更新的线程
  for (const thread of threads) {
    const metadata = await loadCommentMetadata(thread.id);
    if (metadata) {
      const oldThread = oldThreads.find((t: CommentThreadData) => t.id === thread.id);
      metadata.status = thread.status;
      metadata.updatedAt = thread.updatedAt;
      metadata.messages = thread.messages || [];
      metadata.anchor = thread.anchor;
      await saveCommentMetadata(metadata);
      
      // 如果消息内容有变化，同时更新md文件
      if (oldThread && JSON.stringify(oldThread.messages) !== JSON.stringify(thread.messages)) {
        // 先删除该线程的所有旧条目
        await removeThreadFromMd(docUuid, thread.id);
        
        const messages = thread.messages || [];
        // 保存所有消息到md文件
        for (const message of messages) {
          await saveCommentToMd(docUuid, thread.id, {
            id: message.id || thread.id,
            author: message.author || 'Unknown',
            createdAt: message.createdAt || thread.createdAt,
            content: message.body || ''
          });
        }
      }
    }
  }
  
  // 更新文档索引
  const index = await loadCommentIndex(docUuid);
  index.threadIds = threads.map(t => t.id);
  await saveCommentIndex(index);
  
  return threads;
}

export function paragraphIndexOfRange(doc: vscode.TextDocument, sel: vscode.Selection): { startIndex: number; endIndex: number } {
  // 简易段落切分：按空行分段
  const lines = new Array<number>();
  for (let i = 0; i < doc.lineCount; i++) lines.push(i);
  const paraBreak = (ln: number) => /^[\s\t]*$/.test(doc.lineAt(ln).text);
  const toParaIdx = (ln: number) => {
    let idx = 0;
    for (let i = 0; i <= ln && i < doc.lineCount; i++) {
      if (i === 0) { idx = 0; continue; }
      if (paraBreak(i - 1)) idx++;
    }
    return idx;
  };
  const s = toParaIdx(sel.start.line);
  const e = toParaIdx(sel.end.line);
  return { startIndex: s, endIndex: e };
}

