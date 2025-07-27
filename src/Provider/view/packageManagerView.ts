// src/packageManagerView.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Represents a package (folder) or resource file under novel-helper
 */
export class PackageNode extends vscode.TreeItem {
    constructor(
        public readonly resourceUri: vscode.Uri,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(resourceUri, collapsibleState);
        this.id = resourceUri.fsPath;
        const isDir = fs.statSync(resourceUri.fsPath).isDirectory();
        this.contextValue = isDir ? 'package' : 'resourceFile';
        this.label = path.basename(resourceUri.fsPath);

        // click to open files
        if (!isDir) {
            this.command = {
                command: 'AndreaNovelHelper.openResourceFile',
                title: 'Open File',
                arguments: [this.resourceUri]
            };
        }
    }
}

/**
 * TreeDataProvider for novel-helper packages
 */
export class PackageManagerProvider implements vscode.TreeDataProvider<PackageNode> {
    private _onDidChange = new vscode.EventEmitter<PackageNode | void>();
    readonly onDidChangeTreeData = this._onDidChange.event;

    constructor(private workspaceRoot: string) { }

    refresh(): void {
        this._onDidChange.fire();
    }

    getTreeItem(node: PackageNode): vscode.TreeItem {
        return node;
    }

    async getChildren(node?: PackageNode): Promise<PackageNode[]> {
        const base = node
            ? node.resourceUri.fsPath
            : path.join(this.workspaceRoot, 'novel-helper');

        if (!fs.existsSync(base)) {
            return [];
        }

        const entries = fs.readdirSync(base);
        const nodes: PackageNode[] = [];

        for (const name of entries) {
            // ignore top-level outline folder
            if (!node && name === 'outline') {
                continue;
            }
            const full = path.join(base, name);
            const stat = fs.statSync(full);

            if (stat.isDirectory()) {
                nodes.push(
                    new PackageNode(
                        vscode.Uri.file(full),
                        vscode.TreeItemCollapsibleState.Collapsed
                    )
                );
            } else {
                // resource files: match name patterns
                const match = /character-gallery|sensitive-words|vocabulary/.test(name);
                if (match) {
                    const ext = path.extname(name).toLowerCase();
                    const allowed = ['.json5', '.txt'];
                    const nodeItem = new PackageNode(
                        vscode.Uri.file(full),
                        vscode.TreeItemCollapsibleState.None
                    );
                    if (!allowed.includes(ext)) {
                        nodeItem.label += ' （格式错误）';
                        nodeItem.iconPath = new vscode.ThemeIcon('error');
                        nodeItem.contextValue = 'resourceFileError';
                    }
                    nodes.push(nodeItem);
                }
            }
        }

        return nodes;
    }
}

/**
 * Register view and commands in extension.ts
 */
export function registerPackageManagerView(context: vscode.ExtensionContext) {
    const ws = vscode.workspace.workspaceFolders;
    if (!ws) {
        return;
    }
    const root = ws[0].uri.fsPath;
    const provider = new PackageManagerProvider(root);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('packageManagerView', provider)
    );

    // Create new character-gallery.json5
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.createCharacterGallery', async (node: PackageNode) => {
            const dir = node.resourceUri.fsPath;
            const file = path.join(dir, 'character-gallery.json5');
            if (fs.existsSync(file)) {
                vscode.window.showWarningMessage('character-gallery already exists');
            } else {
                fs.writeFileSync(file, '{\n  // TODO: define characters\n}');
                provider.refresh();
            }
        })
    );
    // Create new sensitive-words
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.createSensitiveWords', async (node: PackageNode) => {
            const dir = node.resourceUri.fsPath;
            const file = await promptForExtension(dir, 'sensitive-words');
            if (file) {
                provider.refresh();
            }
        })
    );
    // Create new vocabulary
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.createVocabulary', async (node: PackageNode) => {
            const dir = node.resourceUri.fsPath;
            const file = await promptForExtension(dir, 'vocabulary');
            if (file) {
                provider.refresh();
            }
        })
    );
    // Create sub-package (folder)
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.createSubPackage', async (node: PackageNode) => {
            const dir = node.resourceUri.fsPath;
            const name = await vscode.window.showInputBox({ prompt: 'Sub-package name' });
            if (name) {
                const newDir = path.join(dir, name);
                if (!fs.existsSync(newDir)) {
                    fs.mkdirSync(newDir);
                    provider.refresh();
                } else {
                    vscode.window.showWarningMessage('Sub-package exists');
                }
            }
        })
    );
}

async function promptForExtension(dir: string, baseName: string): Promise<string | undefined> {
    const ext = await vscode.window.showQuickPick(['json5', 'txt'], { placeHolder: 'Select file format' });
    if (!ext) {
        return;
    }
    const file = path.join(dir, `${baseName}.${ext}`);
    if (fs.existsSync(file)) {
        vscode.window.showWarningMessage(`${baseName}.${ext} already exists`);
        return;
    }
    fs.writeFileSync(file, '');
    return file;
}
