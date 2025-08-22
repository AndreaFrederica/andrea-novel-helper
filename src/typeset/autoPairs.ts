// src/typeset/autoPairs.ts
import * as vscode from 'vscode';
import { getPairsFromConfig } from './core/pairs';

let langConfigDisposables: vscode.Disposable[] = [];

function disposeAll() {
    for (const d of langConfigDisposables) { try { d.dispose(); } catch { } }
    langConfigDisposables = [];
}

export function registerAutoPairs(context: vscode.ExtensionContext) {
    const apply = () => {
        disposeAll();

        const cfg = vscode.workspace.getConfiguration();
        const enabled = cfg.get<boolean>('andrea.typeset.enableAutoPairs', true);
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

        // 3) 只把引号放在 autoClosingPairs / surroundingPairs，
        //    不放进 brackets（brackets 更适合 (),[],{}），避免边缘行为叠加
        const autoPairs = pairs.map(p => ({ open: p.open, close: p.close }));
        const surround = pairs.map<[string, string]>(p => [p.open, p.close]);
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
    };

    apply();

    context.subscriptions.push(
        { dispose: disposeAll },
        vscode.workspace.onDidChangeConfiguration(e => {
            if (
                e.affectsConfiguration('andrea.typeset.pairs') ||
                e.affectsConfiguration('andrea.typeset.enableAutoPairs')
            ) { apply(); }
        })
    );
}
