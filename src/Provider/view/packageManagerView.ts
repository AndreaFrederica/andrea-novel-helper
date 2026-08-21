/* eslint-disable curly */
// src/packageManagerView.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { roles, onDidChangeRoles } from '../../activate';
import { Role } from '../../extension';
import { generateCharacterGalleryJson5, generateSensitiveWordsJson5, generateVocabularyJson5, generateRegexPatternsTemplate, generateMarkdownRegexPatternsTemplate, generateMarkdownRoleTemplate, generateMarkdownSensitiveTemplate, generateMarkdownVocabularyTemplate, generateCharacterGalleryToml, generateSensitiveWordsToml, generateVocabularyToml } from '../../templates/templateGenerators';
import { statSync } from 'fs';
import { loadRoles, scanExternalRoleFoldersWithReport, ExternalRoleFolderScanReport, isExternalResourceMarkerFile, isPathUnderAnyRoot, isRoleFile } from '../../utils/utils';
import { generateUUIDv7 } from '../../utils/uuidUtils';
import { updateDecorations } from '../../events/updateDecorations';
import { registerFileChangeCallback, unregisterFileChangeCallback, FileChangeEvent } from '../../utils/tracker/globalFileTracking';
import { generateCustomFileName, generateDefaultFileName } from '../../utils/Parser/markdownParser';
import { globalRelationshipManager } from '../../utils/globalRelationshipManager';
import { AnyNode, RoleTreeDataProvider, RoleTreeItem } from './roleTreeView';
import { PROJECT_CONFIG_MARKDOWN_FILE_NAME, PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME } from '../../projectConfig/constants';
import { getProjectKeywordConfig, mergeProjectKeywordConfigs, type ProjectKeywordConfig } from '../../projectConfig/projectKeywordConfig';
import {
    DEFAULT_PROJECT_KEYWORD_CONFIG,
    FIXED_RESOURCE_KEYWORDS,
    LEGACY_RESOURCE_KEYWORDS,
    RESOURCE_KIND_NAME_KEYWORDS,
    RESOURCE_FILE_KEYWORD_SEPARATOR
} from '../../projectConfig/resourceFileNaming';

type PackageManagerNode = PackageNode | CommonFeaturesRootNode | ProjectSettingsFilesRootNode | ProjectConfigFileNode | HelloPageNode | ProjectInitWizardNode | ProjectSettingsNode | WritingDashboardNode | GlobalRolePanelNode | ReferenceMaintenanceNode | ExternalResourceManageNode | CopilotDocsManageNode | McpStdioScriptNode | GenerateLookupKeysNode | GuideNode | DocCenterNode | BookRootNode | AnyNode;

const PACKAGE_MANAGER_CONFIG_SECTION = 'AndreaNovelHelper.packageManager';
const PACKAGE_CONFIG_SECTION = 'AndreaNovelHelper.package';
const ALWAYS_HIDDEN_INTERNAL_DIRS = new Set(['.anh-fsdb']);

