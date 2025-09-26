/**
 * 关系管理相关的VSCode命令
 */

import * as vscode from 'vscode';
import { globalRelationshipManager } from '../utils/globalRelationshipManager';
import { nodeRoleParser } from '../utils/nodeRoleParser';
import { RelationshipType } from '../types/relationshipTypes';

/**
 * 注册所有关系管理相关的命令
 * @param context VSCode扩展上下文
 */
export function registerRelationshipCommands(context: vscode.ExtensionContext) {
    // 显示全局关系表
    const showRelationshipTableCommand = vscode.commands.registerCommand(
        'andrea.showRelationshipTable',
        showRelationshipTable
    );

    // 解析当前文件的关系
    const parseCurrentFileCommand = vscode.commands.registerCommand(
        'andrea.parseCurrentFileRelationships',
        parseCurrentFileRelationships
    );

    // 清空全局关系表
    const clearRelationshipTableCommand = vscode.commands.registerCommand(
        'andrea.clearRelationshipTable',
        clearRelationshipTable
    );

    // 导出关系数据
    const exportRelationshipsCommand = vscode.commands.registerCommand(
        'andrea.exportRelationships',
        exportRelationships
    );

    // 导入关系数据
    const importRelationshipsCommand = vscode.commands.registerCommand(
        'andrea.importRelationships',
        importRelationships
    );

    // 按角色查询关系
    const queryRelationshipsByRoleCommand = vscode.commands.registerCommand(
        'andrea.queryRelationshipsByRole',
        queryRelationshipsByRole
    );

    context.subscriptions.push(
        showRelationshipTableCommand,
        parseCurrentFileCommand,
        clearRelationshipTableCommand,
        exportRelationshipsCommand,
        importRelationshipsCommand,
        queryRelationshipsByRoleCommand
    );
}

/**
 * 显示全局关系表
 */
async function showRelationshipTable() {
    const relationships = globalRelationshipManager.getAllRelationships();
    const stats = globalRelationshipManager.getStatistics();

    if (relationships.length === 0) {
        vscode.window.showInformationMessage('全局关系表为空，请先解析一些关系数据。');
        return;
    }

    // 创建关系表格式化内容
    let content = `# 全局关系表\n\n`;
    content += `**统计信息：**\n`;
    content += `- 总关系数：${stats.totalRelationships}\n`;
    content += `- 涉及角色数：${stats.totalRoles}\n\n`;

    content += `**按类型分布：**\n`;
    stats.relationshipsByType.forEach((count, type) => {
        content += `- ${type}：${count} 个\n`;
    });

    content += `\n## 详细关系列表\n\n`;
    content += `| 序号 | 来源角色 | 目标角色 | 字面值 | 类型 |\n`;
    content += `|------|----------|----------|--------|------|\n`;

    relationships.forEach((rel, index) => {
        content += `| ${index + 1} | ${rel.sourceRole} | ${rel.targetRole} | ${rel.literalValue} | ${rel.type} |\n`;
    });

    // 创建并显示文档
    const doc = await vscode.workspace.openTextDocument({
        content,
        language: 'markdown'
    });
    await vscode.window.showTextDocument(doc);
}

/**
 * 解析当前文件的关系
 */
async function parseCurrentFileRelationships() {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        vscode.window.showErrorMessage('请先打开一个文件。');
        return;
    }

    const filePath = activeEditor.document.uri.fsPath;
    
    // 检查文件扩展名
    if (!filePath.endsWith('.json5') && !filePath.endsWith('.rjson5') && !filePath.endsWith('.json')) {
        vscode.window.showErrorMessage('当前文件不是支持的关系数据格式（.json5, .rjson5, .json）。');
        return;
    }

    try {
        vscode.window.showInformationMessage('正在解析关系数据...');
        
        const relationships = await nodeRoleParser.parseFromFile(filePath);
        
        if (relationships.length > 0) {
            vscode.window.showInformationMessage(
                `成功解析出 ${relationships.length} 个关系，已添加到全局关系表中。`
            );
        } else {
            vscode.window.showWarningMessage('未在当前文件中找到有效的关系数据。');
        }
    } catch (error) {
        vscode.window.showErrorMessage(`解析失败：${error}`);
    }
}

/**
 * 清空全局关系表
 */
async function clearRelationshipTable() {
    const result = await vscode.window.showWarningMessage(
        '确定要清空全局关系表吗？此操作不可撤销。',
        '确定',
        '取消'
    );

    if (result === '确定') {
        globalRelationshipManager.clear();
        vscode.window.showInformationMessage('全局关系表已清空。');
    }
}

/**
 * 导出关系数据
 */
async function exportRelationships() {
    const relationships = globalRelationshipManager.getAllRelationships();
    
    if (relationships.length === 0) {
        vscode.window.showInformationMessage('全局关系表为空，无数据可导出。');
        return;
    }

    try {
        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('relationships.json'),
            filters: {
                'JSON文件': ['json']
            }
        });

        if (saveUri) {
            const jsonData = globalRelationshipManager.exportToJSON();
            await vscode.workspace.fs.writeFile(saveUri, Buffer.from(jsonData, 'utf8'));
            vscode.window.showInformationMessage(`关系数据已导出到：${saveUri.fsPath}`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`导出失败：${error}`);
    }
}

/**
 * 导入关系数据
 */
async function importRelationships() {
    try {
        const openUri = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'JSON文件': ['json']
            }
        });

        if (openUri && openUri[0]) {
            const fileContent = await vscode.workspace.fs.readFile(openUri[0]);
            const jsonData = Buffer.from(fileContent).toString('utf8');
            
            const success = globalRelationshipManager.importFromJSON(jsonData);
            
            if (success) {
                const stats = globalRelationshipManager.getStatistics();
                vscode.window.showInformationMessage(
                    `成功导入关系数据，当前共有 ${stats.totalRelationships} 个关系。`
                );
            } else {
                vscode.window.showErrorMessage('导入失败：数据格式不正确。');
            }
        }
    } catch (error) {
        vscode.window.showErrorMessage(`导入失败：${error}`);
    }
}

/**
 * 按角色查询关系
 */
async function queryRelationshipsByRole() {
    const roleName = await vscode.window.showInputBox({
        prompt: '请输入要查询的角色名称',
        placeHolder: '角色名称'
    });

    if (!roleName) {
        return;
    }

    const relationships = globalRelationshipManager.getRelationshipsByRole(roleName);
    
    if (relationships.length === 0) {
        vscode.window.showInformationMessage(`未找到角色"${roleName}"的相关关系。`);
        return;
    }

    // 创建查询结果内容
    let content = `# 角色"${roleName}"的关系查询结果\n\n`;
    content += `**找到 ${relationships.length} 个相关关系：**\n\n`;
    content += `| 序号 | 来源角色 | 目标角色 | 字面值 | 类型 |\n`;
    content += `|------|----------|----------|--------|------|\n`;

    relationships.forEach((rel, index) => {
        content += `| ${index + 1} | ${rel.sourceRole} | ${rel.targetRole} | ${rel.literalValue} | ${rel.type} |\n`;
    });

    // 创建并显示文档
    const doc = await vscode.workspace.openTextDocument({
        content,
        language: 'markdown'
    });
    await vscode.window.showTextDocument(doc);
}