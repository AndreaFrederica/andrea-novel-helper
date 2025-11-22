import { createMcpClient } from "./clientFactory";
import { pathToFileURL } from "url";
import * as fs from "fs";

export interface RunScriptOptions {
  scriptPath?: string;
  args?: Record<string, unknown>;
  client?: Parameters<typeof createMcpClient>[0];
}

export async function runMcpScript(opts: RunScriptOptions) {
  const { client: clientOpts, scriptPath, args } = opts;
  const { client, disconnect } = await createMcpClient(clientOpts || {});
  try {
    if (!scriptPath) throw new Error("scriptPath is required");
    if (!fs.existsSync(scriptPath)) throw new Error(`script not found: ${scriptPath}`);
    // eslint-disable-next-line no-restricted-syntax
    const mod = await import(pathToFileURL(scriptPath).href);
    const run = (mod && (mod.default || mod.run)) as ((c: any, a?: any) => Promise<any> | any);
    if (typeof run !== "function") throw new Error("script must export default or run function");
    const result = await run(client, args || {});
    return result;
  } finally {
    await disconnect();
  }
}