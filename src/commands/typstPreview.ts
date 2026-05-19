/* eslint-disable semi */
import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { templateRegistry } from '../typst/templateRegistry'
import { parseMarkdownDoc, firstH1, firstHeading } from '../typst/mdParser'
import { renderFromTemplate, getTypstFS } from '../typst/exportService'
import { TypstMemoryProvider } from '../Provider/fileSystem/TypstMemoryProvider'
import { TypstPreviewStatusBar } from '../Provider/typstPreviewStatusBar'
import { ensureBuildTempBase } from '../typst/tempPaths'
import { scriptExtensionRegistry } from '../mcp/scriptExtensions'

/**
 * 全局状态栏管理器
 */
let typstPreviewStatusBar: TypstPreviewStatusBar | undefined

export function setTypstPreviewStatusBar(statusBar: TypstPreviewStatusBar): void {
    typstPreviewStatusBar = statusBar
}

export function getTypstPreviewStatusBar(): TypstPreviewStatusBar | undefined {
    return typstPreviewStatusBar
}
/**
 * 打开Typst实时预览
 * 直接从当前编辑的Markdown文档生成Typst内容并显示预览
 */
export async function openTypstPreview(typstFS: TypstMemoryProvider | undefined, log: (msg: string, err?: any) => void) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('没有打开的编辑器');
        return;
    }
    
    const doc = editor.document;
    // 只处理markdown和plaintext文档
    if (doc.languageId !== 'markdown' && doc.languageId !== 'plaintext') {
        vscode.window.showErrorMessage('仅支持Markdown或纯文本文档');
        return;
    }
    
    // 生成Typst内容
    try {
        const cfg = vscode.workspace.getConfiguration('andrea.typst');
        const templatesDir = cfg.get<string>('templatesDir') || 
            path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', 'templates', 'typst');
        const defaultTemplate = cfg.get<string>('defaultTemplate') || 'sample';
        const storage = cfg.get<'memory' | 'file'>('preview.storage') || 'memory';
        
        // 让用户选择模板
        let selectedTemplate = defaultTemplate;
        const templates = templateRegistry.list();
        const defaultRenderer = cfg.get<string>('defaultRenderer') || 'internal';
        const isExternalRenderer = defaultRenderer && defaultRenderer !== 'internal' && defaultRenderer !== 'liquid';
        const needsTemplate = !isExternalRenderer || scriptExtensionRegistry.getTypstRendererTemplateMode(defaultRenderer) !== 'none';
        if (needsTemplate && templates.length > 1) {
            const picks = templates.map(t => ({
                label: t.name,
                description: t.root,
                value: t.name
            }));
            const selected = await vscode.window.showQuickPick(picks, {
                placeHolder: '选择Typst模板',
                canPickMany: false
            });
            if (!selected) { return; } // 用户取消了选择
            selectedTemplate = selected.value;
        } else if (needsTemplate && templates.length === 1) {
            selectedTemplate = templates[0].name;
        }
        
        const md = doc.getText();
        const docParsed = parseMarkdownDoc(md);
        const blocks = docParsed.blocks as any[];
        
        const h1 = firstH1(blocks);
        const anyHeading = firstHeading(blocks);
        const filename = path.basename(doc.uri.fsPath).replace(/\.[^\.]+$/, '');
        
        let title = docParsed.meta.defTitle || '';
        if (!title) {
            title = h1?.text || anyHeading?.text || filename;
        }
        
        const ctx = {
            meta: {
                title,
                subtitle: docParsed.meta.subtitle,
                category: docParsed.meta.category,
                filename,
                doc_dir: path.dirname(doc.uri.fsPath),
                auto_time: new Date().toLocaleString(),
                main_title_text: h1?.text,
                main_title_level: h1 ? 1 : undefined
            },
            blocks
        };
        
        let previewUri: vscode.Uri;
        let tempAssetsDir: string | undefined;
        
        if (storage === 'file') {
            // 使用文件存储模式
            const tempDirConfig = cfg.get<string>('preview.tempDir') || '${workspaceFolder}/build/typst/preview';
            const tempDir = tempDirConfig.replace('${workspaceFolder}', vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '');
            
            try {
                fs.mkdirSync(tempDir, { recursive: true });
            } catch (err) {
                vscode.window.showErrorMessage(`创建临时目录失败: ${tempDir}`);
                throw err;
            }
            
            // 在预览文件目录下创建assets子目录
            tempAssetsDir = path.join(tempDir, 'assets');
            try {
                fs.mkdirSync(tempAssetsDir, { recursive: true });
            } catch (err) {
                log(`创建assets目录失败: ${err}`, err);
            }
            
            const filePath = path.join(tempDir, `${filename}.typ`);
            
            // 设置assets目录到上下文中
            (ctx.meta as any).assets_dir = tempAssetsDir;
            
            const typ = await renderFromTemplate(selectedTemplate, templatesDir, ctx);
            if (!typ || typ.trim().length === 0) {
                vscode.window.showErrorMessage('Typst渲染失败：内容为空');
                return;
            }
            
            fs.writeFileSync(filePath, typ, 'utf8');
            previewUri = vscode.Uri.file(filePath);
            log(`写入Typst预览文件: ${filePath}`);
        } else {
            // 使用内存盘存储模式
            if (!typstFS) {
                vscode.window.showErrorMessage('Typst内存盘未初始化');
                return;
            }
            
            // 在默认临时目录下创建assets目录
            try {
                const tmpBase = ensureBuildTempBase();
                const tmpDir = fs.mkdtempSync(path.join(tmpBase, 'preview-tmp-'));
                tempAssetsDir = path.join(tmpDir, 'assets');
                fs.mkdirSync(tempAssetsDir, { recursive: true });
                (ctx.meta as any).assets_dir = tempAssetsDir;
            } catch (err) {
                log(`创建临时assets目录失败: ${err}`, err);
            }
            
            const typ = await renderFromTemplate(selectedTemplate, templatesDir, ctx);
            if (!typ || typ.trim().length === 0) {
                vscode.window.showErrorMessage('Typst渲染失败：内容为空');
                return;
            }
            
            previewUri = typstFS.mapDocumentToMemory(doc.uri, typ);
            log(`映射Typst到内存盘: ${previewUri.toString()}`);
        }
        
        // 记录文档到预览URI的映射（包括使用的模板）
        documentPreviewMap.set(doc.uri.fsPath, { uri: previewUri, storage, assetsDir: tempAssetsDir, template: selectedTemplate });
        
        // 更新状态栏
        const statusBar = getTypstPreviewStatusBar();
        if (statusBar) {
            statusBar.markPreviewEnabled(doc.uri.fsPath, selectedTemplate);
        }
        
        // 在新列打开预览文件
        await vscode.window.showTextDocument(previewUri, { viewColumn: vscode.ViewColumn.Beside, preview: false });
        log(`打开Typst预览: ${previewUri.toString()}`);
    } catch (err) {
        vscode.window.showErrorMessage(`打开Typst预览失败: ${err instanceof Error ? err.message : String(err)}`);
        log(`打开Typst预览失败`, err);
    }
}