const RESOURCE_KIND_NAME_RE = new RegExp(
    RESOURCE_KIND_NAME_KEYWORDS
        .map(keyword => keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|'),
    'i'
);

function normalizeFsPathForCompare(p: string): string {
    const normalized = path.resolve(p).replace(/[\\/]+/g, path.sep);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isRoleHierarchyNode(node: PackageManagerNode): node is AnyNode {
    return !!node && typeof node === 'object' && 'kind' in node;
}

function isFileSystemTreeNode(node: PackageManagerNode | undefined): node is PackageNode | BookRootNode {
    return !!node && (node instanceof PackageNode || node instanceof BookRootNode);
}

function relativeToWorkspace(workspaceRoot: string, targetPath: string): string {
    const rel = path.relative(workspaceRoot, targetPath);
    return rel && !rel.startsWith('..') ? rel : targetPath;
}

const ROLE_CARRIER_EXTENSIONS = new Set([
    '.md',
    '.markdown',
    '.txt',
    '.csv',
    '.json',
    '.json5',
    '.ojson',
    '.ojson5',
    '.rjson',
    '.rjson5',
    '.tjson5',
    '.toml'
]);

function getOutlineStorageRoots(workspaceRoot: string): string[] {
    const configuredOutlineRoot = vscode.workspace
        .getConfiguration('AndreaNovelHelper')
        .get<string>('outlinePath', 'novel-helper/outline') || 'novel-helper/outline';
    const roots = new Set<string>();
    roots.add(path.isAbsolute(configuredOutlineRoot) ? configuredOutlineRoot : path.join(workspaceRoot, configuredOutlineRoot));
    roots.add(path.join(workspaceRoot, 'novel-helper', 'free-outline'));
    return Array.from(roots);
}

function isOutlineStoragePath(workspaceRoot: string, targetPath: string): boolean {
    const normalizedTarget = normalizeFsPathForCompare(targetPath);
    return getOutlineStorageRoots(workspaceRoot).some(root => {
        const normalizedRoot = normalizeFsPathForCompare(root);
        return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + path.sep);
    });
}

function supportsRoleChildren(fullPath: string): boolean {
    const baseName = path.basename(fullPath);
    const lower = fullPath.toLowerCase();
    const ext = path.extname(lower);

    if (ROLE_CARRIER_EXTENSIONS.has(ext)) {
        return true;
    }

    return isRoleFile(baseName, fullPath) || isExternalResourceMarkerFile(baseName);
}

function applyExpandableFileIcon(node: PackageNode, _fullPath: string): void {
    if (node.collapsibleState === vscode.TreeItemCollapsibleState.None || node.iconPath) {
        return;
    }

    node.iconPath = vscode.ThemeIcon.File;
}

// 解析文件名冲突：如果同名存在，则追加 _YYYYMMDD_HHmmss 或递增索引
function resolveFileConflict(dir: string, baseName: string, ext: string): { path: string; conflicted: boolean; } {
    let target = path.join(dir, baseName + ext);
    if (!fs.existsSync(target)) return { path: target, conflicted: false };
    const timestamp = new Date();
    const pad = (n:number)=> n.toString().padStart(2,'0');
    const ts = `${timestamp.getFullYear()}${pad(timestamp.getMonth()+1)}${pad(timestamp.getDate())}_${pad(timestamp.getHours())}${pad(timestamp.getMinutes())}${pad(timestamp.getSeconds())}`;
    let withTs = path.join(dir, `${baseName}_${ts}${ext}`);
    if (!fs.existsSync(withTs)) return { path: withTs, conflicted: true };
    // 如果时间戳也冲突（极少），再加序号
    let idx = 1;
    while (true) {
        const candidate = path.join(dir, `${baseName}_${ts}_${idx}${ext}`);
        if (!fs.existsSync(candidate)) return { path: candidate, conflicted: true };
        idx++;
    }
}

class CommonFeaturesRootNode extends vscode.TreeItem {
    public readonly resourceUri: vscode.Uri;
    public readonly id: string;

    constructor(public readonly workspaceRoot: string, isExpanded: boolean = true) {
        super('常用功能', isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
        this.resourceUri = vscode.Uri.file(workspaceRoot);
        this.id = `${workspaceRoot}::commonFeatures`;
        this.contextValue = 'commonFeaturesRoot';
        this.iconPath = new vscode.ThemeIcon('list-selection');
        this.description = '向导、设置、文档、维护';
        this.tooltip = 'ANH 常用功能快捷入口';
    }
}

// ANH Hello 首页节点
class HelloPageNode extends vscode.TreeItem {
    public readonly resourceUri: vscode.Uri;

    constructor(public readonly workspaceRoot: string) {
        super('+ ANH Hello 首页', vscode.TreeItemCollapsibleState.None);
        this.resourceUri = vscode.Uri.file(workspaceRoot);
        this.contextValue = 'helloPage';
        this.iconPath = new vscode.ThemeIcon('home');
        this.description = '打开新手首页、文档和常用入口';
        this.command = {
            command: 'AndreaNovelHelper.openHello',
            title: '打开 ANH Hello 首页',
            arguments: []
        };
    }
}

// 项目初始化向导节点
class ProjectInitWizardNode extends vscode.TreeItem {
    public readonly resourceUri: vscode.Uri;

    constructor(public readonly workspaceRoot: string) {
        super('+ 项目初始化向导', vscode.TreeItemCollapsibleState.None);
        this.resourceUri = vscode.Uri.file(workspaceRoot);
        this.contextValue = 'projectInitWizard';
        this.iconPath = new vscode.ThemeIcon('rocket');
        this.description = '图形化创建项目配置和基础结构';
        this.command = {
            command: 'AndreaNovelHelper.projectInitWizard.graphical',
            title: '打开项目初始化向导',
            arguments: []
        };
    }
}

// 项目设置节点
class ProjectSettingsNode extends vscode.TreeItem {
    public readonly resourceUri: vscode.Uri;

    constructor(public readonly workspaceRoot: string) {
        super('+ 项目设置', vscode.TreeItemCollapsibleState.None);
        this.resourceUri = vscode.Uri.file(workspaceRoot);
        this.contextValue = 'projectSettings';
        this.iconPath = new vscode.ThemeIcon('settings-gear');
        this.description = '编辑 anhproject.md 和 project-config.json5';
        this.command = {
            command: 'andrea.openProjectSettings',
            title: '打开项目设置',
            arguments: []
        };
    }
}

// 创作工作台节点
class WritingDashboardNode extends vscode.TreeItem {
    public readonly resourceUri: vscode.Uri;

    constructor(public readonly workspaceRoot: string) {
        super('+ 创作工作台', vscode.TreeItemCollapsibleState.None);
        this.resourceUri = vscode.Uri.file(workspaceRoot);
        this.contextValue = 'writingDashboard';
        this.iconPath = new vscode.ThemeIcon('dashboard');
        this.description = '打开任务、计划和创作记录工作台';
        this.command = {
            command: 'andrea.openWritingDashboard',
            title: '打开创作工作台',
            arguments: []
        };
    }
}

// 角色关系图谱节点
class RoleRelationshipGraphNode extends vscode.TreeItem {
    public readonly resourceUri: vscode.Uri;

    constructor(public readonly workspaceRoot: string) {
        super('+ 角色关系图谱', vscode.TreeItemCollapsibleState.None);
        this.resourceUri = vscode.Uri.file(workspaceRoot);
        this.contextValue = 'roleRelationshipGraph';
        this.iconPath = new vscode.ThemeIcon('graph');
        this.description = '查看角色引用和关系表生成的图谱';
        this.command = {
            command: 'andrea.openRoleRelationshipGraph',
            title: '打开角色关系图谱',
            arguments: []
        };
    }
}

// 全局角色面板节点
class GlobalRolePanelNode extends vscode.TreeItem {
    public readonly resourceUri: vscode.Uri;

    constructor(public readonly workspaceRoot: string) {
        super('+ 全局角色面板', vscode.TreeItemCollapsibleState.None);
        this.resourceUri = vscode.Uri.file(workspaceRoot);
        this.contextValue = 'globalRolePanel';
        this.iconPath = new vscode.ThemeIcon('person');
        this.description = '搜索、浏览和查看所有角色的完整数据';
        this.command = {
            command: 'andrea.openGlobalRolePanel',
            title: '打开全局角色面板',
            arguments: []
        };
    }
}

class ProjectSettingsFilesRootNode extends vscode.TreeItem {
    public readonly resourceUri: vscode.Uri;
    public readonly id: string;

    constructor(public readonly workspaceRoot: string, isExpanded: boolean = true) {
        super('项目设置文件', isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
        this.resourceUri = vscode.Uri.file(workspaceRoot);
        this.id = `${workspaceRoot}::projectSettingsFiles`;
        this.contextValue = 'projectSettingsFilesRoot';
        this.iconPath = new vscode.ThemeIcon('settings-gear');
        this.description = '工作区根目录';
        this.tooltip = `项目设置文件位于: ${workspaceRoot}`;
    }
}

class ProjectConfigFileNode extends vscode.TreeItem {
    public readonly resourceUri: vscode.Uri;

    constructor(public readonly workspaceRoot: string, public readonly filePath: string) {
        const exists = fs.existsSync(filePath);
        super(path.basename(filePath), vscode.TreeItemCollapsibleState.None);
        this.resourceUri = vscode.Uri.file(filePath);
        this.id = filePath;
        this.contextValue = exists ? 'projectConfigFile' : 'missingProjectConfigFile';
        this.iconPath = exists ? new vscode.ThemeIcon('file-code') : new vscode.ThemeIcon('warning');
        this.description = exists ? relativeToWorkspace(workspaceRoot, filePath) : `未创建 · ${relativeToWorkspace(workspaceRoot, filePath)}`;
        this.tooltip = exists ? filePath : `${filePath}\n文件尚未创建，点击打开项目设置页创建/保存。`;
        this.command = {
            command: 'AndreaNovelHelper.openProjectConfigFile',
            title: '打开项目设置文件',
            arguments: [this]
        };
    }
}

// 引用维护节点
class ReferenceMaintenanceNode extends vscode.TreeItem {
    public readonly resourceUri: vscode.Uri;

    constructor(public readonly workspaceRoot: string) {
        super('+ 引用维护和热力图', vscode.TreeItemCollapsibleState.None);
        this.resourceUri = vscode.Uri.file(workspaceRoot);
        this.contextValue = 'referenceMaintenance';
        this.iconPath = new vscode.ThemeIcon('tools');
        this.description = '管理角色引用、查看热力图';
        this.command = {
            command: 'AndreaNovelHelper.showReferenceMaintenance',
            title: '打开引用维护和热力图面板',
            arguments: []
        };
    }
}

// 外部资源目录管理节点
class ExternalResourceManageNode extends vscode.TreeItem {
    public readonly resourceUri: vscode.Uri;

    constructor(public readonly workspaceRoot: string) {
        super('+ 外部资源目录管理', vscode.TreeItemCollapsibleState.None);
        this.resourceUri = vscode.Uri.file(workspaceRoot);
        this.contextValue = 'externalResourceManage';
        this.iconPath = new vscode.ThemeIcon('folder-library');
        this.description = '扫描、添加、移除外部资源目录';
        this.command = {
            command: 'AndreaNovelHelper.showExternalResourceManage',
            title: '打开外部资源目录管理面板',
            arguments: []
        };
    }
}

// Copilot 文档释放节点
class CopilotDocsManageNode extends vscode.TreeItem {
    public readonly resourceUri: vscode.Uri;

    constructor(public readonly workspaceRoot: string) {
        super('+ Copilot 文档释放', vscode.TreeItemCollapsibleState.None);
        this.resourceUri = vscode.Uri.file(workspaceRoot);
        this.contextValue = 'copilotDocsManage';
        this.iconPath = new vscode.ThemeIcon('hubot');
        this.description = '释放内置指令与 Prompt 到当前项目';
        this.command = {
            command: 'andrea.copilot.exportPromptsToWorkspace',
            title: '导出内置 Copilot 提示到当前项目',
            arguments: []
        };
    }
}

// MCP stdio 代理桥释放节点
class McpStdioScriptNode extends vscode.TreeItem {
    public readonly resourceUri: vscode.Uri;

    constructor(public readonly workspaceRoot: string) {
        super('+ MCP stdio 代理桥', vscode.TreeItemCollapsibleState.None);
        this.resourceUri = vscode.Uri.file(workspaceRoot);
        this.contextValue = 'mcpStdioScript';
        this.iconPath = new vscode.ThemeIcon('terminal');
        this.description = '释放 andrea-mcp-stdio.js 到 .vscode/';
        this.command = {
            command: 'andrea.copilot.exportMcpStdioScript',
            title: '导出 MCP stdio 代理桥脚本',
            arguments: []
        };
    }
}

// 查询键生成节点
class GenerateLookupKeysNode extends vscode.TreeItem {
    public readonly resourceUri: vscode.Uri;

    constructor(public readonly workspaceRoot: string) {
        super('+ 生成查询键', vscode.TreeItemCollapsibleState.None);
        this.resourceUri = vscode.Uri.file(workspaceRoot);
        this.contextValue = 'generateLookupKeys';
        this.iconPath = new vscode.ThemeIcon('symbol-key');
        this.description = '为当前角色文件生成拼音和罗马字查询键';
        this.command = {
            command: 'AndreaNovelHelper.generateLookupKeysForCurrentFile',
            title: '为当前角色文件生成查询键',
            arguments: []
        };
    }
}

// 功能引导节点
class GuideNode extends vscode.TreeItem {
    public readonly resourceUri: vscode.Uri;

    constructor(public readonly workspaceRoot: string) {
        super('+ 功能引导', vscode.TreeItemCollapsibleState.None);
        this.resourceUri = vscode.Uri.file(workspaceRoot);
        this.contextValue = 'guide';
        this.iconPath = new vscode.ThemeIcon('book');
        this.description = '查看 ANH 常用功能介绍和快速入口';
        this.command = {
            command: 'AndreaNovelHelper.showGuide',
            title: '打开功能引导',
            arguments: []
        };
    }
}

// 文档中心节点
class DocCenterNode extends vscode.TreeItem {
    public readonly resourceUri: vscode.Uri;

    constructor(public readonly workspaceRoot: string) {
        super('+ 文档中心', vscode.TreeItemCollapsibleState.None);
        this.resourceUri = vscode.Uri.file(workspaceRoot);
        this.contextValue = 'docCenter';
        this.iconPath = new vscode.ThemeIcon('book');
        this.description = '查看 ANH 各模块的详细文档';
        this.command = {
            command: 'AndreaNovelHelper.showGuideDoc',
            title: '打开文档中心',
            arguments: []
        };
    }
}

// 图形化快速设置节点
class GraphicalQuickSettingsNode extends vscode.TreeItem {
    public readonly resourceUri: vscode.Uri;

    constructor(public readonly workspaceRoot: string) {
        super('+ 图形化快速设置', vscode.TreeItemCollapsibleState.None);
        this.resourceUri = vscode.Uri.file(workspaceRoot);
        this.contextValue = 'graphicalQuickSettings';
        this.iconPath = new vscode.ThemeIcon('settings-gear');
        this.description = '可视化调整写作环境，带实时预览';
        this.command = {
            command: 'andrea.openGraphicalQuickSettings',
            title: '打开图形化快速设置',
            arguments: []
        };
    }
}

// 书籍根目录节点（真正的目录，可展开）
class BookRootNode extends vscode.TreeItem {
    public readonly resourceUri: vscode.Uri;

    constructor(public readonly baseDir: string, isExpanded: boolean = false) {
        super(vscode.Uri.file(baseDir), isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
        this.resourceUri = vscode.Uri.file(baseDir);
        this.id = baseDir;
        this.label = path.basename(baseDir); // 显示真实文件夹名
        this.contextValue = 'package'; // 使用 package contextValue 以支持右键菜单
        this.iconPath = new vscode.ThemeIcon('book');
        this.tooltip = `novel-helper 资源目录: ${baseDir}`;
        this.description = '书籍根目录';
    }
}
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

        // click to open files if not a directory
        if (!isDir) {
            // 文件节点点击时使用决策命令（会根据全局或每文件偏好决定用角色卡管理器还是文本编辑器）
            this.command = {
                command: 'AndreaNovelHelper.openFile',
                title: 'Open File',
                arguments: [this.resourceUri]
            };
        }
    }
}

/**
 * TreeDataProvider for novel-helper packages
 */
export class PackageManagerProvider implements vscode.TreeDataProvider<PackageManagerNode> {
    private _onDidChange = new vscode.EventEmitter<PackageManagerNode | void>();
    readonly onDidChangeTreeData = this._onDidChange.event;
    private _onDidChangeExternalFolders = new vscode.EventEmitter<string[]>();
    readonly onDidChangeExternalFolders = this._onDidChangeExternalFolders.event;
    
    // 保存展开状态的键值对
    private expandedNodes = new Set<string>();
    private memento: vscode.Memento;

    // 剪贴板（复制/剪切临时存放路径）
    private copyClipboard: string[] | null = null; // 复制
    private cutClipboard: string[] | null = null;  // 剪切
    private externalRoleFolders: string[] = [];
    private externalScanReport: ExternalRoleFolderScanReport | undefined;
    private readonly roleTreeProvider = new RoleTreeDataProvider({
        roleSvgConfigKey: 'package.roleNodes.display.useRoleSvgIfPresent',
        colorizeRoleNameConfigKey: 'package.roleNodes.display.colorizeRoleName',
        showColorOnValueConfigKey: 'package.roleNodes.details.showColorOnValue',
        enableRoleExpansionConfigKey: 'package.roleNodes.details.enableRoleExpansion',
        alwaysExpandableConfigKey: 'package.roleNodes.details.alwaysExpandable',
        enableWrappingConfigKey: 'package.roleNodes.details.enableWrapping',
        wrapColumnConfigKey: 'package.roleNodes.details.wrapColumn'
    });

    constructor(private workspaceRoot: string, memento: vscode.Memento) { 
        this.memento = memento;
        // 从工作区状态恢复展开状态
        const savedState = this.memento.get<string[]>('packageManagerExpandedNodes', []);
        this.expandedNodes = new Set(savedState);
        this.rescanExternalRoleFolders(false);
    }

    private getPackageManagerConfig(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration('AndreaNovelHelper', vscode.Uri.file(this.workspaceRoot));
    }

    public showGeneralResourceFiles(): boolean {
        return this.getPackageManagerConfig().get<boolean>('packageManager.showGeneralResourceFiles', true);
    }

    public showRoleFileChangeNotifications(): boolean {
        return this.getPackageManagerConfig().get<boolean>('packageManager.showRoleFileChangeNotifications', false);
    }

    public shouldHideHelperEntry(fullPath: string): boolean {
        const helperRoot = path.join(this.workspaceRoot, 'novel-helper');
        if (!isPathUnderAnyRoot(fullPath, [helperRoot])) {
            return false;
        }

        const relativePath = path.relative(helperRoot, fullPath);
        if (!relativePath) {
            return false;
        }

        const segments = relativePath.split(path.sep).filter(Boolean);
        if (segments.length === 0) {
            return false;
        }

        if (isOutlineStoragePath(this.workspaceRoot, fullPath)) {
            return this.getPackageManagerConfig().get<boolean>('packageManager.hideOutlineStorage', true);
        }

        const topLevel = segments[0];
        if (ALWAYS_HIDDEN_INTERNAL_DIRS.has(topLevel)) {
            return true;
        }

        const config = this.getPackageManagerConfig();
        switch (topLevel) {
            case 'comments':
                return config.get<boolean>('packageManager.hideCommentsFolder', true);
            case 'typo':
                return config.get<boolean>('packageManager.hideTypoFolder', true);
            case 'dashboard':
                return config.get<boolean>('packageManager.hideDashboardFolder', false);
            case 'docs':
                return config.get<boolean>('packageManager.hideDocsFolder', false);
            default:
                return false;
        }
    }

    refresh(): void {
        this._onDidChange.fire();
    }

    public rescanExternalRoleFolders(showMessage: boolean = false): ExternalRoleFolderScanReport {
        const previous = this.externalRoleFolders;
        const result = scanExternalRoleFoldersWithReport(vscode.workspace.workspaceFolders);
        this.externalRoleFolders = result.externalFolders;
        this.externalScanReport = result.report;
        const changed = previous.length !== this.externalRoleFolders.length
            || previous.some((item, idx) => item !== this.externalRoleFolders[idx]);
        if (changed) {
            this._onDidChangeExternalFolders.fire([...this.externalRoleFolders]);
        }
        if (showMessage) {
            vscode.window.setStatusBarMessage(`$(search) 外部资源重扫完成：${result.report.externalFolderCount} 个目录`, 3000);
        }
        return result.report;
    }

    public getExternalRoleFolders(): string[] {
        return [...this.externalRoleFolders];
    }

    public getExternalScanReport(): ExternalRoleFolderScanReport | undefined {
        return this.externalScanReport ? { ...this.externalScanReport, externalFolders: [...this.externalScanReport.externalFolders], sampleMatchedFiles: [...this.externalScanReport.sampleMatchedFiles] } : undefined;
    }

    // —— 剪贴板操作 ——
    public setCopy(paths: string[] | null) { this.copyClipboard = paths && paths.length? [...paths]: null; }
    public setCut(paths: string[] | null) { this.cutClipboard = paths && paths.length? [...paths]: null; }
    public hasClipboard() { return (this.copyClipboard && this.copyClipboard.length) || (this.cutClipboard && this.cutClipboard.length); }
    public async pasteInto(targetDir: string) {
        if (!this.hasClipboard()) return;
        const entries: {source: string; base: string; isDir: boolean;}[] = [];
        const pushEntry = (p:string) => {
            if (!fs.existsSync(p)) return; const st = fs.statSync(p);
            entries.push({source: p, base: path.basename(p), isDir: st.isDirectory()});
        };
        if (this.copyClipboard) this.copyClipboard.forEach(pushEntry);
        if (this.cutClipboard) this.cutClipboard.forEach(pushEntry);

        for (const e of entries) {
            let dest = path.join(targetDir, e.base);
            if (fs.existsSync(dest)) {
                // 防冲突：附加 (copy) 递增
                let idx=1; const baseName = path.basename(e.base, path.extname(e.base)); const ext = path.extname(e.base);
                while (fs.existsSync(dest)) {
                    dest = path.join(targetDir, `${baseName} (${idx++})${ext}`);
                }
            }
            if (this.copyClipboard && (!this.cutClipboard || !this.cutClipboard.includes(e.source))) {
                // 复制
                await this.copyRecursive(e.source, dest);
            } else {
                // 剪切或剪切优先 - 使用移动逻辑（支持跨分区）
                await this.moveRecursive(e.source, dest);
            }
        }
        // 剪切后清空
        if (this.cutClipboard) this.cutClipboard = null;
        this.refresh();
    }
    private async copyRecursive(src: string, dest: string) {
        const st = fs.statSync(src);
        if (st.isDirectory()) {
            fs.mkdirSync(dest, {recursive: true});
            for (const name of fs.readdirSync(src)) {
                await this.copyRecursive(path.join(src,name), path.join(dest,name));
            }
        } else {
            fs.copyFileSync(src, dest);
        }
    }
    // 移动操作（支持跨分区）
    private async moveRecursive(src: string, dest: string): Promise<void> {
        const st = fs.statSync(src);
        try {
            // 先尝试 rename（同分区快速移动）
            fs.renameSync(src, dest);
        } catch (err: any) {
            // 跨分区移动失败时，改用复制+删除
            if (err.code === 'EXDEV' || err.code === 'EPERM') {
                if (st.isDirectory()) {
                    fs.mkdirSync(dest, { recursive: true });
                    for (const name of fs.readdirSync(src)) {
                        await this.moveRecursive(path.join(src, name), path.join(dest, name));
                    }
                    // 递归删除源目录
                    fs.rmSync(src, { recursive: true, force: true });
                } else {
                    fs.copyFileSync(src, dest);
                    fs.unlinkSync(src);
                }
            } else {
                throw err;
            }
        }
    }

    // 保存展开状态到工作区
    private saveExpandedState(): void {
        this.memento.update('packageManagerExpandedNodes', Array.from(this.expandedNodes));
    }

    // 处理节点展开
    onDidExpandElement(node: PackageManagerNode): void {
        if (!('id' in node) || !node.id) { return; }
        this.expandedNodes.add(node.id!);
        this.saveExpandedState();
    }

    // 处理节点折叠
    onDidCollapseElement(node: PackageManagerNode): void {
        if (!('id' in node) || !node.id) { return; }
        this.expandedNodes.delete(node.id!);
        this.saveExpandedState();
    }

    getTreeItem(node: PackageManagerNode): vscode.TreeItem {
        if (isRoleHierarchyNode(node)) {
            return this.roleTreeProvider.getTreeItem(node);
        }
        return node;
    }

    getParent(node: PackageManagerNode): PackageManagerNode | undefined {
        if (!isFileSystemTreeNode(node)) return undefined;

        const fullPath = node.resourceUri.fsPath;
        const parentPath = path.dirname(fullPath);
        if (parentPath === fullPath) return undefined;

        const helperRoot = path.join(this.workspaceRoot, 'novel-helper');
        if (normalizeFsPathForCompare(fullPath) === normalizeFsPathForCompare(helperRoot)) return undefined;

        const externalRoot = this.externalRoleFolders.find(folder => {
            const normalizedFolder = normalizeFsPathForCompare(folder);
            const normalizedFullPath = normalizeFsPathForCompare(fullPath);
            return normalizedFullPath === normalizedFolder || normalizedFullPath.startsWith(normalizedFolder + path.sep);
        });
        if (externalRoot && normalizeFsPathForCompare(fullPath) === normalizeFsPathForCompare(externalRoot)) return undefined;

        if (normalizeFsPathForCompare(parentPath) === normalizeFsPathForCompare(helperRoot)) {
            return new BookRootNode(helperRoot, this.expandedNodes.has(helperRoot));
        }

        if (externalRoot && normalizeFsPathForCompare(parentPath) === normalizeFsPathForCompare(externalRoot)) {
            const externalNode = new PackageNode(
                vscode.Uri.file(externalRoot),
                this.expandedNodes.has(externalRoot) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
            );
            externalNode.contextValue = 'externalRoleFolder';
            externalNode.tooltip = `外部角色文件夹: ${externalRoot}`;
            return externalNode;
        }

        if (!fs.existsSync(parentPath)) return undefined;
        return this.applyOutlineStorageContext(new PackageNode(
            vscode.Uri.file(parentPath),
            this.expandedNodes.has(parentPath) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
        ));
    }

    public isManagedResourcePath(filePath: string): boolean {
        const helperRoot = path.join(this.workspaceRoot, 'novel-helper');
        return isPathUnderAnyRoot(filePath, [helperRoot, ...this.externalRoleFolders]);
    }

    public async findNodeByPath(filePath: string): Promise<PackageManagerNode | undefined> {
        if (!filePath || !fs.existsSync(filePath) || !this.isManagedResourcePath(filePath)) return undefined;

        const normalizedTarget = normalizeFsPathForCompare(filePath);
        const roots = (await this.getChildren()).filter(isFileSystemTreeNode);
        let current = roots.find(root => {
            const rootPath = root.resourceUri.fsPath;
            const normalizedRoot = normalizeFsPathForCompare(rootPath);
            return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + path.sep);
        });

        while (current) {
            const currentPath = current.resourceUri.fsPath;
            if (normalizeFsPathForCompare(currentPath) === normalizedTarget) return current;

            const children = (await this.getChildren(current)).filter(isFileSystemTreeNode);
            const next = children.find(child => {
                const childPath = child.resourceUri.fsPath;
                const normalizedChild = normalizeFsPathForCompare(childPath);
                if (normalizedChild === normalizedTarget) return true;
                if (!fs.existsSync(childPath) || !fs.statSync(childPath).isDirectory()) return false;
                return normalizedTarget.startsWith(normalizedChild + path.sep);
            });
            if (!next) return undefined;
            current = next;
        }

        return undefined;
    }

    private getRolesForFile(filePath: string): Role[] {
        const normalized = normalizeFsPathForCompare(filePath);
        return roles
            .filter(role => role.sourcePath && normalizeFsPathForCompare(role.sourcePath) === normalized)
            .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans', { numeric: true, sensitivity: 'base' }));
    }

    private createRoleNodesForFile(filePath: string): AnyNode[] {
        return this.getRolesForFile(filePath).map(role => ({
            kind: 'role',
            key: role.name,
            role,
            affiliation: role.affiliation?.trim() || '(未分组)',
            roleType: role.type || 'unknown',
        } as AnyNode));
    }

    private applyOutlineStorageContext(node: PackageNode): PackageNode {
        const fullPath = node.resourceUri.fsPath;
        if (!isOutlineStoragePath(this.workspaceRoot, fullPath)) return node;

        try {
            node.contextValue = fs.statSync(fullPath).isDirectory() ? 'outlineStorageFolder' : 'outlineStorageFile';
            if (!node.description) node.description = '大纲存储';
        } catch {
            // keep original context for stale nodes
        }

        return node;
    }

    private createFileNode(fullPath: string, contextValue: string, collapsibleState?: vscode.TreeItemCollapsibleState): PackageNode {
        const fileRoles = this.getRolesForFile(fullPath);
        const canShowRoleChildren = supportsRoleChildren(fullPath);
        const shouldExpandForRoles = canShowRoleChildren && fileRoles.length > 0;
        const fileNode = new PackageNode(
            vscode.Uri.file(fullPath),
            collapsibleState ?? (shouldExpandForRoles ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None)
        );
        fileNode.contextValue = contextValue;
        if (shouldExpandForRoles) {
            fileNode.description = `${fileRoles.length} 个角色`;
            fileNode.tooltip = `${fullPath}\n承载角色: ${fileRoles.map(role => role.name).join('、')}`;
        }
        return this.applyOutlineStorageContext(fileNode);
    }

    async getChildren(node?: PackageManagerNode): Promise<PackageManagerNode[]> {
        // 根节点：展示功能按钮 + 书籍根目录
        if (!node) {
            // 1）算出 novel-helper 根目录
            const base = path.join(this.workspaceRoot, 'novel-helper');

            // 2）常用功能与项目配置文件节点
            const commonFeaturesId = `${this.workspaceRoot}::commonFeatures`;
            const projectSettingsFilesId = `${this.workspaceRoot}::projectSettingsFiles`;
            const result: PackageManagerNode[] = [
                new CommonFeaturesRootNode(this.workspaceRoot, this.expandedNodes.has(commonFeaturesId)),
                new ProjectSettingsFilesRootNode(this.workspaceRoot, this.expandedNodes.has(projectSettingsFilesId))
            ];

            // 3) 外部资源目录（由 fast-glob 扫描器提供）
            if (this.externalRoleFolders.length === 0 || this.externalRoleFolders.some(folder => !fs.existsSync(folder))) {
                this.rescanExternalRoleFolders(false);
            }
            console.log(`[PackageManager] 找到 ${this.externalRoleFolders.length} 个外部角色文件夹:`, this.externalRoleFolders);

            // 添加外部文件夹节点
            for (const externalFolder of this.externalRoleFolders) {
                if (!fs.existsSync(externalFolder)) {
                    continue;
                }
                const isExpanded = this.expandedNodes.has(externalFolder);
                const externalNode = new PackageNode(
                    vscode.Uri.file(externalFolder),
                    isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
                );
                // 标记为外部文件夹，用于后续拖放处理
                externalNode.contextValue = 'externalRoleFolder';
                externalNode.tooltip = `外部角色文件夹: ${externalFolder}`;
                result.push(externalNode);
            }

            // 4）书籍根目录（可展开的目录节点）
            if (fs.existsSync(base)) {
                const isExpanded = this.expandedNodes.has(base);
                const bookRootNode = new BookRootNode(base, isExpanded);
                result.push(bookRootNode);
            }

            return result;
        }

        if (node instanceof CommonFeaturesRootNode) {
            return [
                new HelloPageNode(this.workspaceRoot),
                new ProjectInitWizardNode(this.workspaceRoot),
                new ProjectSettingsNode(this.workspaceRoot),
                new WritingDashboardNode(this.workspaceRoot),
                new GlobalRolePanelNode(this.workspaceRoot),
                new RoleRelationshipGraphNode(this.workspaceRoot),
                new ReferenceMaintenanceNode(this.workspaceRoot),
                new ExternalResourceManageNode(this.workspaceRoot),
                new CopilotDocsManageNode(this.workspaceRoot),
                new McpStdioScriptNode(this.workspaceRoot),
                new GenerateLookupKeysNode(this.workspaceRoot),
                new GuideNode(this.workspaceRoot),
                new DocCenterNode(this.workspaceRoot),
                new GraphicalQuickSettingsNode(this.workspaceRoot)
            ];
        }

        if (node instanceof ProjectSettingsFilesRootNode) {
            return [
                new ProjectConfigFileNode(this.workspaceRoot, path.join(this.workspaceRoot, PROJECT_CONFIG_MARKDOWN_FILE_NAME)),
                new ProjectConfigFileNode(this.workspaceRoot, path.join(this.workspaceRoot, PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME))
            ];
        }

        if (node instanceof ProjectConfigFileNode) {
            return [];
        }

        if (isRoleHierarchyNode(node)) {
            const children = this.roleTreeProvider.getChildren(node);
            return Array.isArray(children) ? children : [];
        }

        if (node instanceof PackageNode && !fs.statSync(node.resourceUri.fsPath).isDirectory()) {
            const filePath = node.resourceUri.fsPath;
            return supportsRoleChildren(filePath) ? this.createRoleNodesForFile(filePath) : [];
        }

        // 子节点：扫描目录内容
        const dir = node.resourceUri.fsPath;
        if (!fs.existsSync(dir)) {
            return [];
        }
        return fs.readdirSync(dir).reduce<PackageManagerNode[]>((nodes, name) => {
            const full = path.join(dir, name);
            const stat = fs.statSync(full);

            if (this.shouldHideHelperEntry(full)) {
                return nodes;
            }

            if (stat.isDirectory()) {
                // 根据保存的状态决定子目录展开状态
                const isExpanded = this.expandedNodes.has(full);
                nodes.push(
                    this.applyOutlineStorageContext(new PackageNode(
                        vscode.Uri.file(full),
                        isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
                    ))
                );
            } else {
                // 对于文件，分两类处理
                const ext = path.extname(name).toLowerCase();
                const isRoleFile = ext === '.ojson5' || ext === '.ojson';
                const isRelationshipFile = ext === '.rjson5' || ext === '.rjson';
                const isTimelineFile = ext === '.tjson5';

                if (isRoleFile || isRelationshipFile || isTimelineFile || RESOURCE_KIND_NAME_RE.test(name)) {
                    // 角色相关文件：检查格式并标记错误
                    const allowed = ['.json5', '.txt', '.md', '.csv', '.ojson', '.rjson', '.rjson5', '.ojson5', '.tjson5', '.toml'];
                    const fileNode = this.createFileNode(full, 'resourceFile');

                    // 根据配置决定是否使用自定义图标
                    const iconStyle = vscode.workspace.getConfiguration('AndreaNovelHelper.package').get<string>('iconStyle', 'auto');
                    const useCustomIcon = iconStyle === 'custom' || (iconStyle === 'auto' && (isRoleFile || isRelationshipFile || isTimelineFile));

                    if (useCustomIcon) {
                        // 根据文件类型设置语义化图标
                        if (isRoleFile) {
                            fileNode.iconPath = new vscode.ThemeIcon('person');
                        } else if (isRelationshipFile) {
                            fileNode.iconPath = new vscode.ThemeIcon('type-hierarchy');
                        } else if (isTimelineFile) {
                            fileNode.iconPath = new vscode.ThemeIcon('git-branch');
                        }
                    }
                    // 如果 iconStyle === 'theme' 或者 auto 但不是特殊文件，则不设置 iconPath，使用主题默认图标

                    if (!allowed.includes(ext)) {
                        fileNode.label += ' (格式错误)';
                        fileNode.iconPath = new vscode.ThemeIcon('error');
                        fileNode.contextValue = 'resourceFileError';
                    }
                    applyExpandableFileIcon(fileNode, full);
                    nodes.push(fileNode);
                } else {
                    // 其他资源文件：全部显示，设置为普通资源文件
                    if (!this.showGeneralResourceFiles()) {
                        return nodes;
                    }
                    const fileNode = this.createFileNode(full, 'generalResourceFile'); // 普通资源文件，不被监视

                    applyExpandableFileIcon(fileNode, full);

                    nodes.push(fileNode);
                }
            }
            return nodes;
        }, []);
    }
}

/**
 * Register view and commands in extension.ts
 */
export function registerPackageManagerView(context: vscode.ExtensionContext) {
    const ws = vscode.workspace.workspaceFolders;
    if (!ws) return;

    const rootFsPath = ws[0].uri.fsPath;
    const provider = new PackageManagerProvider(rootFsPath, context.workspaceState);

    // 注册 TreeDataProvider
    const treeView = vscode.window.createTreeView('packageManagerView', {
        treeDataProvider: provider,
        showCollapseAll: true,
        canSelectMany: true,
        dragAndDropController: new class implements vscode.TreeDragAndDropController<PackageManagerNode> {
            dropMimeTypes = ['application/vnd.code.tree.packageManagerView','text/uri-list'];
            dragMimeTypes = ['text/uri-list'];
            async handleDrag(source: readonly PackageManagerNode[], data: vscode.DataTransfer) {
                const dragSources = source.filter(isFileSystemTreeNode);
                if (dragSources.length === 0) { return; }
                data.set('text/uri-list', new vscode.DataTransferItem(dragSources.map(s=>s.resourceUri.toString()).join('\n')));
            }
            async handleDrop(target: PackageManagerNode | undefined, data: vscode.DataTransfer, _token: vscode.CancellationToken) {
                try {
                    const urisRaw = data.get('text/uri-list')?.value as string | undefined;
                    if (!urisRaw) return;
                    const uris = urisRaw.split(/\r?\n/).filter(Boolean).map(u=>vscode.Uri.parse(u));

                    // 确定目标目录
                    const toDir = isFileSystemTreeNode(target) && fs.existsSync(target.resourceUri.fsPath) && fs.statSync(target.resourceUri.fsPath).isDirectory()
                        ? target.resourceUri.fsPath
                        : path.join(rootFsPath,'novel-helper');

                    const paths = uris.map(u=>u.fsPath);
                    const targetName = path.basename(toDir);

                    // 读取配置
                    const config = vscode.workspace.getConfiguration('AndreaNovelHelper.package');
                    const defaultAction = config.get<string>('dragDefaultAction', 'move');

                    let action: 'copy' | 'move' | 'cancel' = 'cancel';

                    if (defaultAction === 'ask') {
                        // 询问用户
                        const result = await vscode.window.showQuickPick([
                            { label: '$(copy) 复制到此处', description: '保留源文件', action: 'copy' as const },
                            { label: '$(arrow-right) 移动到此处', description: '删除源文件', action: 'move' as const },
                            { label: '$(x) 取消', description: '不执行任何操作', action: 'cancel' as const }
                        ], {
                            placeHolder: `将 ${paths.length} 个项目拖放到 "${targetName}"`,
                            title: '选择操作'
                        });
                        if (!result) return;
                        action = result.action;
                    } else {
                        action = defaultAction === 'copy' ? 'copy' : 'move';
                    }

                    if (action === 'cancel') {
                        return;
                    }

                    if (action === 'copy') {
                        provider.setCopy(paths);
                        provider.setCut(null);
                    } else {
                        provider.setCut(paths);
                        provider.setCopy(null);
                    }
                    await provider.pasteInto(toDir);

                } catch (err) {
                    vscode.window.showErrorMessage('拖拽操作失败: '+err);
                }
            }
        }
    });

    // 监听树视图展开/折叠事件以保存状态
    context.subscriptions.push(
        onDidChangeRoles(() => provider.refresh()),
        treeView.onDidExpandElement(e => {
            provider.onDidExpandElement(e.element);
        }),
        treeView.onDidCollapseElement(e => {
            provider.onDidCollapseElement(e.element);
        }),
        treeView
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.package.rescanExternalFolders', async () => {
            const report = provider.rescanExternalRoleFolders(true);
            provider.refresh();
            try {
                loadRoles(true);
                updateDecorations();
            } catch (error) {
                console.error('[PackageManager] 外部资源重扫后刷新角色失败:', error);
            }
            vscode.window.showInformationMessage(`外部资源扫描完成：${report.externalFolderCount} 个目录`);
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.package.showExternalScanReport', async () => {
            const report = provider.getExternalScanReport() || provider.rescanExternalRoleFolders(false);
            await openExternalScanReportPage(report);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.package.revealPath', async (target: vscode.Uri | string | { resourceUri?: vscode.Uri; fsPath?: string }, options?: { silent?: boolean }) => {
            const uri = target instanceof vscode.Uri
                ? target
                : typeof target === 'string'
                    ? vscode.Uri.file(target)
                    : target?.resourceUri ?? (target?.fsPath ? vscode.Uri.file(target.fsPath) : undefined);
            if (!uri) {
                if (!options?.silent) vscode.window.showWarningMessage('未找到要定位的包管理器路径。');
                return false;
            }

            const item = await provider.findNodeByPath(uri.fsPath);
            if (!item) {
                if (!options?.silent) vscode.window.showWarningMessage('包管理器中未找到对应节点。');
                return false;
            }

            try {
                await vscode.commands.executeCommand('packageManagerView.focus');
                await treeView.reveal(item, { select: true, focus: true, expand: true });
                return true;
            } catch (error) {
                if (!options?.silent) vscode.window.showWarningMessage(`包管理器定位失败: ${error}`);
                return false;
            }
        })
    );

    // Command: open file with default application
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.openFileWithDefault', async (uri: vscode.Uri) => {
            try {
                // 使用 VS Code 的默认打开方式
                await vscode.commands.executeCommand('vscode.open', uri);
            } catch (error) {
                vscode.window.showErrorMessage(`无法打开文件: ${error}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.openProjectConfigFile', async (target?: ProjectConfigFileNode | vscode.Uri | string) => {
            const filePath = target instanceof vscode.Uri
                ? target.fsPath
                : typeof target === 'string'
                    ? target
                    : target?.resourceUri?.fsPath;

            if (!filePath) {
                await vscode.commands.executeCommand('andrea.openProjectSettings');
                return;
            }

            if (!fs.existsSync(filePath)) {
                await vscode.commands.executeCommand('andrea.openProjectSettings');
                vscode.window.showWarningMessage(`项目设置文件尚未创建，请在项目设置页保存: ${path.basename(filePath)}`);
                return;
            }

            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            await vscode.window.showTextDocument(doc, { preview: false });
        })
    );

    // Helper: per-file preference store key
    const PER_FILE_KEY = 'andrea.roleJson5.perFileOpen';

    function getPerFilePrefs(): Record<string, boolean> {
        return context.workspaceState.get<Record<string, boolean>>(PER_FILE_KEY, {});
    }


    // —— 引用维护命令 ——
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.showReferenceMaintenance', async () => {
            showReferenceMaintenancePanel(rootFsPath);
        })
    );

    // —— 外部资源目录管理命令 ——
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.showExternalResourceManage', async () => {
            showExternalResourceManagePanel(provider);
        })
    );

    // —— 复制 / 剪切 / 粘贴 命令 ——
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.package.copy', (node: PackageNode | PackageNode[]) => {
            const nodes = (Array.isArray(node)? node: treeView.selection.length? treeView.selection: [node]).filter(isFileSystemTreeNode);
            if (nodes.length === 0) { return; }
            provider.setCopy(nodes.map(n=>n.resourceUri.fsPath));
            provider.setCut(null);
            vscode.window.setStatusBarMessage(`已复制 ${nodes.length} 个项目`, 2000);
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.package.cut', (node: PackageNode | PackageNode[]) => {
            const nodes = (Array.isArray(node)? node: treeView.selection.length? treeView.selection: [node]).filter(isFileSystemTreeNode);
            if (nodes.length === 0) { return; }
            provider.setCut(nodes.map(n=>n.resourceUri.fsPath));
            provider.setCopy(null);
            vscode.window.setStatusBarMessage(`已剪切 ${nodes.length} 个项目`, 2000);
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.package.paste', async (target?: PackageNode) => {
            const dir = target && fs.existsSync(target.resourceUri.fsPath) && fs.statSync(target.resourceUri.fsPath).isDirectory()? target.resourceUri.fsPath: path.join(rootFsPath,'novel-helper');
            await provider.pasteInto(dir);
            vscode.window.setStatusBarMessage('粘贴完成', 2000);
        })
    );

    // Command: open file
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.openFile', async (uri: vscode.Uri | PackageNode) => {
            try {
                // 如果传入的是 PackageNode，提取 resourceUri
                const fileUri = uri instanceof vscode.Uri ? uri : (uri as PackageNode).resourceUri;

                // consult per-file preference and global config
                const prefs = getPerFilePrefs();
                const pref = prefs[fileUri.fsPath];
                const globalDefault = vscode.workspace.getConfiguration().get<boolean>('andrea.roleJson5.openWithRoleManager', true);

                const shouldOpenWithManager = typeof pref === 'boolean' ? pref : !!globalDefault;

                // Decide by extension: .json5/.ojson5/.ojson are eligible for role manager.
                const ext = path.extname(fileUri.fsPath).toLowerCase();
                if (ext === '.json5' || ext === '.ojson5' || ext === '.ojson') {
                    if (shouldOpenWithManager) {
                        try {
                            // ensure it's recognized as role-related before opening with manager
                            if (shouldUpdateRoles(fileUri.fsPath)) {
                                await vscode.commands.executeCommand('vscode.openWith', fileUri, 'andrea.roleJson5Editor');
                                return;
                            }
                        } catch (err) {
                            console.warn('openWith andrea.roleJson5Editor failed, fallback to vscode.open', err);
                        }
                    }
                    // fallback to VS Code default open for .json5
                    await vscode.commands.executeCommand('vscode.open', fileUri);
                    return;
                }

                // For markdown and all other types use VS Code default opening behavior
                await vscode.commands.executeCommand('vscode.open', fileUri);
                return;
            } catch (error) {
                vscode.window.showErrorMessage(`无法打开文件: ${error}`);
            }
        })
    );

        // 右键快速切换：是否使用角色卡管理器打开 JSON5 文件（全局布尔开关）
        context.subscriptions.push(
            vscode.commands.registerCommand('AndreaNovelHelper.toggleRoleManagerOpenForFile', async (resource?: vscode.Uri) => {
                try {
                    const config = vscode.workspace.getConfiguration();
                    const key = 'andrea.roleJson5.openWithRoleManager';
                    const current = config.get<boolean>(key, true);
                    const target = !current;
                    // 优先更新工作区设置（如果有工作区），否则用户设置
                    const targetScope = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
                    await config.update(key, target, targetScope);
                    vscode.window.showInformationMessage(`已${target ? '启用' : '禁用'}：使用角色卡管理器打开 JSON5 文件（全局设置）`);
                } catch (e) {
                    console.error('[ANH] toggleRoleManagerOpenForFile error', e);
                    vscode.window.showErrorMessage('切换角色卡管理器打开方式失败，请在设置中手动修改。');
                }
            })
        );

    // Command: open with specific application
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.openWith', async (node: PackageNode) => {
            const filePath = node.resourceUri.fsPath;
            const fileName = path.basename(filePath);
            
            // 直接调用 VS Code 的内置"打开方式"命令
            try {
                await vscode.commands.executeCommand('explorer.openWith', node.resourceUri);
            } catch (error) {
                // 如果上面的命令不可用，提供一个简化的选择菜单
                const options = [
                    {
                        label: 'VS Code 编辑器',
                        description: '在当前编辑器中打开',
                        action: 'vscode'
                    },
                    {
                        label: 'VS Code 新窗口',
                        description: '在新的 VS Code 窗口中打开',
                        action: 'vscode-new'
                    },
                    {
                        label: '系统默认程序',
                        description: '使用系统默认关联程序打开',
                        action: 'system-default'
                    },
                    {
                        label: '文件资源管理器',
                        description: '在文件资源管理器中显示',
                        action: 'explorer'
                    }
                ];

                const selected = await vscode.window.showQuickPick(options, {
                    placeHolder: `选择打开 ${fileName} 的方式`,
                    title: '打开方式'
                });

                if (selected) {
                    await executeOpenAction(selected.action, node.resourceUri);
                }
            }
        })
    );

    // Command: reveal in file explorer
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.revealInExplorer', async (node: PackageNode) => {
            try {
                await vscode.commands.executeCommand('revealFileInOS', node.resourceUri);
            } catch (error) {
                vscode.window.showErrorMessage(`无法在文件资源管理器中显示文件: ${error}`);
            }
        })
    );

    // Command: delete package or file
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.deleteNode', async (node: PackageNode) => {
            const confirm = await vscode.window.showWarningMessage(
                `Delete ${node.label}?`, { modal: true }, 'Yes'
            );
            if (confirm === 'Yes') {
                const p = node.resourceUri.fsPath;
                statSync(p).isDirectory() ? fs.rmdirSync(p, { recursive: true }) : fs.unlinkSync(p);
                provider.refresh();
            }
        })
    );

    // 统一创建命令：角色库 / 敏感词库 / 词汇库 （内部选择 json5 / txt / md / csv / toml）
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.createCharacterGallery', async (node: PackageNode | BookRootNode) => {
            const file = await promptForExtensionCustom(node.resourceUri.fsPath, { defaultBase: getLegacyResourceKeyword('character'), kind: 'character' });
            if (file) provider.refresh();
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.createSensitiveWords', async (node: PackageNode | BookRootNode) => {
            const file = await promptForExtensionCustom(node.resourceUri.fsPath, { defaultBase: getLegacyResourceKeyword('sensitive'), kind: 'sensitive' });
            if (file) provider.refresh();
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.createVocabulary', async (node: PackageNode | BookRootNode) => {
            const file = await promptForExtensionCustom(node.resourceUri.fsPath, { defaultBase: getLegacyResourceKeyword('vocabulary'), kind: 'vocabulary' });
            if (file) provider.refresh();
        })
    );

    // 新增：创建 ojson5 和 rjson5 文件的命令
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.createRoleFile', async (node: PackageNode | BookRootNode) => {
            const file = await createRoleFile(node.resourceUri.fsPath);
            if (file) provider.refresh();
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.createRelationshipFile', async (node: PackageNode | BookRootNode) => {
            const file = await createRelationshipFile(node.resourceUri.fsPath);
            if (file) provider.refresh();
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.createTimelineFile', async (node: PackageNode | BookRootNode) => {
            const file = await createTimelineFile(node.resourceUri.fsPath);
            if (file) provider.refresh();
        })
    );

    // Command: create sub-package
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.createSubPackage', async (node: PackageNode | BookRootNode) => {
            const name = await vscode.window.showInputBox({ prompt: 'Sub-package name' });
            if (!name) return;
            const newDir = path.join(node.resourceUri.fsPath, name);
            if (fs.existsSync(newDir)) {
                vscode.window.showWarningMessage('Sub-package already exists');
            } else {
                fs.mkdirSync(newDir);
                provider.refresh();
            }
        })
    );

    // Command: rename package or file
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'AndreaNovelHelper.renamePackage',
            async (node: PackageNode) => {
                const stat = fs.statSync(node.resourceUri.fsPath);
                if (stat.isDirectory()) {
                    // 原有的包重命名逻辑
                    const oldName = node.label as string;
                    const newName = await vscode.window.showInputBox({
                        prompt: `重命名包 ${oldName}`,
                        value: oldName
                    });
                    if (!newName || newName === oldName) {
                        return;
                    }

                    // 计算旧路径和新路径
                    const oldPath = node.resourceUri.fsPath;
                    const newPath = path.join(path.dirname(oldPath), newName);
                    if (fs.existsSync(newPath)) {
                        vscode.window.showErrorMessage(`目标名称 "${newName}" 已存在`);
                        return;
                    }

                    // 重命名文件夹
                    fs.renameSync(oldPath, newPath);
                    provider.refresh();
                } else {
                    // 新的文件重命名逻辑
                    const newFileName = await promptForFileRename(node);
                    if (newFileName) {
                        provider.refresh();
                    }
                }
            }
        )
    );

    // 旧的单独 md / txt 创建命令已移除，避免菜单冗余

    // Command: create regex patterns file
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.createRegexPatterns', async (node: PackageNode | BookRootNode) => {
            const file = await createRegexPatternsFile(node.resourceUri.fsPath);
            if (file) provider.refresh();
        })
    );

    // —— 使用全局文件追踪系统 —— 
    const helperRoot = path.join(rootFsPath, 'novel-helper');

    const getManagedRoots = () => [helperRoot, ...provider.getExternalRoleFolders()];
    const isManagedPath = (filePath: string) => isPathUnderAnyRoot(filePath, getManagedRoots());
    const isHelperPath = (filePath: string) => isPathUnderAnyRoot(filePath, [helperRoot]);
    const workspaceRoots = (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.fsPath);
    const isWorkspacePath = (filePath: string) => isPathUnderAnyRoot(filePath, workspaceRoots);

    // 改进的过滤逻辑：只关注受管理目录中的相关文件和目录
    const shouldRefresh = (filePath: string) => {
        if (!isManagedPath(filePath)) {
            return false;
        }

        // helperRoot 下继续沿用原有排除规则
        if (isHelperPath(filePath)) {
            if (provider.shouldHideHelperEntry(filePath)) {
                return false;
            }
            if (!provider.showGeneralResourceFiles()) {
                const baseName = path.basename(filePath);
                if (!isExternalResourceMarkerFile(baseName) && !isRoleFile(baseName, filePath)) {
                    try {
                        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isDirectory()) {
                            return false;
                        }
                    } catch {
                        return false;
                    }
                }
            }
            if (normalizeFsPathForCompare(filePath) === normalizeFsPathForCompare(helperRoot)) {
                return false;
            }
        }

        // 如果是目录变化，总是刷新（用于显示结构变化）
        try {
            if (!fs.existsSync(filePath)) {
                return true;
            }
            if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
                return true;
            }
        } catch {
            // 文件可能已被删除，仍需要刷新
        }

        const baseName = path.basename(filePath);
        return isExternalResourceMarkerFile(baseName) || isRoleFile(baseName, filePath);
    };

    // 角色数据更新：标识文件变化均触发增量角色刷新
    const shouldUpdateRoles = (filePath: string) => {
        if (!isManagedPath(filePath)) {
            return false;
        }
        const baseName = path.basename(filePath);
        // 标记文件变化会影响外部目录识别；角色文件变化会影响角色/装饰实时结果。
        if (isExternalResourceMarkerFile(baseName)) {
            return true;
        }
        return isRoleFile(baseName, filePath);
    };

    // 统一的刷新处理函数
    const handleFileChange = (event: FileChangeEvent) => {
        const touchedPaths = [event.filePath, event.oldPath].filter((p): p is string => !!p);
        let hasManagedChange = touchedPaths.some(isManagedPath);

        // 外部目录新增标识文件时，先重扫目录列表再判断
        if (!hasManagedChange && touchedPaths.some(p => {
            const baseName = path.basename(p);
            return isExternalResourceMarkerFile(baseName) || isRoleFile(baseName, p);
        })) {
            provider.rescanExternalRoleFolders(false);
            hasManagedChange = touchedPaths.some(isManagedPath);
        }

        if (!hasManagedChange) {
            return;
        }

        // 只有角色相关文件才触发角色数据更新
        const changedRolePaths = touchedPaths.filter(shouldUpdateRoles);
        const needTreeRefresh = touchedPaths.some(shouldRefresh);
        if (!needTreeRefresh && changedRolePaths.length === 0) {
            return;
        }

        console.log(`包管理器：检测到文件${event.type} ${event.filePath}`);
        if (needTreeRefresh) {
            provider.refresh();
        }

        if (changedRolePaths.length > 0) {
            try {
                loadRoles(false, changedRolePaths);

                // 触发装饰器更新
                try {
                    updateDecorations();
                } catch (error) {
                    console.error(`装饰器更新失败: ${error}`);
                }
                
                // 显示用户通知
                const fileName = path.basename(event.filePath);
                const changeTypeMap: { [key: string]: string } = {
                    'create': '创建',
                    'delete': '删除', 
                    'change': '修改',
                    'rename': '重命名'
                };
                if (provider.showRoleFileChangeNotifications()) {
                    vscode.window.showInformationMessage(`检测到角色文件${changeTypeMap[event.type]}: ${fileName}`);
                }
            } catch (error) {
                console.error(`角色数据更新失败: ${error}`);
            }
        }
    };

    // 注册全局文件追踪回调
    registerFileChangeCallback('packageManager', handleFileChange);

    // 为工作区外的外部目录补充监听，确保其修改也能触发热重载。
    const externalFolderWatchers = new Map<string, vscode.FileSystemWatcher>();
    const syncExternalFolderWatchers = () => {
        const expected = new Set(provider.getExternalRoleFolders().map(folder => path.resolve(folder)));

        for (const [folder, watcher] of externalFolderWatchers.entries()) {
            if (!expected.has(folder)) {
                watcher.dispose();
                externalFolderWatchers.delete(folder);
            }
        }

        for (const folder of expected) {
            if (externalFolderWatchers.has(folder)) {
                continue;
            }
            // 工作区内目录已由全局 fileTracker 监听，避免重复触发。
            if (isWorkspacePath(folder)) {
                continue;
            }
            const pattern = new vscode.RelativePattern(folder, '**/*');
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            watcher.onDidCreate(uri => handleFileChange({ type: 'create', filePath: uri.fsPath, timestamp: Date.now() }));
            watcher.onDidChange(uri => handleFileChange({ type: 'change', filePath: uri.fsPath, timestamp: Date.now() }));
            watcher.onDidDelete(uri => handleFileChange({ type: 'delete', filePath: uri.fsPath, timestamp: Date.now() }));
            externalFolderWatchers.set(folder, watcher);
            context.subscriptions.push(watcher);
        }
    };
    context.subscriptions.push(provider.onDidChangeExternalFolders(() => syncExternalFolderWatchers()));
    syncExternalFolderWatchers();

    // 额外监听文本文档保存事件（更精确的文件内容变化检测）
    const saveWatcher = vscode.workspace.onDidSaveTextDocument((document) => {
        const filePath = document.uri.fsPath;

        if (!isManagedPath(filePath)) {
            const baseName = path.basename(filePath);
            if (isExternalResourceMarkerFile(baseName) || isRoleFile(baseName, filePath)) {
                provider.rescanExternalRoleFolders(false);
            }
        }

        if (!isManagedPath(filePath)) {
            return;
        }

        const needTreeRefresh = shouldRefresh(filePath);
        const needRoleUpdate = shouldUpdateRoles(filePath);
        if (needTreeRefresh || needRoleUpdate) {
            console.log(`包管理器：检测到相关文件保存 ${filePath}`);
            if (needTreeRefresh) {
                provider.refresh();
            }
            
            // 只有角色相关文件才触发角色数据更新
            if (needRoleUpdate) {
                try {
                    loadRoles(false, [filePath]);
                    
                    // 触发装饰器更新
                    try {
                        updateDecorations();
                    } catch (error) {
                        console.error(`装饰器更新失败: ${error}`);
                    }
                } catch (error) {
                    console.error(`角色数据更新失败: ${error}`);
                }
            }
        }
    });

    context.subscriptions.push(saveWatcher);

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration(PACKAGE_MANAGER_CONFIG_SECTION) || event.affectsConfiguration(PACKAGE_CONFIG_SECTION)) {
            provider.refresh();
        }
    }));

    // 清理函数：取消注册文件追踪回调
    context.subscriptions.push({
        dispose: () => {
            unregisterFileChangeCallback('packageManager');
        }
    });
}

async function openExternalScanReportPage(report: ExternalRoleFolderScanReport): Promise<void> {
    // 获取数据库统计信息
    const dbBackend = vscode.workspace.getConfiguration('AndreaNovelHelper').get<string>('database.backend', 'json');
    const relationshipStats = globalRelationshipManager.getStatistics();
    const roleCount = relationshipStats.totalRoles;
    const relationshipCount = relationshipStats.totalRelationships;

    // 统计各类型关系
    const relationshipTypeStats: string[] = [];
    relationshipStats.relationshipsByType.forEach((count, type) => {
        relationshipTypeStats.push(`  - ${type}: ${count}`);
    });

    const lines: string[] = [
        '# 资源扫描报告',
        '',
        '---',
        '',
        '## 📊 数据库统计',
        '',
        `- 数据库类型: \`${dbBackend === 'json' ? 'JSON 文件' : dbBackend}\``,
        `- 已加载角色数: ${roleCount}`,
        `- 已加载关系数: ${relationshipCount}`,
        '',
        relationshipTypeStats.length > 0 ? '### 关系类型分布' : '',
        ...relationshipTypeStats,
        '',
        '---',
        '',
        '## 📂 外部资源目录',
        '',
        `- 生成时间: ${new Date(report.generatedAt).toLocaleString()}`,
        `- 扫描耗时: ${report.durationMs} ms`,
        `- 工作区根目录数: ${report.workspaceRoots.length}`,
        `- 候选文件数: ${report.totalCandidateFiles}`,
        `- 命中 legacy __init__.ojson5: ${report.matchedLegacyInitFiles}`,
        `- 命中标识文件: ${report.matchedMarkerFiles}`,
        `- 外部资源目录数: ${report.externalFolderCount}`,
        '',
        '### 工作区根目录',
        ...report.workspaceRoots.map(root => `- \`${root}\``),
        '',
        '### 忽略目录',
        ...report.ignoredDirectories.map(item => `- \`${item}\``),
        '',
        `### 关键字（${report.markerKeywords.length}）`,
        ...report.markerKeywords.map(item => `- \`${item}\``),
        '',
        `### 外部资源目录（全量 ${report.externalFolders.length}）`,
        ...report.externalFolders.map(item => `- \`${item}\``),
        '',
        `### 命中文件（全量 ${report.sampleMatchedFiles.length}）`,
        ...report.sampleMatchedFiles.map(item => `- \`${item}\``),
        ''
    ];
    const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'markdown' });
    await vscode.window.showTextDocument(doc, { preview: false });
}

