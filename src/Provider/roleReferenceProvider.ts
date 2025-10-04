import * as vscode from 'vscode';
import { Role } from '../extension';
import { getSupportedLanguages, getSupportedExtensions } from '../utils/utils';
import { hoverRangesMap } from './hoverProvider';
import { findDefinitionInFile } from './defProv';
import { getRoleReferencesForRole, RoleReferenceHit } from '../context/roleUsageStore';
import { roles } from '../activate';

/**
 * 从光标位置获取角色
 * 支持两种方式：
 * 1. 从 hoverRangesMap 获取（小说文本中的角色引用）- 复用 defProv.ts 逻辑
 * 2. 在定义文件中直接匹配角色名称（支持查找引用功能）
 */
function roleFromPosition(document: vscode.TextDocument, position: vscode.Position): Role | undefined {
    console.log('[roleFromPosition] 被调用:', {
        file: document.fileName,
        line: position.line,
        char: position.character
    });
    
    // 文件类型检查
    const supportedLangs = getSupportedLanguages();
    const supportedExts = new Set(getSupportedExtensions().map(e => e.toLowerCase()));
    const fileNameLower = document.fileName.toLowerCase();
    const extMatch = fileNameLower.match(/\.([a-z0-9_\-]+)$/);
    const ext = extMatch ? extMatch[1] : '';
    
    if (!supportedLangs.includes(document.languageId) && !supportedExts.has(ext)) {
        console.log('[roleFromPosition] 文件类型不支持');
        return undefined;
    }
    
    // 方式1：从 hoverRangesMap 获取（优先，用于文本中的角色引用）
    const key = document.uri.toString();
    const ranges = hoverRangesMap.get(key) || [];
    const hit = ranges.find(h => h.range.contains(position));
    
    if (hit) {
        console.log('[roleFromPosition] 从 hoverRangesMap 找到角色:', hit.role.name);
        return hit.role;
    }
    
    // 方式2：如果 hoverRangesMap 中没有，尝试在定义文件中直接匹配
    // 这对于"在定义处查找引用"功能很重要
    console.log('[roleFromPosition] hoverRangesMap 未命中，尝试直接匹配角色名');
    
    const wordRange = document.getWordRangeAtPosition(position, /[\u4e00-\u9fa5\w\-]+/);
    if (!wordRange) {
        console.log('[roleFromPosition] 无法获取单词范围');
        return undefined;
    }
    
    const word = document.getText(wordRange);
    const currentFilePath = document.uri.fsPath;
    
    console.log('[roleFromPosition] 尝试匹配单词:', word);
    
    // 在全局角色列表中查找匹配
    const matchingRoles = roles.filter(role => 
        role.name === word || 
        (role.aliases && role.aliases.includes(word))
    );
    
    if (matchingRoles.length === 0) {
        console.log('[roleFromPosition] 没有匹配的角色');
        return undefined;
    }
    
    console.log('[roleFromPosition] 找到匹配角色:', matchingRoles.length, '个');
    
    // 优先返回当前文件中定义的角色
    const roleInCurrentFile = matchingRoles.find(role => 
        role.sourcePath && role.sourcePath === currentFilePath
    );
    
    if (roleInCurrentFile) {
        console.log('[roleFromPosition] 返回当前文件定义的角色:', roleInCurrentFile.name);
        return roleInCurrentFile;
    }
    
    // 返回第一个匹配的角色
    console.log('[roleFromPosition] 返回第一个匹配角色:', matchingRoles[0].name);
    return matchingRoles[0];
}

/**
 * 检查文件路径是否应该被过滤（typo、数据库等内部文件）
 */
function shouldFilterPath(fsPath: string | undefined): boolean {
    if (!fsPath) {
        return false;
    }
    
    const normalizedPath = fsPath.replace(/\\/g, '/').toLowerCase();
    
    // 过滤 typo 相关文件和目录
    if (normalizedPath.includes('/typo/') || 
        normalizedPath.includes('\\typo\\')) {
        return true;
    }
    
    // 过滤 .anh- 开头的内部目录（数据库、统计等）
    if (normalizedPath.includes('/.anh-') || 
        normalizedPath.includes('\\.anh-')) {
        return true;
    }
    
    // 过滤其他内部目录
    if (normalizedPath.includes('/.git/') || 
        normalizedPath.includes('/node_modules/')) {
        return true;
    }
    
    return false;
}

