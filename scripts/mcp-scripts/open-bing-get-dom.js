export async function run(client, args) {
  const url = (args && args.url) || "https://www.bing.com";
  const tools = await client.listTools();
  const names = (tools.tools || []).map(t => t.name);
  const nav = names.includes("chrome_navigate") ? "chrome_navigate" : (names.includes("open_url") ? "open_url" : null);
  if (!nav) return { ok: false, error: "navigate tool not available", tools: names };
  await client.callTool({ name: nav, arguments: { url } });
  const getContent = names.includes("chrome_get_web_content") ? "chrome_get_web_content" : null;
  if (!getContent) return { ok: false, error: "content tool not available", tools: names };
  const result = await client.callTool({ name: getContent, arguments: { format: "html" } });
  let text = undefined;
  if (Array.isArray(result && result.content)) {
    const entry = result.content.find(c => c && c.type === "text");
    text = entry && entry.text;
  }
  let parsed = undefined;
  try { parsed = typeof text === "string" ? JSON.parse(text) : undefined; } catch {}
  return { ok: true, url, contentText: text, parsed };
}