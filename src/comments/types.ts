/*
 * @Author: AndreaFrederica andreafrederica@outlook.com
 * @Date: 2025-09-12 07:34:04
 * @LastEditors: AndreaFrederica andreafrederica@outlook.com
 * @LastEditTime: 2025-09-12 09:26:34
 * @FilePath: \andrea-novel-helper\src\comments\types.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import * as vscode from 'vscode';

export type CommentStatus = 'open' | 'resolved';

export interface CommentMessage {
  id: string;
  author: string;
  body: string;
  createdAt: number; // epoch ms
}

// 支持多行范围的锚点
export interface CommentAnchor {
  // 支持多个范围，实现多对一关系
  ranges: { start: { line: number; ch: number }; end: { line: number; ch: number } }[];
  // Paragraph helper indices (best-effort)
  para?: { startIndex: number; endIndex: number }[];
  // Raw selected text at creation time (用于精确重定位)
  selTexts: string[];
  // Context window around selection for fuzzy rebind
  contexts: { before: string; after: string }[];
}

// 新的批注数据结构，支持独立文件存储
export interface CommentThreadData {
  id: string;
  status: CommentStatus;
  createdAt: number;
  updatedAt: number;
  docUuid: string; // 关联的文档UUID
  anchor: CommentAnchor;
  // 批注内容现在存储在独立的MD文件中
  contentFile: string; // MD文件的相对路径
  messages: CommentMessage[];
}

// 文档级别的批注索引
export interface CommentDocumentIndex {
  version: string;
  docUuid: string;
  threadIds: string[]; // 该文档关联的批注ID列表
}

// 独立的批注元数据文件
export interface CommentMetadata {
  version: string;
  id: string;
  status: CommentStatus;
  createdAt: number;
  updatedAt: number;
  docUuid: string;
  anchor: CommentAnchor;
  contentFile: string; // 对应的MD文件名
  messages: CommentMessage[];
}

export function rangeToVSCodeRange(r: { start: { line: number; ch: number }; end: { line: number; ch: number } }): vscode.Range {
  return new vscode.Range(new vscode.Position(r.start.line, r.start.ch), new vscode.Position(r.end.line, r.end.ch));
}

export function vscodeRangeToAnchorRange(r: vscode.Range): CommentAnchor['ranges'][0] {
  return {
    start: { line: r.start.line, ch: r.start.character },
    end: { line: r.end.line, ch: r.end.character },
  };
}

