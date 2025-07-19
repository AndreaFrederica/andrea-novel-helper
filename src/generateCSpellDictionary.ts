/* eslint-disable curly */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { roles } from './activate';
import * as crypto from 'crypto';
import { tokenizeComplexNames } from './utils';

export function generateCSpellDictionary() {
    if (!roles.length) return;

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return;

    const root = folders[0].uri.fsPath;
    const vscodeDir = path.join(root, '.vscode');
    const dictPath = path.join(vscodeDir, 'cspell-roles.txt');

    // 1. 收集角色名、别名和分词结果
    const wordSet = new Set<string>();
    
    for (const role of roles) {
        // 添加原始名称
        wordSet.add(role.name);
        
        // 添加分词结果
        const nameTokens = tokenizeComplexNames(role.name);
        for (const token of nameTokens) {
            if (token !== role.name) { // 避免重复添加原始名称
                wordSet.add(token);
            }
        }
        
        // 处理别名
        if (Array.isArray(role.aliases)) {
            for (const alias of role.aliases) {
                wordSet.add(alias);
                
                // 添加别名的分词结果
                const aliasTokens = tokenizeComplexNames(alias);
                for (const token of aliasTokens) {
                    if (token !== alias) { // 避免重复添加别名
                        wordSet.add(token);
                    }
                }
            }
        }
    }
    
    // 2. 排序并准备写入内容
    const sorted = Array.from(wordSet).sort((a, b) => a.localeCompare(b, 'en'));
    const newContent = sorted.join('\n');

    // 3. 如果文件已存在且内容一致，则跳过写入
    if (fs.existsSync(dictPath)) {
        const oldContent = fs.readFileSync(dictPath, 'utf8');
        const hashOld = crypto.createHash('sha256').update(oldContent).digest('hex');
        const hashNew = crypto.createHash('sha256').update(newContent).digest('hex');
        if (hashOld === hashNew) {
            console.log('🔁 cSpell 字典未变更，跳过写入');
            return;
        }
    }

    // 4. 写入文件
    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.writeFileSync(dictPath, newContent, 'utf8');

    // 5. 更新 settings.json 中 cSpell.customDictionaries
    const config = vscode.workspace.getConfiguration();
    const current = config.get('cSpell.customDictionaries') as any ?? {};

    current['AndreaRoles'] = {
        path: './.vscode/cspell-roles.txt',
        addWords: true
    };

    config.update('cSpell.customDictionaries', current, vscode.ConfigurationTarget.Workspace).then(() => {
        vscode.window.showInformationMessage('✅ 已生成并注册 cSpell 角色词典（含分词）');
    });
}