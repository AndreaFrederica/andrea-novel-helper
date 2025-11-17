import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpClientOptions {
  name?: string;
  version?: string;
  httpUrl?: string;
  command?: string;
  args?: string[];
}

export type McpTransport = StdioClientTransport | StreamableHTTPClientTransport;

export type McpClientHandle = {
  client: Client;
  transport: McpTransport;
  disconnect: () => Promise<void>;
};

export async function createMcpClient(opts: McpClientOptions = {}): Promise<McpClientHandle> {
  const httpUrl = opts.httpUrl || process.env.MCP_HTTP_URL || process.env.MCP_CHROME_HTTP_URL;
  let transport: McpTransport;

  if (httpUrl) {
    transport = new StreamableHTTPClientTransport(new URL(httpUrl));
  } else {
    const command = opts.command || process.env.MCP_CMD || process.env.MCP_CHROME_CMD || "chrome-mcp";
    const args = opts.args || [];
    transport = new StdioClientTransport({ command, args });
  }

  const client = new Client({
    name: opts.name || "anh-mcp-client",
    version: opts.version || "0.1.0",
  });

  await client.connect(transport);

  return {
    client,
    transport,
    disconnect: async () => {
      try {
        await transport.close();
      } catch {}
    },
  };
}