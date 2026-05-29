/**
 * 批量导出 Webview 面板
 * 以树形结构展示工作区中的章节文件，支持多选后批量导出。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { setWebviewPanelIcon } from '../Provider/utils/webviewPanelIcon';
import { compareNames } from '../utils/Order/sorter';
import { ensureBuildTempBase } from '../typst/tempPaths';
import { renderFromTemplate, compileTypstWithLog } from '../typst/exportService';
import { templateRegistry } from '../typst/templateRegistry';
import { parseMarkdownDoc, firstH1, firstHeading, Block } from '../typst/mdParser';
import { scriptExtensionRegistry } from '../mcp/scriptExtensions';
import { getObsidianInlineRenderOptions } from '../utils/obsidianInlineConfig';

const VIEW_TYPE = 'andrea.batchExport';
let currentPanel: vscode.WebviewPanel | undefined;
let extensionPath = '';

// ========== 文件树构建 ==========

interface FileNode {
    name: string;
    relPath: string;
    isDir: boolean;
    children?: FileNode[];
}

function buildFileTree(dir: string, baseDir: string): FileNode[] {
    const nodes: FileNode[] = [];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return nodes;
    }
    // 忽略的目录
    const ignoreDirs = new Set([
        'node_modules', '.git', '.vscode', '.anh-fsdb',
        'novel-helper', 'target', 'dist', 'out', '.history',
    ]);
    // 忽略的文件模式
    const ignoreExts = new Set(['.json5', '.json', '.toml', '.rjson5', '.rjson', '.tjson5', '.ojson5']);

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(baseDir, fullPath);

        if (entry.isDirectory()) {
            if (ignoreDirs.has(entry.name)) continue;
            const children = buildFileTree(fullPath, baseDir);
            if (children.length > 0) {
                nodes.push({ name: entry.name, relPath, isDir: true, children });
            }
        } else {
            const ext = path.extname(entry.name).toLowerCase();
            if (ignoreExts.has(ext)) continue;
            if (ext === '.md' || ext === '.txt') {
                nodes.push({ name: entry.name, relPath, isDir: false });
            }
        }
    }
    // 排序：与写作资源管理器一致（目录在前，章节号/中文数字/版本号感知排序）
    nodes.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return compareNames(a.name, b.name);
    });
    return nodes;
}

// ========== 面板管理 ==========

export function registerBatchExport(context: vscode.ExtensionContext): void {
    extensionPath = context.extensionPath;

    context.subscriptions.push(
        vscode.commands.registerCommand('andrea.batchExport.open', () => {
            showBatchExportPanel(context);
        })
    );
}

function showBatchExportPanel(context: vscode.ExtensionContext): void {
    if (currentPanel) {
        currentPanel.reveal(vscode.ViewColumn.Active);
        sendFileTree(currentPanel);
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        VIEW_TYPE,
        '批量导出',
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.file(extensionPath),
            ],
        }
    );
    currentPanel = panel;
    setWebviewPanelIcon(panel, extensionPath, 'export');

    panel.webview.html = getPanelHtml(panel.webview);

    // 文件监视：自动刷新树
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{md,txt}');
    watcher.onDidCreate(() => sendFileTree(panel));
    watcher.onDidDelete(() => sendFileTree(panel));
    watcher.onDidChange(() => { /* 内容变化不需要刷新树 */ });
    panel.onDidDispose(() => watcher.dispose());

    // 监视工作区文件夹变化
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        for (const folder of workspaceFolders) {
            const folderWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(folder, '**/*.{md,txt}')
            );
            folderWatcher.onDidCreate(() => sendFileTree(panel));
            folderWatcher.onDidDelete(() => sendFileTree(panel));
            panel.onDidDispose(() => folderWatcher.dispose());
        }
    }

    // 消息处理
    panel.webview.onDidReceiveMessage(async (msg) => {
        try {
            switch (msg.command) {
                case 'batchExport.ready':
                    sendFileTree(panel);
                    sendTemplateList(panel);
                    break;
                case 'batchExport.execute':
                    await handleBatchExport(msg.files, msg.format, msg.template, msg.outputDir, msg.keepStructure !== false);
                    break;
                case 'batchExport.pickDir': {
                    const picked = await vscode.window.showOpenDialog({
                        canSelectFolders: true,
                        canSelectFiles: false,
                        canSelectMany: false,
                        title: '选择导出目录',
                    });
                    if (picked && picked.length > 0) {
                        panel.webview.postMessage({
                            command: 'batchExport.dirPicked',
                            dir: picked[0].fsPath,
                        });
                    }
                    break;
                }
            }
        } catch (err) {
            const text = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`批量导出失败: ${text}`);
        }
    });

    panel.onDidDispose(() => {
        currentPanel = undefined;
        watcher.dispose();
    });
}

function sendFileTree(panel: vscode.WebviewPanel): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
        panel.webview.postMessage({ command: 'batchExport.fileTree', tree: [] });
        return;
    }
    const allTrees: FileNode[] = [];
    for (const folder of folders) {
        const tree = buildFileTree(folder.uri.fsPath, folder.uri.fsPath);
        allTrees.push(...tree);
    }
    panel.webview.postMessage({ command: 'batchExport.fileTree', tree: allTrees });
}

function sendTemplateList(panel: vscode.WebviewPanel): void {
    const templates = templateRegistry.list().map(t => t.name);
    panel.webview.postMessage({ command: 'batchExport.templates', templates });
}

