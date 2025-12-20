import { mergeRolesByUUID } from '../utils/roleMerger';
import { Role } from '../extension';

// 测试角色合并功能
function testRoleMerging() {
    console.log('开始测试角色合并功能...\n');

    // 创建测试角色数据
    const testRoles: Role[] = [
        {
            name: '张三',
            uuid: 'test-uuid-1',
            type: '角色',
            color: '#FF0000',
            aliases: ['小三', '阿三'],
            fixes: ['小三子', '张小三'],
            wordSegmentFilter: false,
            description: '这是来自MD文件的张三',
            packagePath: 'novel-helper/characters',
            sourcePath: 'novel-helper/characters/zhangsan.md'
        },
        {
            name: '李四',
            uuid: 'test-uuid-2',
            type: '角色',
            color: '#00FF00',
            aliases: ['小四', '阿四'],
            fixes: ['小四子'],
            wordSegmentFilter: false,
            description: '这是李四',
            packagePath: 'novel-helper/characters',
            sourcePath: 'novel-helper/characters/lisi.json5'
        },
        {
            name: '张三',
            uuid: 'test-uuid-1', // 相同的UUID
            type: '角色',
            color: '#0000FF', // 不同的颜色
            aliases: ['老张', '三哥'], // 不同的别名
            fixes: ['张三哥', '老张头'], // 不同的修复候选词
            priority: 5, // 有优先级
            wordSegmentFilter: true, // 不同的分词过滤设置
            description: '这是来自JSON5文件的张三',
            packagePath: 'novel-helper/characters',
            sourcePath: 'novel-helper/characters/zhangsan.json5'
        },
        {
            name: '王五',
            uuid: 'test-uuid-3',
            type: '角色',
            color: '#FFFF00',
            aliases: ['小五'],
            wordSegmentFilter: false,
            description: '这是王五',
            packagePath: 'novel-helper/characters',
            sourcePath: 'novel-helper/characters/wangwu.md'
        }
    ];

    console.log(`测试数据准备完成，共 ${testRoles.length} 个角色：`);
    testRoles.forEach(role => {
        console.log(`- ${role.name} (UUID: ${role.uuid})`);
        console.log(`  颜色: ${role.color}`);
        console.log(`  别名: [${role.aliases?.join(', ')}]`);
        console.log(`  修复候选词: [${role.fixes?.join(', ')}]`);
        console.log(`  描述: ${role.description}`);
        console.log(`  来源: ${role.sourcePath}\n`);
    });

    // 执行合并
    console.log('执行角色合并...\n');
    const mergedRoles = mergeRolesByUUID(testRoles);

    console.log(`合并完成，剩余 ${mergedRoles.length} 个角色：\n`);
    mergedRoles.forEach(role => {
        console.log(`- ${role.name} (UUID: ${role.uuid})`);
        console.log(`  颜色: ${role.color}`);
        console.log(`  别名: [${role.aliases?.join(', ')}]`);
        console.log(`  修复候选词: [${role.fixes?.join(', ')}]`);
        console.log(`  优先级: ${role.priority}`);
        console.log(`  分词过滤: ${role.wordSegmentFilter}`);
        console.log(`  描述: ${role.description}`);
        console.log(`  来源: ${role.sourcePath}\n`);
    });

    // 验证合并结果
    console.log('验证合并结果：');

    // 验证张三的合并
    const zhangsan = mergedRoles.find(r => r.uuid === 'test-uuid-1');
    if (zhangsan) {
        console.log('✓ 张三合并成功');
        console.log(`  - 保留基础名称: ${zhangsan.name}`);
        console.log(`  - 保留基础颜色: ${zhangsan.color}`);
        console.log(`  - 别名合并: ${zhangsan.aliases?.includes('小三') && zhangsan.aliases?.includes('老张') ? '✓' : '✗'}`);
        console.log(`  - 修复候选词合并: ${zhangsan.fixes?.includes('小三子') && zhangsan.fixes?.includes('张三哥') ? '✓' : '✗'}`);
        console.log(`  - 优先级取较小值: ${zhangsan.priority === 5 ? '✓' : '✗'}`);
    } else {
        console.log('✗ 张三合并失败');
    }

    // 验证李四保持不变
    const lisi = mergedRoles.find(r => r.uuid === 'test-uuid-2');
    if (lisi && lisi.name === '李四') {
        console.log('✓ 李四保持不变');
    } else {
        console.log('✗ 李四数据错误');
    }

    // 验证王五保持不变
    const wangwu = mergedRoles.find(r => r.uuid === 'test-uuid-3');
    if (wangwu && wangwu.name === '王五') {
        console.log('✓ 王五保持不变');
    } else {
        console.log('✗ 王五数据错误');
    }

    console.log('\n测试完成！');
}

// 运行测试
testRoleMerging();