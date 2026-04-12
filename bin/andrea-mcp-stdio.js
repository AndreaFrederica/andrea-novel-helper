#!/usr/bin/env node
/**
 * andrea-mcp-stdio.js
 *
 * Stdio proxy for the Andrea Novel Helper MCP server.
 *
 * This script connects to the running HTTP MCP server (started by the
 * VSCode extension) and bridges it over stdio, so that Claude Desktop,
 * Continue.dev, and other tools that speak the stdio MCP protocol can
 * use the same server.
 *
 * Usage in claude_desktop_config.json (or similar):
 *
 *   {
 *     "mcpServers": {
 *       "andrea-novel-helper": {
 *         "command": "node",
 *         "args": ["/path/to/extension/bin/andrea-mcp-stdio.js"]
 *       }
 *     }
 *   }
 *
 * The HTTP URL defaults to http://127.0.0.1:13306/mcp but can be
 * overridden with the ANDREA_MCP_URL environment variable.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const http = require('http')
const { Readable } = require('stream')

const MCP_URL = process.env.ANDREA_MCP_URL || 'http://127.0.0.1:13306/mcp'

function postToMcp(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const url = new URL(MCP_URL)
    const options = {
      hostname: url.hostname,
      port: Number(url.port) || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Accept': 'application/json, text/event-stream',
      },
    }

    const req = http.request(options, (res) => {
      const contentType = res.headers['content-type'] || ''
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8')
        if (contentType.includes('text/event-stream')) {
          // Parse SSE and extract JSON data lines
          const messages = []
          for (const line of raw.split('\n')) {
            if (line.startsWith('data: ')) {
              const json = line.slice('data: '.length).trim()
              if (json) {
                try { messages.push(JSON.parse(json)) } catch {}
              }
            }
          }
          resolve(messages)
        } else {
          try { resolve([JSON.parse(raw)]) } catch { resolve([]) }
        }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

async function main() {
  let buffer = ''

  process.stdin.setEncoding('utf-8')
  process.stdin.on('data', async (chunk) => {
    buffer += chunk
    // JSON-RPC messages are newline-delimited
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let msg
      try { msg = JSON.parse(trimmed) } catch { continue }
      try {
        const responses = await postToMcp(msg)
        for (const resp of responses) {
          process.stdout.write(JSON.stringify(resp) + '\n')
        }
      } catch (e) {
        // Return a JSON-RPC error response
        if (msg && msg.id !== undefined) {
          const errResp = {
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32603, message: String(e) },
          }
          process.stdout.write(JSON.stringify(errResp) + '\n')
        }
      }
    }
  })

  process.stdin.on('end', () => process.exit(0))
}

main().catch((e) => {
  process.stderr.write('andrea-mcp-stdio fatal: ' + String(e) + '\n')
  process.exit(1)
})
