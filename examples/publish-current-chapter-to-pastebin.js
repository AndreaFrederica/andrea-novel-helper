export async function run(ctx, args) {
  console.log('[pastebin-fill] start')
  let tools
  let names = []
  try {
    tools = await ctx.mcp.listTools()
    names = (tools.tools || []).map(t => t.name)
  } catch (e) {
    console.log('[pastebin-fill] listTools failed', e?.message || String(e))
    return { ok: false, error: 'mcp listTools failed', detail: e?.message || String(e) }
  }

  const nav = names.includes('chrome_navigate') ? 'chrome_navigate' : null
  const getWeb = names.includes('chrome_get_web_content') ? 'chrome_get_web_content' : null
  const fill = names.includes('chrome_fill_or_select') ? 'chrome_fill_or_select' : null
  const inject = names.includes('chrome_inject_script') ? 'chrome_inject_script' : null
  const readConsole = names.includes('chrome_console') ? 'chrome_console' : null
  if (!nav || !getWeb || !fill) return { ok: false, error: 'required tool missing', tools: names }

  // 打开 Pastebin 首页
  await ctx.mcp.callTool({ name: nav, arguments: { url: 'https://pastebin.com/' } })
  console.log('[pastebin-fill] navigated to https://pastebin.com/')

  // 等待页面初始渲染稳定
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  await sleep(1200)

  // 抓取输入框 HTML，确认选择器有效
  let textHtml = ''
  let nameHtml = ''
  try {
    const r1 = await ctx.mcp.callTool({ name: getWeb, arguments: { format: 'html', selector: '#postform-text' } })
    textHtml = r1?.html || r1?.content || r1?.text || ''
  } catch {}
  try {
    const r2 = await ctx.mcp.callTool({ name: getWeb, arguments: { format: 'html', selector: '#postform-name' } })
    nameHtml = r2?.html || r2?.content || r2?.text || ''
  } catch {}

  console.log('[pastebin-fill] selector check', {
    textFound: !!(textHtml && String(textHtml).length),
    nameFound: !!(nameHtml && String(nameHtml).length),
  })

  // 从预览源获取标题与正文（优先 args，其次 activeDoc）
  const active = ctx.activeDoc || {}
  const title = (args?.title ?? args?.name ?? active.title ?? active.name ?? '未命名')
  const body = (args?.body ?? args?.text ?? active.processed ?? active.raw ?? '')
  const source = (active.path || active.filePath || active.fullPath || active.uri || '')
  try { await ctx.mcp.callTool({ name: fill, arguments: { selector: '#postform-name', value: title } }) } catch {}
  try { await ctx.mcp.callTool({ name: fill, arguments: { selector: '#postform-text', value: body } }) } catch {}

  await sleep(300)

  // 注入脚本读取 .value/CodeMirror 并兜底设置，输出到控制台
  let afterLenText = 0
  let afterLenName = 0
  let afterLenCM = 0
  if (inject && readConsole) {
    const js = `(() => {
      const res = { ok: true }
      try {
        const elText = document.querySelector('#postform-text')
        const elName = document.querySelector('#postform-name')
        const cmEl = document.querySelector('.CodeMirror')
        const cm = cmEl && cmEl.CodeMirror
        res.present = { text: !!elText, name: !!elName, cm: !!cm }
        res.before = { textLen: elText?.value?.length || 0, nameLen: elName?.value?.length || 0, cmLen: cm ? (cm.getValue()?.length || 0) : 0 }
        // 兜底：CodeMirror 优先
        if (cm && res.before.cmLen < 5) {
          cm.setValue(${JSON.stringify(body)})
        }
        // 兜底：textarea 和 input 设置 .value 并派发事件
        if (elText && (!elText.value || elText.value.length < 5)) {
          elText.value = ${JSON.stringify(body)}
          elText.dispatchEvent(new Event('input', { bubbles: true }))
          elText.dispatchEvent(new Event('change', { bubbles: true }))
        }
        if (elName && (!elName.value || elName.value.length < 2)) {
          elName.value = ${JSON.stringify(title)}
          elName.dispatchEvent(new Event('input', { bubbles: true }))
          elName.dispatchEvent(new Event('change', { bubbles: true }))
        }
        // 再读一次长度
        res.after = { textLen: elText?.value?.length || 0, nameLen: elName?.value?.length || 0, cmLen: cm ? (cm.getValue()?.length || 0) : 0 }
      } catch (e) {
        res.ok = false
        res.error = e && e.message ? e.message : String(e)
      }
      console.log('__FILL_SUMMARY__' + JSON.stringify(res))
      return res
    })()`
    try { await ctx.mcp.callTool({ name: inject, arguments: { type: 'MAIN', jsScript: js } }) } catch {}
    await sleep(200)
    try {
      const r = await ctx.mcp.callTool({ name: readConsole, arguments: { includeExceptions: true, maxMessages: 200 } })
      const msgs = r?.structuredContent?.messages || r?.messages || []
      const textify = (m) => {
        if (!m) return ''
        return (m.text ?? m.message ?? m.content ?? (typeof m === 'string' ? m : ''))
      }
      const lines = Array.isArray(msgs) ? msgs.map(textify).filter(Boolean) : []
      const line = lines.reverse().find(t => typeof t === 'string' && (t.startsWith('__FILL_SUMMARY__') || t.startsWith('__FILL_VERIFY__')))
      if (line) {
        const json = line.replace('__FILL_SUMMARY__', '').replace('__FILL_VERIFY__', '')
        try {
          const obj = JSON.parse(json)
          afterLenText = obj?.after?.textLen || 0
          afterLenName = obj?.after?.nameLen || 0
          afterLenCM = obj?.after?.cmLen || 0
        } catch {}
      }
    } catch {}
  }

  // 回读验证：textarea 用 text，input 用 html
  let textText = ''
  let textHtml2 = ''
  let nameHtml2 = ''
  try {
    const r3 = await ctx.mcp.callTool({ name: getWeb, arguments: { format: 'text', selector: '#postform-text' } })
    textText = r3?.text || r3?.content || ''
  } catch {}
  try {
    const r4 = await ctx.mcp.callTool({ name: getWeb, arguments: { format: 'html', selector: '#postform-text' } })
    textHtml2 = r4?.html || r4?.content || ''
  } catch {}
  try {
    const r5 = await ctx.mcp.callTool({ name: getWeb, arguments: { format: 'html', selector: '#postform-name' } })
    nameHtml2 = r5?.html || r5?.content || ''
  } catch {}

  const cut = (s, n = 120) => {
    const str = typeof s === 'string' ? s : String(s || '')
    return str.length > n ? str.slice(0, n) + '...' : str
  }

  console.log('[pastebin-fill] verify', {
    textTextLen: textText ? String(textText).length : 0,
    textHtmlLen: textHtml2 ? String(textHtml2).length : 0,
    nameHtmlLen: nameHtml2 ? String(nameHtml2).length : 0,
    valueLens: { text: afterLenText, name: afterLenName, cm: afterLenCM },
    source,
    usedTitle: title,
  })

  return {
    ok: true,
    usedSelectors: { title: '#postform-name', text: '#postform-text' },
    wrote: { titleLength: title.length, textLength: body.length },
    readBack: {
      textTextLength: textText ? String(textText).length : 0,
      textHtmlLength: textHtml2 ? String(textHtml2).length : 0,
      nameHtmlLength: nameHtml2 ? String(nameHtml2).length : 0,
      textTextSample: cut(textText),
      textHtmlSample: cut(textHtml2),
      nameHtmlSample: cut(nameHtml2),
      valueLens: { text: afterLenText, name: afterLenName, cm: afterLenCM },
      source,
      titleUsed: title,
    }
  }
}