// ========== 批量导出执行 ==========

async function handleBatchExport(
    files: string[],
    format: 'pdf' | 'png' | 'svg' | 'html' | 'txt',
    templateName: string,
    outputDir?: string,
    keepStructure: boolean = true
): Promise<void> {
    if (!files || files.length === 0) {
        vscode.window.showWarningMessage('请至少选择一个文件进行导出。');
        return;
    }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return;

    const cfg = vscode.workspace.getConfiguration('andrea.typst');
    const cliPath = cfg.get<string>('cliPath', 'typst');
    const templatesDir = cfg.get<string>('templatesDir') || path.join(folders[0].uri.fsPath, 'templates', 'typst');
    const ppi = cfg.get<number>('output.ppi', 144);
    const pages = cfg.get<string>('pages', '');
    const fontPaths = cfg.get<string[]>('font.paths', []);

    // 如果没指定输出目录，让用户选
    if (!outputDir) {
        const picked = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            title: '选择导出目录',
        });
        if (!picked || picked.length === 0) return;
        outputDir = picked[0].fsPath;
    }

    const channel = vscode.window.createOutputChannel('ANH: 批量导出');
    channel.show(true);
    channel.appendLine(`批量导出: ${files.length} 个文件 -> ${outputDir}`);
    channel.appendLine(`格式: ${format}, 模板: ${templateName}`);
    channel.appendLine('---');

    const baseDir = folders[0].uri.fsPath;
    const rendererId = cfg.get<string>('defaultRenderer', 'internal');
    const isExternalRenderer = rendererId && rendererId !== 'internal' && rendererId !== 'liquid';

    let success = 0;
    let failed = 0;

    for (const relPath of files) {
        const absPath = path.join(baseDir, relPath);
        try {
            if (!fs.existsSync(absPath)) {
                channel.appendLine(`[跳过] ${relPath} - 文件不存在`);
                failed++;
                continue;
            }

            const md = fs.readFileSync(absPath, 'utf8');
            const docUri = vscode.Uri.file(absPath);
            const docParsed = parseMarkdownDoc(md, getObsidianInlineRenderOptions(docUri));
            const ctx = { meta: docParsed.meta, blocks: docParsed.blocks as Block[] };
            const filename = path.basename(absPath).replace(/\.[^.]+$/, '');
            const h1 = firstH1(ctx.blocks);

            if (ctx.meta.defTitle) {
                ctx.meta.title = ctx.meta.defTitle;
            } else {
                ctx.meta.title = h1?.text || filename;
            }
            (ctx.meta as any).filename = filename;
            (ctx.meta as any).doc_dir = path.dirname(absPath);
            (ctx.meta as any).auto_time = new Date().toLocaleString();

            // 计算输出路径：保留目录结构时在输出目录下创建子目录
            const relDir = path.dirname(relPath);
            const outSubDir = keepStructure && relDir !== '.' ? path.join(outputDir, relDir) : outputDir;
            if (!fs.existsSync(outSubDir)) {
                fs.mkdirSync(outSubDir, { recursive: true });
            }

            const tmpBase = ensureBuildTempBase();
            const tmpDir = fs.mkdtempSync(path.join(tmpBase, 'batch-'));
            (ctx.meta as any).assets_dir = path.join(tmpDir, 'assets');

            if (format === 'txt') {
                // 纯文本导出：直接写入
                const plainText = docParsed.blocks
                    .map((b: any) => (typeof b === 'object' && b !== null && 'text' in b) ? b.text : '')
                    .filter(Boolean)
                    .join('\n\n');
                const outPath = path.join(outSubDir, `${filename}.txt`);
                fs.writeFileSync(outPath, plainText, 'utf8');
                channel.appendLine(`[✓] ${relPath} -> ${filename}.txt`);
                success++;
            } else {
                // Typst 导出
                let typ: string;
                if (!isExternalRenderer || scriptExtensionRegistry.getTypstRendererTemplateMode(rendererId) !== 'none') {
                    typ = await renderFromTemplate(templateName, templatesDir, ctx, channel);
                } else {
                    // 外部渲染器自行处理
                    typ = '';
                    channel.appendLine(`[跳过模板] 外部渲染器 ${rendererId} 自行处理`);
                }

                const typPath = path.join(tmpDir, 'doc.typ');
                fs.writeFileSync(typPath, typ, 'utf8');

                const outPath = path.join(outSubDir, `${filename}.${format}`);
                const outUri = vscode.Uri.file(outPath);
                await compileTypstWithLog(cliPath, typPath, outUri, { format, ppi, pages, fontPaths }, channel);
                channel.appendLine(`[✓] ${relPath} -> ${filename}.${format}`);
                success++;
            }
        } catch (err) {
            const text = err instanceof Error ? err.message : String(err);
            channel.appendLine(`[✗] ${relPath} - ${text}`);
            failed++;
        }
    }

    channel.appendLine('---');
    channel.appendLine(`批量导出完成: ${success} 成功, ${failed} 失败`);
    vscode.window.showInformationMessage(`批量导出完成: ${success} 成功, ${failed} 失败`);
}

// ========== Webview HTML ==========

function getPanelHtml(webview: vscode.Webview): string {
    const nonce = generateNonce();
    const csp = webview.cspSource;
    const htmlPath = path.join(extensionPath, 'media', 'batch-export.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace(/__CSP_SOURCE__/g, csp).replace(/__NONCE__/g, nonce);
    return html;
}

function generateNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}

