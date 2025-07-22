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
import { initAutomaton, updateDecorations } from './updateDecorations';
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
                `角色库文件 "${rolesFile1}" 不存在，是否初始化示例角色库？`,
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
                vscode.window.showInformationMessage(`已创建示例角色库：${rolesFile1}`);
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
    
    console.log('[AHO] roles:', roles.map(r => r.name));
    console.log('[AHO] patterns:', roles.flatMap(r => [r.name, ...(r.aliases || [])]));

    initAutomaton();

    // 2. 小防抖：防止用户快速输入时一堆次 update
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleUpdate = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => updateDecorations(), 200);
    };

    // 3. 注册事件：切换编辑器／文本变化／保存时都触发
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(scheduleUpdate),
        vscode.workspace.onDidChangeTextDocument(scheduleUpdate),
        vscode.workspace.onDidSaveTextDocument(scheduleUpdate)
    );

    // 4. 第一次激活也跑一次
    scheduleUpdate();


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
                // txt库
                const txtPath = fullPath1.replace(/\.[^/.]+$/, ".txt");
                if (!fs.existsSync(txtPath)) {
                    const txtContent = example.map(item => item.name).join('\n');
                    fs.writeFileSync(txtPath, txtContent, 'utf8');
                }
                // json5库
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


    // —— 1. 自动监听所有库文件变化（包括 txt 版本） —— 
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length) {
        const rootUri = folders[0].uri;

        const fileKeys = [
            { key: 'rolesFile', label: '角色库' },
            { key: 'sensitiveWordsFile', label: '敏感词库' },
            { key: 'vocabularyFile', label: '词汇库' }
        ];

        for (const { key, label } of fileKeys) {
            const fileSetting = cfg1.get<string>(key)!;
            // 确保转成相对于 workspace 根的 POSIX 路径，glob 只识别 '/'
            const absPath = path.isAbsolute(fileSetting)
                ? fileSetting
                : path.join(rootUri.fsPath, fileSetting);
            let relPath = path.relative(rootUri.fsPath, absPath);
            relPath = relPath.split(path.sep).join('/'); // 转成 POSIX

            const txtPath = relPath.replace(/\.[^/.]+$/, ".txt");

            // —— 监听 JSON5/JSON 路径 —— 
            const watcherJson = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(rootUri, relPath)
            );
            watcherJson.onDidChange(() => {
                loadRoles();
                updateDecorations();
                vscode.window.showInformationMessage(`${label}（JSON5）已自动刷新`);
            });
            watcherJson.onDidCreate(() => {
                loadRoles();
                updateDecorations();
                vscode.window.showInformationMessage(`${label}（JSON5）文件已创建，已刷新`);
            });
            watcherJson.onDidDelete(() => {
                roles = [];
                loadRoles(); //重新加载角色并刷新装饰
                updateDecorations();
                vscode.window.showWarningMessage(`${label}（JSON5）文件已删除，已清空列表`);
            });
            context.subscriptions.push(watcherJson);

            // —— 监听 TXT 路径 —— 
            const watcherTxt = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(rootUri, txtPath)
            );
            watcherTxt.onDidChange(() => {
                loadRoles();        // 确保 loadRoles() 能识别并加载 TXT
                updateDecorations();
                vscode.window.showInformationMessage(`${label}（TXT）已自动刷新`);
            });
            watcherTxt.onDidCreate(() => {
                loadRoles();
                updateDecorations();
                vscode.window.showInformationMessage(`${label}（TXT）文件已创建，已刷新`);
            });
            watcherTxt.onDidDelete(() => {
                roles = [];
                loadRoles(); //重新加载角色并刷新装饰
                updateDecorations();
                vscode.window.showWarningMessage(`${label}（TXT）文件已删除，已清空列表`);
            });
            context.subscriptions.push(watcherTxt);
        }
    }

    // —— 2. 手动刷新命令 —— 
    const refreshCmd = vscode.commands.registerCommand(
        'AndreaNovelHelper.refreshRoles',
        () => {
            loadRoles();
            updateDecorations();
            vscode.window.showInformationMessage('所有库已手动刷新');
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
    // 4. 监听活动编辑器切换
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(async editor => {
            if (!editor) return;

            // 1) 视图没展开就直接跳过
            if (!treeView.visible) return;

            const fsPath = editor.document.uri.fsPath;
            const stub = {
                id: fsPath,
                resourceUri: editor.document.uri
            } as any;

            try {
                await treeView.reveal(stub, {
                    expand: true,
                    select: true,
                    focus: false
                });
            } catch {
                // 文件不在统计范围里时忽略
            }
        })
    );


    // —— 命令：从选中创建敏感词 —— 
    const addSensitiveCmd = vscode.commands.registerCommand(
        'AndreaNovelHelper.addSensitiveWord',
        async () => {
            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const sensitiveFile = cfg.get<string>('sensitiveWordsFile')!;
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!root) return;
            const fullPath = path.join(root, sensitiveFile);

            // 当敏感词库文件不存在时，初始化示例
            if (!fs.existsSync(fullPath)) {
                await vscode.window.showInformationMessage(
                    `敏感词库文件 "${sensitiveFile}" 不存在，先创建一个示例再继续…`
                );
                const example = [
                    {
                        name: "示例敏感词",
                        type: "敏感词",
                        description: "这是一个示例敏感词。",
                        color: "#FF0000"
                    }
                ];
                // txt库
                const txtPath = fullPath.replace(/\.[^/.]+$/, ".txt");
                if (!fs.existsSync(txtPath)) {
                    const txtContent = example.map(item => item.name).join('\n');
                    fs.writeFileSync(txtPath, txtContent, 'utf8');
                }
                // json5库
                fs.mkdirSync(path.dirname(fullPath), { recursive: true });
                fs.writeFileSync(fullPath, JSON5.stringify(example, null, 2), 'utf8');
                vscode.window.showInformationMessage(`已初始化示例敏感词库：${sensitiveFile}`);
            }

            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const sel = editor.selection;
            const name = editor.document.getText(sel).trim();
            if (!name) {
                vscode.window.showWarningMessage('请选择文本作为敏感词');
                return;
            }

            // 不询问类型，直接固定为 "敏感词"
            const description = await vscode.window.showInputBox({
                placeHolder: '输入敏感词简介（可选）'
            });
            const color = await vscode.window.showInputBox({
                placeHolder: '输入十六进制颜色，如 #FF0000（可选，默认为红色）',
                validateInput: v => {
                    return v && !/^#([0-9A-Fa-f]{6})$/.test(v) ? '请输入合法的 #RRGGBB 形式' : null;
                }
            });

            let arr: any[];
            try {
                const text = fs.readFileSync(fullPath, 'utf8');
                arr = JSON5.parse(text) as any[];
            } catch (e) {
                vscode.window.showErrorMessage(`解析敏感词库失败: ${e}`);
                return;
            }

            // 若用户未输入颜色，则使用红色作为默认颜色
            const newSensitive: any = { name, type: "敏感词" };
            if (description) newSensitive.description = description;
            newSensitive.color = color || "#FF0000";

            arr.push(newSensitive);
            fs.writeFileSync(fullPath, JSON5.stringify(arr, null, 2), 'utf8');
            vscode.window.showInformationMessage(`已添加敏感词 "${name}" 到 ${sensitiveFile}`);

            // 刷新全局角色列表（包括特殊角色）
            loadRoles();
            updateDecorations();
        }
    );
    context.subscriptions.push(addSensitiveCmd);


    // —— 命令：从选中创建词汇 —— 
    const addVocabularyCmd = vscode.commands.registerCommand(
        'AndreaNovelHelper.addVocabulary',
        async () => {
            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const vocabFile = cfg.get<string>('vocabularyFile')!;
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!root) return;
            const fullPath = path.join(root, vocabFile);

            if (!fs.existsSync(fullPath)) {
                await vscode.window.showInformationMessage(
                    `词汇库文件 "${vocabFile}" 不存在，先创建一个示例再继续…`
                );
                const example = [
                    {
                        name: "示例词汇",
                        type: "词汇",
                        description: "这是一个示例词汇。",
                        color: "#00AAFF"
                    }
                ];
                // txt库
                const txtPath = fullPath.replace(/\.[^/.]+$/, ".txt");
                if (!fs.existsSync(txtPath)) {
                    const txtContent = example.map(item => item.name).join('\n');
                    fs.writeFileSync(txtPath, txtContent, 'utf8');
                }
                // json5库
                fs.mkdirSync(path.dirname(fullPath), { recursive: true });
                fs.writeFileSync(fullPath, JSON5.stringify(example, null, 2), 'utf8');
                vscode.window.showInformationMessage(`已初始化示例词汇库：${vocabFile}`);
            }

            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const sel = editor.selection;
            const name = editor.document.getText(sel).trim();
            if (!name) {
                vscode.window.showWarningMessage('请选择文本作为词汇');
                return;
            }

            const description = await vscode.window.showInputBox({
                placeHolder: '输入词汇简介（可选）'
            });
            const color = await vscode.window.showInputBox({
                placeHolder: '输入十六进制颜色，如 #00AAFF（可选）',
                validateInput: v => {
                    return v && !/^#([0-9A-Fa-f]{6})$/.test(v) ? '请输入合法的 #RRGGBB 形式' : null;
                }
            });

            let arr: any[];
            try {
                const text = fs.readFileSync(fullPath, 'utf8');
                arr = JSON5.parse(text) as any[];
            } catch (e) {
                vscode.window.showErrorMessage(`解析词汇库失败: ${e}`);
                return;
            }

            const newVocab: any = { name, type: "词汇" };
            if (description) newVocab.description = description;
            if (color) newVocab.color = color;

            arr.push(newVocab);
            fs.writeFileSync(fullPath, JSON5.stringify(arr, null, 2), 'utf8');
            vscode.window.showInformationMessage(`已添加词汇 "${name}" 到 ${vocabFile}`);

            loadRoles();
            updateDecorations();
        }
    );
    context.subscriptions.push(addVocabularyCmd);
}


