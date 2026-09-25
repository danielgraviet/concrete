/**
 * Claude BYO agent — ESM module (SDK is ESM-only).
 * Spawned from Electron main via dynamic import().
 * Reuses the user's own installed Claude Code CLI + its login session
 * (mirrors codexAgent.mjs) instead of the SDK's bundled platform binary.
 * An Anthropic API key, when configured, is passed as ANTHROPIC_API_KEY and
 * takes precedence over the subscription login.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { query } from '@anthropic-ai/claude-agent-sdk';

const execFileAsync = promisify(execFile);

const MCP_TOOL_PREFIX = 'mcp__concrete__';

/** @type {{ abortController: AbortController } | null} */
let activeRun = null;

function homebrewPathPrefix() {
  return `${path.join(os.homedir(), '.local', 'bin')}:/opt/homebrew/bin:/usr/local/bin`;
}

function claudeEnv(apiKey) {
  const envPath = process.env.PATH || '';
  return {
    ...process.env,
    PATH: `${homebrewPathPrefix()}:${envPath}`,
    ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
  };
}

function resolveClaudeBin() {
  const override = process.env.CLAUDE_PATH?.trim();
  if (override && existsSync(override)) return override;
  for (const candidate of [
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    path.join(os.homedir(), '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ]) {
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

function parseAuthStatus(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    if (parsed && typeof parsed.loggedIn === 'boolean') return parsed;
  } catch {
    // fall through
  }
  return null;
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
  const cliPath = resolveClaudeBin();
  if (!cliPath) {
    return {
      available: false,
      authenticated: false,
      cliPath: null,
      message:
        'Claude Code CLI not found. Install it from claude.com/code and ensure `claude` is on your PATH, then restart Concrete.',
    };
  }
  if (apiKey) {
    return {
      available: true,
      authenticated: true,
      cliPath,
      message: `Claude ready (Anthropic API key …${apiKey.slice(-4)})`,
    };
  }

  try {
    const { stdout } = await execFileAsync(cliPath, ['auth', 'status', '--json'], {
      env: claudeEnv(),
      timeout: 8000,
    });
    const parsed = parseAuthStatus(stdout);
    const authenticated = parsed?.loggedIn === true;
    return {
      available: true,
      authenticated,
      cliPath,
      message: authenticated
        ? `Claude ready${parsed.email ? ` (${parsed.email})` : ''}`
        : 'Claude CLI found but not logged in. Run `claude auth login` in Terminal.',
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
    const parsed = parseAuthStatus(stdout);
    if (parsed) {
      return {
        available: true,
        authenticated: parsed.loggedIn === true,
        cliPath,
        message: parsed.loggedIn
          ? `Claude ready${parsed.email ? ` (${parsed.email})` : ''}`
          : 'Claude CLI found but not logged in. Run `claude auth login` in Terminal.',
      };
    }
    const combined = `${stdout}\n${stderr}`.trim();
    const detail = error instanceof Error ? error.message : String(error);
    return {
      available: true,
      authenticated: false,
      cliPath,
      message: combined || `Could not check Claude login (${detail}). Try \`claude auth login\`.`,
    };
  }
}

function toolStartProgress(name, input) {
  if (name === 'Bash') {
    return { kind: 'command', text: `Running \`${input?.command ?? ''}\`` };
  }
  if (name === 'Edit' || name === 'Write') {
    return { kind: 'status', text: 'Preparing file edits…' };
  }
  if (typeof name === 'string' && name.startsWith(MCP_TOOL_PREFIX)) {
    return { kind: 'tool', text: `Calling concrete.${name.slice(MCP_TOOL_PREFIX.length)}…` };
  }
  return null;
}

function extractPathFromToolResult(resultBlock) {
  const content = resultBlock?.content;
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map((block) =>
        block && typeof block === 'object' && block.type === 'text'
          ? String(block.text || '')
          : '',
      )
      .join('\n');
  }
  const match = /"path"\s*:\s*"([^"]+)"/.exec(text);
  return match?.[1] || null;
}

function toolEndProgress(meta, resultBlock, vaultRoot, changedPaths) {
  if (!meta) return null;
  const { name, input } = meta;
  const failed = resultBlock?.is_error === true;

  if (name === 'Bash') {
    return {
      kind: 'command',
      text: `Finished \`${input?.command ?? ''}\`${failed ? ' (failed)' : ''}`,
    };
  }
  if (name === 'Edit' || name === 'Write') {
    const rel = toVaultRelative(vaultRoot, input?.file_path);
    if (failed) return { kind: 'error', text: `Failed to update ${rel || 'file'}` };
    if (rel) changedPaths.push(rel);
    return { kind: 'file', text: `${name === 'Write' ? 'Wrote' : 'Edited'} ${rel || 'file'}` };
  }
  if (typeof name === 'string' && name.startsWith(MCP_TOOL_PREFIX)) {
    const label = `concrete.${name.slice(MCP_TOOL_PREFIX.length)}`;
    if (failed) return { kind: 'error', text: `${label} failed` };
    const resultPath = extractPathFromToolResult(resultBlock);
    if (resultPath) changedPaths.push(resultPath);
    return { kind: 'tool', text: `Finished ${label}` };
  }
  return null;
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

  const abortController = new AbortController();
  activeRun = { abortController };

  const emit = (progress) => {
    if (progress && typeof onProgress === 'function') onProgress(progress);
  };

  try {
    const mcpServers = concreteMcp
      ? {
          concrete: {
            type: 'stdio',
            command: concreteMcp.command,
            args: concreteMcp.args,
            ...(concreteMcp.env ? { env: concreteMcp.env } : {}),
          },
        }
      : undefined;

    const toolHints = concreteMcp
      ? [
          'Concrete app tools (MCP — prefer these over hand-editing settings files or inventing quiz frontmatter):',
          '- mcp__concrete__set_theme({ theme: "concrete"|"martian"|"daytona" })',
          '- mcp__concrete__generate_quiz({ topic: string, source_paths: string[] })',
          '- mcp__concrete__export_note_pdf({ note_path: string })',
        ]
      : [];

    const fullPrompt = [
      'You are editing a local Markdown vault for the Concrete notes app.',
      'Vault root is the working directory.',
      notePath ? `Open note: ${notePath}` : 'No specific note is open.',
      'Edit markdown files on disk as needed. Prefer the open note when one is given.',
      'Keep changes focused. Do not create unrelated files.',
      ...toolHints,
      '',
      `User request: ${prompt}`,
    ].join('\n');

    emit({
      kind: 'status',
      text: notePath ? `Editing ${notePath}…` : 'Starting Claude…',
    });
    if (concreteMcp) {
      emit({ kind: 'status', text: 'Concrete tools configured (MCP)' });
    }

    const stream = query({
      prompt: fullPrompt,
      options: {
        cwd: vaultRoot,
        pathToClaudeCodeExecutable: status.cliPath,
        env: claudeEnv(input.apiKey),
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        mcpServers,
        abortController,
      },
    });

    let finalResponse = '';
    /** @type {string[]} */
    const changedPaths = [];
    const pendingTools = new Map();

    for await (const message of stream) {
      if (abortController.signal.aborted) break;

      onEvent?.(message);

      if (message.type === 'assistant') {
        for (const block of message.message?.content ?? []) {
          if (block.type === 'tool_use') {
            pendingTools.set(block.id, { name: block.name, input: block.input });
            emit(toolStartProgress(block.name, block.input));
          }
        }
      } else if (message.type === 'user') {
        const content = Array.isArray(message.message?.content) ? message.message.content : [];
        for (const block of content) {
          if (block.type === 'tool_result') {
            const meta = pendingTools.get(block.tool_use_id);
            pendingTools.delete(block.tool_use_id);
            emit(toolEndProgress(meta, block, vaultRoot, changedPaths));
          }
        }
      } else if (message.type === 'result') {
        if (message.subtype === 'success') {
          finalResponse = message.result?.trim() || finalResponse;
        } else {
          const detail = message.errors?.[0] || message.stop_reason || message.subtype;
          throw new Error(detail ? `Claude agent failed: ${detail}` : 'Claude agent failed');
        }
      }
    }

    if (abortController.signal.aborted) {
      throw new Error('Agent turn cancelled');
    }

    return {
      ok: true,
      finalResponse: finalResponse || 'Done.',
      threadId: null,
      changedPaths: [...new Set(changedPaths)],
    };
  } catch (error) {
    if (abortController.signal.aborted) {
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
  activeRun.abortController.abort();
  return true;
}

/**
 * One plain text completion: no tools, no MCP, no user settings or CLAUDE.md.
 * Temperature and token limits are not exposed by the CLI, so they are ignored.
 *
 * @param {{
 *   messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
 *   model?: string;
 *   apiKey?: string;
 * }} request
 * @returns {Promise<{ content: string; model: string; usage: unknown }>}
 */
export async function completeChat({ messages, model, apiKey }) {
  const status = await getAgentStatus({ apiKey });
  if (!status.available || !status.authenticated) throw new Error(status.message);

  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const stream = query({
    prompt: transcriptPrompt(messages),
    options: {
      cwd: os.tmpdir(),
      pathToClaudeCodeExecutable: status.cliPath,
      env: claudeEnv(apiKey),
      ...(system ? { systemPrompt: system } : {}),
      ...(model ? { model } : {}),
      tools: [],
      settingSources: [],
      persistSession: false,
      maxTurns: 1,
    },
  });

  let resolvedModel = model || 'claude';
  for await (const message of stream) {
    if (message.type === 'system' && message.subtype === 'init') resolvedModel = message.model;
    if (message.type !== 'result') continue;
    if (message.subtype !== 'success' || message.is_error) {
      const detail = message.subtype === 'success' ? message.result : message.errors?.[0] || message.subtype;
      throw new Error(`Claude request failed: ${detail}`);
    }
    if (!message.result?.trim()) throw new Error('Claude returned an empty completion.');
    return { content: message.result, model: resolvedModel, usage: message.usage ?? null };
  }
  throw new Error('Claude ended without a result.');
}

/** Single-turn prompt from chat messages; system messages go in the system prompt. */
function transcriptPrompt(messages) {
  const turns = messages.filter((m) => m.role !== 'system');
  if (turns.length === 1) return turns[0].content;
  return turns.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
}
