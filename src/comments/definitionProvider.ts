import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
// import { findDefinitionInFile } from '../Provider/defProv';
// import { roles } from '../activate';
// import { loadCommentContent } from './storage';
import { CommentThreadData } from './types';
import { hoverRangesMap } from '../Provider/hoverProvider';
import { getFileUuid } from '../utils/tracker/globalFileTracking';

/**
 * 批注定义跳转提供器
 * 在批注内容中识别角色名，提供跳转到角色定义的功能
 */
export class CommentDefinitionProvider implements vscode.DefinitionProvider {
  private threadsByDoc = new Map<string, CommentThreadData[]>();

  constructor() {
    // 监听角色数据变化
    vscode.workspace.onDidChangeTextDocument(this.onDocumentChange, this);
  }

  updateThreads(docUri: string, threads: CommentThreadData[]) {
    this.threadsByDoc.set(docUri, threads);
  }

  private onDocumentChange(event: vscode.TextDocumentChangeEvent) {
    // 当文档内容变化时，可以考虑更新缓存
    // 这里暂时不做处理，因为批注内容是独立存储的
  }

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Definition | undefined> {
    console.log('CommentDefinitionProvider: provideDefinition called', {
      uri: document.uri.toString(),
      position: { line: position.line, character: position.character }
    });
    
    const docUri = document.uri.toString();
    const threads = this.threadsByDoc.get(docUri);
    
    console.log('CommentDefinitionProvider: threads found', threads?.length || 0);
    
    if (!threads || threads.length === 0) {
      console.log('CommentDefinitionProvider: no threads found');
      return undefined;
    }

    // 查找当前位置的线程
    const currentThread = this.findThreadAtPosition(threads, position);
    console.log('CommentDefinitionProvider: thread at position', currentThread?.id || 'none');
    if (!currentThread) {
      console.log('CommentDefinitionProvider: no thread at current position');
      return undefined;
    }

    // 若当前位置命中了角色名（由 hoverRangesMap 提供），交给角色的 DefinitionProvider 处理
    // 这样可以在批注文本中对角色名使用与正文一致的跳转逻辑
    {
      try {
        const hits = hoverRangesMap.get(docUri) || [];
        const roleHit = hits.find(h => h.range.contains(position));
        if (roleHit) {
          return undefined; // 让角色 defProv 接管
        }
      } catch {
        // 忽略任何异常，继续处理批注跳转
      }
    }

    // 获取文档UUID
    const docUuid = await this.getDocUuidFromUri(docUri);
    console.log('CommentDefinitionProvider: docUuid', docUuid);
    if (!docUuid) {
      console.log('CommentDefinitionProvider: no docUuid found');
      return undefined;
    }

    // 构建MD文件路径
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      console.log('CommentDefinitionProvider: no workspace root');
      return undefined;
    }

    const mdFilePath = path.join(root, 'novel-helper', 'comments', 'content', `${docUuid}.md`);
    console.log('CommentDefinitionProvider: mdFilePath', mdFilePath);
    
    // 检查MD文件是否存在
    try {
      if (!fs.existsSync(mdFilePath)) {
        console.log('CommentDefinitionProvider: MD file does not exist');
        return undefined;
      }
    } catch (error) {
      console.log('CommentDefinitionProvider: error checking MD file', error);
      return undefined;
    }

    // 读取MD文件内容并查找对应线程的位置
    try {
      const mdContent = fs.readFileSync(mdFilePath, 'utf8');
      console.log('CommentDefinitionProvider: MD content length', mdContent.length);
      const threadPosition = this.findThreadPositionInMd(mdContent, currentThread.id);
      console.log('CommentDefinitionProvider: thread position in MD', threadPosition);
      
      if (threadPosition !== undefined) {
        const mdUri = vscode.Uri.file(mdFilePath);
        const targetPosition = new vscode.Position(threadPosition, 0);
        console.log('CommentDefinitionProvider: returning location', { file: mdFilePath, line: threadPosition });
        return new vscode.Location(mdUri, targetPosition);
      } else {
        console.log('CommentDefinitionProvider: thread not found in MD file');
      }
    } catch (error) {
      console.error('CommentDefinitionProvider: Error reading MD file:', error);
    }

    console.log('CommentDefinitionProvider: returning undefined');
    return undefined;
  }

  private findThreadAtPosition(threads: CommentThreadData[], position: vscode.Position): CommentThreadData | undefined {
    for (const thread of threads) {
      // 检查位置是否在任何一个范围内
      for (const range of thread.anchor.ranges) {
        const vscodeRange = new vscode.Range(
          new vscode.Position(range.start.line, range.start.ch),
          new vscode.Position(range.end.line, range.end.ch)
        );
        if (vscodeRange.contains(position)) {
          return thread;
        }
      }
    }
    return undefined;
  }

  private async getDocUuidFromUri(docUri: string): Promise<string | undefined> {
    try {
      const uri = vscode.Uri.parse(docUri);
      return await getFileUuid(uri.fsPath);
    } catch {
      return undefined;
    }
  }

  private findThreadPositionInMd(mdContent: string, threadId: string): number | undefined {
    const lines = mdContent.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // 查找线程标题行，格式为 "## 注解线程 {threadId}" 或 "## {threadId}"
      if (line.startsWith('## ')) {
        const titleContent = line.substring(3).trim();
        
        // 检查是否匹配当前线程ID
        if (titleContent === `注解线程 ${threadId}` || titleContent === threadId) {
          return i;
        }
        
        // 处理可能包含"注解线程"前缀的情况
        if (titleContent.startsWith('注解线程 ')) {
          const extractedId = titleContent.substring('注解线程 '.length).trim();
          if (extractedId === threadId) {
            return i;
          }
        }
      }
    }
    
    return undefined;
  }
}

/**
 * 注册批注定义跳转提供器
 */
export function registerCommentDefinitionProvider(context: vscode.ExtensionContext): CommentDefinitionProvider {
  const provider = new CommentDefinitionProvider();
  
  const disposable = vscode.languages.registerDefinitionProvider(
    { scheme: 'file' },
    provider
  );
  
  context.subscriptions.push(disposable);
  return provider;
}