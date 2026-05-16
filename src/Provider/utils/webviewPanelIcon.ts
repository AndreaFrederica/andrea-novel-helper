import * as path from 'path';
import * as vscode from 'vscode';

const ICON_MAP: Record<string, string> = {
    hello: 'rocket.svg',
    guide: 'guide.svg',
    docs: 'book.svg',
    settings: 'settings.svg',
    dashboard: 'dashboard.svg',
    graph: 'graph.svg',
    comments: 'comment.svg',
    export: 'export.svg',
    files: 'files.svg',
    extension: 'extension.svg',
    git: 'git.svg',
    quick: 'settings.svg',
    heatmap: 'graph.svg',
    wizard: 'rocket.svg'
};

export function setWebviewPanelIcon(panel: vscode.WebviewPanel, extensionPath: string, icon: keyof typeof ICON_MAP | string): void {
    const fileName = ICON_MAP[icon] || icon;
    const basePath = extensionPath || findExtensionPath();
    if (!basePath) return;
    const uri = vscode.Uri.file(path.join(basePath, 'media', 'hello-icons', fileName));
    panel.iconPath = { light: uri, dark: uri };
}

function findExtensionPath(): string {
    return vscode.extensions.getExtension('AndreaFrederica.andrea-novel-helper')?.extensionPath
        || vscode.extensions.all.find(ext => ext.packageJSON?.name === 'andrea-novel-helper')?.extensionPath
        || '';
}
