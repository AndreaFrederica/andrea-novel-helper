/* eslint-disable curly */
import * as vscode from 'vscode';
import { Role } from './extension';
import { getPrefix, getSupportedLanguages, typeColorMap } from './utils';
import { hoverRanges } from './activate';
import * as path from 'path';
import * as fs from 'fs';

export const defProv = vscode.languages.registerDefinitionProvider(
    getSupportedLanguages(),
    {
        provideDefinition(document, position) {
            // 1. 先用 hoverRanges 定位到哪个角色
            const hit = hoverRanges.find(h => h.range.contains(position));
            if (!hit) return null;
            const role = hit.role;

            // 2. 找到角色库文件绝对路径
            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const file = cfg.get<string>('rolesFile')!;
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!root) return null;
            const fullPath = path.join(root, file);
            if (!fs.existsSync(fullPath)) return null;

            // 3. 读取文件，按行查找 name 字段
            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split(/\r?\n/);
            const idx = lines.findIndex(line =>
                // 匹配 JSON5 中 name: "xxx"
                new RegExp(`\\bname\\s*:\\s*["']${role.name}["']`).test(line)
            );
            if (idx < 0) return null;

            // 4. 构造跳转目标位置
            const char = lines[idx].indexOf(role.name);
            const targetUri = vscode.Uri.file(fullPath);
            const targetPos = new vscode.Position(idx, char);
            return new vscode.Location(targetUri, targetPos);
        }
    }
);