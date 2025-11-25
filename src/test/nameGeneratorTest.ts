import { nameGeneratorService } from '../services/nameGeneratorService';
import { NameGenerationOptions } from '../types/names';

/**
 * 名字生成器测试脚本
 */
export async function testNameGenerator() {
    console.log('开始测试名字生成器...');

    try {
        // 测试中文名字生成
        console.log('\n=== 测试中文名字 ===');
        const chineseNames = await nameGeneratorService.generateNames({
            culture: 'zh_CN',
            gender: 'male',
            count: 5,
            style: 'modern'
        });
        console.log('生成的中文名字:', chineseNames.map(n => n.fullName));

        // 测试英文名字生成
        console.log('\n=== 测试英文名字 ===');
        const englishNames = await nameGeneratorService.generateNames({
            culture: 'en_US',
            gender: 'female',
            count: 3,
            style: 'modern'
        });
        console.log('生成的英文名字:', englishNames.map(n => n.fullName));

        // 测试奇幻名字生成
        console.log('\n=== 测试奇幻名字 ===');
        const fantasyNames = await nameGeneratorService.generateNames({
            culture: 'fantasy',
            gender: 'any',
            count: 4,
            style: 'high-fantasy'
        });
        console.log('生成的奇幻名字:', fantasyNames.map(n => n.fullName));

        // 测试支持的文化
        console.log('\n=== 支持的文化 ===');
        const cultures = nameGeneratorService.getSupportedCultures();
        console.log('支持的文化:', cultures.map(c => `${c.displayName} (${c.code})`));

        // 测试统计功能
        console.log('\n=== 生成统计 ===');
        const stats = nameGeneratorService.getStats();
        console.log('统计信息:', stats);

        console.log('\n✅ 名字生成器测试完成');

    } catch (error) {
        console.error('❌ 名字生成器测试失败:', error);
    }
}

// 如果直接运行此文件，执行测试
if (require.main === module) {
    testNameGenerator();
}