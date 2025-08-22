import * as vscode from 'vscode';
import * as fontList from 'font-list';

/** CSS font-family 解析：支持引号、引号内外的反斜杠转义，返回有序去重列表 */
export function parseFontFamily(input: string): string[] {
    const out: string[] = [];
    let cur = '';
    let i = 0;
    let quote: '"' | "'" | null = null;

    const pushToken = (raw: string) => {
        const t = raw.trim();
        if (t.length) { out.push(t); }
    };

    while (i < input.length) {
        const ch = input[i];

        // 统一处理：引号内外都识别反斜杠做“转义下一个字符”
        if (ch === '\\') {
            if (i + 1 < input.length) {
                cur += input[i + 1];
                i += 2;
                continue;
            } else {
                // 末尾孤立的反斜杠：按字面追加一次
                cur += '\\';
                i++;
                continue;
            }
        }

        if (quote) {
            if (ch === quote) { quote = null; i++; continue; }
            cur += ch; i++; continue;
        } else {
            if (ch === '"' || ch === "'") { quote = ch; i++; continue; }
            if (ch === ',') { pushToken(cur); cur = ''; i++; continue; }
            cur += ch; i++; continue;
        }
    }
    pushToken(cur);

    // 去重（忽略大小写）
    const seen = new Set<string>();
    const dedup: string[] = [];
    for (const t of out) {
        const key = t.toLowerCase();
        if (!seen.has(key)) { seen.add(key); dedup.push(t); }
    }
    return dedup;
}

const GENERIC_KEYWORDS = new Set([
    'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
    'ui-monospace', 'ui-rounded', 'ui-serif', 'ui-sans-serif', 'emoji', 'math', 'fangsong'
]);

// ---- 统一规范化工具 ----

/** 去掉外层成对引号并反转义（\x -> x；末尾孤立反斜杠保留） */
function unquote_and_unescape(raw: string): string {
    let s = (raw ?? '').trim();
    if (!s) {return s;}

    // 去外层成对引号
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
        s = s.slice(1, -1);
    }
    // \x -> x；注意：末尾孤立 \ 不会被这个正则吃掉
    s = s.replace(/\\(.)/g, '$1');
    return s.trim();
}

/** 规范化整个列表：去引号、反转义、去空、大小写去重 */
function normalize_font_list(list: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of list) {
        const v = unquote_and_unescape(item);
        if (!v) {continue;}
        const k = v.toLowerCase();
        if (!seen.has(k)) { seen.add(k); out.push(v); }
    }
    return out;
}

// 用单引号包裹带空格/特殊字符的字体名，避免 JSON 里的 \" 转义
function needsQuotes(name: string): boolean {
    if (GENERIC_KEYWORDS.has(name.trim().toLowerCase())) { return false; }
    // 仅允许无空格的简洁 token，无空格/纯字母数字/下划线/连字符
    return !/^[A-Za-z0-9_-]+$/.test(name.trim());
}

