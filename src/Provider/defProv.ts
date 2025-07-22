/* eslint-disable curly */
import * as vscode from 'vscode';
import { Role } from '../extension';
import { getPrefix, getSupportedLanguages, typeColorMap } from '../utils/utils';
import { hoverRanges } from '../activate';
import * as path from 'path';
import * as fs from 'fs';


export const defProv = vscode.languages.registerDefinitionProvider(
    getSupportedLanguages(),
    {
        provideDefinition(document, position) {
            const hit = hoverRanges.find(h => h.range.contains(position));
            if (!hit) return null;
            const role = hit.role;

            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!root) return null;

            // 根据 role.type 选配置项
            let settingKey: 'rolesFile' | 'sensitiveWordsFile' | 'vocabularyFile';
            if (role.type === '敏感词') {
                settingKey = 'sensitiveWordsFile';
            } else if (role.type === '词汇') {
                settingKey = 'vocabularyFile';
            } else {
                settingKey = 'rolesFile';
            }

            const fileRel = cfg.get<string>(settingKey)!;
            const jsonPath = path.join(root, fileRel);
            const txtPath = jsonPath.replace(/\.[^/.]+$/, '.txt');

            // —— 如果是 txt 迁移过来的角色，直接走 TXT 跳转 —— 
            if (role.type === 'txt角色') {
                if (!fs.existsSync(txtPath)) return null;
                const lines = fs.readFileSync(txtPath, 'utf8').split(/\r?\n/);
                const idx = lines.findIndex(l => l.trim() === role.name);
                if (idx < 0) return null;
                const char = lines[idx].indexOf(role.name);
                return new vscode.Location(
                    vscode.Uri.file(txtPath),
                    new vscode.Position(idx, char)
                );
            }

            // 普通角色 / 敏感词 / 词汇：优先 JSON5，再 TXT
            if (fs.existsSync(jsonPath)) {
                const lines = fs.readFileSync(jsonPath, 'utf8').split(/\r?\n/);
                const idx = lines.findIndex(l =>
                    /["']/.test(l) &&
                    new RegExp(`\\bname\\s*:\\s*["']${role.name}["']`).test(l)
                );
                if (idx >= 0) {
                    const char = lines[idx].indexOf(role.name);
                    return new vscode.Location(
                        vscode.Uri.file(jsonPath),
                        new vscode.Position(idx, char)
                    );
                }
            }

            if (fs.existsSync(txtPath)) {
                const lines = fs.readFileSync(txtPath, 'utf8').split(/\r?\n/);
                const idx = lines.findIndex(l => l.trim() === role.name);
                if (idx >= 0) {
                    const char = lines[idx].indexOf(role.name);
                    return new vscode.Location(
                        vscode.Uri.file(txtPath),
                        new vscode.Position(idx, char)
                    );
                }
            }

            return null;
        }
    }
);
