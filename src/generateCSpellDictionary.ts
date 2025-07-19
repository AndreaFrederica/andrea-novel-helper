/* eslint-disable curly */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { roles } from './activate';
import * as crypto from 'crypto';

export function generateCSpellDictionary() {
    if (!roles.length) return;

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return;

    const root = folders[0].uri.fsPath;
    const vscodeDir = path.join(root, '.vscode');
    const dictPath = path.join(vscodeDir, 'cspell-roles.txt');

    // 1. 收集角色名和别名
    const wordSet = new Set<string>();
    for (const role of roles) {
        wordSet.add(role.name);
        if (Array.isArray(role.aliases)) {
            for (const alias of role.aliases) {
                wordSet.add(alias);
            }
        }
    }
    const sorted = Array.from(wordSet).sort((a, b) => a.localeCompare(b, 'en'));
    const newContent = sorted.join('\n');

    // 2. 如果文件已存在且内容一致，则跳过写入
    if (fs.existsSync(dictPath)) {
        const oldContent = fs.readFileSync(dictPath, 'utf8');
        const hashOld = crypto.createHash('sha256').update(oldContent).digest('hex');
        const hashNew = crypto.createHash('sha256').update(newContent).digest('hex');
        if (hashOld === hashNew) {
            console.log('🔁 cSpell 字典未变更，跳过写入');
            return;
        }
    }

    // 3. 写入文件
    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.writeFileSync(dictPath, newContent, 'utf8');

    // 4. 更新 settings.json 中 cSpell.customDictionaries
    const config = vscode.workspace.getConfiguration();
    const current = config.get('cSpell.customDictionaries') as any ?? {};

    current['AndreaRoles'] = {
        path: './.vscode/cspell-roles.txt',
        addWords: true
    };

    config.update('cSpell.customDictionaries', current, vscode.ConfigurationTarget.Workspace).then(() => {
        vscode.window.showInformationMessage('✅ 已生成并注册 cSpell 角色词典');
    });
}
