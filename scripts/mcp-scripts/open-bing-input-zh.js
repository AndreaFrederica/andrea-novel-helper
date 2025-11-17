export async function run(client, args) {
  const url = (args && args.url) || "https://www.bing.com";
  const text = (args && args.text) || "人工智能 测试";
  const preferredSelectors = [
    "#sb_form_q",
    "input[type='search']",
    "input[name='q']",
    "input[aria-label='Search']",
    "input[aria-label='搜索']"
  ];

  const tools = await client.listTools();
  const names = (tools.tools || []).map(t => t.name);
  const nav = names.includes("chrome_navigate") ? "chrome_navigate" : (names.includes("open_url") ? "open_url" : null);
  const fill = names.includes("chrome_fill_or_select") ? "chrome_fill_or_select" : null;
  const click = names.includes("chrome_click_element") ? "chrome_click_element" : null;
  const keyboard = names.includes("chrome_keyboard") ? "chrome_keyboard" : null;
  const getInteractive = names.includes("chrome_get_interactive_elements") ? "chrome_get_interactive_elements" : null;

  if (!nav || !fill) {
    return { ok: false, error: "required tools missing", tools: names };
  }

  await client.callTool({ name: nav, arguments: { url } });

  // Try preferred selectors first
  let selector = preferredSelectors[0];

  // If interactive inspection is available, try to discover an input-like selector
  if (getInteractive) {
    try {
      const res = await client.callTool({ name: getInteractive, arguments: {} });
      const elems = Array.isArray(res?.structuredContent?.elements)
        ? res.structuredContent.elements
        : [];
      const candidates = elems.filter(e => {
        const sel = String(e?.selector || "");
        const type = String(e?.type || "").toLowerCase();
        return (
          sel.includes("sb_form_q") ||
          type.includes("input") ||
          sel.includes("input") ||
          type.includes("search")
        );
      });
      if (candidates.length > 0) {
        selector = candidates[0].selector || selector;
      }
    } catch {}
  }

  // Optional: focus the input box
  if (click) {
    try { await client.callTool({ name: click, arguments: { selector } }); } catch {}
  }

  // Fill the query text
  await client.callTool({ name: fill, arguments: { selector, value: text } });

  // Press Enter to submit if keyboard available
  if (keyboard) {
    try { await client.callTool({ name: keyboard, arguments: { keys: "Enter", selector } }); } catch {}
  }

  return { ok: true, url, selector, text };
}