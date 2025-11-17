export async function run(ctx, args) {
  console.log('[pastebin-fill-submit] start')
  let tools
  let names = []
  try {
    tools = await ctx.mcp.listTools()
    names = (tools.tools || []).map(t => t.name)
  } catch (e) {
    console.log('[pastebin-fill-submit] listTools failed', e?.message || String(e))
    return { ok: false, error: 'mcp listTools failed', detail: e?.message || String(e) }
  }

  const nav = names.includes('chrome_navigate') ? 'chrome_navigate' : null
  const getWeb = names.includes('chrome_get_web_content') ? 'chrome_get_web_content' : null
  const fill = names.includes('chrome_fill_or_select') ? 'chrome_fill_or_select' : null
  const inject = names.includes('chrome_inject_script') ? 'chrome_inject_script' : null
  const readConsole = names.includes('chrome_console') ? 'chrome_console' : null
  const clickEl = names.includes('chrome_click_element') ? 'chrome_click_element' : null
  const getInteractive = names.includes('chrome_get_interactive_elements') ? 'chrome_get_interactive_elements' : null
  const getTabs = names.includes('get_windows_and_tabs') ? 'get_windows_and_tabs' : null
  if (!nav || !getWeb || !fill || !clickEl) return { ok: false, error: 'required tool missing', tools: names }

  await ctx.mcp.callTool({ name: nav, arguments: { url: 'https://pastebin.com/' } })
  console.log('[pastebin-fill-submit] navigated to https://pastebin.com/')

  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  await sleep(1200)

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

  console.log('[pastebin-fill-submit] selector check', {
    textFound: !!(textHtml && String(textHtml).length),
    nameFound: !!(nameHtml && String(nameHtml).length),
  })

  const active = ctx.activeDoc || {}
  const title = (args?.title ?? args?.name ?? active.title ?? active.name ?? '未命名')
  const body = (args?.body ?? args?.text ?? active.processed ?? active.raw ?? '')
  const source = (active.path || active.filePath || active.fullPath || active.uri || '')
  try { await ctx.mcp.callTool({ name: fill, arguments: { selector: '#postform-name', value: title } }) } catch {}
  try { await ctx.mcp.callTool({ name: fill, arguments: { selector: '#postform-text', value: body } }) } catch {}

  await sleep(1500)

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
        if (cm && res.before.cmLen < 5) {
          cm.setValue(${JSON.stringify(body)})
        }
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
      const textify = (m) => (m?.text ?? m?.message ?? m?.content ?? (typeof m === 'string' ? m : ''))
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

  console.log('[pastebin-fill-submit] verify', {
    textTextLen: textText ? String(textText).length : 0,
    textHtmlLen: textHtml2 ? String(textHtml2).length : 0,
    nameHtmlLen: nameHtml2 ? String(nameHtml2).length : 0,
    valueLens: { text: afterLenText, name: afterLenName, cm: afterLenCM },
    source,
    usedTitle: title,
  })

  let clicked = false
  const triedSelectors = []
  let clickMethod = 'unknown'

  if (inject) {
    try {
      const jsMarkSubmitButton = `(() => {\n  const result = { ok: true, present: false, selector: null, text: null, error: null };\n  try {\n    const btn = document.querySelector('div.form-group.form-btn-container > button.btn.-big[type=\"submit\"]') || Array.from(document.querySelectorAll('button.btn.-big[type=\"submit\"]')).find(b => /create new paste/i.test((b.textContent || '').trim()));\n    if (!btn) {\n      result.ok = false;\n      result.error = 'submit button not found';\n      console.log('__PB_SUBMIT_BTN__' + JSON.stringify(result));\n      return result;\n    }\n    const id = '__mcp_pastebin_submit_btn__';\n    btn.id = id;\n    try { btn.scrollIntoView({ block: 'center' }); } catch (e) {}\n    result.present = true;\n    result.selector = '#' + id;\n    result.text = (btn.textContent || '').trim();\n    console.log('__PB_SUBMIT_BTN__' + JSON.stringify(result));\n    return result;\n  } catch (e) {\n    result.ok = false;\n    result.error = e && e.message ? e.message : String(e);\n    console.log('__PB_SUBMIT_BTN__' + JSON.stringify(result));\n    return result;\n  }\n})()`
      await ctx.mcp.callTool({ name: inject, arguments: { type: 'MAIN', jsScript: jsMarkSubmitButton } })
      const idSel = '#__mcp_pastebin_submit_btn__'
      triedSelectors.push(idSel)
      await ctx.mcp.callTool({ name: clickEl, arguments: { selector: idSel } })
      clicked = true
      clickMethod = 'mark-id'
    } catch {}
  }

  if (!clicked) {
    const submitSelectors = [
      'div.form-group.form-btn-container > button.btn.-big[type="submit"]',
      'form#postform button.btn.-big[type="submit"]',
      'button.btn.-big[type="submit"]'
    ]
    for (const sel of submitSelectors) {
      if (clicked) break
      try {
        triedSelectors.push(sel)
        await ctx.mcp.callTool({ name: clickEl, arguments: { selector: sel } })
        clicked = true
        clickMethod = 'selector'
      } catch {}
    }
  }

  let interactiveCount = 0
  if (!clicked && getInteractive) {
    try {
      const rIE = await ctx.mcp.callTool({ name: getInteractive, arguments: { textQuery: 'Create New Paste', includeCoordinates: true } })
      const items = rIE?.elements || rIE?.structuredContent?.elements || rIE || []
      interactiveCount = Array.isArray(items) ? items.length : 0
      const btn = Array.isArray(items) ? items.find(el => (el?.tagName || '').toLowerCase() === 'button' || /btn/.test(el?.className || '')) : null
      if (btn && btn.coordinates) {
        await ctx.mcp.callTool({ name: clickEl, arguments: { coordinates: { x: btn.coordinates.x, y: btn.coordinates.y } } })
        clicked = true
        clickMethod = 'coords'
      }
    } catch {}
  }

  await sleep(1000)

  let finalUrl = ''
  try {
    if (getTabs) {
      const tabsInfo = await ctx.mcp.callTool({ name: getTabs, arguments: {} })
      const windows = tabsInfo?.windows || tabsInfo || []
      const allTabs = []
      if (Array.isArray(windows)) {
        for (const w of windows) {
          if (Array.isArray(w?.tabs)) {
            for (const t of w.tabs) allTabs.push(t)
          }
        }
      }
      const activeTab = allTabs.find(t => t?.active) || allTabs[allTabs.length - 1]
      finalUrl = activeTab?.url || ''
    }
  } catch {}

  let pageHint = ''
  try {
    if (getWeb) {
      const r3 = await ctx.mcp.callTool({ name: getWeb, arguments: { textContent: true } })
      pageHint = r3?.text || r3?.content || r3?.structuredContent?.text || r3?.structuredContent?.content || ''
    }
  } catch {}

  const submitted = !!(finalUrl && /pastebin\.com\/\w+/i.test(finalUrl))
  console.log('[pastebin-fill-submit] result', { submitted, finalUrl, source, clickMethod, interactiveCount, triedSelectors })

  return {
    ok: true,
    submitted,
    url: finalUrl || null,
    usedTitle: title,
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
    },
    debug: { clickMethod, interactiveCount, triedSelectors }
  }
}