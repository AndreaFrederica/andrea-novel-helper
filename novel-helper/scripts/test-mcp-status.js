export async function run(ctx, args) {
  // 测试MCP服务器的动态启用/禁用功能
  console.log('开始测试MCP服务器状态...')

  // 检查MCP客户端是否可用
  const hasMcp = !!ctx.mcp
  console.log(`MCP客户端可用: ${hasMcp}`)

  if (hasMcp) {
    try {
      // 列出可用的工具/资源
      if (ctx.mcp.listTools) {
        const tools = await ctx.mcp.listTools()
        console.log(`可用工具数量: ${tools.tools?.length || 0}`)
        if (tools.tools?.length > 0) {
          console.log('前几个工具:', tools.tools.slice(0, 3).map(t => t.name))
        }
      }

      if (ctx.mcp.listResources) {
        const resources = await ctx.mcp.listResources()
        console.log(`可用资源数量: ${resources.resources?.length || 0}`)
      }
    } catch (error) {
      console.log('MCP调用失败:', error.message)
      return {
        success: false,
        message: 'MCP服务器未正确配置或已禁用',
        error: error.message
      }
    }
  }

  const result = {
    success: true,
    timestamp: new Date().toISOString(),
    mcpAvailable: hasMcp,
    activeDocument: {
      uri: ctx.activeDoc?.uri,
      name: ctx.activeDoc?.name,
      hasContent: !!ctx.activeDoc?.raw
    }
  }

  console.log('测试完成:', result)
  return result
}