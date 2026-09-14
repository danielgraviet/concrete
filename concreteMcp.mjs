/**
 * Concrete MCP server — stdio tools that call back into Electron via localhost bridge.
 *
 * Env:
 *   CONCRETE_BRIDGE_URL   e.g. http://127.0.0.1:45231
 *   CONCRETE_BRIDGE_TOKEN shared secret
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const bridgeUrl = process.env.CONCRETE_BRIDGE_URL?.replace(/\/$/, '');
const bridgeToken = process.env.CONCRETE_BRIDGE_TOKEN || '';

if (!bridgeUrl || !bridgeToken) {
  console.error(
    'concreteMcp: CONCRETE_BRIDGE_URL and CONCRETE_BRIDGE_TOKEN are required',
  );
  process.exit(1);
}

async function callTool(name, args) {
  const response = await fetch(`${bridgeUrl}/tool`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bridgeToken}`,
    },
    body: JSON.stringify({ name, arguments: args ?? {} }),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Bridge returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
  }
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `Bridge error ${response.status}`);
  }
  return data;
}

function okText(message, data) {
  return {
    content: [
      {
        type: 'text',
        text: data ? `${message}\n${JSON.stringify(data, null, 2)}` : message,
      },
    ],
  };
}

const server = new McpServer({
  name: 'concrete',
  version: '0.1.0',
});

server.registerTool(
  'set_theme',
  {
    title: 'Set Concrete theme',
    description:
      'Change the Concrete app theme pack. Use when the user asks to switch themes (concrete, martian, or daytona).',
    inputSchema: {
      theme: z
        .enum(['concrete', 'martian', 'daytona'])
        .describe('Theme pack id'),
    },
  },
  async ({ theme }) => {
    const result = await callTool('set_theme', { theme });
    return okText(`Theme set to ${theme}.`, result);
  },
);

server.registerTool(
  'generate_quiz',
  {
    title: 'Generate quiz from notes',
    description:
      'Generate a Concrete quiz markdown file from one or more vault notes using the app quiz generator. Prefer this over hand-writing quiz files.',
    inputSchema: {
      topic: z
        .string()
        .describe('Short quiz topic / title without the Quiz prefix'),
      source_paths: z
        .array(z.string())
        .min(1)
        .describe('Vault-relative .md note paths to ground the quiz in'),
    },
  },
  async ({ topic, source_paths }) => {
    const result = await callTool('generate_quiz', {
      topic,
      source_paths,
    });
    return okText(
      `Quiz written to ${result.path || 'vault'}.`,
      result,
    );
  },
);

server.registerTool(
  'export_note_pdf',
  {
    title: 'Export note to PDF',
    description:
      'Export a vault markdown note to PDF under Exports/. Use when the user asks for a PDF of a note.',
    inputSchema: {
      note_path: z
        .string()
        .describe('Vault-relative path to the .md note to export'),
    },
  },
  async ({ note_path }) => {
    const result = await callTool('export_note_pdf', { note_path });
    return okText(`PDF saved to ${result.path || 'Exports/'}.`, result);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
