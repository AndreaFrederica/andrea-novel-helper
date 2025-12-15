// src/typeset/autoPairs.ts
import * as vscode from 'vscode';
import { Keyboard } from '@anh/enigo-keyboard';
import { getPairsFromConfig, nextIsClosingPair } from './core/pairs';
import { tryLoadNativeModuleWithFallback } from '../utils/nativeModuleLoader';

let langConfigDisposables: vscode.Disposable[] = [];
let typingListener: vscode.Disposable | undefined;
let isSimulatingInput = false; // 标记是否正在模拟输入，防止无限循环
let cachedKeyboard: Keyboard | null = null;
let keyboardLoadPromise: Promise<Keyboard | null> | null = null;
let extensionContext: vscode.ExtensionContext | null = null;

async function getKeyboard(): Promise<Keyboard | null> {
    if (cachedKeyboard) { return cachedKeyboard; }
    
    // 如果已经在尝试加载，等待结果
    if (keyboardLoadPromise) {
        return keyboardLoadPromise;
    }

    if (!extensionContext) {
        console.error('Extension context not set for native module loading');
        return null;
    }

    // 开始加载
    keyboardLoadPromise = (async () => {
        try {
            const result = await tryLoadNativeModuleWithFallback(
                () => new Keyboard(),
                {
                    moduleName: '@anh/enigo-keyboard',
                    displayName: 'Enigo Keyboard',
                    context: extensionContext!,
                }
            );
            
            if (result) {
                cachedKeyboard = result;
            }
            
            return cachedKeyboard ?? null;
        } catch (err) {
            console.error('Failed to initialize enigo keyboard', err);
            return null;
        }
    })();

    return keyboardLoadPromise;
}

function disposeAll() {
    for (const d of langConfigDisposables) { try { d.dispose(); } catch { } }
    langConfigDisposables = [];
    if (typingListener) { typingListener.dispose(); typingListener = undefined; }
}

export function registerAutoPairs(context: vscode.ExtensionContext) {
    extensionContext = context; // 存储 context 以便加载原生模块时使用
    
    const apply = () => {
        disposeAll();

        const cfg = vscode.workspace.getConfiguration();
        const enabled = cfg.get<boolean>('andrea.typeset.enableAutoPairs', true);
        const chineseIMEFixEnabled = cfg.get<boolean>('andrea.typeset.enableChineseIMEFix', true);
        const chineseIMEDelay = cfg.get<number>('andrea.typeset.chineseIMEDelay', 50);
        if (!enabled) { return; }

        // 1) 去重（open+close 唯一）
        const seen = new Set<string>();
        const pairs = getPairsFromConfig().filter(p => {
            const k = `${p.open}→${p.close}`;
            if (seen.has(k)) { return false; }
            seen.add(k);
            return true;
        });

        // 2) 仅 md / txt
        const langs = ['markdown', 'plaintext'] as const;

        // 3) 过滤出中文引号对（用于特殊处理）
        const chineseQuotePairs = pairs.filter(p =>
            p.open === '“' || p.open === '”' ||
            p.open === '‘' || p.open === '’'
        );

        // 4) 配置 VSCode 的自动补全
        // 如果启用中文IME修复，中文引号使用特殊处理，否则使用传统自动补全
        let autoPairs, surround;
        if (chineseIMEFixEnabled) {
            // 移除中文引号，使用特殊处理
            const nonChineseQuotePairs = pairs.filter(p => !chineseQuotePairs.includes(p));
            autoPairs = nonChineseQuotePairs.map(p => ({ open: p.open, close: p.close }));
            surround = nonChineseQuotePairs.map<[string, string]>(p => [p.open, p.close]);
        } else {
            // 包含所有配对，使用传统自动补全
            autoPairs = pairs.map(p => ({ open: p.open, close: p.close }));
            surround = pairs.map<[string, string]>(p => [p.open, p.close]);
        }
        const onlyBrackets: [string, string][] = [['(', ')'], ['[', ']'], ['{', '}']];

        for (const lang of langs) {
            const baseCfg: vscode.LanguageConfiguration = {
                autoClosingPairs: autoPairs,
                brackets: onlyBrackets,
            };
            (baseCfg as any).surroundingPairs = surround;

            const disp = vscode.languages.setLanguageConfiguration(lang, baseCfg);
            langConfigDisposables.push(disp);
        }

        // 5) 为引号添加自定义的输入处理逻辑
        if (chineseQuotePairs.length > 0 && chineseIMEFixEnabled) {
            typingListener = vscode.workspace.onDidChangeTextDocument(e => {
                // 如果正在模拟输入，忽略事件防止无限循环
                if (isSimulatingInput) { return; }

                if (e.contentChanges.length !== 1) { return; }

                const change = e.contentChanges[0];
                const text = change.text;

                // 检查是否是单个引号字符的输入
                const quotePair = chineseQuotePairs.find(p => p.open === text);
                if (!quotePair) { return; }

                // 只处理左引号输入，右引号不处理
                if (quotePair.open === '”' || quotePair.open === '’') {
                    return;
                }

                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document !== e.document) { return; }

                // 检查文档语言
                if (!langs.includes(editor.document.languageId as any)) { return; }

                const position = change.range.end;

                // 检查下一个字符是否已经是闭合引号
                if (nextIsClosingPair(e.document, position, [quotePair])) {
                    return; // 已经有闭合引号，不需要自动补全
                }

                // 进入特殊分支：自动补全引号并执行特殊逻辑
                handleQuoteAutoComplete(editor, position, quotePair, chineseIMEDelay);
            });
        }
    };

    apply();

    context.subscriptions.push(
        { dispose: disposeAll },
        vscode.workspace.onDidChangeConfiguration(e => {
            if (
                e.affectsConfiguration('andrea.typeset.pairs') ||
                e.affectsConfiguration('andrea.typeset.enableAutoPairs') ||
                e.affectsConfiguration('andrea.typeset.enableChineseIMEFix') ||
                e.affectsConfiguration('andrea.typeset.chineseIMEDelay')
            ) { apply(); }
        })
    );
}

