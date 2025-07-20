/* eslint-disable curly */
import * as fs from 'fs';
import JSON5 from 'json5';
import * as path from 'path';
import * as vscode from 'vscode';
import { Role } from './extension';
import { getPrefix, typeColorMap, getSupportedLanguages } from './utils';
import { create } from 'domain';
import { createCompletionProvider } from './completionProvider';
import { generateCSpellDictionary } from './generateCSpellDictionary';
import { hoverProv } from './hoverProvider';
import { defProv } from './defProv';
import { updateDecorations } from './updateDecorations';
import { WordCountItem, WordCountProvider } from './wordCountProvider';


// 全局角色列表
export let roles: Role[] = [];
// 存储当前文档中每个角色出现的范围和对应角色
export let hoverRanges: { range: vscode.Range; role: Role }[] = [];

export function setHoverRanges(ranges: { range: vscode.Range; role: Role }[]) {
    hoverRanges = ranges;
}
// editor 装饰类型存储
export let decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();



export function activate(context: vscode.ExtensionContext) {
    const cfg1 = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const rolesFile1 = cfg1.get<string>('rolesFile')!;

    const fileTypes = cfg1.get<string[]>('supportedFileTypes', ['markdown', 'plaintext']);

    // 转换为 VS Code 的语言 ID
    const supportedLanguages = getSupportedLanguages();

    const folders1 = vscode.workspace.workspaceFolders;
    if (folders1 && folders1.length) {
        const root = folders1[0].uri.fsPath;
        const fullPath = path.join(root, rolesFile1);
        // ——— 向导：如果角色库文件不存在，询问并初始化 ———
        const createWizard = async () => {
            const choice = await vscode.window.showInformationMessage(
                `角色库文件 "${rolesFile}" 不存在，是否初始化示例角色库？`,
                '创建',
                '取消'
            );
            if (choice === '创建') {
                // 示例角色
                const example = [
                    {
                        name: "示例角色",
                        type: "配角",
                        affiliation: "示例阵营",
                        aliases: ["示例"],
                        description: "这是一个示例角色，用于说明角色库格式。",
                        color: "#FFA500"
                    }
                ];
                const content = JSON5.stringify(example, null, 2);
                // 自动创建目录（若需要）
                fs.mkdirSync(path.dirname(fullPath), { recursive: true });
                fs.writeFileSync(fullPath, content, 'utf8');
                vscode.window.showInformationMessage(`已创建示例角色库：${rolesFile}`);
            }
        };

        // 激活时调用一次
        if (!fs.existsSync(fullPath)) {
            createWizard().then(() => {
                // 向导完成后再加载和装饰
                loadRoles();
                updateDecorations();
            });
        }
    }


    loadRoles();
    // 配置变更监听
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('AndreaNovelHelper.rolesFile') ||
                e.affectsConfiguration('AndreaNovelHelper.minChars') ||
                e.affectsConfiguration('AndreaNovelHelper.defaultColor')) {
                loadRoles();
                updateDecorations();
            }
        })
    );

    // —— 命令：从选中创建角色 —— 
    const addCmd = vscode.commands.registerCommand(
        'AndreaNovelHelper.addRoleFromSelection',
        async () => {

            // 确保角色库存在
            const cfg1 = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const rolesFile = cfg1.get<string>('rolesFile')!;
            const root1 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!root1) return;
            const fullPath1 = path.join(root1, rolesFile);
            if (!fs.existsSync(fullPath1)) {
                await vscode.window.showInformationMessage(
                    `角色库 "${rolesFile}" 不存在，先创建一个示例再继续…`
                );
                // 复用上面同样的示例创建逻辑
                const example = [
                    {
                        name: "示例角色",
                        type: "配角",
                        affiliation: "示例阵营",
                        aliases: ["示例"],
                        description: "这是一个示例角色，用于说明角色库格式。",
                        color: "#FFA500"
                    }
                ];
                fs.mkdirSync(path.dirname(fullPath1), { recursive: true });
                fs.writeFileSync(fullPath1, JSON5.stringify(example, null, 2), 'utf8');
                vscode.window.showInformationMessage(`已初始化示例角色库：${rolesFile}`);
            }

            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const sel = editor.selection;
            const name = editor.document.getText(sel).trim();
            if (!name) {
                vscode.window.showWarningMessage('请选择文本作为角色名称');
                return;
            }

            // 依次让用户填写 type / affiliation / description / color
            const type = await vscode.window.showQuickPick(
                ['主角', '配角', '联动角色'],
                { placeHolder: '选择角色类型' }
            );
            if (!type) { return; }

            const affiliation = await vscode.window.showInputBox({
                placeHolder: '输入从属标签（可选）'
            });

            const description = await vscode.window.showInputBox({
                placeHolder: '输入角色简介（可选）'
            });

            const color = await vscode.window.showInputBox({
                placeHolder: '输入十六进制颜色，如 #E60033（可选）',
                validateInput: v => {
                    return v && !/^#([0-9A-Fa-f]{6})$/.test(v) ? '请输入合法的 #RRGGBB 形式' : null;
                }
            });

            // 找到并读入 rolesFile
            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const file = cfg.get<string>('rolesFile')!;
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!root) {
                vscode.window.showErrorMessage('未找到工作区根目录');
                return;
            }
            const fullPath = path.join(root, file);
            if (!fs.existsSync(fullPath)) {
                vscode.window.showErrorMessage(`角色库文件不存在: ${file}`);
                return;
            }
            const text = fs.readFileSync(fullPath, 'utf8');
            let arr: any[];
            try {
                arr = JSON5.parse(text) as any[];
            } catch (e) {
                vscode.window.showErrorMessage(`解析角色库失败: ${e}`);
                return;
            }

            // 新角色对象
            const newRole: any = { name, type };
            if (affiliation) newRole.affiliation = affiliation;
            if (description) newRole.description = description;
            if (color) newRole.color = color;

            // 把新角色 push 到数组末尾
            arr.push(newRole);

            // 写回文件，使用 JSON5.stringify 保留注释/尾逗号风格
            const out = JSON5.stringify(arr, null, 2);
            fs.writeFileSync(fullPath, out, 'utf8');

            vscode.window.showInformationMessage(`已添加角色 "${name}" 到 ${file}`);
            // 重新加载角色并刷新装饰
            loadRoles();
            updateDecorations();
        }
    );

    context.subscriptions.push(addCmd);
    // —— 自动补全提供器 ——
    const provider = createCompletionProvider(roles);

    // 初始 & 监听
    updateDecorations();
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(updateDecorations),

        // 合并后的文档变化监听器
        vscode.workspace.onDidChangeTextDocument(e => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            // 检查文档是否匹配当前活动文档
            const isActiveDocument = e.document === editor.document;

            // 检查当前文档是否在支持的语言列表中
            const isSupported = supportedLanguages.includes(editor.document.languageId);

            // 只有当文档是当前活动文档且语言受支持时才更新装饰
            if (isActiveDocument && isSupported) {
                updateDecorations(editor);
            }
        })
    );

    // Hover provider 显示名称、简介、类型、从属、颜色
    context.subscriptions.push(hoverProv);

    // “转到定义”提供器：Ctrl+Click 或 F12
    context.subscriptions.push(defProv);


    // —— 1. 自动监听角色库文件变化 —— 
    //
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const rolesFile = cfg.get<string>('rolesFile')!;
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length) {
        const root = folders[0].uri.fsPath;
        // 相对工作区根、监控单个文件
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(root, rolesFile)
        );
        // 文件改动
        watcher.onDidChange(() => {
            loadRoles();
            updateDecorations();
            vscode.window.showInformationMessage('角色库已自动刷新');
        });
        // 文件被删除或新建也一并处理
        watcher.onDidCreate(() => {
            loadRoles();
            updateDecorations();
            vscode.window.showInformationMessage('角色库文件已创建，已刷新');
        });
        watcher.onDidDelete(() => {
            roles = [];
            updateDecorations();
            vscode.window.showWarningMessage('角色库文件已删除，已清空角色列表');
        });
        context.subscriptions.push(watcher);
    }

    //
    // —— 2. 手动刷新命令 —— 
    //
    const refreshCmd = vscode.commands.registerCommand(
        'AndreaNovelHelper.refreshRoles',
        () => {
            loadRoles();
            updateDecorations();
            vscode.window.showInformationMessage('手动刷新角色库完成');
        }
    );
    context.subscriptions.push(refreshCmd);


    // 1. 创建你的 TreeDataProvider
    const wordCountProvider = new WordCountProvider();

    // 2. 用 createTreeView 拿到 TreeView 实例（后面会用它 reveal）
    const treeView = vscode.window.createTreeView('wordCountExplorer', {
        treeDataProvider: wordCountProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(treeView);

    // 3. 刷新命令，可选
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.refreshWordCount', () => {
            wordCountProvider.refresh();
        })
    );

    // // 4. 当激活的编辑器改变时，自动在视图中定位对应文件项
    // context.subscriptions.push(
    //     vscode.window.onDidChangeActiveTextEditor(async editor => {
    //         if (!editor) return;
    //         const uri = editor.document.uri;
    //         // 构造一个“stub”节点，ID 必须和真正的 Item 对应
    //         const stub = new WordCountItem(
    //             uri,
    //             path.basename(uri.fsPath),
    //             { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: 0 },
    //             vscode.TreeItemCollapsibleState.None
    //         );
    //         stub.id = uri.fsPath;

    //         // reveal 会自动展开父节点并滚动到该项
    //         try {
    //             await treeView.reveal(stub, { expand: true, select: true, focus: false });
    //         } catch {
    //             // 如果该文件不在统计范围里，reveal 会报错，可以忽略
    //         }
    //     })
    // );
    // 监听编辑器切换
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (!editor) return;
            const fsPath = editor.document.uri.fsPath;

            // 从 provider 的缓存里，找出刚才被创建过的那个 TreeItem
            const element = wordCountProvider.getItemById(fsPath);
            if (element) {
                // 直接用真实实例 reveal，VS Code 会展开父节点、滚动并选中它
                treeView.reveal(element, { expand: true, select: true, focus: false })
                    .then(undefined, () => {
                        console.warn(`[AndreaNovelHelper] 无法定位到 TreeItem: ${fsPath}`);
                    });
            }
        })
    );

}


/**
 * 加载角色库 JSON5，支持注释与尾逗号
 */
export function loadRoles() {
    roles = [];
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const file = cfg.get<string>('rolesFile')!;
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || !folders.length) return;
    const root = folders[0].uri.fsPath;
    const full = path.join(root, file);
    if (!fs.existsSync(full)) {
        vscode.window.showWarningMessage(`角色库未找到: ${file}`);
        return;
    }
    try {
        const text = fs.readFileSync(full, 'utf8');
        roles = JSON5.parse(text) as Role[];
    } catch (e) {
        vscode.window.showErrorMessage(`解析角色库失败: ${e}`);
    }
    generateCSpellDictionary();
}



export function deactivate() {
    decorationTypes.forEach(d => d.dispose());
}