/**
 * 追踪文档到预览URI的映射
 */
const documentPreviewMap = new Map<string, { uri: vscode.Uri; storage: 'memory' | 'file'; assetsDir?: string; template: string }>();

/**
 * 创建文档变更监听器，自动更新Typst预览
 */
export function createOnChangeTypstPreview(typstFS: TypstMemoryProvider | undefined, log: (msg: string, err?: any) => void) {
    return async (event: vscode.TextDocumentChangeEvent) => {
        const doc = event.document;
        // 只处理markdown和plaintext文档
        if (doc.languageId !== 'markdown' && doc.languageId !== 'plaintext') { return; }
        
        // 检查该文档是否有预览文件
        const previewInfo = documentPreviewMap.get(doc.uri.fsPath);
        if (!previewInfo) { return; }
        
        // 延迟更新以避免频繁重新渲染（节流）
        const updateKey = `typst-update-${doc.uri.fsPath}`;
        const existingTimeout = (globalThis as any)[updateKey];
        if (existingTimeout) { clearTimeout(existingTimeout); }
        
        (globalThis as any)[updateKey] = setTimeout(async () => {
            try {
                const cfg = vscode.workspace.getConfiguration('andrea.typst');
                const templatesDir = cfg.get<string>('templatesDir') || 
                    path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', 'templates', 'typst');
                const defaultTemplate = cfg.get<string>('defaultTemplate') || 'sample';
                
                const md = doc.getText();
                const docParsed = parseMarkdownDoc(md);
                const blocks = docParsed.blocks as any[];
                
                const h1 = firstH1(blocks);
                const anyHeading = firstHeading(blocks);
                const filename = path.basename(doc.uri.fsPath).replace(/\.[^\.]+$/, '');
                
                let title = docParsed.meta.defTitle || '';
                if (!title) {
                    title = h1?.text || anyHeading?.text || filename;
                }
                
                const ctx = {
                    meta: {
                        title,
                        subtitle: docParsed.meta.subtitle,
                        category: docParsed.meta.category,
                        filename,
                        doc_dir: path.dirname(doc.uri.fsPath),
                        auto_time: new Date().toLocaleString(),
                        main_title_text: h1?.text,
                        main_title_level: h1 ? 1 : undefined
                    },
                    blocks
                };
                
                // 使用预览时保存的assets目录
                if (previewInfo.assetsDir) {
                    (ctx.meta as any).assets_dir = previewInfo.assetsDir;
                }
                
                // 使用预览时保存的模板（而不是默认模板）
                const typ = await renderFromTemplate(previewInfo.template, templatesDir, ctx);
                if (!typ) { return; }
                
                if (previewInfo.storage === 'file') {
                    // 更新文件存储
                    const filePath = previewInfo.uri.fsPath;
                    fs.writeFileSync(filePath, typ, 'utf8');
                    log(`自动更新Typst预览文件: ${doc.uri.fsPath}`);
                } else {
                    // 更新内存盘存储
                    const typstFSLocal = getTypstFS();
                    if (typstFSLocal) {
                        const memPath = `/typst/current/${filename}.typ`;
                        typstFSLocal.updateMemoryContent(memPath, typ);
                        log(`自动更新Typst内存预览: ${doc.uri.fsPath}`);
                    }
                }
            } catch (err) {
                // 静默处理自动更新错误，不中断编辑
                console.warn('[Typst] 自动更新预览失败', err);
            }
            delete (globalThis as any)[updateKey];
        }, 1000); // 1秒节流
    };
}

