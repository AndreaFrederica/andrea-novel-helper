/**
 * 文件时间线数据测试工具
 * 用于验证数据转换和显示效果
 */

import { defaultFileTimelineData, defaultRoleDocumentAppearances } from '../data/fileTimelineDefaultData'
import { convertFromBackendData, convertToBackendFormat, mergeFileTimelineData } from './fileTimelineDataConverter'
import { validateFileTimelineData } from '../types/fileTimelineDataFormat'

/**
 * 测试默认数据的有效性
 */
export function testDefaultData(): boolean {
  console.log('测试默认文件时间线数据...')

  try {
    // 验证默认数据
    const isValid = validateFileTimelineData(defaultFileTimelineData)
    console.log(`默认数据验证结果: ${isValid ? '通过' : '失败'}`)

    if (isValid) {
      console.log('文件数量:', defaultFileTimelineData.sequence.files.length)
      console.log('角色数量:', defaultFileTimelineData.roleAppearances?.length || 0)
      console.log('总字数:', defaultFileTimelineData.metadata?.totalWordCount || 0)
    }

    return isValid
  } catch (error) {
    console.error('测试默认数据时出错:', error)
    return false
  }
}

/**
 * 测试数据转换功能
 */
export function testDataConversion(): boolean {
  console.log('测试数据转换功能...')

  try {
    // 将默认数据转换为后端格式
    const backendData = convertToBackendFormat(defaultFileTimelineData)
    console.log('转换为后端格式成功')
    console.log('后端文件数量:', backendData.files.length)
    console.log('后端角色数据数量:', backendData.roleUsages?.length || 0)

    // 将后端数据转换回我们的格式
    const convertedData = convertFromBackendData(
      backendData.files,
      backendData.roleUsages
    )
    console.log('从后端格式转换成功')

    // 验证转换后的数据
    const isValid = validateFileTimelineData(convertedData)
    console.log(`转换后数据验证结果: ${isValid ? '通过' : '失败'}`)

    return isValid
  } catch (error) {
    console.error('测试数据转换时出错:', error)
    return false
  }
}

/**
 * 测试数据合并功能
 */
export function testDataMerge(): boolean {
  console.log('测试数据合并功能...')

  try {
    // 创建两个不同的数据集
    const data1 = { ...defaultFileTimelineData }
    const data2 = { ...defaultFileTimelineData }

    // 修改第二个数据集
    if (data2.sequence.files.length > 0) {
      const firstFile = data2.sequence.files[0]
      if (firstFile) {
        firstFile.id = 'merged-file-1'
        firstFile.name = '合并的文件1'
        firstFile.wordCount = 9999
      }
    }

    // 合并数据
    const mergedData = mergeFileTimelineData(data1, data2)
    console.log('数据合并成功')
    console.log('合并后文件数量:', mergedData.sequence.files.length)

    // 验证合并后的数据
    const isValid = validateFileTimelineData(mergedData)
    console.log(`合并后数据验证结果: ${isValid ? '通过' : '失败'}`)

    return isValid
  } catch (error) {
    console.error('测试数据合并时出错:', error)
    return false
  }
}

/**
 * 运行所有测试
 */
export function runAllTests(): boolean {
  console.log('开始运行文件时间线数据测试...')

  const results = [
    testDefaultData(),
    testDataConversion(),
    testDataMerge()
  ]

  const allPassed = results.every(result => result)
  console.log(`\n测试结果: ${allPassed ? '全部通过' : '部分失败'}`)

  return allPassed
}

/**
 * 生成测试报告
 */
export function generateTestReport(): string {
  let report = '# 文件时间线数据测试报告\n\n'

  // 默认数据测试
  report += '## 默认数据测试\n'
  report += `- 文件数量: ${defaultFileTimelineData.sequence.files.length}\n`
  report += `- 角色数量: ${defaultFileTimelineData.roleAppearances?.length || 0}\n`
  report += `- 总字数: ${defaultFileTimelineData.metadata?.totalWordCount || 0}\n`
  report += `- 验证结果: ${validateFileTimelineData(defaultFileTimelineData) ? '通过' : '失败'}\n\n`

  // 数据转换测试
  try {
    const backendData = convertToBackendFormat(defaultFileTimelineData)
    const convertedData = convertFromBackendData(backendData.files, backendData.roleUsages)

    report += '## 数据转换测试\n'
    report += `- 转换为后端格式: 成功\n`
    report += `- 从后端格式转换: 成功\n`
    report += `- 转换后验证结果: ${validateFileTimelineData(convertedData) ? '通过' : '失败'}\n\n`
  } catch (error) {
    report += '## 数据转换测试\n'
    report += `- 转换过程出错: ${String(error)}\n\n`
  }

  // 数据合并测试
  try {
    const data1 = { ...defaultFileTimelineData }
    const data2 = { ...defaultFileTimelineData }

    if (data2.sequence.files.length > 0) {
      const firstFile = data2.sequence.files[0]
      if (firstFile) {
        firstFile.id = 'merged-file-1'
        firstFile.name = '合并的文件1'
      }
    }

    const mergedData = mergeFileTimelineData(data1, data2)

    report += '## 数据合并测试\n'
    report += `- 合并前文件数: ${data1.sequence.files.length}\n`
    report += `- 合并后文件数: ${mergedData.sequence.files.length}\n`
    report += `- 合并后验证结果: ${validateFileTimelineData(mergedData) ? '通过' : '失败'}\n\n`
  } catch (error) {
    report += '## 数据合并测试\n'
    report += `- 合并过程出错: ${String(error)}\n\n`
  }

  report += `## 总体结果\n`
  report += `- 测试时间: ${new Date().toISOString()}\n`
  report += `- 测试结论: ${runAllTests() ? '全部测试通过' : '部分测试失败'}\n`

  return report
}

// 如果直接运行此文件，执行测试
if (typeof window === 'undefined') {
  // 在 Node.js 环境中运行
  runAllTests()
}