interface ExtensionCustomOptions { defaultBase: string; kind: 'character' | 'sensitive' | 'vocabulary'; }
const AUTO_KEYWORD_NAMING_SETTING = 'packageManager.enableAutoKeywordNaming';

function isAutoKeywordNamingEnabled(): boolean {
    return vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>(AUTO_KEYWORD_NAMING_SETTING, true) === true;
}

function getResourceFileKeyword(kind: ExtensionCustomOptions['kind']): string {
    return FIXED_RESOURCE_KEYWORDS[kind];
}

function getLegacyResourceKeyword(kind: ExtensionCustomOptions['kind']): string {
    return LEGACY_RESOURCE_KEYWORDS[kind];
}

function getKeywordCandidatesForKind(kind: ExtensionCustomOptions['kind'], filePathOrDir?: string): string[] {
    const mergedKeywordConfig = mergeProjectKeywordConfigs(
        DEFAULT_PROJECT_KEYWORD_CONFIG,
        getProjectKeywordConfig(filePathOrDir)
    );

    const kindKeywords = kind === 'character'
        ? mergedKeywordConfig.characterFileKeywords
        : kind === 'sensitive'
            ? mergedKeywordConfig.sensitiveWordsFileKeywords
            : mergedKeywordConfig.vocabularyFileKeywords;

    return Array.from(new Set([
        ...kindKeywords,
        getLegacyResourceKeyword(kind),
        getResourceFileKeyword(kind)
    ].map(item => item.trim()).filter(Boolean)));
}

