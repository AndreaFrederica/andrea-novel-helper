export async function run(ctx, args) {
  // 测试不依赖MCP的功能
  console.log('开始测试不依赖MCP的功能...')

  // 测试基本系统信息
  const result = {
    success: true,
    timestamp: new Date().toISOString(),
    platform: ctx.os.platform(),
    arch: ctx.os.arch(),
    nodeVersion: ctx.os.version(),

    // 测试文档信息
    activeDocument: {
      hasDocument: !!ctx.activeDoc,
      hasRawContent: !!ctx.activeDoc?.raw,
      hasProcessedContent: !!ctx.activeDoc?.processed,
      fileName: ctx.activeDoc?.name || 'none',
      filePath: ctx.activeDoc?.filePath || 'none'
    },

    // 测试文件系统访问
    canAccessFs: typeof ctx.fs === 'object',

    // 测试环境变量访问
    canAccessEnv: typeof ctx.env === 'object',
    envCount: Object.keys(ctx.env || {}).length,

    // 测试路径工具
    canAccessPath: typeof ctx.path === 'object',

    // 测试输出功能
    canOutput: typeof ctx.output === 'object'
  }

  console.log('测试完成:', result)

  // 测试输出功能
  if (ctx.output) {
    ctx.output.appendLine('\n--- 输出测试 ---')
    ctx.output.appendLine('这是通过ctx.output输出的消息')
    ctx.output.appendLine(`当前时间: ${new Date().toLocaleString()}`)
  }

  return result
}