/*
 * MD格式注解存储器
 * 实现将注解内容存储到md文档中，多条内容存储在不同的二级标题下面
 */

import * as fs from 'fs';
import * as path from 'path';
import { CommentMessage } from './types';

// MD文件中的注解条目
export interface MdCommentEntry {
  id: string;
  author: string;
  createdAt: number;
  content: string;
}

// MD文件中的注解线程（包含多个消息）
export interface MdCommentThread {
  threadId: string;
  messages: MdCommentEntry[];
}

// MD文件解析结果
export interface MdParseResult {
  // 文档前言部分（第一个二级标题之前的内容）
  preamble: string;
  // 各个注解线程，按二级标题组织
  threads: MdCommentThread[];
  // 其他未识别的二级标题内容（保留原样）
  otherSections: { title: string; content: string }[];
}

/**
 * MD注解存储器
 * 负责解析和写入md格式的注解文件
 */
export class MdCommentStorage {
  
  /**
   * 解析md文件内容
   * @param content md文件内容
   * @returns 解析结果
   */
  static parseMdContent(content: string): MdParseResult {
    const lines = content.split('\n');
    const result: MdParseResult = {
      preamble: '',
      threads: [],
      otherSections: []
    };
    
    let currentSection: 'preamble' | 'thread' | 'other' = 'preamble';
    let currentTitle = '';
    let currentContent: string[] = [];
    let currentThreadId = '';
    let currentThread: MdCommentThread | null = null;
    let currentMessageId = '';
    let currentMessageAuthor = '';
    let currentMessageCreatedAt = 0;
    let currentMessageContent: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // 检测二级标题
      const h2Match = line.match(/^## (.+)$/);
      if (h2Match) {
        // 保存之前的消息内容
        if (currentSection === 'thread' && currentThread && currentMessageId) {
          currentThread.messages.push({
            id: currentMessageId,
            author: currentMessageAuthor,
            createdAt: currentMessageCreatedAt,
            content: currentMessageContent.join('\n').trim()
          });
        }
        
        // 保存之前的线程
        if (currentSection === 'thread' && currentThread) {
          result.threads.push(currentThread);
        }
        
        // 保存之前的内容
        if (currentSection === 'preamble') {
          result.preamble = currentContent.join('\n').trim();
        }
        
        // 开始新的section
        currentTitle = h2Match[1];
        currentContent = [];
        
        // 检查是否是注解线程标题格式: "注解线程 {threadId}" 或直接使用标题作为threadId
        const threadMatch = currentTitle.match(/^注解线程\s+(.+)$/);
        if (threadMatch) {
          currentSection = 'thread';
          currentThreadId = threadMatch[1].trim();
        } else {
          // 将任何二级标题都视为线程，使用标题作为threadId
          currentSection = 'thread';
          currentThreadId = currentTitle;
        }
        
        currentThread = {
          threadId: currentThreadId,
          messages: []
        };
        currentMessageId = '';
        currentMessageAuthor = '';
        currentMessageCreatedAt = 0;
        currentMessageContent = [];
      } else {
        // 检测三级标题（在线程内部）
        const h3Match = line.match(/^### (.+)$/);
        if (h3Match && currentSection === 'thread' && currentThread) {
          // 保存之前的消息
          if (currentMessageId) {
            currentThread.messages.push({
              id: currentMessageId,
              author: currentMessageAuthor,
              createdAt: currentMessageCreatedAt,
              content: currentMessageContent.join('\n').trim()
            });
          }
          
          // 开始新的消息
          const messageTitle = h3Match[1];
          // 检查消息标题格式: "消息 {id} - {author} ({timestamp})" 或直接使用标题作为messageId
          const messageMatch = messageTitle.match(/^消息 ([\w-]+) - (.+) \((\d+)\)$/);
          if (messageMatch) {
            currentMessageId = messageMatch[1];
            currentMessageAuthor = messageMatch[2];
            currentMessageCreatedAt = parseInt(messageMatch[3]);
          } else {
            // 使用标题作为messageId，从后续内容中解析作者和时间
            currentMessageId = messageTitle;
            currentMessageAuthor = 'Unknown';
            currentMessageCreatedAt = Date.now();
          }
          currentMessageContent = [];
        } else {
          // 普通内容行
          if (currentSection === 'thread' && currentMessageId) {
            // 检查是否是作者或时间信息行
            const authorMatch = line.match(/^\*\*作者\*\*:\s*(.+)$/);
            const timeMatch = line.match(/^\*\*时间\*\*:\s*(.+)$/);
            
            if (authorMatch) {
               currentMessageAuthor = authorMatch[1].trim();
            } else if (timeMatch) {
              // 尝试解析时间格式
              const timeStr = timeMatch[1];
              const timestamp = new Date(timeStr).getTime();
              if (!isNaN(timestamp)) {
                currentMessageCreatedAt = timestamp;
              }
            } else if (line.trim() !== '') {
              // 只添加非空行到内容中
              currentMessageContent.push(line);
            }
          } else {
            currentContent.push(line);
          }
        }
      }
    }
    
    // 处理最后的内容
    if (currentSection === 'thread' && currentThread) {
      if (currentMessageId) {
        currentThread.messages.push({
          id: currentMessageId,
          author: currentMessageAuthor,
          createdAt: currentMessageCreatedAt,
          content: currentMessageContent.join('\n').trim()
        });
      }
      result.threads.push(currentThread);
    } else if (currentSection === 'preamble') {
      result.preamble = currentContent.join('\n').trim();
    }
    
    return result;
  }
  
  /**
   * 生成md文件内容
   * @param preamble 前言部分
   * @param entries 注解条目
   * @param otherSections 其他section
   * @returns md文件内容
   */
  static generateMdContent(
    preamble: string,
    threads: MdCommentThread[],
    otherSections: { title: string; content: string }[] = []
  ): string {
    const parts: string[] = [];
    
    // 添加前言
    if (preamble.trim()) {
      parts.push(preamble.trim());
      parts.push(''); // 空行分隔
    }
    
    // 添加注解线程
    for (const thread of threads) {
      // 检查threadId是否已经包含"注解线程"前缀，避免重复
      const threadTitle = thread.threadId.startsWith('注解线程') 
        ? `## ${thread.threadId}` 
        : `## 注解线程 ${thread.threadId}`;
      parts.push(threadTitle);
      parts.push('');
      
      // 添加线程中的消息
      for (const message of thread.messages) {
        const messageTitle = `### 消息 ${message.id} - ${message.author} (${message.createdAt})`;
        parts.push(messageTitle);
        parts.push('');
        if (message.content.trim()) {
          parts.push(message.content.trim());
          parts.push('');
        }
      }
    }
    
    // 添加其他sections
    for (const section of otherSections) {
      parts.push(`## ${section.title}`);
      parts.push('');
      if (section.content.trim()) {
        parts.push(section.content.trim());
        parts.push('');
      }
    }
    
    return parts.join('\n');
  }
  
  /**
   * 从文件读取并解析md内容
   * @param filePath md文件路径
   * @returns 解析结果，如果文件不存在返回空结果
   */
  static readMdFile(filePath: string): MdParseResult {
    if (!fs.existsSync(filePath)) {
      return {
        preamble: '',
        threads: [],
        otherSections: []
      };
    }
    
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return this.parseMdContent(content);
    } catch (error) {
      console.error('Failed to read md file:', error);
      return {
        preamble: '',
        threads: [],
        otherSections: []
      };
    }
  }
  