function splitResourceBaseNameByKeyword(baseName: string, kind: ExtensionCustomOptions['kind'], filePathOrDir?: string): { namePart: string; keywordPart: string; matched: boolean } {
    const trimmed = baseName.trim();
    const normalizedNamePart = trimmed.replace(/\s+/g, '-');
    const candidates = getKeywordCandidatesForKind(kind, filePathOrDir)
        .sort((left, right) => right.length - left.length);
    const lower = trimmed.toLowerCase();

    for (const candidate of candidates) {
        const candidateLower = candidate.toLowerCase();
        if (lower === candidateLower) {
            return { namePart: '', keywordPart: trimmed, matched: true };
        }

        const suffix = `${RESOURCE_FILE_KEYWORD_SEPARATOR}${candidateLower}`;
        if (!lower.endsWith(suffix)) {
            continue;
        }

        const prefixLength = trimmed.length - candidate.length - RESOURCE_FILE_KEYWORD_SEPARATOR.length;
        if (prefixLength <= 0) {
            continue;
        }

        const namePart = trimmed.slice(0, prefixLength).trim().replace(/\s+/g, '-');
        const keywordPart = trimmed.slice(trimmed.length - candidate.length);
        if (!namePart) {
            continue;
        }

        return { namePart, keywordPart, matched: true };
    }

    return { namePart: normalizedNamePart, keywordPart: getResourceFileKeyword(kind), matched: false };
}

