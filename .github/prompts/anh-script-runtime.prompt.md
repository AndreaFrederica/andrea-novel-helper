---
mode: ask
description: ANH 脚本运行器的领域知识：脚本格式、ctx API、MCP 客户端集成、mcp.json 配置
---

# ANH Script Runtime — Agent Knowledge Base

This skill gives you the domain knowledge needed to create, edit, and run scripts inside an **ANH (Andrea Novel Helper)** project using the built-in Script Runner.

---

## 1. What Is the ANH Script Runtime?

ANH includes a **Script Runner sidebar** (`andrea.scriptsView`) that lets users execute JavaScript (`.js`) or TypeScript (`.ts`) scripts directly inside VS Code. Scripts can:

- Read and process the currently open document.
- Call tools on a connected **MCP (Model Context Protocol)** server (e.g., a browser automation server).
- Write output to the **ANH Scripts** output channel.
- Use Node.js built-in modules (`fs`, `path`, `os`).

Scripts are lightweight automation tools — think of them as macros that run inside the editor context.

---

## 2. Where Scripts Live

The script root directory is configured by the VS Code setting:

```
AndreaNovelHelper.scripts.root   (default: "novel-helper/scripts")
```

The resolved absolute path is `<workspace-root>/novel-helper/scripts/` by default.

**Example layout:**

```
<workspace-root>/
└── novel-helper/
    ├── scripts/               ← script root
    │   ├── my-script.js       ← a runnable script
    │   ├── browser/
    │   │   └── navigate.js
    │   └── utils/
    │       └── helpers.js
    └── mcp.json               ← MCP server configuration
```

- Only `.js` and `.ts` files appear in the sidebar tree.
- Subdirectories are shown as collapsible folders.
- A **"新建脚本..."** item at the top lets users create new scripts from the sidebar.

---

## 3. Script Format

Every script must export a function named **`run`** (or a `default` export that is a function):

```js
// Minimal script (no MCP required)
export async function run(ctx, args) {
  return { ok: true };
}
```

```js
// Script using active document and output channel
export async function run(ctx, args) {
  ctx.output.show();
  ctx.output.appendLine('File: ' + ctx.activeDoc.name);
  ctx.output.appendLine('Word count: ' + ctx.activeDoc.processed.length);
  return { ok: true };
}
```

**Rules:**
- The export must be `export function run` or `export default function`.
- The function receives `(ctx, args)` — both are always provided.
- The function may be `async`; the runtime always `await`s the result.
- Any `console.log` / `console.error` / etc. calls inside the script are **automatically redirected** to the ANH Scripts output channel (not the browser console).

---

## 4. Runtime Context (`ctx`)

The `ctx` object injected into every script exposes:

### 4a. Node.js Modules

| Property | Value |
|---|---|
| `ctx.fs` | Node.js `fs` module |
| `ctx.path` | Node.js `path` module |
| `ctx.os` | Node.js `os` module |
| `ctx.env` | `process.env` |

### 4b. Active Document (`ctx.activeDoc`)

Contains information about the document currently open in the editor.

| Property | Description |
|---|---|
| `ctx.activeDoc.uri` | VS Code URI string of the file (`file:///...`) |
| `ctx.activeDoc.filePath` | Absolute filesystem path (`string \| undefined`) |
| `ctx.activeDoc.name` | Filename, e.g. `chapter-01.md` |
| `ctx.activeDoc.title` | Same as `name` |
| `ctx.activeDoc.fullPath` | Same as `filePath` |
| `ctx.activeDoc.raw` | Full raw text of the document |
| `ctx.activeDoc.processed` | Plain-text version (Markdown → plain text for `.md` files, otherwise raw) |

If no document is open, all `activeDoc` properties are empty strings or `undefined`.

**Selection priority:** ANH prefers a Markdown or plain-text file in the visible editors. If no preferred file is open, it falls back to any file-scheme document.

### 4c. Output Channel (`ctx.output`)

| Method | Description |
|---|---|
| `ctx.output.appendLine(s)` | Append a line to the ANH Scripts output channel |
| `ctx.output.append(s)` | Append text without newline |
| `ctx.output.clear()` | Clear the output channel |
| `ctx.output.show()` | Bring the output channel into view |

### 4d. MCP Client (`ctx.mcp`)

When an MCP server is enabled in `novel-helper/mcp.json`, `ctx.mcp` is a live `@modelcontextprotocol/sdk` `Client` instance.

When no server is enabled or configured, `ctx.mcp` is `null`.

**Always check before using:**

```js
export async function run(ctx, args) {
  if (!ctx.mcp) {
    ctx.output.appendLine('No MCP server connected. Skipping browser steps.');
    return { ok: false, reason: 'no-mcp' };
  }
  const tools = await ctx.mcp.listTools();
  ctx.output.appendLine('Available tools: ' + tools.tools.map(t => t.name).join(', '));
}
```

**Key MCP client methods:**

```js
// List available tools on the server
const { tools } = await ctx.mcp.listTools();

// Call a tool
const result = await ctx.mcp.callTool({ name: 'chrome_navigate', arguments: { url: 'https://example.com' } });

// Access result content
const content = result.content;              // array of content items
const text = content.find(c => c.type === 'text')?.text;
```

---

