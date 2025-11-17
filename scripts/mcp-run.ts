import { runMcpScript } from "../src/mcp/runtime";

async function main() {
  const scriptPath = process.argv[2];
  if (!scriptPath) {
    console.error("Usage: npm run mcp:run -- <scriptPath>");
    process.exit(1);
  }

  const httpUrl = process.env.MCP_CHROME_HTTP_URL || process.env.MCP_HTTP_URL;
  const clientOpts = httpUrl ? { httpUrl } : {};
  try {
    const result = await runMcpScript({ scriptPath, client: clientOpts });
    if (result !== undefined) console.log(JSON.stringify(result));
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error(`MCP runtime error: ${msg}`);
    process.exit(1);
  }
}

main();