function buildResourceBaseName(customName: string, kind: ExtensionCustomOptions['kind'], autoAppendKeyword: boolean, keywordOverride?: string): string {
    const normalizedName = customName.trim().replace(/\s+/g, '-');
    if (!autoAppendKeyword) {
        return normalizedName;
    }

    const keyword = keywordOverride?.trim() || getResourceFileKeyword(kind);
    if (!normalizedName) {
        return keyword;
    }

    if (normalizedName.toLowerCase().includes(keyword.toLowerCase())) {
        return normalizedName;
    }

    return `${normalizedName}${RESOURCE_FILE_KEYWORD_SEPARATOR}${keyword}`;
}

async function promptForExtensionCustom(dir: string, opts: ExtensionCustomOptions): Promise<string | undefined> {
    const baseInput = await vscode.window.showInputBox({
        prompt: '输入基础文件名（不含扩展名，可留空）',
        placeHolder: '例如: 主要人物、禁用词汇等'
    });
    if (baseInput === undefined) return; // 取消

    const extPick = await vscode.window.showQuickPick(['json5','txt','md','csv','toml'], { placeHolder: '选择文件格式 (json5 / txt / md / csv / toml)' });
    if (!extPick) return;

    const autoKeywordNaming = isAutoKeywordNamingEnabled();
    const baseNameRaw = autoKeywordNaming
        ? buildResourceBaseName(baseInput, opts.kind, true)
        : (baseInput.trim() || opts.defaultBase).replace(/\s+/g, '-');

    if (!baseNameRaw) {
        vscode.window.showWarningMessage('文件名为空且未自动添加关键词，请输入文件名或开启自动添加关键词。');
        return;
    }

    const fileInfo = resolveFileConflict(dir, baseNameRaw, '.'+extPick);
    let initialContent = '';
    if (extPick === 'json5') {
        if (opts.kind === 'sensitive') initialContent = generateSensitiveWordsJson5();
        else if (opts.kind === 'vocabulary') initialContent = generateVocabularyJson5();
        else if (opts.kind === 'character') initialContent = generateCharacterGalleryJson5();
        else initialContent = '[\n  // 新文件\n]';
    } else if (extPick === 'txt') {
        if (opts.kind === 'character') initialContent = '# 一行一个角色名称 (支持 # / // 注释)';
        else if (opts.kind === 'sensitive') initialContent = '# 一行一个敏感词 (支持 # / // 注释)';
        else if (opts.kind === 'vocabulary') initialContent = '# 一行一个词汇/术语 (支持 # / // 注释)';
    } else if (extPick === 'md') {
        if (opts.kind === 'character') initialContent = generateMarkdownRoleTemplate();
        else if (opts.kind === 'sensitive') initialContent = generateMarkdownSensitiveTemplate();
        else if (opts.kind === 'vocabulary') initialContent = generateMarkdownVocabularyTemplate();
        else initialContent = '# 新文件\n';
    } else if (extPick === 'csv') {
        initialContent = generateDelimitedCsvTemplate(opts.kind);
    } else if (extPick === 'toml') {
        if (opts.kind === 'character') initialContent = generateCharacterGalleryToml();
        else if (opts.kind === 'sensitive') initialContent = generateSensitiveWordsToml();
        else if (opts.kind === 'vocabulary') initialContent = generateVocabularyToml();
        else initialContent = '# 新文件\n';
    }
    fs.writeFileSync(fileInfo.path, initialContent + (initialContent.endsWith('\n')? '':'\n'), 'utf8');
    // 自动打开新文件
    try {
        const doc = await vscode.workspace.openTextDocument(fileInfo.path);
        await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
        console.warn('自动打开新文件失败: ', err);
    }
    if (fileInfo.conflicted) vscode.window.showInformationMessage(`文件已存在，自动使用名称: ${path.basename(fileInfo.path)}`);
    return fileInfo.path;
}

