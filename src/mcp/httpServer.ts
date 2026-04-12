/* eslint-disable semi */
/**
 * HTTP wrapper for the Novel Helper MCP Server.
 *
 * Starts an HTTP server on 127.0.0.1:<port> (default 13306) and routes
 * all requests through the StreamableHTTPServerTransport so that
 * VSCode Copilot Agent Mode, Cursor, and any other HTTP-MCP client can
 * connect.
 *
 * Usage:
 *   const srv = startNovelHttpMcpServer(rolesGetter)
 *   // later:
 *   await srv.stop()
 */

import * as http from 'http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createNovelMcpServer } from './novelServer'
import { Role } from '../extension'

export const DEFAULT_MCP_PORT = 13306

type RolesGetter = () => Role[]

export interface NovelHttpMcpServer {
  port: number
  url: string
  stop: () => Promise<void>
}

/**
 * Start the HTTP MCP server. Returns a handle that can be used to stop it.
 *
 * The server uses stateless mode (no session IDs) so that multiple AI
 * clients (e.g. VSCode Copilot + Cursor simultaneously) can connect
 * without conflicting sessions.
 */
export async function startNovelHttpMcpServer(
  rolesGetter: RolesGetter,
  port = DEFAULT_MCP_PORT,
): Promise<NovelHttpMcpServer> {
  const mcpServer = createNovelMcpServer(rolesGetter)

  const httpServer = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
    // CORS headers for browser-based tools
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    try {
      // Use stateless transport per request (no session management)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      })

      // Wire up this transport to the MCP server for this single request
      await mcpServer.connect(transport)

      // Parse body for POST requests
      let body: unknown
      if (req.method === 'POST') {
        body = await readBody(req)
      }

      await transport.handleRequest(req, res, body)
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(err) }))
      }
    }
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, '127.0.0.1', () => resolve())
    httpServer.once('error', (err: Error) => reject(err))
  })

  const url = `http://127.0.0.1:${port}/mcp`

  return {
    port,
    url,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err?: Error) => (err ? reject(err) : resolve()))
      }),
  }
}

// --------------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8')
      if (!raw) { resolve(undefined); return }
      try { resolve(JSON.parse(raw)) } catch { resolve(raw) }
    })
    req.on('error', (err: Error) => reject(err))
  })
}