/**
 * 处理引号自动补全的特殊逻辑
 * @param editor 编辑器
 * @param position 光标位置
 * @param quotePair 引号对
 */
async function handleQuoteAutoComplete(
    editor: vscode.TextEditor,
    position: vscode.Position,
    quotePair: { open: string; close: string },
    delay: number
) {
    // 使用键盘模拟输入引号对
    await handleQuoteWithKeyboardSimulation(editor, position, quotePair, delay);
}

/**
 * 使用键盘模拟输入引号对（当启用中文IME修复时）
 * @param editor 编辑器
 * @param position 光标位置
 * @param quotePair 引号对
 */
async function handleQuoteWithKeyboardSimulation(
    editor: vscode.TextEditor,
    position: vscode.Position,
    quotePair: { open: string; close: string },
    delay: number
) {
    try {
        const keyboard = await getKeyboard();
        if (!keyboard) {
            throw new Error('enigo keyboard not available');
        }

        // 标记正在模拟输入，防止无限循环
        isSimulatingInput = true;

        // // 根据引号类型显示不同的信息
        // if (quotePair.open === '“') {
        //     vscode.window.setStatusBarMessage('中文双引号自动补全（键盘模拟）', 2000);
        // } else if (quotePair.open === '‘') {
        //     vscode.window.setStatusBarMessage('中文单引号自动补全（键盘模拟）', 2000);
        // }

        // 使用 enigo 发送物理按键（IME 可接管）
        // Windows: VK_OEM_7 = 0xDE，对应单/双引号，双引号需 Shift。
        // 其他平台同键位映射；如失败再回退到直接插入文字。
        const VK_OEM_7 = 0xde;
        const useShift = quotePair.close === '”';

        // 模拟按键，让 IME 进行转换
        // 添加一个小延迟以确保模拟的稳定性
        await new Promise(resolve => setTimeout(resolve, delay));
        keyboard.tapVirtualKey(VK_OEM_7, useShift);
        await new Promise(resolve => setTimeout(resolve, delay));
        const currentPosition = editor.selection.active;
        const newPosition = currentPosition.with({
            character: currentPosition.character - 1
        });
        editor.selection = new vscode.Selection(newPosition, newPosition);
    } catch (error) {
        // 如果键盘模拟失败，回退到直接编辑模式
        console.error('键盘模拟失败，使用直接编辑模式:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`键盘模拟失败: ${errorMessage}。已切换到直接编辑模式。`);

        // 使用直接编辑模式作为后备方案
        editor.edit(editBuilder => {
            editBuilder.insert(position, quotePair.close);
        }).then(() => {
            // 将光标移动到引号之间
            // 使用 position 变量，因为它代表原始位置
            const newPosition = position.with({
                character: position.character
            });
            editor.selection = new vscode.Selection(newPosition, newPosition);
        });
    } finally {
        // 无论成功还是失败，都要清除模拟输入标记
        isSimulatingInput = false;
    }
}