function generateDelimitedCsvTemplate(kind: ExtensionCustomOptions['kind']): string {
    if (kind === 'sensitive') {
        return [
            'name,description,fixes,lookupKeys,lookupKeys_pinyin,lookupKeys_romanized,lookupKeys_spelling',
            '示例敏感词,这是一个示例敏感词,"替换词1;替换词2","示例检索词;示例反查词",shi li min gan ci,shi li min gan ci,shiliminganci'
        ].join('\n');
    }

    if (kind === 'vocabulary') {
        return [
            'name,description,aliases,lookupKeys,lookupKeys_pinyin,lookupKeys_romanized,lookupKeys_spelling',
            '示例词汇,这是一个示例词汇,"别名1;别名2","示例检索词;示例反查词",shi li ci hui,shi li ci hui,shilicihui'
        ].join('\n');
    }

    return [
        'name,description,aliases,lookupKeys,lookupKeys_pinyin,lookupKeys_romanized,lookupKeys_spelling',
        '示例角色,这是一个示例角色,"别名1;别名2","示例检索词;示例反查词",shi li jue se,shi li jue se,shilijuese'
    ].join('\n');
}

async function createRegexPatternsFile(dir: string): Promise<string | undefined> {
    const format = await vscode.window.showQuickPick(['md', 'json5'], { placeHolder: '选择正则表达式配置格式 (推荐 Markdown)' });
    if (!format) return;

    // 询问自定义文件名
    const customName = await vscode.window.showInputBox({
        prompt: '输入正则表达式文件的自定义名称（留空使用默认名称）',
        placeHolder: '例如: 对话着色、特殊格式等'
    });
    
    // 生成文件名
    let fileNameBase: string;
    if (customName && customName.trim()) {
        fileNameBase = `${customName.trim()}_regex-patterns`;
    } else {
        fileNameBase = 'regex-patterns';
    }
    const fileInfo = resolveFileConflict(dir, fileNameBase, '.' + format);
    
    const template = format === 'md' ? generateMarkdownRegexPatternsTemplate() : generateRegexPatternsTemplate();
    fs.writeFileSync(fileInfo.path, template, 'utf8');
    const document = await vscode.workspace.openTextDocument(fileInfo.path);
    await vscode.window.showTextDocument(document);
    if (fileInfo.conflicted) vscode.window.showInformationMessage(`文件已存在，自动使用名称: ${path.basename(fileInfo.path)}`);
    return fileInfo.path;
}

