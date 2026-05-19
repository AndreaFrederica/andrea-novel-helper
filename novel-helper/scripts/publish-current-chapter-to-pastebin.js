export async function run(ctx, args) {
  const content = (args && args.text) || (ctx.activeDoc && (ctx.activeDoc.processed || ctx.activeDoc.raw)) || ''
  const tools = await ctx.mcp.listTools()
  const names = (tools.tools || []).map(t => t.name)
  const nav = names.includes('chrome_navigate') ? 'chrome_navigate' : (names.includes('open_url') ? 'open_url' : null)
  const fill = names.includes('chrome_fill_or_select') ? 'chrome_fill_or_select' : null
  const click = names.includes('chrome_click_element') ? 'chrome_click_element' : null
  const keyboard = names.includes('chrome_keyboard') ? 'chrome_keyboard' : null
  const getTabs = names.includes('get_windows_and_tabs') ? 'get_windows_and_tabs' : null
  if (!nav || !fill) return { ok: false, error: 'required tools missing', tools: names }
  await ctx.mcp.callTool({ name: nav, arguments: { url: 'https://pastebin.com/' } })
  const candidates = ['#postform textarea', 'textarea[name*="text"]', '#paste_code', 'textarea']
  let used = null
  for (const s of candidates) {
    try { await ctx.mcp.callTool({ name: fill, arguments: { selector: s, value: content } }); used = s; break } catch {}
  }
  if (!used) return { ok: false, error: 'no textarea found' }
  let submitted = false
  if (click) {
    const submits = ['#postform button[type="submit"]', '#postform input[type="submit"]', 'button[type="submit"]', 'input[type="submit"]']
    for (const s of submits) { try { await ctx.mcp.callTool({ name: click, arguments: { selector: s } }); submitted = true; break } catch {} }
  }
  if (!submitted && keyboard) { try { await ctx.mcp.callTool({ name: keyboard, arguments: { keys: 'Enter', selector: used } }); submitted = true } catch {} }
  let currentUrl = null
  if (getTabs) {
    try {
      const r = await ctx.mcp.callTool({ name: getTabs, arguments: {} })
      const tabs = (r && (r.structuredContent && r.structuredContent.tabs)) || r?.tabs || []
      const active = Array.isArray(tabs) ? tabs.find(t => t?.active || t?.focused) : null
      currentUrl = active && active.url ? active.url : null
    } catch {}
  }
  return { ok: true, usedSelector: used, submitted, currentUrl }
}