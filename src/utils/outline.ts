/* eslint-disable curly */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';// 递归生成文件夹大纲


function buildFolderOutline(dir: string, indent = 0): string {
    if (!fs.existsSync(dir)) return '';
    let out = `${'  '.repeat(indent)}- **${path.basename(dir)}/**\n`;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out += buildFolderOutline(full, indent + 1);
        } else {
            out += `${'  '.repeat(indent + 1)}- ${entry.name}\n`;
        }
    }
    return out;
}

// 生成当前文件大纲（使用 Symbol Provider）
async function buildFileOutline(uri: vscode.Uri): Promise<string> {
    const symbols =
        (await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            uri
        )) || [];
    const lines: string[] = [];
    function walk(syms: vscode.DocumentSymbol[], depth: number) {
        for (const s of syms) {
            lines.push(
                `${'  '.repeat(depth)}- ${s.name} (行 ${s.range.start.line + 1})`
            );
            if (s.children.length) walk(s.children, depth + 1);
        }
    }
    walk(symbols, 0);
    return lines.join('\n');
}