/**
 * 切换Typst模板
 */
export async function changeTypstTemplate(typstFS: TypstMemoryProvider | undefined, log: (msg: string, err?: any) => void) {
    if (!typstFS) {
        vscode.window.showErrorMessage('Typst内存盘未初始化');
        return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('没有打开的编辑器');
        return;
    }

    const doc = editor.document;
    if (doc.languageId !== 'markdown' && doc.languageId !== 'plaintext') {
        vscode.window.showErrorMessage('仅支持Markdown或纯文本文档');
        return;
    }

    // 检查该文档是否有预览文件
    const previewInfo = documentPreviewMap.get(doc.uri.fsPath);
    if (!previewInfo) {
        vscode.window.showErrorMessage('请先打开Typst预览');
        return;
    }

    try {
        const templates = templateRegistry.list();
        if (templates.length === 0) {
            vscode.window.showErrorMessage('没有可用的模板');
            return;
        }

        const picks = templates.map(t => ({
            label: t.name,
            description: t.root,
            value: t.name
        }));

        const selected = await vscode.window.showQuickPick(picks, {
            placeHolder: '选择Typst模板',
            canPickMany: false
        });

        if (!selected) { return; }

        // 保存选中的模板到配置
        const cfg = vscode.workspace.getConfiguration('andrea.typst');
        await cfg.update('defaultTemplate', selected.value, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`已切换模板: ${selected.value}`);

        // 重新生成预览
        await openTypstPreview(typstFS, log);
        log(`切换Typst模板: ${selected.value}`);
    } catch (err) {
        vscode.window.showErrorMessage(`切换模板失败: ${err instanceof Error ? err.message : String(err)}`);
        log(`切换模板失败`, err);
    }
}

/**
 * 关闭Typst预览
 */
export async function closeTypstPreview(log: (msg: string, err?: any) => void) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('没有打开的编辑器');
        return;
    }

    const doc = editor.document;
    if (doc.languageId !== 'markdown' && doc.languageId !== 'plaintext') {
        vscode.window.showErrorMessage('仅支持Markdown或纯文本文档');
        return;
    }

    const previewInfo = documentPreviewMap.get(doc.uri.fsPath);
    if (!previewInfo) {
        vscode.window.showInformationMessage('该文档无预览');
        return;
    }

    try {
        // 移除映射
        documentPreviewMap.delete(doc.uri.fsPath);

        // 更新状态栏
        const statusBar = getTypstPreviewStatusBar();
        if (statusBar) {
            statusBar.markPreviewDisabled(doc.uri.fsPath);
        }

        vscode.window.showInformationMessage('已关闭Typst预览');
        log(`关闭Typst预览: ${doc.uri.fsPath}`);
    } catch (err) {
        vscode.window.showErrorMessage(`关闭预览失败: ${err instanceof Error ? err.message : String(err)}`);
        log(`关闭预览失败`, err);
    }
}

/**
 * 注册Typst预览相关命令
 */
export function registerTypstPreviewCommands(context: vscode.ExtensionContext, typstFS: TypstMemoryProvider | undefined, log: (msg: string, err?: any) => void) {
    // 注册打开Typst实时预览命令
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.openTypstPreview', async () => {
            await openTypstPreview(typstFS, log);
        })
    );

    // 注册关闭Typst预览命令
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.closeTypstPreview', async () => {
            await closeTypstPreview(log);
        })
    );

    // 注册切换Typst模板命令
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.changeTypstTemplate', async () => {
            await changeTypstTemplate(typstFS, log);
        })
    );

    // 注册Typst内容刷新命令
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.refreshTypstContent', () => {
            if (!typstFS) { return; }
            typstFS.clearAll();
        })
    );

    // 监听文档变更，自动更新内存盘中的Typst预览
    const onChangeTypstPreview = createOnChangeTypstPreview(typstFS, log);
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(onChangeTypstPreview));
}
