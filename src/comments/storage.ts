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
    const u = getFileUuid(doc.uri.fsPath);
    return u || undefined;
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
    if (metadata) {
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
  
  // 从文档索引中移除
  const index = await loadCommentIndex(metadata.docUuid);
  index.threadIds = index.threadIds.filter(id => id !== commentId);
  await saveCommentIndex(index);
  
  // 从md文件中删除注解
  // 删除整个线程从md文件
  await removeThreadFromMd(metadata.docUuid, commentId);
  
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

