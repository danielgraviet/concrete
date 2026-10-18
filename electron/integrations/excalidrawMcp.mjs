import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const EXCALIDRAW_MCP_URL = 'https://mcp.excalidraw.com';

/** Translate the provider-neutral server location to Claude Agent SDK config. */
export function toClaudeMcpServer(url = EXCALIDRAW_MCP_URL) {
  return { type: 'http', url };
}

/** Translate the provider-neutral server location to Codex MCP config. */
export function toCodexMcpServer(url = EXCALIDRAW_MCP_URL) {
  return { url, default_tools_approval_mode: 'approve', startup_timeout_sec: 20 };
}

/** Probe the official remote MCP and return a user-safe status summary. */
export async function checkExcalidrawMcp() {
  const client = new Client({ name: 'concrete', version: '0.1.0' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const transport = new StreamableHTTPClientTransport(new URL(EXCALIDRAW_MCP_URL), {
    requestInit: { signal: controller.signal },
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    return { available: true, url: EXCALIDRAW_MCP_URL, tools: tools.map((tool) => tool.name) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      url: EXCALIDRAW_MCP_URL,
      tools: [],
      message: `Could not connect to Excalidraw MCP. Check your internet connection and try again. (${detail})`,
    };
  } finally {
    clearTimeout(timeout);
    await client.close().catch(() => {});
  }
}
