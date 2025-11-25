/**
 * 名字生成器测试脚本
 * 运行方式: node test-names.js
 */

const path = require('path');

// 模拟VS Code环境
global.vscode = {
    window: {
        showInformationMessage: console.log,
        showErrorMessage: console.error,
        showQuickPick: (items) => Promise.resolve(items[0]),
        showInputBox: () => Promise.resolve('5')
    },
    env: {
        clipboard: {
            writeText: (text) => console.log('已复制到剪贴板:', text)
        }
    },
    ExtensionContext: class {}
};

// 导入我们的服务
async function testNameGenerator() {
    try {
        // 动态导入编译后的模块
        const modulePath = path.join(__dirname, 'out', 'services', 'nameGeneratorService.js');
        const { nameGeneratorService } = require(modulePath);

        console.log('🎯 开始测试名字生成器...\n');

        // 1. 测试中文名字
        console.log('🇨🇳 测试中文名字:');
        const chineseNames = await nameGeneratorService.generateNames({
            culture: 'zh_CN',
            gender: 'male',
            count: 5
        });
        chineseNames.forEach((name, index) => {
            console.log(`  ${index + 1}. ${name.fullName} (${name.gender}, ${name.style})`);
        });

        // 2. 测试中文女名
        console.log('\n🇨🇳 测试中文女名:');
        const chineseFemaleNames = await nameGeneratorService.generateNames({
            culture: 'zh_CN',
            gender: 'female',
            count: 5
        });
        chineseFemaleNames.forEach((name, index) => {
            console.log(`  ${index + 1}. ${name.fullName} (${name.gender}, ${name.style})`);
        });

        // 3. 测试英文名字
        console.log('\n🇺🇸 测试英文名字:');
        const englishNames = await nameGeneratorService.generateNames({
            culture: 'en_US',
            gender: 'male',
            count: 5
        });
        englishNames.forEach((name, index) => {
            console.log(`  ${index + 1}. ${name.fullName} (${name.gender}, ${name.style})`);
        });

        // 4. 测试英文女名
        console.log('\n🇺🇸 测试英文女名:');
        const englishFemaleNames = await nameGeneratorService.generateNames({
            culture: 'en_US',
            gender: 'female',
            count: 5
        });
        englishFemaleNames.forEach((name, index) => {
            console.log(`  ${index + 1}. ${name.fullName} (${name.gender}, ${name.style})`);
        });

        // 5. 测试日文名字
        console.log('\n🇯🇵 测试日文名字:');
        const japaneseNames = await nameGeneratorService.generateNames({
            culture: 'ja_JP',
            gender: 'male',
            count: 5
        });
        japaneseNames.forEach((name, index) => {
            console.log(`  ${index + 1}. ${name.fullName} (${name.gender}, ${name.style})`);
        });

        // 6. 测试日文女名
        console.log('\n🇯🇵 测试日文女名:');
        const japaneseFemaleNames = await nameGeneratorService.generateNames({
            culture: 'ja_JP',
            gender: 'female',
            count: 5
        });
        japaneseFemaleNames.forEach((name, index) => {
            console.log(`  ${index + 1}. ${name.fullName} (${name.gender}, ${name.style})`);
        });

        // 7. 测试奇幻名字
        console.log('\n🐉 测试奇幻名字:');
        const fantasyNames = await nameGeneratorService.generateNames({
            culture: 'fantasy',
            gender: 'male',
            style: 'fantasy',
            count: 5
        });
        fantasyNames.forEach((name, index) => {
            console.log(`  ${index + 1}. ${name.fullName} (${name.gender}, ${name.style})`);
        });

        // 8. 测试高等奇幻
        console.log('\n🏰 测试高等奇幻:');
        const highFantasyNames = await nameGeneratorService.generateNames({
            culture: 'fantasy',
            gender: 'female',
            style: 'high-fantasy',
            count: 5
        });
        highFantasyNames.forEach((name, index) => {
            console.log(`  ${index + 1}. ${name.fullName} (${name.gender}, ${name.style})`);
        });

        // 9. 测试混合性别
        console.log('\n🎲 测试混合性别:');
        const mixedNames = await nameGeneratorService.generateNames({
            culture: 'en_US',
            gender: 'any',
            count: 5
        });
        mixedNames.forEach((name, index) => {
            console.log(`  ${index + 1}. ${name.fullName} (${name.gender}, ${name.style})`);
        });

        // 10. 测试不包含姓氏
        console.log('\n📝 测试仅名字:');
        const firstNamesOnly = await nameGeneratorService.generateNames({
            culture: 'zh_CN',
            gender: 'female',
            count: 5,
            includeSurname: false
        });
        firstNamesOnly.forEach((name, index) => {
            console.log(`  ${index + 1}. ${name.fullName} (${name.gender})`);
        });

        // 显示统计信息
        console.log('\n📊 生成统计:');
        const stats = nameGeneratorService.getStats();
        console.log(`  - 总生成次数: ${stats.totalGenerated}`);
        console.log(`  - 按文化分类: ${JSON.stringify(stats.byCulture, null, 2)}`);
        console.log(`  - 按性别分类: ${JSON.stringify(stats.byGender, null, 2)}`);
        console.log(`  - 按风格分类: ${JSON.stringify(stats.byStyle, null, 2)}`);

        console.log('\n✅ 测试完成！所有名字生成功能正常工作。');

    } catch (error) {
        console.error('❌ 测试失败:', error);

        // 如果导入失败，尝试直接运行一个简单的测试
        console.log('\n🔄 尝试简单测试...');

        try {
            // 测试是否可以访问编译后的模块
            const fs = require('fs');
            const outPath = path.join(__dirname, 'out');

            if (fs.existsSync(outPath)) {
                console.log('✅ out 目录存在');

                const servicePath = path.join(outPath, 'services');
                if (fs.existsSync(servicePath)) {
                    console.log('✅ services 目录存在');

                    const nameGeneratorPath = path.join(servicePath, 'nameGeneratorService.js');
                    if (fs.existsSync(nameGeneratorPath)) {
                        console.log('✅ nameGeneratorService.js 文件存在');
                    } else {
                        console.log('❌ nameGeneratorService.js 文件不存在');
                    }
                } else {
                    console.log('❌ services 目录不存在');
                }
            } else {
                console.log('❌ out 目录不存在，请先运行 npm run compile');
            }
        } catch (fsError) {
            console.error('❌ 文件系统检查失败:', fsError);
        }
    }
}

// 运行测试
testNameGenerator().catch(console.error);