function quote(name: string): string {
    const n = name.trim();
    if (!needsQuotes(n)) { return n; }
    // CSS 单引号字符串：需要把 \ 先转义为 \\，再把 ' 转义为 \'
    return `'${n.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export function serializeFontFamily(list: string[]): string {
    return list
        .map(s => s.trim())
        .filter(Boolean)
        .map(quote)
        .join(', ');
}

function renderItems(current: string[]): vscode.QuickPickItem[] {
    return current.map((f, idx) => ({
        label: `${idx + 1}. ${f}`,
        description: GENERIC_KEYWORDS.has(f.toLowerCase()) ? '（关键字）' : undefined
    }));
}

export function registerFontManager(context: vscode.ExtensionContext, onRefreshStatus: () => void) {
    context.subscriptions.push(
        vscode.commands.registerCommand('andrea.manageEditorFontFamily', async () => {
            const cfg = vscode.workspace.getConfiguration('editor');

            // 初始化时就做一次规范化，避免历史遗留的引号/转义进入工作集
            let working = normalize_font_list(parseFontFamily(cfg.get<string>('fontFamily', '') || ''));

            // —— 会话级缓存：只在本次管理器会话中缓存一次 —— //
            let sessionFonts: string[] | null = null;
            const getSessionFonts = async (): Promise<string[]> => {
                if (sessionFonts) { return sessionFonts; }
                const arr = await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: '正在枚举本机字体…' },
                    async () => fontList.getFonts()
                );
                // 对枚举回来的系统字体做清洗（font-list 某些平台可能带引号）
                sessionFonts = normalize_font_list(arr.map(n => n.trim()).filter(Boolean))
                    .sort((a, b) => a.localeCompare(b));
                return sessionFonts!;
            };

            const addFromSystem = async (): Promise<void> => {
                const sys = await getSessionFonts();
                const exist = new Set(working.map(s => s.toLowerCase()));
                const picked = await vscode.window.showQuickPick(
                    sys.filter(n => !exist.has(n.toLowerCase())).map(n => ({ label: n })),
                    { canPickMany: true, placeHolder: '选择要添加的系统字体（可多选）' }
                );
                if (!picked || picked.length === 0) { return; }
                // 追加后再整体规范化，确保列表干净
                working = normalize_font_list([...working, ...picked.map(p => p.label)]);
            };

            const addManual = async (): Promise<void> => {
                const input = await vscode.window.showInputBox({
                    prompt: '输入要添加的字体名（可逗号分隔多个）。含空格/特殊字符无需手动加引号，保存时自动处理。',
                    placeHolder: '例：Microsoft YaHei, Sarasa UI SC, monospace',
                    ignoreFocusOut: true
                });
                if (!input) { return; }

                const arr = parseFontFamily(input);
                const exist = new Set(working.map(s => s.toLowerCase()));
                for (const a of arr) {
                    const k = a.toLowerCase();
                    if (!exist.has(k)) {
                        working.push(a);
                        exist.add(k); // 同批次去重
                    }
                }
                working = normalize_font_list(working); // 兜底一次
            };

            const removeFonts = async (): Promise<void> => {
                const picked = await vscode.window.showQuickPick(renderItems(working), {
                    canPickMany: true, placeHolder: '选择要移除的项'
                });
                if (!picked) { return; }
                const toDel = new Set(picked.map(p => p.label.replace(/^\d+\.\s*/, '').toLowerCase()));
                working = working.filter(f => !toDel.has(f.toLowerCase()));
                working = normalize_font_list(working);
            };

            const editFont = async (): Promise<void> => {
                const pick = await vscode.window.showQuickPick(renderItems(working), {
                    canPickMany: false, placeHolder: '选择要编辑的项'
                });
                if (!pick) { return; }
                const old = pick.label.replace(/^\d+\.\s*/, '');
                const input = await vscode.window.showInputBox({
                    prompt: `编辑字体名（原：${old}）`,
                    value: old,
                    ignoreFocusOut: true
                });
                if (typeof input !== 'string') { return; }
                const idx = working.findIndex(s => s === old);
                if (idx >= 0) {
                    working[idx] = input.trim();
                    working = normalize_font_list(working);
                }
            };

            const reorder = async (): Promise<void> => {
                const pick = await vscode.window.showQuickPick(renderItems(working), {
                    canPickMany: false, placeHolder: '选择要移动的项'
                });
                if (!pick) { return; }
                const name = pick.label.replace(/^\d+\.\s*/, '');
                const idx = working.indexOf(name);
                if (idx < 0) { return; }
                const action = await vscode.window.showQuickPick(
                    [
                        { label: '上移一位' },
                        { label: '下移一位' },
                        { label: '置顶' },
                        { label: '置底' }
                    ],
                    { placeHolder: `移动：${name}` }
                );
                if (!action) { return; }
                const arr = working.slice();
                const [item] = arr.splice(idx, 1);
                switch (action.label) {
                    case '上移一位': arr.splice(Math.max(0, idx - 1), 0, item); break;
                    case '下移一位': arr.splice(Math.min(arr.length, idx + 1), 0, item); break;
                    case '置顶': arr.unshift(item); break;
                    case '置底': arr.push(item); break;
                }
                working = normalize_font_list(arr);
            };

            const save = async (): Promise<void> => {
                // 保存前最终兜底一次，避免任何异常格式写回设置
                const finalList = normalize_font_list(working);
                await cfg.update('fontFamily', serializeFontFamily(finalList), vscode.ConfigurationTarget.Workspace);
                working = finalList;
                onRefreshStatus();
                vscode.window.showInformationMessage('已保存 editor.fontFamily');
            };

            const reset = async (): Promise<void> => {
                const ok = await vscode.window.showWarningMessage('将 editor.fontFamily 清空为默认？', { modal: true }, '确定', '取消');
                if (ok === '确定') {
                    await cfg.update('fontFamily', undefined, vscode.ConfigurationTarget.Workspace);
                    working = [];
                    onRefreshStatus();
                    vscode.window.showInformationMessage('已恢复 VS Code 默认字体');
                }
            };

            while (true) {
                const pick = await vscode.window.showQuickPick(
                    [
                        { label: '$(add) 添加：从系统字体', description: '枚举本机字体，多选添加' },
                        { label: '$(pencil) 添加：手动输入', description: '支持逗号分隔多个' },
                        { label: '$(edit) 编辑现有项', description: '修改单个字体名' },
                        { label: '$(trash) 删除', description: '可多选删除' },
                        { label: '$(arrow-small-up) 调整顺序', description: '上移/下移/置顶/置底' },
                        { label: '$(paintcan) 保存更改', description: serializeFontFamily(working) || '（空）' },
                        { label: '$(discard) 还原默认', description: '清空 fontFamily，使用 VS Code 默认' },
                        { label: '$(list-unordered) 当前清单（只读）', description: working.length ? working.join('  ·  ') : '（空）' },
                        { label: '$(close) 关闭' }
                    ],
                    { placeHolder: '管理：编辑器字体家族（font-family）', ignoreFocusOut: true }
                );
                if (!pick) { return; }

                switch (pick.label) {
                    case '$(add) 添加：从系统字体': await addFromSystem(); break;
                    case '$(pencil) 添加：手动输入': await addManual(); break;
                    case '$(edit) 编辑现有项': await editFont(); break;
                    case '$(trash) 删除': await removeFonts(); break;
                    case '$(arrow-small-up) 调整顺序': await reorder(); break;
                    case '$(paintcan) 保存更改': await save(); break;
                    case '$(discard) 还原默认': await reset(); break;
                    case '$(list-unordered) 当前清单（只读）': break;
                    case '$(close) 关闭': return;
                }
            }
        })
    );
}
