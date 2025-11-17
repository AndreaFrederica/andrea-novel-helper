import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface ChromeMcpOptions {
  command?: string;
  args?: string[];
  name?: string;
  version?: string;
  httpUrl?: string;
}

export type ChromeMcpClient = {
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  disconnect: () => Promise<void>;
};

export async function createChromeMcpClient(opts: ChromeMcpOptions = {}): Promise<ChromeMcpClient> {
  const httpUrl = opts.httpUrl || process.env.MCP_CHROME_HTTP_URL;
  let transport: StdioClientTransport | StreamableHTTPClientTransport;
  if (httpUrl) {
    transport = new StreamableHTTPClientTransport(new URL(httpUrl));
  } else {
    const command = opts.command || process.env.MCP_CHROME_CMD || "chrome-mcp";
    const args = opts.args || [];
    transport = new StdioClientTransport({ command, args });
  }

  const client = new Client({
    name: opts.name || "anh-chrome-client",
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

export async function listChromeTools(client: Client) {
  return client.listTools();
}

export async function callChromeTool(client: Client, name: string, args: Record<string, unknown>) {
  return client.callTool({ name, arguments: args });
}