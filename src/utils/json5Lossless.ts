import * as vscode from 'vscode';

const LOSSLESS_CONFIG_KEY = 'json5.losslessEditorEnabled';
const CONFIG_SECTION = 'AndreaNovelHelper';

function getPreferredEol(text: string): '\n' | '\r\n' {
    return text.includes('\r\n') ? '\r\n' : '\n';
}

export function isLosslessJson5Enabled(resource?: vscode.Uri): boolean {
    return vscode.workspace
        .getConfiguration(CONFIG_SECTION, resource)
        .get<boolean>(LOSSLESS_CONFIG_KEY, true);
}

export type LosslessUpdateResult = {
    text?: string;
    error?: string;
};

export function tryLosslessJson5UpdateText(
    originalText: string,
    updatedValue: unknown,
    resource?: vscode.Uri,
): LosslessUpdateResult {
    if (!isLosslessJson5Enabled(resource)) {
        return {};
    }

    try {
        // Lazy load to keep fallback path available if dependency is missing.
        const parserModule = require('@croct/json5-parser') as {
            JsonParser?: { parse: (text: string) => any };
        };
        const parser = parserModule?.JsonParser;

        if (!parser || typeof parser.parse !== 'function') {
            return { error: 'JsonParser.parse is not available in @croct/json5-parser' };
        }

        const source = originalText && originalText.trim().length > 0 ? originalText : '{}';
        const root = parser.parse(source);

        if (!root || typeof root.update !== 'function' || typeof root.toString !== 'function') {
            return { error: 'Parsed CST node does not support update/toString' };
        }

        root.update(updatedValue);

        let text = String(root.toString());
        if (!text.endsWith('\n') && !text.endsWith('\r\n')) {
            text += getPreferredEol(originalText);
        }

        return { text };
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
}
