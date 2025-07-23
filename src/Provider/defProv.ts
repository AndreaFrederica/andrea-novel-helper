/* eslint-disable curly */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getSupportedLanguages } from '../utils/utils';
import { Role } from '../extension';
// 从 HoverProvider 模块导入 hoverRangesMap
import { hoverRangesMap } from './hoverProvider';

/**
 * 创建并注册 Definition Provider
 */
export function activateDef(context: vscode.ExtensionContext) {
    const defProv = vscode.languages.registerDefinitionProvider(
        getSupportedLanguages(),
        {
            provideDefinition(document, position) {
                const key = document.uri.toString();
                const ranges = hoverRangesMap.get(key) || [];
                const hit = ranges.find(h => h.range.contains(position));
                if (!hit) return null;
                const role: Role = hit.role;

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

                // txt 类型角色
                if (role.type === 'txt角色') {
                    if (!fs.existsSync(txtPath)) return null;
                    const lines = fs.readFileSync(txtPath, 'utf8').split(/\r?\n/);
                    const idx = lines.findIndex(l => l.trim() === role.name);
                    if (idx < 0) return null;
                    const col = lines[idx].indexOf(role.name);
                    return new vscode.Location(
                        vscode.Uri.file(txtPath),
                        new vscode.Position(idx, col)
                    );
                }

                // 普通 JSON5 文件定位
                if (fs.existsSync(jsonPath)) {
                    const lines = fs.readFileSync(jsonPath, 'utf8').split(/\r?\n/);
                    const idx = lines.findIndex(l => /["']/.test(l) && new RegExp(`\\bname\\s*:\\s*["']${role.name}["']`).test(l));
                    if (idx >= 0) {
                        const col = lines[idx].indexOf(role.name);
                        return new vscode.Location(
                            vscode.Uri.file(jsonPath),
                            new vscode.Position(idx, col)
                        );
                    }
                }

                // 备用 TXT 文件定位
                if (fs.existsSync(txtPath)) {
                    const lines = fs.readFileSync(txtPath, 'utf8').split(/\r?\n/);
                    const idx = lines.findIndex(l => l.trim() === role.name);
                    if (idx >= 0) {
                        const col = lines[idx].indexOf(role.name);
                        return new vscode.Location(
                            vscode.Uri.file(txtPath),
                            new vscode.Position(idx, col)
                        );
                    }
                }

                return null;
            }
        }
    );
    context.subscriptions.push(defProv);
}