## 5. MCP Configuration (`novel-helper/mcp.json`)

ANH reads MCP server settings from `<workspace-root>/novel-helper/mcp.json`.

**Default content** (created automatically if missing):

```json
{
  "mcpServers": {
    "chrome-mcp-server": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:12306/mcp",
      "enabled": true
    }
  },
  "defaultServer": "chrome-mcp-server"
}
```

### Server Entry Fields

| Field | Type | Description |
|---|---|---|
| `type` | `"streamableHttp"` or `"stdio"` | Transport type |
| `url` | string | HTTP endpoint URL (only for `streamableHttp`) |
| `command` | string | CLI command (only for `stdio`) |
| `args` | string[] | CLI args (only for `stdio`) |
| `enabled` | boolean | Whether this server is active |

### Multiple Servers

You can define multiple servers. When a script runs, ANH runs it once per **enabled** server, in parallel:

```json
{
  "mcpServers": {
    "chrome-mcp-server": { "type": "streamableHttp", "url": "http://127.0.0.1:12306/mcp", "enabled": true },
    "local-tools": { "type": "stdio", "command": "my-mcp-server", "args": [], "enabled": false }
  },
  "defaultServer": "chrome-mcp-server"
}
```

### Editing the Config

- The sidebar shows a **"MCP 服务器"** root node listing all configured servers.
- Click a server item to toggle it on/off.
- Use the command **`andrea.scripts.openMcpConfig`** to open `mcp.json` in the editor.
- Changes to `mcp.json` are detected automatically; the client cache is invalidated.

---

## 6. Running Scripts

### From the Sidebar

1. Open the **Script Runner** sidebar panel (`andrea.scriptsView`).
2. Navigate to a `.js` or `.ts` file.
3. **Right-click → Run** (or use the run button in the title bar).

### Execution behaviour

- If the environment variable `MCP_CHROME_HTTP_URL` or `MCP_HTTP_URL` is set, it overrides the config and connects directly to that URL.
- Otherwise, ANH connects to all enabled servers in `mcp.json` and runs the script once per server in parallel.
- If **no** servers are enabled, the script runs with `ctx.mcp = null` (no MCP) — useful for local file processing scripts.

### Output

All output (including redirected `console.log`) appears in the **ANH Scripts** output channel. This channel opens automatically when a script runs.

---

## 7. Common Script Patterns

### Read active document and process it

```js
export async function run(ctx, args) {
  const { name, processed } = ctx.activeDoc;
  ctx.output.appendLine(`Processing: ${name}`);
  // count Chinese characters
  const cjk = (processed.match(/[\u4e00-\u9fff]/g) || []).length;
  ctx.output.appendLine(`CJK characters: ${cjk}`);
  return { name, cjk };
}
```

### Navigate a browser with chrome-mcp

```js
export async function run(ctx, args) {
  if (!ctx.mcp) return { ok: false, reason: 'no-mcp' };
  const tools = await ctx.mcp.listTools();
  const names = tools.tools.map(t => t.name);
  const nav = names.includes('chrome_navigate') ? 'chrome_navigate' : names.includes('open_url') ? 'open_url' : null;
  if (!nav) return { ok: false, reason: 'navigate tool not available' };
  await ctx.mcp.callTool({ name: nav, arguments: { url: 'https://example.com' } });
  ctx.output.appendLine('Navigated to example.com');
  return { ok: true };
}
```

### Write results to a file

```js
export async function run(ctx, args) {
  const outPath = ctx.path.join(ctx.path.dirname(ctx.activeDoc.filePath || ''), 'output.txt');
  ctx.fs.writeFileSync(outPath, 'Hello from ANH script!\n', 'utf8');
  ctx.output.appendLine('Wrote: ' + outPath);
  return { ok: true, outPath };
}
```

---

## 8. Creating a New Script

### From the Sidebar

1. Click **"新建脚本..."** at the top of the Script Runner panel.
2. Enter a filename (e.g. `my-script.js`).
3. A file is created with the minimal template:
   ```js
   export async function run(ctx, args) { return { ok: true, activeDoc: ctx.activeDoc } }
   ```
4. The file opens in the editor automatically.

### Manually

1. Create a `.js` or `.ts` file under `<workspace-root>/novel-helper/scripts/` (or any subdirectory).
2. Export a `run(ctx, args)` function.
3. The sidebar tree auto-refreshes and the new file appears.

---

## 9. Key Settings

| Setting | Default | Description |
|---|---|---|
| `AndreaNovelHelper.scripts.root` | `"novel-helper/scripts"` | Root directory for the Script Runner sidebar |

---

## 10. Key Rules for Script Development

1. **Always export `run` or a default function** — scripts without an exported function will fail with an error.
2. **Check `ctx.mcp` before use** — it is `null` when no server is configured or enabled.
3. **Use `ctx.output` instead of `console.log`** for reliable output — `console.log` is also redirected, but `ctx.output` gives you more control (e.g. `clear()`, `show()`).
4. **Scripts are stateless** — each run creates a fresh context. Do not rely on module-level variables persisting between runs.
5. **The client is cached** — the same MCP client connection is reused across runs for the same server config. Reconnection happens automatically on config change.
6. **Do not edit `mcp.json` directly from a script** — use the sidebar UI or the VS Code command to avoid race conditions.
