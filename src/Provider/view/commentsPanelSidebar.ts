import * as vscode from 'vscode';
import { CommentsController } from '../../comments/controller';

export class CommentsPanelSidebarProvider implements vscode.WebviewViewProvider {
  constructor(private readonly controller: CommentsController) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
    return this.controller.attachSidebarView(webviewView);
  }
}