// generateRegexPatternsTemplate 已迁移到 templates/templateGenerators


async function promptForFileRename(node: PackageNode): Promise<string | undefined> {
    const oldPath = node.resourceUri.fsPath;
    const oldName = path.basename(oldPath);
    const ext = path.extname(oldName).toLowerCase();
    const baseName = path.basename(oldName, ext);
    const dir = path.dirname(oldPath);

    // 检测当前文件类型
    let detectedType = '角色';
    const lowerBaseName = baseName.toLowerCase();
    if (getKeywordCandidatesForKind('sensitive', oldPath).some(keyword => lowerBaseName.includes(keyword.toLowerCase()))) {
        detectedType = '敏感词';
    } else if (getKeywordCandidatesForKind('vocabulary', oldPath).some(keyword => lowerBaseName.includes(keyword.toLowerCase()))) {
        detectedType = '词汇';
    } else if (getKeywordCandidatesForKind('character', oldPath).some(keyword => lowerBaseName.includes(keyword.toLowerCase()))) {
        detectedType = '角色';
    }

    const keywordManagedExtensions = new Set(['.json5', '.txt', '.csv', '.md', '.toml']);
    if (keywordManagedExtensions.has(ext)) {
        const roleTypeToKind = (roleType: '角色' | '敏感词' | '词汇'): ExtensionCustomOptions['kind'] => {
            if (roleType === '敏感词') return 'sensitive';
            if (roleType === '词汇') return 'vocabulary';
            return 'character';
        };

        // 选择文件类型
        const roleType = await vscode.window.showQuickPick(
            ['角色', '敏感词', '词汇'], 
            { 
                placeHolder: '选择文件类型',
                title: `重命名文件: ${oldName}`
            }
        );
        if (!roleType) return;

        const selectedKind = roleTypeToKind(roleType as '角色' | '敏感词' | '词汇');
        const autoKeywordNaming = isAutoKeywordNamingEnabled();

        if (!autoKeywordNaming) {
            // 关闭设置时，保持老行为（用户手动管理关键词）
            if (ext === '.md') {
                const customName = await vscode.window.showInputBox({
                    prompt: `输入${roleType}文件的自定义名称（留空使用默认名称）`,
                    placeHolder: '例如: 主要人物、禁用词汇等'
                });

                let newFileName: string;
                if (customName && customName.trim()) {
                    newFileName = generateCustomFileName(customName.trim(), roleType);
                } else {
                    newFileName = generateDefaultFileName(roleType);
                }

                const newPath = path.join(dir, `${newFileName}${ext}`);
                if (newPath === oldPath) {
                    return;
                }
                if (fs.existsSync(newPath)) {
                    vscode.window.showErrorMessage(`文件 ${newFileName}${ext} 已存在`);
                    return;
                }
                fs.renameSync(oldPath, newPath);
                return newPath;
            }

            const customName = await vscode.window.showInputBox({
                prompt: `输入${roleType}文件的自定义名称（留空使用默认名称）`,
                placeHolder: '例如: 主要人物、禁用词汇等'
            });

            let newFileName: string;
            if (customName && customName.trim()) {
                newFileName = buildResourceBaseName(customName.trim(), selectedKind, true, getLegacyResourceKeyword(selectedKind));
            } else {
                newFileName = getLegacyResourceKeyword(selectedKind);
            }

            const newPath = path.join(dir, `${newFileName}${ext}`);
            if (newPath === oldPath) {
                return;
            }
            if (fs.existsSync(newPath)) {
                vscode.window.showErrorMessage(`文件 ${newFileName}${ext} 已存在`);
                return;
            }
            fs.renameSync(oldPath, newPath);
            return newPath;
        }

        const splitInfo = splitResourceBaseNameByKeyword(baseName, selectedKind, oldPath);
        const oldFileMatchesSpec = isRoleFile(`${baseName}${ext}`, oldPath);
        const preferredKeyword = splitInfo.matched && oldFileMatchesSpec
            ? splitInfo.keywordPart
            : getResourceFileKeyword(selectedKind);

        // 新机制：始终自动添加关键词，不再单独询问第三步
        const customName = await vscode.window.showInputBox({
            prompt: `输入${roleType}文件的自定义名称（可留空）`,
            value: splitInfo.namePart,
            placeHolder: '例如: 主要人物、禁用词汇等'
        });
        if (customName === undefined) return;
        
        const newFileName = buildResourceBaseName(customName, selectedKind, true, preferredKeyword);
        if (!newFileName) {
            vscode.window.showWarningMessage('文件名为空，请输入名称。');
            return;
        }

        if (!isRoleFile(`${newFileName}${ext}`, path.join(dir, `${newFileName}${ext}`))) {
            vscode.window.showWarningMessage(`重命名结果不符合资源文件关键词规范：${newFileName}${ext}`);
            return;
        }
        
        const newPath = path.join(dir, `${newFileName}${ext}`);
        
        if (newPath === oldPath) {
            return; // 没有变化
        }
        
        if (fs.existsSync(newPath)) {
            vscode.window.showErrorMessage(`文件 ${newFileName}${ext} 已存在`);
            return;
        }
        
        fs.renameSync(oldPath, newPath);
        return newPath;
    } else {
        // 对于其他文件类型，使用简单的重命名
        const newName = await vscode.window.showInputBox({
            prompt: `重命名文件 ${oldName}`,
            value: baseName
        });
        
        if (!newName || newName === baseName) {
            return;
        }
        
        const newPath = path.join(dir, `${newName}${ext}`);
        
        if (fs.existsSync(newPath)) {
            vscode.window.showErrorMessage(`文件 ${newName}${ext} 已存在`);
            return;
        }
        
        // 重命名文件
        fs.renameSync(oldPath, newPath);
        return newPath;
    }
}

/**
 * 执行不同的打开操作
 */
async function executeOpenAction(action: string, uri: vscode.Uri): Promise<void> {
    try {
        switch (action) {
            case 'role-manager':
                await vscode.commands.executeCommand('AndreaNovelHelper.openWithRoleManager', uri);
                break;
            case 'text-editor':
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc, { preview: false });
                break;
            case 'system-default':
                await vscode.env.openExternal(uri);
                break;
            case 'explorer':
                await vscode.commands.executeCommand('revealFileInOS', uri);
                break;
            default:
                vscode.window.showErrorMessage(`未知的打开方式: ${action}`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`打开文件失败: ${error}`);
    }
}

/** 创建角色文件 (.ojson5) */
async function createRoleFile(dir: string): Promise<string | undefined> {
    const name = await vscode.window.showInputBox({ 
        prompt: '输入角色文件名称',
        placeHolder: '例如: main-characters'
    });
    if (!name) return;

    const fileName = name.endsWith('.ojson5') ? name : `${name}.ojson5`;
    const filePath = path.join(dir, fileName);
    
    if (fs.existsSync(filePath)) {
        vscode.window.showErrorMessage(`文件 ${fileName} 已存在`);
        return;
    }

    // 生成角色文件初始内容
    const initialContent = generateRoleFileTemplate();
    
    fs.writeFileSync(filePath, initialContent, 'utf8');
    
    // 自动打开新文件
    try {
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
        console.warn('自动打开新文件失败: ', err);
    }
    
    vscode.window.showInformationMessage(`角色文件 ${fileName} 创建成功`);
    return filePath;
}

/** 创建关系文件 (.rjson5) */
async function createRelationshipFile(dir: string): Promise<string | undefined> {
    const name = await vscode.window.showInputBox({ 
        prompt: '输入关系文件名称',
        placeHolder: '例如: character-relationships'
    });
    if (!name) return;

    const fileName = name.endsWith('.rjson5') ? name : `${name}.rjson5`;
    const filePath = path.join(dir, fileName);
    
    if (fs.existsSync(filePath)) {
        vscode.window.showErrorMessage(`文件 ${fileName} 已存在`);
        return;
    }

    // 生成关系文件初始内容
    const initialContent = generateRelationshipFileTemplate();
    
    fs.writeFileSync(filePath, initialContent, 'utf8');
    
    // 自动打开新文件
    try {
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
        console.warn('自动打开新文件失败: ', err);
    }
    
    vscode.window.showInformationMessage(`关系文件 ${fileName} 创建成功`);
    return filePath;
}

/** 生成角色文件模板 */
function generateRoleFileTemplate(): string {
    const id = generateUUIDv7();
    return `[
    // === 示例角色（可删除或修改）===
    {
        uuid: "${id}",
        name: "示例角色",
        type: "主角",
        affiliation: "示例阵营",
        aliases: ["示例"],
        color: "#FFA500",
        description: "这是一个示例角色，用于说明角色文件格式。",
        age: 25,
        gender: "未知",
        occupation: "示例职业"
    }
]`;
}

/** 生成关系文件模板 */
function generateRelationshipFileTemplate(): string {
    const src = generateUUIDv7();
    const tgt = generateUUIDv7();
    return `{
    // === 角色关系配置文件 ===
    "relationships": [
        // 示例关系（可删除或修改）
        {
            "sourceRoleUuid": "${src}",
            "targetRoleUuid": "${tgt}", 
            "relationshipType": "朋友",
            "description": "从小一起长大的好朋友",
            "strength": 8,
            "isPublic": true,
            "tags": ["友情", "童年"],
            "metadata": {
                "startChapter": 1,
                "developmentStage": "稳定期"
            }
        }
    ]
}`;
}

/** 创建时间线文件 (.tjson5) */
async function createTimelineFile(dir: string): Promise<string | undefined> {
    const name = await vscode.window.showInputBox({ 
        prompt: '输入时间线文件名称',
        placeHolder: '例如: story-timeline'
    });
    if (!name) return;

    const fileName = name.endsWith('.tjson5') ? name : `${name}.tjson5`;
    const filePath = path.join(dir, fileName);
    
    if (fs.existsSync(filePath)) {
        vscode.window.showErrorMessage(`文件 ${fileName} 已存在`);
        return;
    }

    // 生成时间线文件初始内容
    const initialContent = generateTimelineFileTemplate();
    
    fs.writeFileSync(filePath, initialContent, 'utf8');
    
    // 自动打开新文件
    try {
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
        console.warn('自动打开新文件失败: ', err);
    }
    
    vscode.window.showInformationMessage(`时间线文件 ${fileName} 创建成功`);
    return filePath;
}

/** 生成时间线文件模板 */
function generateTimelineFileTemplate(): string {
    return `{
    // === 时间线配置文件 ===
    "events": [],
    "connections": []
}`;
}

