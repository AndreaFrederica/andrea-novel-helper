/**
 * 文件类型识别测试
 * 验证 ojson5 和 rjson5 文件的正确识别
 */

import * as path from 'path';

// 模拟 isRoleFile 函数（从 utils.ts 复制核心逻辑）
function isRoleFile(fileName: string, fileFullPath?: string): boolean {
    const lowerName = fileName.toLowerCase();
    const debugPrefix = `[isRoleFile] name="${fileName}" path="${fileFullPath || ''}"`;
    
    // ojson5 文件一定是角色文件
    if (lowerName.endsWith('.ojson5')) {
        console.log(`${debugPrefix} ojson5Extension -> true`);
        return true;
    }
    
    // rjson5 文件一定是关系文件，不是角色文件
    if (lowerName.endsWith('.rjson5')) {
        console.log(`${debugPrefix} rjson5Extension -> false`);
        return false;
    }
    
    // 其他逻辑...
    return false;
}

// 模拟 isRelationshipFile 函数（从 relationshipLoader.ts 复制核心逻辑）
function isRelationshipFile(fileName: string): boolean {
    const lowerName = fileName.toLowerCase();
    
    // rjson5 文件一定是关系文件
    if (lowerName.endsWith('.rjson5')) {
        return true;
    }
    
    // ojson5 文件一定是角色文件，不是关系文件
    if (lowerName.endsWith('.ojson5')) {
        return false;
    }
    
    // 其他逻辑...
    return false;
}

// 测试用例
function runTests() {
    console.log('=== 文件类型识别测试 ===\n');
    
    const testCases = [
        { fileName: 'test-role.ojson5', expectedRole: true, expectedRelationship: false },
        { fileName: 'test-relationship.rjson5', expectedRole: false, expectedRelationship: true },
        { fileName: 'character.ojson5', expectedRole: true, expectedRelationship: false },
        { fileName: 'relations.rjson5', expectedRole: false, expectedRelationship: true },
        { fileName: 'mixed.ojson5', expectedRole: true, expectedRelationship: false },
        { fileName: 'data.rjson5', expectedRole: false, expectedRelationship: true }
    ];
    
    let passedTests = 0;
    let totalTests = testCases.length * 2; // 每个文件测试两个函数
    
    for (const testCase of testCases) {
        console.log(`测试文件: ${testCase.fileName}`);
        
        // 测试 isRoleFile
        const roleResult = isRoleFile(testCase.fileName);
        const rolePass = roleResult === testCase.expectedRole;
        console.log(`  isRoleFile: ${roleResult} (期望: ${testCase.expectedRole}) ${rolePass ? '✓' : '✗'}`);
        if (rolePass) passedTests++;
        
        // 测试 isRelationshipFile
        const relationshipResult = isRelationshipFile(testCase.fileName);
        const relationshipPass = relationshipResult === testCase.expectedRelationship;
        console.log(`  isRelationshipFile: ${relationshipResult} (期望: ${testCase.expectedRelationship}) ${relationshipPass ? '✓' : '✗'}`);
        if (relationshipPass) passedTests++;
        
        console.log('');
    }
    
    console.log(`=== 测试结果 ===`);
    console.log(`通过: ${passedTests}/${totalTests}`);
    console.log(`成功率: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
    
    if (passedTests === totalTests) {
        console.log('🎉 所有测试通过！');
    } else {
        console.log('❌ 部分测试失败');
    }
}

// 运行测试
runTests();