function toLocations(hit: RoleReferenceHit): vscode.Location[] {
    const locations: vscode.Location[] = [];
    
    // 过滤 typo 和内部文件
    if (shouldFilterPath(hit.fsPath)) {
        return locations;
    }
    
    let uri: vscode.Uri;
    try {
        uri = vscode.Uri.parse(hit.uri);
    } catch {
        if (hit.fsPath) {
            uri = vscode.Uri.file(hit.fsPath);
        } else {
            return locations;
        }
    }
    
    // 再次检查解析后的 URI 路径
    if (shouldFilterPath(uri.fsPath)) {
        return locations;
    }
    
    for (const range of hit.ranges) {
        const [startLine, startChar, endLine, endChar] = range;
        if (startLine < 0 || startChar < 0 || endLine < startLine) {
            continue;
        }
        const start = new vscode.Position(startLine, Math.max(0, startChar));
        const end = new vscode.Position(Math.max(startLine, endLine), Math.max(0, endChar));
        locations.push(new vscode.Location(uri, new vscode.Range(start, end)));
    }
    return locations;
}

function locationKey(loc: vscode.Location): string {
    const start = loc.range.start;
    const end = loc.range.end;
    return loc.uri.toString() + '#' + start.line + ',' + start.character + '-' + end.line + ',' + end.character;
}

class RoleReferenceProvider implements vscode.ReferenceProvider {
    async provideReferences(document: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext, token: vscode.CancellationToken): Promise<vscode.Location[] | null> {
        console.log('[RoleReferenceProvider] provideReferences 被调用:', {
            file: document.uri.fsPath,
            line: position.line,
            char: position.character
        });
        
        const role = roleFromPosition(document, position);
        console.log('[RoleReferenceProvider] 识别到角色:', role ? role.name : 'null');
        
        if (!role || token.isCancellationRequested) {
            return null;
        }
        
        const hits = getRoleReferencesForRole(role);
        console.log('[RoleReferenceProvider] 找到索引数据:', hits.length, '个文件');
        
        const dedupe = new Set<string>();
        const results: vscode.Location[] = [];
        for (const hit of hits) {
            if (token.isCancellationRequested) { return null; }
            for (const loc of toLocations(hit)) {
                const key = locationKey(loc);
                if (!dedupe.has(key)) {
                    dedupe.add(key);
                    results.push(loc);
                }
            }
        }
        const maybeAddDefinition = (def: vscode.Location | null) => {
            if (!def) { return; }
            // 过滤 typo 和内部文件的定义位置
            if (shouldFilterPath(def.uri.fsPath)) {
                return;
            }
            const key = locationKey(def);
            if (!dedupe.has(key)) {
                dedupe.add(key);
                results.push(def);
            }
        };

        if (role.sourcePath) {
            // 只有当 sourcePath 不是内部文件时才添加定义
            if (!shouldFilterPath(role.sourcePath)) {
                maybeAddDefinition(findDefinitionInFile(role, role.sourcePath));
            }
        }
        if (!role.sourcePath || results.length === 0) {
            const currentPath = document.uri.fsPath;
            if (!shouldFilterPath(currentPath)) {
                const fallback = findDefinitionInFile(role, currentPath);
                maybeAddDefinition(fallback);
            }
        }
        
        console.log('[RoleReferenceProvider] 过滤后返回引用数量:', results.length);
        
        return results;
    }
}

export function registerRoleReferenceProvider(context: vscode.ExtensionContext) {
    // 复用 defProv.ts 的注册方式：使用 { scheme: 'file' } 匹配所有文件
    // 具体的文件类型过滤在 roleFromPosition 中进行
    const provider = vscode.languages.registerReferenceProvider(
        { scheme: 'file' },
        new RoleReferenceProvider()
    );
    context.subscriptions.push(provider);
    console.log('[RoleReferenceProvider] 已注册 Reference Provider');
}
