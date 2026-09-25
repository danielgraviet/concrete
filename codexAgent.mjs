/**
 * Codex BYO agent — ESM module (SDK is ESM-only).
 * Spawned from Electron main via dynamic import().
 * Uses the user's Codex login (ChatGPT subscription) unless an OpenAI API key
 * is configured, which the SDK passes to the CLI as CODEX_API_KEY.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Codex } from '@openai/codex-sdk';

const execFileAsync = promisify(execFile);

/** @type {{ abort: AbortController } | null} */
let activeRun = null;

function homebrewPathPrefix() {
  return '/opt/homebrew/bin:/usr/local/bin';
}

function codexEnv() {
  const envPath = process.env.PATH || '';
  return {
    ...process.env,
    PATH: `${homebrewPathPrefix()}:${envPath}`,
  };
}

function resolveCodexBin() {
  const override = process.env.CODEX_PATH?.trim();
  if (override && existsSync(override)) return override;
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', ...pathDirs]) {
    const candidate = path.join(dir, 'codex');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function toVaultRelative(vaultRoot, filePath) {
  if (!filePath) return filePath;
  const root = path.resolve(vaultRoot);
  const abs = path.resolve(filePath);
  if (abs === root) return '.';
  if (abs.startsWith(`${root}${path.sep}`)) {
    return abs.slice(root.length + 1).split(path.sep).join('/');
  }
  return filePath;
}

/**
 * @param {import('@openai/codex-sdk').ThreadEvent} event
 * @param {string} vaultRoot
 * @returns {{ kind: string, text: string } | null}
 */
function progressFromEvent(event, vaultRoot) {
  switch (event.type) {
    case 'turn.started':
      return { kind: 'status', text: 'Working…' };
    case 'turn.completed':
      return { kind: 'status', text: 'Finished turn' };
    case 'turn.failed':
      return {
        kind: 'error',
        text: event.error?.message || 'Turn failed',
      };
    case 'error':
      return { kind: 'error', text: event.message || 'Agent error' };
    case 'item.started': {
      const item = event.item;
      if (item.type === 'command_execution') {
        return { kind: 'command', text: `Running \`${item.command}\`` };
      }
      if (item.type === 'file_change') {
        return { kind: 'status', text: 'Preparing file edits…' };
      }
      if (item.type === 'web_search') {
        return { kind: 'status', text: `Searching: ${item.query}` };
      }
      if (item.type === 'mcp_tool_call') {
        return {
          kind: 'tool',
          text: `Calling ${item.server}.${item.tool}…`,
        };
      }
      if (item.type === 'reasoning') {
        return { kind: 'status', text: 'Thinking…' };
      }
      return null;
    }
    case 'item.completed': {
      const item = event.item;
      if (item.type === 'mcp_tool_call') {
        const label = `${item.server}.${item.tool}`;
        if (item.status === 'failed') {
          return {
            kind: 'error',
            text: `${label} failed${item.error?.message ? `: ${item.error.message}` : ''}`,
          };
        }
        return { kind: 'tool', text: `Finished ${label}` };
      }
      if (item.type === 'file_change') {
        const labels = (item.changes || []).map((change) => {
          const rel = toVaultRelative(vaultRoot, change.path);
          const verb =
            change.kind === 'add'
              ? 'Created'
              : change.kind === 'delete'
                ? 'Deleted'
                : 'Updated';
          return `${verb} ${rel}`;
        });
        if (labels.length === 0) return { kind: 'file', text: 'Applied file changes' };
        return { kind: 'file', text: labels.join('\n') };
      }
      if (item.type === 'command_execution') {
        const code =
          typeof item.exit_code === 'number' ? ` (exit ${item.exit_code})` : '';
        return {
          kind: 'command',
          text: `Finished \`${item.command}\`${code}`,
        };
      }
      if (item.type === 'agent_message' && item.text?.trim()) {
        return { kind: 'message', text: item.text.trim() };
      }
      if (item.type === 'error') {
        return { kind: 'error', text: item.message || 'Item error' };
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * @param {{ apiKey?: string }} [options]
 * @returns {Promise<{
 *   available: boolean;
 *   authenticated: boolean;
 *   cliPath: string | null;
 *   message: string;
 * }>}
 */
export async function getAgentStatus({ apiKey } = {}) {
  const cliPath = resolveCodexBin();
  if (!cliPath) {
    return {
      available: false,
      authenticated: false,
      cliPath: null,
      message:
        'Codex CLI not found. Install Codex and ensure `codex` is on your PATH, then restart Concrete.',
    };
  }
  if (apiKey) {
    return {
      available: true,
      authenticated: true,
      cliPath,
      message: `Codex ready (OpenAI API key …${apiKey.slice(-4)})`,
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync(cliPath, ['login', 'status'], {
      env: codexEnv(),
      timeout: 8000,
    });
    const text = `${stdout || ''}\n${stderr || ''}`.trim();
    const authenticated = /logged in/i.test(text);
    return {
      available: true,
      authenticated,
      cliPath,
      message: authenticated
        ? text.split('\n').filter(Boolean).pop() || 'Codex ready'
        : 'Codex CLI found but not logged in. Run `codex login` in Terminal.',
    };
  } catch (error) {
    const stdout =
      error && typeof error === 'object' && 'stdout' in error
        ? String(error.stdout || '')
        : '';
    const stderr =
      error && typeof error === 'object' && 'stderr' in error
        ? String(error.stderr || '')
        : '';
    const combined = `${stdout}\n${stderr}`.trim();
    if (/logged in/i.test(combined)) {
      return {
        available: true,
        authenticated: true,
        cliPath,
        message: combined.split('\n').filter(Boolean).pop() || 'Codex ready',
      };
    }
    const detail = error instanceof Error ? error.message : String(error);
    return {
      available: true,
      authenticated: false,
      cliPath,
      message: `Could not check Codex login (${detail}). Try \`codex login\`.`,
    };
  }
}

/**
 * @param {{
 *   vaultRoot: string;
 *   notePath?: string | null;
 *   prompt: string;
 *   apiKey?: string;
 *   concreteMcp?: {
 *     command: string;
 *     args: string[];
 *     env?: Record<string, string>;
 *     cliPath?: string;
 *     bridgeFile?: string;
 *   } | null;
 * }} input
 * @param {(event: { kind: string, text: string }) => void} [onProgress]
 * @param {(event: unknown) => void} [onEvent]
 */
export async function runAgentTurn(input, onProgress, onEvent) {
  const vaultRoot = typeof input.vaultRoot === 'string' ? input.vaultRoot.trim() : '';
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  const notePath =
    typeof input.notePath === 'string' && input.notePath.trim()
      ? input.notePath.trim()
      : null;
  const concreteMcp =
    input.concreteMcp &&
    typeof input.concreteMcp.command === 'string' &&
    Array.isArray(input.concreteMcp.args)
      ? input.concreteMcp
      : null;

  if (!vaultRoot) throw new Error('No vault open');
  if (!prompt) throw new Error('Prompt is empty');

  const status = await getAgentStatus({ apiKey: input.apiKey });
  if (!status.available) throw new Error(status.message);
  if (!status.authenticated) throw new Error(status.message);

  if (activeRun) {
    throw new Error('An agent turn is already running. Cancel it first.');
  }

  const abort = new AbortController();
  activeRun = { abort };

  const emit = (progress) => {
    if (progress && typeof onProgress === 'function') onProgress(progress);
  };

  try {
    /** @type {import('@openai/codex-sdk').CodexOptions} */
    const codexOptions = {
      codexPathOverride: status.cliPath ?? undefined,
      env: codexEnv(),
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    };

    if (concreteMcp) {
      // With approval_policy=never, Codex cannot prompt for MCP calls and
      // denies them unless the server pre-approves tools.
      codexOptions.config = {
        mcp_servers: {
          concrete: {
            command: concreteMcp.command,
            args: concreteMcp.args,
            ...(concreteMcp.env ? { env: concreteMcp.env } : {}),
            default_tools_approval_mode: 'approve',
            startup_timeout_sec: 20,
            tools: {
              set_theme: { approval_mode: 'approve' },
              generate_quiz: { approval_mode: 'approve' },
              export_note_pdf: { approval_mode: 'approve' },
            },
          },
        },
      };
    }

    const codex = new Codex(codexOptions);

    // Fresh thread each turn so MCP servers always re-register (reuse was
    // intermittently leaving Concrete tools missing from the session).
    const thread = codex.startThread({
      workingDirectory: vaultRoot,
      skipGitRepoCheck: true,
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      networkAccessEnabled: true,
    });

    const nodeBin = concreteMcp?.command || 'node';
    const cliPath = concreteMcp?.cliPath;
    const bridgeFile = concreteMcp?.bridgeFile;

    const toolHints = concreteMcp
      ? [
          'Concrete app tools (prefer MCP; fall back to CLI if MCP tools are missing):',
          '',
          'MCP tool names (call these directly when present):',
          '- mcp__concrete__set_theme({ theme: "concrete"|"martian"|"daytona" })',
          '- mcp__concrete__generate_quiz({ topic: string, source_paths: string[] })',
          '- mcp__concrete__export_note_pdf({ note_path: string })',
          '',
          ...(cliPath && bridgeFile
            ? [
                'CLI fallback (shell) if those MCP tools are NOT in your tool list:',
                `export CONCRETE_BRIDGE_FILE=${JSON.stringify(bridgeFile)}`,
                `${nodeBin} ${JSON.stringify(cliPath)} set_theme '{"theme":"martian"}'`,
                `${nodeBin} ${JSON.stringify(cliPath)} generate_quiz '{"topic":"Topic","source_paths":["Note.md"]}'`,
                `${nodeBin} ${JSON.stringify(cliPath)} export_note_pdf '{"note_path":"Note.md"}'`,
                'Do not search the vault for theme settings files.',
              ]
            : []),
          'Do not hand-edit settings files or invent quiz frontmatter when these tools apply.',
        ]
      : [];

    const fullPrompt = [
      'You are editing a local Markdown vault for the Concrete notes app.',
      'Vault root is the cwd.',
      notePath ? `Open note: ${notePath}` : 'No specific note is open.',
      'Edit markdown files on disk as needed. Prefer the open note when one is given.',
      'Keep changes focused. Do not create unrelated files.',
      ...toolHints,
      '',
      `User request: ${prompt}`,
    ].join('\n');

    emit({
      kind: 'status',
      text: notePath ? `Editing ${notePath}…` : 'Starting Codex…',
    });
    if (concreteMcp) {
      emit({
        kind: 'status',
        text: 'Concrete tools configured (MCP + CLI fallback)',
      });
    }

    const { events } = await thread.runStreamed(fullPrompt, {
      signal: abort.signal,
    });

    let finalResponse = '';
    /** @type {string[]} */
    const changedPaths = [];

    for await (const event of events) {
      if (abort.signal.aborted) break;

      onEvent?.(event);

      const progress = progressFromEvent(event, vaultRoot);
      if (progress) emit(progress);

      if (event.type === 'item.completed') {
        const item = event.item;
        if (item.type === 'agent_message' && item.text?.trim()) {
          finalResponse = item.text.trim();
        }
        if (item.type === 'file_change' && item.status === 'completed') {
          for (const change of item.changes ?? []) {
            if (change?.path) {
              changedPaths.push(toVaultRelative(vaultRoot, change.path));
            }
          }
        }
        if (item.type === 'mcp_tool_call' && item.status === 'completed') {
          const blocks = item.result?.content;
          if (Array.isArray(blocks)) {
            const text = blocks
              .map((block) =>
                block && typeof block === 'object' && 'text' in block
                  ? String(block.text || '')
                  : '',
              )
              .join('\n');
            const match = /"path"\s*:\s*"([^"]+)"/.exec(text);
            if (match?.[1]) changedPaths.push(match[1]);
          }
        }
      }
    }

    if (abort.signal.aborted) {
      throw new Error('Agent turn cancelled');
    }

    return {
      ok: true,
      finalResponse: finalResponse || 'Done.',
      threadId: thread.id,
      changedPaths: [...new Set(changedPaths)],
    };
  } catch (error) {
    if (abort.signal.aborted) {
      throw new Error('Agent turn cancelled');
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message);
  } finally {
    activeRun = null;
  }
}

export function cancelAgentTurn() {
  if (!activeRun) return false;
  activeRun.abort.abort();
  return true;
}

/**
 * One plain text completion in a read-only thread outside the vault. Codex has
 * no system prompt option, so system messages lead the prompt. Temperature and
 * token limits are not exposed by the CLI, so they are ignored; the model comes
 * from the user's Codex config.
 *
 * @param {{
 *   messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
 *   apiKey?: string;
 * }} request
 * @returns {Promise<{ content: string; model: string; usage: unknown }>}
 */
export async function completeChat({ messages, apiKey }) {
  const status = await getAgentStatus({ apiKey });
  if (!status.available || !status.authenticated) throw new Error(status.message);

  const codex = new Codex({
    codexPathOverride: status.cliPath ?? undefined,
    env: codexEnv(),
    ...(apiKey ? { apiKey } : {}),
  });
  const thread = codex.startThread({
    workingDirectory: os.tmpdir(),
    skipGitRepoCheck: true,
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
    networkAccessEnabled: false,
    webSearchMode: 'disabled',
  });
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const turns = messages.filter((m) => m.role !== 'system');
  const conversation =
    turns.length === 1
      ? turns[0].content
      : turns.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
  const prompt = [
    ...system,
    'Answer directly in your reply. Do not run commands or edit files.',
    conversation,
  ].join('\n\n');

  const turn = await thread.run(prompt);
  if (!turn.finalResponse?.trim()) throw new Error('Codex returned an empty completion.');
  return { content: turn.finalResponse, model: 'codex', usage: turn.usage };
}