  /**
   * 写入md文件
   * @param filePath md文件路径
   * @param preamble 前言部分
   * @param entries 注解条目
   * @param otherSections 其他sections
   */
  static writeMdFile(
    filePath: string,
    preamble: string,
    threads: MdCommentThread[],
    otherSections: { title: string; content: string }[] = []
  ): void {
    try {
      // 确保目录存在
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const content = this.generateMdContent(preamble, threads, otherSections);
      fs.writeFileSync(filePath, content, 'utf8');
    } catch (error) {
      console.error('Failed to write md file:', error);
      throw error;
    }
  }
  
  /**
   * 添加或更新注解线程中的消息
   * @param filePath md文件路径
   * @param threadId 线程ID
   * @param message 要添加或更新的消息
   */
  static addOrUpdateMessage(filePath: string, threadId: string, message: MdCommentEntry): void {
    const parsed = this.readMdFile(filePath);
    
    // 如果是新文件且没有preamble，设置默认的一级标题
    if (!parsed.preamble.trim() && parsed.threads.length === 0) {
      parsed.preamble = '# 注解';
    }
    
    // 查找或创建线程
    let thread = parsed.threads.find(t => t.threadId === threadId);
    if (!thread) {
      thread = {
        threadId: threadId,
        messages: []
      };
      parsed.threads.push(thread);
    }
    
    // 查找是否已存在相同id的消息
    const existingIndex = thread.messages.findIndex(m => m.id === message.id);
    
    if (existingIndex >= 0) {
      // 更新现有消息
      thread.messages[existingIndex] = message;
    } else {
      // 添加新消息
      thread.messages.push(message);
    }
    
    // 写回文件
    this.writeMdFile(filePath, parsed.preamble, parsed.threads, parsed.otherSections);
  }
  
