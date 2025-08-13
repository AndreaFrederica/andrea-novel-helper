/* eslint-disable curly */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getSupportedLanguages } from '../utils/utils';
import { Role } from '../extension';
// 从 HoverProvider 模块导入 hoverRangesMap
import { hoverRangesMap } from './hoverProvider';

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 在指定文件中查找角色定义
 */
function findDefinitionInFile(role: Role, filePath: string): vscode.Location | null {
    if (!fs.existsSync(filePath)) return null;

    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split(/\r?\n/);
        const fileExt = path.extname(filePath).toLowerCase();

        if (fileExt === '.txt') {
            // TXT 文件：直接查找角色名
            const idx = lines.findIndex(l => l.trim() === role.name);
            if (idx >= 0) {
                const col = lines[idx].indexOf(role.name);
                return new vscode.Location(
                    vscode.Uri.file(filePath),
                    new vscode.Position(idx, col)
                );
            }
        } else if (fileExt === '.json5') {
            // JSON5 文件：查找 name 字段
            const namePattern = new RegExp(`\\bname\\s*:\\s*["'\`]${escapeRegExp(role.name)}["'\`]`);
            const idx = lines.findIndex(l => namePattern.test(l));
            if (idx >= 0) {
                const col = lines[idx].indexOf(role.name);
                return new vscode.Location(
                    vscode.Uri.file(filePath),
                    new vscode.Position(idx, col)
                );
            }

            // 如果没找到 name 字段，尝试查找数组中的字符串
            const directStringIdx = lines.findIndex(l => {
                const trimmed = l.trim();
                return trimmed === `"${role.name}",` || 
                       trimmed === `"${role.name}"` ||
                       trimmed === `'${role.name}',` || 
                       trimmed === `'${role.name}'` ||
                       trimmed === `\`${role.name}\`,` || 
                       trimmed === `\`${role.name}\``;
            });
            if (directStringIdx >= 0) {
                const col = lines[directStringIdx].indexOf(role.name);
                return new vscode.Location(
                    vscode.Uri.file(filePath),
                    new vscode.Position(directStringIdx, col)
                );
            }
        }

        return null;
    } catch (error) {
        console.error(`defProvider: 读取文件失败 ${filePath}: ${error}`);
        return null;
    }
}

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

                // 优先使用角色的 sourcePath（包管理器模式）
                if (role.sourcePath) {
                    return findDefinitionInFile(role, role.sourcePath);
                }

                // 回退到传统模式（向后兼容）
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

                // 尝试 JSON5 文件定位
                const jsonLocation = findDefinitionInFile(role, jsonPath);
                if (jsonLocation) return jsonLocation;

                // 尝试 TXT 文件定位
                return findDefinitionInFile(role, txtPath);
            }
        }
    );
    context.subscriptions.push(defProv);
}
