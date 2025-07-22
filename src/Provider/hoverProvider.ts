/* eslint-disable curly */
import * as vscode from 'vscode';
import { hoverRanges } from '../activate';
import { getSupportedLanguages, typeColorMap } from '../utils/utils';
import { Role } from '../extension';

export const hoverProv = vscode.languages.registerHoverProvider(
    getSupportedLanguages(),
    {
        provideHover(doc, pos) {
            const hit = hoverRanges.find(h => h.range.contains(pos));
            if (!hit) return;
            const r = hit.role;

            // 一定要开启 HTML 支持
            const md = new vscode.MarkdownString('', true);
            md.isTrusted = true;

            md.appendMarkdown(`**${r.name}**`);
            if (r.description) md.appendMarkdown(`\n\n${r.description}`);
            md.appendMarkdown(`\n\n**类型**: ${r.type}`);
            if (r.affiliation) md.appendMarkdown(`\n\n**从属**: ${r.affiliation}`);

            // 准备 Data URI
            const defaultColor = vscode.workspace
                .getConfiguration('AndreaNovelHelper')
                .get<string>('defaultColor')!;
            const c = r.color || typeColorMap[r.type] || defaultColor;
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">` +
                `<rect width="16" height="16" fill="${c}" /></svg>`;
            const b64 = Buffer.from(svg).toString('base64');
            const uri = `data:image/svg+xml;base64,${b64}`;

            // TODO 不能居中
            //md.appendMarkdown(`\n\n**颜色**: ![](${uri}) \`${c}\``);
            md.appendMarkdown(`\n\n**颜色**: ![](${uri}) \`${c}\``);
            md.isTrusted = true;  // 允许渲染 Data URI

            return new vscode.Hover(md, hit.range);
        }
    }
);