  /**
   * 删除注解消息
   * @param filePath md文件路径
   * @param threadId 线程ID
   * @param messageId 要删除的消息ID
   */
  static removeMessage(filePath: string, threadId: string, messageId: string): void {
    const parsed = this.readMdFile(filePath);
    
    // 查找线程
    const thread = parsed.threads.find(t => t.threadId === threadId);
    if (thread) {
      // 删除指定ID的消息
      thread.messages = thread.messages.filter(m => m.id !== messageId);
    }
    
    this.writeMdFile(filePath, parsed.preamble, parsed.threads, parsed.otherSections);
  }
  
  /**
   * 删除特定线程
   * @param filePath md文件路径
   * @param threadId 线程ID
   */
  static removeThread(filePath: string, threadId: string): void {
    const parsed = this.readMdFile(filePath);
    
    // 删除指定的线程
    parsed.threads = parsed.threads.filter(t => t.threadId !== threadId);
    
    this.writeMdFile(filePath, parsed.preamble, parsed.threads, parsed.otherSections);
  }
  
  /**
   * 从CommentMessage数组转换为MdCommentThread
   * @param threadId 线程ID
   * @param messages CommentMessage数组
   * @returns MdCommentThread
   */
  static fromCommentMessages(threadId: string, messages: CommentMessage[]): MdCommentThread {
    return {
      threadId: threadId,
      messages: messages.map(msg => ({
        id: msg.id,
        author: msg.author,
        createdAt: msg.createdAt,
        content: msg.body
      }))
    };
  }
  
  /**
   * 从MdCommentThread转换为CommentMessage数组
   * @param thread MdCommentThread
   * @returns CommentMessage数组
   */
  static toCommentMessages(thread: MdCommentThread): CommentMessage[] {
    return thread.messages.map(message => ({
      id: message.id,
      author: message.author,
      body: message.content,
      createdAt: message.createdAt
    }));
  }
  
  /**
   * 添加或更新整个线程
   * @param filePath md文件路径
   * @param thread 要添加或更新的线程
   */
  static addOrUpdateThread(filePath: string, thread: MdCommentThread): void {
    const parsed = this.readMdFile(filePath);
    
    // 查找是否已存在相同threadId的线程
    const existingIndex = parsed.threads.findIndex(t => t.threadId === thread.threadId);
    
    if (existingIndex >= 0) {
      // 更新现有线程
      parsed.threads[existingIndex] = thread;
    } else {
      // 添加新线程
      parsed.threads.push(thread);
    }
    
    // 写回文件
    this.writeMdFile(filePath, parsed.preamble, parsed.threads, parsed.otherSections);
  }
}