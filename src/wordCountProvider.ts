/* eslint-disable curly */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { countAndAnalyze, countWordsMixed, getSupportedExtensions, mergeStats, readTextFileDetectEncoding, TextStats } from './utils';

export class WordCountProvider implements vscode.TreeDataProvider<WordCountItem> {
    private _onDidChange = new vscode.EventEmitter<WordCountItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChange.event;
    private itemsById = new Map<string, WordCountItem>();

    constructor() {
        vscode.workspace.onDidSaveTextDocument(() => this.refresh());
        vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh());
    }
    refresh() { this._onDidChange.fire(undefined); }

    getTreeItem(item: WordCountItem): vscode.TreeItem {
        return item;
    }

    async getChildren(element?: WordCountItem): Promise<WordCountItem[]> {
        const root = element
            ? element.resourceUri.fsPath
            : vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (!root) return [];

        const exts = getSupportedExtensions(); // e.g. ['md','txt','json']

        const dirents = await fs.promises.readdir(root, { withFileTypes: true });
        const items: WordCountItem[] = [];

        for (const d of dirents) {
            const uri = vscode.Uri.file(path.join(root, d.name));
            let item: WordCountItem;

            if (d.isDirectory()) {
                const stats = await this.analyzeFolder(uri.fsPath, exts);
                if (stats.total === 0) continue;
                item = new WordCountItem(uri, d.name, stats, vscode.TreeItemCollapsibleState.Collapsed);
            } else {
                // —— 一定要把文件当“叶子节点” —— 
                const ext = path.extname(d.name).slice(1).toLowerCase();
                if (!exts.includes(ext)) continue;
                const stats = await countAndAnalyze(uri.fsPath);
                // 这里改为 None！
                item = new WordCountItem(uri, d.name, stats, vscode.TreeItemCollapsibleState.None);
            }

            // —— 公共：给每个节点都注册 id 并缓存 —— 
            item.id = uri.fsPath;
            this.itemsById.set(item.id, item);

            items.push(item);
        }

        // 可选：文件夹在前，文件按名称排序
        items.sort((a, b) => {
            const aDir = a.collapsibleState !== vscode.TreeItemCollapsibleState.None;
            const bDir = b.collapsibleState !== vscode.TreeItemCollapsibleState.None;
            if (aDir !== bDir) return aDir ? -1 : 1;
            return a.label.localeCompare(b.label, 'zh');
        });

        return items;
    }


    /**
   * 递归分析一个文件夹下所有匹配文件，聚合 TextStats
   */
    private async analyzeFolder(folder: string, exts: string[]): Promise<TextStats> {
        let agg: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: 0 };
        const dirents = await fs.promises.readdir(folder, { withFileTypes: true });

        for (const d of dirents) {
            const full = path.join(folder, d.name);
            if (d.isDirectory()) {
                const child = await this.analyzeFolder(full, exts);
                agg = mergeStats(agg, child);
            } else {
                const ext = path.extname(d.name).slice(1).toLowerCase();
                if (!exts.includes(ext)) continue;
                const stats = await countAndAnalyze(full);
                agg = mergeStats(agg, stats);
            }
        }
        return agg;
    }

    /** 通过路径拿到真实的 TreeItem */
    public getItemById(id: string): WordCountItem | undefined {
        return this.itemsById.get(id);
    }

    public getParent(element: WordCountItem): WordCountItem | undefined {
        const parentPath = path.dirname(element.resourceUri.fsPath);
        return this.itemsById.get(parentPath);
    }
}

export class WordCountItem extends vscode.TreeItem {
    constructor(
        public readonly resourceUri: vscode.Uri,
        public readonly label: string,
        private readonly stats: TextStats,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);

        this.resourceUri = resourceUri;
        this.description = `(${stats.total})`;  //? 总字数
        // wordCountProvider.ts, inside WordCountItem constructor:
        this.id = this.resourceUri.fsPath;  // Must be unique and stable per item

        // **这里**构造一个 MarkdownString 让它变成悬停提示
        const tip = new vscode.MarkdownString();
        tip.appendMarkdown(`**路径**: \`${resourceUri.fsPath}\``);
        tip.appendMarkdown(`\n\n中文字符数: **${stats.cjkChars}**`);
        tip.appendMarkdown(`\n\n英文单词数: **${stats.words}**`);
        tip.appendMarkdown(`\n\n非 ASCII 字符数: **${stats.asciiChars}**`);
        tip.appendMarkdown(`\n\n非空白字符数: **${stats.nonWSChars}**`);
        tip.appendMarkdown(`\n\n**总字数**: **${stats.total}**`);
        tip.isTrusted = true;
        this.tooltip = tip;

        // 保持文件点击打开
        if (collapsibleState === vscode.TreeItemCollapsibleState.None) {
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [resourceUri]
            };
        }
    }
}