/**
 * 加载角色库、词汇库和敏感词库，均为 JSON5，支持注释与尾逗号
 */
export function loadRoles() {
    roles = [];
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || !folders.length) {
        console.error('loadRoles: 未找到工作区文件夹');
        return;
    }
    const root = folders[0].uri.fsPath;
    console.log(`loadRoles: workspace root = ${root}`);

    // 通用加载函数：fileKey 为配置项键，defaultType 为当 txt 版本加载时使用的类型
    function loadLibrary(fileKey: string, defaultType: string) {
        const fileName = cfg.get<string>(fileKey);
        console.log(`loadLibrary: fileKey = ${fileKey}, fileName = ${fileName}`);
        if (!fileName) {
            vscode.window.showErrorMessage(`配置项 ${fileKey} 未设置，请检查设置`);
            console.error(`loadLibrary: ${fileKey} 为 undefined`);
            return;
        }
        const libPath = path.join(root, fileName);
        console.log(`loadLibrary: libPath = ${libPath}`);

        // 加载 JSON5 版（如果存在）
        if (fs.existsSync(libPath)) {
            try {
                const text = fs.readFileSync(libPath, 'utf8');
                const arr = JSON5.parse(text) as Role[];
                roles.push(...arr);
                console.log(`loadLibrary: 成功加载 JSON5库 ${fileName}`);
            } catch (e) {
                vscode.window.showErrorMessage(`解析 ${fileName} 失败: ${e}`);
                console.error(`loadLibrary: 解析 ${fileName} 失败: ${e}`);
            }
        } else {
            vscode.window.showWarningMessage(`${fileName} 未找到`);
            console.warn(`loadLibrary: ${libPath} 不存在`);
        }

        // 加载 txt 版（仅用于用户迁移，不与 JSON5 同步）
        const txtPath = libPath.replace(/\.[^/.]+$/, ".txt");
        console.log(`loadLibrary: TXT版本路径 = ${txtPath}`);
        if (fs.existsSync(txtPath)) {
            try {
                const txtContent = fs.readFileSync(txtPath, 'utf8');
                const lines = txtContent.split(/\r?\n/).filter(line => line.trim() !== '');
                for (const line of lines) {
                    const trimmed = line.trim();
                    let role: Role = { name: trimmed, type: defaultType };
                    if (fileKey === 'rolesFile') {
                        // 普通角色的 txt 版本：固定类型为 "txt角色"，使用配置中的默认颜色
                        role.type = "txt角色";
                        role.color = cfg.get<string>('defaultColor')!;
                    } else if (fileKey === 'sensitiveWordsFile') {
                        // 敏感词：保持 "敏感词"，固定红色
                        role.type = "敏感词";
                        role.color = "#FF0000";
                    } else if (fileKey === 'vocabularyFile') {
                        // 词汇：保持 "词汇"，不设置颜色
                        role.type = "词汇";
                    }
                    // txt 版不支持别名和描述，直接忽略
                    roles.push(role);
                }
                console.log(`loadLibrary: 成功加载 TXT库 ${fileName}`);
            } catch (e) {
                vscode.window.showErrorMessage(`解析 TXT ${fileName} 失败: ${e}`);
                console.error(`loadLibrary: 解析 TXT ${fileName} 失败: ${e}`);
            }
        }
    }

    loadLibrary('rolesFile', "角色");
    loadLibrary('sensitiveWordsFile', "敏感词");
    loadLibrary('vocabularyFile', "词汇");

    generateCSpellDictionary();
}



export function deactivate() {
    decorationTypes.forEach(d => d.dispose());
}
