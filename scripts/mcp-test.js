"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chromeClient_1 = require("../src/mcp/chromeClient");
async function main() {
    const httpUrl = process.env.MCP_CHROME_HTTP_URL;
    if (httpUrl) {
        console.log(`MCP: trying to connect via streamable http '${httpUrl}'`);
    }
    else {
        const cmd = process.env.MCP_CHROME_CMD || "chrome-mcp";
        console.log(`MCP: trying to connect via stdio '${cmd}'`);
    }
    try {
        const { client, disconnect } = await (0, chromeClient_1.createChromeMcpClient)({ httpUrl });
        const tools = await (0, chromeClient_1.listChromeTools)(client);
        const toolNames = tools.tools?.map(t => t.name) || [];
        console.log(`MCP: connected. tools = ${JSON.stringify(toolNames)}`);
        if (toolNames.includes("open_url") || toolNames.includes("chrome_navigate")) {
            const url = "https://example.com";
            const name = toolNames.includes("open_url") ? "open_url" : "chrome_navigate";
            const result = await (0, chromeClient_1.callChromeTool)(client, name, { url });
            console.log(`MCP: ${name}(${url}) => ${JSON.stringify(result)}`);
        }
        else {
            console.log("MCP: neither 'open_url' nor 'chrome_navigate' available; skipping call.");
        }
        await disconnect();
    }
    catch (err) {
        const msg = err?.message || String(err);
        console.error(`MCP: failed to connect or run tools: ${msg}`);
        console.error("Hint: for stdio, install and expose 'chrome-mcp' or set MCP_CHROME_CMD; for http, set MCP_CHROME_HTTP_URL to your server (e.g. http://127.0.0.1:12306/mcp).");
        process.exitCode = 1;
    }
}
main();
//# sourceMappingURL=mcp-test.js.map