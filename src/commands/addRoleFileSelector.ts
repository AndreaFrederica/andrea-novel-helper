/* eslint-disable curly */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import JSON5 from 'json5';
import { isRoleFile, getPackageDirectory } from '../utils/utils';

// 记忆功能：存储每种fileType上次选择的文件
const lastSelectedFiles = new Map<string, string>();

/**
 * 扫描工作区中的角色文件（使用isRoleFile函数判断）
 * @returns 相对路径数组
 */
export async function scanJson5Files(): Promise<string[]> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return [];
    
    // 扫描novel-helper目录
    const novelHelperPath = path.join(root, 'novel-helper');
    if (fs.existsSync(novelHelperPath)) {
        // 使用 getPackageDirectory 函数扫描角色文件
        const roleFiles = getPackageDirectory(novelHelperPath, '');
        
        // 筛选出所有以 .json5 为后缀的文件
        const json5Files = roleFiles.filter(file => file.endsWith('.json5'));
        
        return json5Files;
    }
    
    return [];
}

/**
 * 通用的文件选择或创建函数
 * @param fileType 文件类型描述（如"词汇"、"敏感词"、"角色"）
 * @param defaultFileName 默认文件名，默认为"词汇库"
 * @returns 完整文件路径或undefined
 */
export async function selectOrCreateFile(
    fileType: string,
    defaultFileName: string = '词汇库'
): Promise<string | undefined> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
        vscode.window.showErrorMessage('没有打开的工作区');
        return undefined;
    }
    

    
    // 扫描现有的角色文件
    const existingFiles = await scanJson5Files();
    
    // 获取记忆的上次选择文件
    const lastSelected = lastSelectedFiles.get(fileType);
    
    // 构建选项
    const options: vscode.QuickPickItem[] = [];
    
    // 1. 如果有记忆的上次选择文件，放到第一个
    if (lastSelected && existingFiles.includes(lastSelected)) {
        options.push({
            label: `$(file) ${lastSelected}`,
            description: `上次选择的${fileType}文件`,
            detail: lastSelected
        });
    }
    
    // 2. defaultFileName 放到第二个（或第一个，如果没有记忆文件）
    if (defaultFileName) {
        options.push({
            label: `$(file) ${defaultFileName}`,
            description: `默认${fileType}文件`,
            detail: defaultFileName
        });
    }
    
    // 3. 其他现有文件
    const remainingFiles = existingFiles.filter(file => 
        file !== lastSelected && file !== defaultFileName
    );
    options.push(...remainingFiles.map(file => ({
        label: `$(file) ${file}`,
        description: `现有文件`,
        detail: file
    })));
    
    // 4. 创建新文件选项
    options.push({
        label: `$(new-file) 创建新文件...`,
        description: '手动输入文件路径',
        detail: 'new'
    });
    
    // 如果没有现有文件，添加提示
    if (existingFiles.length === 0 && !defaultFileName) {
        options.unshift({
            label: `$(info) 未找到现有${fileType}文件`,
            description: '请选择创建新文件或检查配置',
            detail: 'info'
        });
    }
    
    const selected = await vscode.window.showQuickPick(options, {
        placeHolder: `选择${fileType}文件或创建新文件`,
        title: `${fileType}文件选择`
    });
    
    if (!selected) {
        return undefined; // 用户取消
    }
    
    // 记住用户的选择（排除特殊选项）
    if (selected.detail && selected.detail !== 'new' && selected.detail !== 'info') {
        lastSelectedFiles.set(fileType, selected.detail);
    }
    
    if (selected.detail === 'new') {
        // 创建新文件
        const filePath = await vscode.window.showInputBox({
            prompt: `输入文件路径（相对于novel-helper目录）`,
            placeHolder: defaultFileName,
            value: defaultFileName,
            validateInput: (value) => {
                if (!value.trim()) {
                    return '文件路径不能为空';
                }
                if (!value.endsWith('.json5')) {
                    return '文件必须以 .json5 结尾';
                }
                return null;
            }
        });
        
        if (!filePath) {
            return undefined; // 用户取消
        }
        
        // 构建完整路径（相对于novel-helper目录）
        const novelHelperPath = path.join(root, 'novel-helper');
        const fullPath = path.join(novelHelperPath, filePath);
        
        // 确保目录存在
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // 创建文件
        if (!fs.existsSync(fullPath)) {
            fs.writeFileSync(fullPath, JSON5.stringify([], null, 2), 'utf8');
            vscode.window.showInformationMessage(`已创建新${fileType}文件: ${filePath}`);
        }
        
        return fullPath;
    } else if (selected.detail === 'info') {
        return undefined; // 只是信息提示
    } else {
        // 使用现有文件
        const novelHelperPath = path.join(root, 'novel-helper');
        return path.join(novelHelperPath, selected.detail!);
    }
}