// 显示引用维护面板
async function showReferenceMaintenancePanel(workspaceRoot: string) {
    try {
        // 获取角色和引用统计信息
        const stats = await getReferenceStats(workspaceRoot);

        // 创建快速选择面板
        const options: vscode.QuickPickItem[] = [
            {
                label: '$(database) 清理数据库中的绝对路径',
                description: '清理角色文件中的绝对路径，避免路径依赖问题',
                detail: '扫描所有角色文件，将绝对路径转换为相对路径'
            },
            {
                label: '$(refresh) 重建角色引用索引',
                description: '重新分析并建立角色之间的引用关系',
                detail: '扫描角色文件，更新引用关系数据库'
            },
            {
                label: '$(graph) 打开角色引用热力图',
                description: '可视化查看角色之间的引用关系强度',
                detail: '在图表中显示角色引用的热力分布'
            }
        ];

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: `当前统计：${stats.roleCount} 个角色，${stats.referenceCount} 个引用`,
            title: '引用维护操作'
        });

        if (selected) {
            await executeReferenceMaintenanceAction(selected.label, workspaceRoot);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`显示引用维护面板失败: ${error}`);
    }
}

// 获取角色和引用统计信息
async function getReferenceStats(workspaceRoot: string): Promise<{ roleCount: number; referenceCount: number }> {
    try {
        // 从全局关系管理器获取角色数量
        const roleCount = globalRelationshipManager.getAllRoles().size;

        // 执行命令获取角色引用数据统计
        const roleReferenceData = await vscode.commands.executeCommand<any>('AndreaNovelHelper.circlePacking.getRoleReferenceData');
        let referenceCount = 0;

        if (roleReferenceData && roleReferenceData.items) {
            referenceCount = roleReferenceData.items.reduce((total: number, item: any) => total + (item.count || 0), 0);
        }

        return { roleCount, referenceCount };
    } catch (error) {
        console.error('获取引用统计失败:', error);
        // 如果获取引用统计失败，至少返回角色数量
        try {
            const roleCount = globalRelationshipManager.getAllRoles().size;
            return { roleCount, referenceCount: 0 };
        } catch (roleError) {
            console.error('获取角色数量也失败:', roleError);
            return { roleCount: 0, referenceCount: 0 };
        }
    }
}

// 执行引用维护操作
async function executeReferenceMaintenanceAction(actionLabel: string, workspaceRoot: string): Promise<void> {
    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '执行引用维护操作',
            cancellable: true
        }, async (progress, token) => {
            progress.report({ increment: 0, message: `正在执行: ${actionLabel}` });

            if (actionLabel.includes('清理数据库中的绝对路径')) {
                progress.report({ increment: 20, message: '清理绝对路径...' });
                await vscode.commands.executeCommand('AndreaNovelHelper.fileTracking.cleanAbsolutePaths');
                progress.report({ increment: 80, message: '绝对路径清理完成' });
            } else if (actionLabel.includes('重建角色引用索引')) {
                progress.report({ increment: 20, message: '重建引用索引...' });
                await vscode.commands.executeCommand('AndreaNovelHelper.roleUsage.rebuildIndex');
                progress.report({ increment: 80, message: '引用索引重建完成' });
            } else if (actionLabel.includes('打开角色引用热力图')) {
                progress.report({ increment: 20, message: '准备热力图数据...' });
                await vscode.commands.executeCommand('AndreaNovelHelper.openRoleHeatmap');
                progress.report({ increment: 80, message: '热力图已打开' });
            }

            progress.report({ increment: 100, message: '操作完成' });
        });

        vscode.window.showInformationMessage(`引用维护操作完成: ${actionLabel}`);
    } catch (error) {
        vscode.window.showErrorMessage(`执行引用维护操作失败: ${error}`);
    }
}

// 显示外部资源目录管理面板
async function showExternalResourceManagePanel(provider: PackageManagerProvider) {
    try {
        // 获取当前外部资源目录信息
        const report = provider.getExternalScanReport() || provider.rescanExternalRoleFolders(false);
        const folders = provider.getExternalRoleFolders();

        // 获取内置资源目录统计
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        let internalFolderCount = 0;
        let internalFileCount = 0;
        if (workspaceRoot) {
            const novelHelperRoot = path.join(workspaceRoot, 'novel-helper');
            if (fs.existsSync(novelHelperRoot)) {
                // 统计内部目录和文件
                const countRecursive = (dir: string) => {
                    let dirs = 0;
                    let files = 0;
                    for (const name of fs.readdirSync(dir)) {
                        const full = path.join(dir, name);
                        const st = fs.statSync(full);
                        if (st.isDirectory()) {
                            dirs++;
                            const sub = countRecursive(full);
                            dirs += sub.dirs;
                            files += sub.files;
                        } else {
                            files++;
                        }
                    }
                    return { dirs, files };
                };
                const internalStats = countRecursive(novelHelperRoot);
                internalFolderCount = internalStats.dirs;
                internalFileCount = internalStats.files;
            }
        }

        // 创建快速选择面板
        const options: vscode.QuickPickItem[] = [
            {
                label: '$(refresh) 重新扫描外部资源目录',
                description: '扫描工作区外的角色资源目录',
                detail: '重新搜索并更新外部资源目录列表'
            },
            {
                label: '$(add) 添加外部资源目录',
                description: '手动添加一个外部资源目录',
                detail: '选择一个文件夹作为外部资源目录'
            },
            {
                label: '$(list-unordered) 查看外部资源目录列表',
                description: '显示当前已识别的外部资源目录',
                detail: `当前共 ${folders.length} 个外部资源目录`
            },
            {
                label: '$(file-text) 查看扫描报告',
                description: '查看详细的资源扫描报告（含内置目录）',
                detail: `外部 ${report.externalFolderCount} 个目录，内部 ${internalFolderCount} 个目录、${internalFileCount} 个文件`
            }
        ];

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: `外部：${folders.length} 个目录 | 内部：${internalFolderCount} 个目录、${internalFileCount} 个文件`,
            title: '资源目录管理'
        });

        if (selected) {
            await executeExternalResourceAction(selected.label, provider);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`显示外部资源目录管理面板失败: ${error}`);
    }
}

// 执行外部资源管理操作
async function executeExternalResourceAction(actionLabel: string, provider: PackageManagerProvider): Promise<void> {
    try {
        if (actionLabel.includes('重新扫描外部资源目录')) {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '扫描外部资源目录',
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: '正在扫描...' });
                const report = provider.rescanExternalRoleFolders(true);
                provider.refresh();
                progress.report({ increment: 50, message: '刷新角色数据...' });
                try {
                    loadRoles(true);
                    updateDecorations();
                } catch (e) {
                    console.error('[PackageManager] 外部资源重扫后刷新角色失败:', e);
                }
                progress.report({ increment: 100, message: '完成' });
                vscode.window.showInformationMessage(`外部资源扫描完成：${report.externalFolderCount} 个目录`);
            });
        } else if (actionLabel.includes('添加外部资源目录')) {
            const folders = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: '选择外部资源目录'
            });
            if (folders && folders.length > 0) {
                const selectedPath = folders[0].fsPath;
                const initFilePath = path.join(selectedPath, '__init__.ojson5');
                const ignoreFilePath = path.join(selectedPath, '.anh-ignore');

                // 检查目录是否已经被识别
                const currentFolders = provider.getExternalRoleFolders();
                if (currentFolders.includes(selectedPath)) {
                    vscode.window.showWarningMessage('该目录已是外部资源目录');
                    return;
                }

                // 检查是否已有 __init__.ojson5 文件
                if (fs.existsSync(initFilePath)) {
                    vscode.window.showWarningMessage('该目录已包含 __init__.ojson5 文件，请重新扫描');
                    provider.rescanExternalRoleFolders(false);
                    provider.refresh();
                    return;
                }

                // 询问用户是否创建标记文件
                const createInit = await vscode.window.showQuickPick([
                    { label: '$(check) 创建标记文件', description: '创建 __init__.ojson5 标记此目录为外部资源目录' },
                    { label: '$(x) 取消', description: '不创建文件' }
                ], {
                    placeHolder: `是否在 ${path.basename(selectedPath)} 中创建标记文件？`,
                    title: '添加外部资源目录'
                });

                if (createInit && createInit.label.includes('创建标记文件')) {
                    // 删除 .anh-ignore 文件（如果存在）
                    if (fs.existsSync(ignoreFilePath)) {
                        fs.unlinkSync(ignoreFilePath);
                    }

                    // 创建 __init__.ojson5 文件
                    const initContent = `{
  // 外部资源目录标记文件
  // 此文件用于标识此目录为 Andrea Novel Helper 的外部资源目录
  // 可以在此文件中添加目录级别的配置或备注
  "description": "外部资源目录",
  "createdAt": "${new Date().toISOString()}"
}`;
                    fs.writeFileSync(initFilePath, initContent, 'utf-8');
                    provider.rescanExternalRoleFolders(false);
                    provider.refresh();

                    // 同时刷新角色数据
                    try {
                        loadRoles(true);
                        updateDecorations();
                    } catch (e) {
                        console.error('[PackageManager] 添加外部资源目录后刷新角色失败:', e);
                    }

                    vscode.window.showInformationMessage(`已将 ${path.basename(selectedPath)} 标记为外部资源目录`);
                }
            }
        } else if (actionLabel.includes('查看外部资源目录列表')) {
            const folders = provider.getExternalRoleFolders();
            if (folders.length === 0) {
                vscode.window.showInformationMessage('当前没有外部资源目录');
                return;
            }
            const items = folders.map(f => ({
                label: path.basename(f),
                description: f,
                detail: fs.existsSync(f) ? '已存在' : '路径不存在'
            }));
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: '外部资源目录列表',
                title: `共 ${folders.length} 个外部资源目录`
            });
            if (selected) {
                // 提供操作选项
                const action = await vscode.window.showQuickPick([
                    { label: '$(folder) 在资源管理器中打开', description: selected.description },
                    { label: '$(trash) 从列表中移除', description: selected.description }
                ], { placeHolder: selected.label });
                if (action) {
                    if (action.label.includes('在资源管理器中打开')) {
                        vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(selected.description));
                    } else if (action.label.includes('从列表中移除')) {
                        const initFilePath = path.join(selected.description, '__init__.ojson5');
                        const ignoreFilePath = path.join(selected.description, '.anh-ignore');

                        // 检查是否有标记文件需要处理
                        const hasInitFile = fs.existsSync(initFilePath);

                        // 选择如何处理
                        const removeAction = await vscode.window.showQuickPick<vscode.QuickPickItem>([
                            { label: '$(circle-slash) 排除此目录', description: '创建 .anh-ignore 文件，防止再次被自动识别' },
                            { label: '$(trash) 删除标记文件', description: '仅删除 __init__.ojson5 标记文件（目录内其他资源文件仍可能被识别）' },
                            { label: '$(x) 取消', description: '不执行任何操作' }
                        ], {
                            placeHolder: `如何处理 ${path.basename(selected.description)}？${hasInitFile ? ' (包含 __init__.ojson5)' : ''}`,
                            title: '移除外部资源目录'
                        });

                        if (!removeAction || removeAction.label.includes('取消')) {
                            return;
                        }

                        if (removeAction.label.includes('排除此目录')) {
                            // 创建 .anh-ignore 文件
                            const ignoreContent = `# Andrea Novel Helper 忽略标记
# 此文件用于标记此目录不应被自动识别为外部资源目录
# 创建时间: ${new Date().toISOString()}
`;
                            fs.writeFileSync(ignoreFilePath, ignoreContent, 'utf-8');

                            // 同时删除 __init__.ojson5 如果存在
                            if (hasInitFile) {
                                fs.unlinkSync(initFilePath);
                            }
                        } else if (removeAction.label.includes('删除标记文件')) {
                            if (hasInitFile) {
                                fs.unlinkSync(initFilePath);
                            }
                        }

                        provider.rescanExternalRoleFolders(false);
                        provider.refresh();

                        // 同时刷新角色数据
                        try {
                            loadRoles(true);
                            updateDecorations();
                        } catch (e) {
                            console.error('[PackageManager] 移除外部资源目录后刷新角色失败:', e);
                        }

                        vscode.window.showInformationMessage(`已移除外部资源目录: ${selected.description}`);
                    }
                }
            }
        } else if (actionLabel.includes('查看扫描报告')) {
            await vscode.commands.executeCommand('AndreaNovelHelper.package.showExternalScanReport');
        }
    } catch (error) {
        vscode.window.showErrorMessage(`执行外部资源管理操作失败: ${error}`);
    }
}
