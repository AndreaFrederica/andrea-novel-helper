export async function run(client: any, args: any) {
  const tools = await client.listTools();
  const names = tools.tools?.map((t: any) => t.name) || [];
  const url = args?.url || "https://example.com";
  const name = names.includes("chrome_navigate") ? "chrome_navigate" : names.includes("open_url") ? "open_url" : undefined;
  if (!name) return { ok: false, reason: "navigate tool not available" };
  const result = await client.callTool({ name, arguments: { url } });
  return { ok: true, tool: name, url, result };
}