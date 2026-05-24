import * as vscode from 'vscode';
import { type MarkdownSeparatorRenderMode, ObsidianInlineRenderOptions } from './obsidianInline';

export type MarkdownTxtExportSeparatorMode = 'follow' | 'hidden' | 'preserve';

export function getObsidianInlineRenderOptions(scope?: vscode.ConfigurationScope): ObsidianInlineRenderOptions {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper.obsidian', scope);
    const renderTags = cfg.get<boolean>('renderTags', true);
    const markdownCfg = vscode.workspace.getConfiguration('AndreaNovelHelper.markdown', scope);
    return {
        renderWikilinks: cfg.get<boolean>('renderWikilinks', true),
        tagRenderMode: renderTags ? 'visible' : 'hidden',
        renderEscapedTags: cfg.get<boolean>('renderEscapedTags', false),
        separatorRenderMode: markdownCfg.get<MarkdownSeparatorRenderMode>('separatorRenderMode', 'preserve'),
    };
}

export function getTxtExportObsidianInlineRenderOptions(scope?: vscode.ConfigurationScope): ObsidianInlineRenderOptions {
    const base = getObsidianInlineRenderOptions(scope);
    const markdownCfg = vscode.workspace.getConfiguration('AndreaNovelHelper.markdown', scope);
    const txtExportMode = markdownCfg.get<MarkdownTxtExportSeparatorMode>('txtExportSeparatorMode', 'preserve');
    if (txtExportMode === 'follow') {
        return base;
    }
    return {
        ...base,
        separatorRenderMode: txtExportMode,
    };
}