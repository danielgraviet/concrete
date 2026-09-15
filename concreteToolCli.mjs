/**
 * CLI fallback for Concrete tools when Codex MCP is unavailable.
 * Usage: node concreteToolCli.mjs <tool> '<json-args>'
 * Reads bridge from CONCRETE_BRIDGE_URL / CONCRETE_BRIDGE_TOKEN
 * or from CONCRETE_BRIDGE_FILE (JSON {url,token}).
 */
import fs from 'node:fs';

function loadBridge() {
  const file = process.env.CONCRETE_BRIDGE_FILE?.trim();
  if (file && fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed?.url && parsed?.token) return parsed;
  }
  const url = process.env.CONCRETE_BRIDGE_URL?.replace(/\/$/, '');
  const token = process.env.CONCRETE_BRIDGE_TOKEN || '';
  if (!url || !token) {
    throw new Error(
      'Missing bridge credentials (CONCRETE_BRIDGE_URL/TOKEN or CONCRETE_BRIDGE_FILE)',
    );
  }
  return { url, token };
}

const tool = process.argv[2];
const rawArgs = process.argv[3] || '{}';
if (!tool) {
  console.error('Usage: concreteToolCli.mjs <tool> \'<json-args>\'');
  process.exit(2);
}

let args;
try {
  args = JSON.parse(rawArgs);
} catch {
  console.error('Arguments must be JSON');
  process.exit(2);
}

const bridge = loadBridge();
const response = await fetch(`${bridge.url}/tool`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${bridge.token}`,
  },
  body: JSON.stringify({ name: tool, arguments: args }),
});
const text = await response.text();
let data;
try {
  data = JSON.parse(text);
} catch {
  console.error(`Bridge non-JSON (${response.status}): ${text.slice(0, 300)}`);
  process.exit(1);
}
if (!response.ok || data?.ok === false) {
  console.error(data?.error || `Bridge error ${response.status}`);
  process.exit(1);
}
console.log(JSON.stringify(data, null, 2));
