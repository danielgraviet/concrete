/**
 * Concrete tool bridge — localhost HTTP API used by concreteMcp.mjs.
 * Loaded from Electron main via dynamic import().
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_OPENROUTER_MODEL = 'deepseek/deepseek-v4-flash-0731';

const QUIZ_GENERATION_SYSTEM_PROMPT = `You generate study quizzes as Markdown for a local note vault.

Return ONLY valid quiz Markdown. No preamble, no explanation, no code fences unless the whole document is inside one markdown fence.

Required shape:

---
type: quiz
source: <origin note path or omit>
rubric: "<one-line grading rubric>"
---

# Quiz <Title>

## Q1 · mcq

<question stem>

- [ ] <distractor>
- [x] <correct answer>
- [ ] <distractor>
- [ ] <distractor>

## Q2 · cloze

Sentence with {{exact answer}} blanks like this.

## Q3 · open

Open-ended prompt.

### Answer

Reference answer for the grader.

Hard rules:
1. Include a mix of mcq, cloze, and open (default 2 mcq, 1 cloze, 1 open unless the user asks otherwise).
2. MCQ options must NOT start with A), B), C), D) or similar letters. Plain option text only.
3. Exactly one [x] correct option per MCQ unless the stem clearly requires multi-select.
4. Do not make the correct MCQ option the longest option by default. Vary lengths.
5. Distractors must be plausible misconceptions, not joke answers.
6. Ground every item in the provided note context when present. Do not invent unrelated topics.
7. Cloze answers inside {{ }} must be short (1-5 words).
8. Rubric must be a single quoted line in frontmatter.
9. Title must start with "Quiz ".`;

/** @type {{
 *   server: import('node:http').Server | null,
 *   url: string | null,
 *   token: string | null,
 *   getMainWindow: () => import('electron').BrowserWindow | null,
 *   getContext: () => { vaultRoot: string | null, notePath: string | null, openRouterModel: string },
 *   BrowserWindow: typeof import('electron').BrowserWindow | null,
 * }} */
const state = {
  server: null,
  url: null,
  token: null,
  getMainWindow: () => null,
  getContext: () => ({
    vaultRoot: null,
    notePath: null,
    openRouterModel: DEFAULT_OPENROUTER_MODEL,
  }),
  BrowserWindow: null,
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function assertWithinVault(vaultRoot, relativePath) {
  if (!vaultRoot) throw new Error('No vault open');
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('Path is required');
  }
  const rel = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || rel.split('/').some((part) => part === '..' || !part)) {
    throw new Error('Invalid path');
  }
  const resolvedRoot = path.resolve(vaultRoot);
  const resolved = path.resolve(resolvedRoot, rel);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path escapes vault root');
  }
  return {
    relative: relative.split(path.sep).join('/'),
    absolute: resolved,
  };
}

function quizFileTitle(topic) {
  const cleaned = String(topic || 'Untitled').trim().replace(/\.md$/i, '');
  if (!cleaned) return 'Quiz Untitled.md';
  if (/^Quiz\s+/i.test(cleaned)) {
    const rest = cleaned.replace(/^Quiz\s+/i, '').trim() || 'Untitled';
    return `Quiz ${rest}.md`;
  }
  return `Quiz ${cleaned}.md`;
}

function extractQuizMarkdown(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('Empty model response');
  const fenced =
    /```(?:markdown|md)?\s*([\s\S]*?)```/i.exec(text) ??
    /```\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  const fmStart = candidate.indexOf('---');
  if (fmStart >= 0) return candidate.slice(fmStart).trim();
  const heading = candidate.search(/^#\s+Quiz\b/m);
  if (heading >= 0) return candidate.slice(heading).trim();
  const qHeading = candidate.search(/^##\s+Q\d+/m);
  if (qHeading >= 0) {
    return `---\ntype: quiz\n---\n\n# Quiz\n\n${candidate.slice(qHeading).trim()}`;
  }
  return candidate;
}

function parentDir(relativePath) {
  const parts = relativePath.split('/');
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
}

async function openRouterChat({ model, messages, temperature, max_tokens }) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY missing. Add it to .env and restart Concrete.',
    );
  }
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/danielgraviet/concrete',
      'X-Title': 'Concrete',
    },
    body: JSON.stringify({
      model: model || DEFAULT_OPENROUTER_MODEL,
      messages,
      temperature: temperature ?? 0.55,
      max_tokens: max_tokens ?? 4096,
    }),
  });
  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(`OpenRouter non-JSON: ${rawText.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(
      data?.error?.message || data?.message || `OpenRouter HTTP ${response.status}`,
    );
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('OpenRouter returned empty content');
  }
  return content;
}

async function handleSetTheme(args) {
  const theme = args?.theme;
  if (!['concrete', 'martian', 'daytona'].includes(theme)) {
    throw new Error('theme must be concrete, martian, or daytona');
  }
  const win = state.getMainWindow();
  if (!win || win.isDestroyed()) {
    throw new Error('Concrete window is not available');
  }
  win.webContents.send('concrete:setTheme', { themePack: theme });
  return { ok: true, theme };
}

async function handleGenerateQuiz(args) {
  const ctx = state.getContext();
  const vaultRoot = ctx.vaultRoot;
  if (!vaultRoot) throw new Error('No vault open');

  const topic = String(args?.topic || '').trim() || 'Untitled';
  const sourcePaths = Array.isArray(args?.source_paths)
    ? args.source_paths.map(String)
    : [];
  if (sourcePaths.length === 0) {
    throw new Error('source_paths must include at least one note');
  }

  const chunks = [];
  const resolvedSources = [];
  for (const rawPath of sourcePaths) {
    const { relative, absolute } = assertWithinVault(vaultRoot, rawPath);
    if (!relative.toLowerCase().endsWith('.md')) {
      throw new Error(`Not a markdown note: ${relative}`);
    }
    const body = await fs.readFile(absolute, 'utf8');
    chunks.push(`### File: ${relative}\n\n${body.trim()}`);
    resolvedSources.push(relative);
  }

  const noteContext = chunks.join('\n\n-----\n\n').slice(0, 12000);
  const primary = resolvedSources[0];
  const titledTopic = topic.replace(/^Quiz\s+/i, '');
  const userPrompt = [
    `Create a quiz titled "Quiz ${titledTopic}".`,
    'Question types to include: mcq, cloze, open.',
    'Base every question on the source note(s) below.',
    resolvedSources.length === 1
      ? `Set frontmatter source to: ${primary}`
      : `Primary source: ${primary}. Also grounded in: ${resolvedSources.join(', ')}`,
    '',
    'SOURCE NOTES:',
    noteContext,
  ].join('\n');

  const model = ctx.openRouterModel || DEFAULT_OPENROUTER_MODEL;
  const content = await openRouterChat({
    model,
    messages: [
      { role: 'system', content: QUIZ_GENERATION_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.55,
    max_tokens: 8192,
  });

  let markdown = extractQuizMarkdown(content);
  if (!/^---[\s\S]*type:\s*quiz/m.test(markdown)) {
    markdown = `---\ntype: quiz\nsource: ${primary}\n---\n\n${markdown}`;
  }

  const folder = parentDir(primary);
  const fileName = quizFileTitle(titledTopic);
  const relative = folder ? `${folder}/${fileName}` : fileName;
  const { absolute } = assertWithinVault(vaultRoot, relative);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, markdown, 'utf8');

  return { ok: true, path: relative, sources: resolvedSources };
}

async function handleExportNotePdf(args) {
  const ctx = state.getContext();
  const vaultRoot = ctx.vaultRoot;
  if (!vaultRoot) throw new Error('No vault open');
  if (!state.BrowserWindow) throw new Error('BrowserWindow unavailable');

  const notePath = String(args?.note_path || ctx.notePath || '').trim();
  if (!notePath) throw new Error('note_path is required');
  const { relative, absolute } = assertWithinVault(vaultRoot, notePath);
  if (!relative.toLowerCase().endsWith('.md')) {
    throw new Error('Only .md notes can be exported');
  }

  const markdown = await fs.readFile(absolute, 'utf8');
  const bodyHtml = marked.parse(markdown, { async: false });
  const title = path.basename(relative, '.md');
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title.replace(/</g, '')}</title>
  <style>
    body { font-family: Georgia, "Times New Roman", serif; color: #111; margin: 48px; line-height: 1.55; font-size: 14px; }
    h1,h2,h3 { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.25; }
    h1 { font-size: 28px; } h2 { font-size: 22px; margin-top: 1.4em; } h3 { font-size: 17px; margin-top: 1.2em; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    pre { background: #f4f4f4; padding: 12px; border-radius: 6px; overflow: auto; }
    blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 14px; color: #444; }
    a { color: #333; }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`;

  const folder = parentDir(relative);
  const exportDir = folder ? path.join(vaultRoot, folder) : vaultRoot;
  const pdfName = `${title}.pdf`;
  const pdfAbsolute = path.join(exportDir, pdfName);
  const pdfRelative = folder ? `${folder}/${pdfName}` : pdfName;

  const win = new state.BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
    },
  });

  try {
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await win.loadURL(dataUrl);
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'Letter',
      margins: { marginType: 'default' },
    });
    await fs.writeFile(pdfAbsolute, pdf);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }

  return { ok: true, path: pdfRelative, source: relative };
}

async function dispatchTool(name, args) {
  switch (name) {
    case 'set_theme':
      return handleSetTheme(args);
    case 'generate_quiz':
      return handleGenerateQuiz(args);
    case 'export_note_pdf':
      return handleExportNotePdf(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * @param {{
 *   getMainWindow: () => import('electron').BrowserWindow | null,
 *   getContext: () => { vaultRoot: string | null, notePath: string | null, openRouterModel: string },
 *   BrowserWindow: typeof import('electron').BrowserWindow,
 * }} deps
 */
export async function startConcreteBridge(deps) {
  if (state.server) {
    return { url: state.url, token: state.token };
  }

  state.getMainWindow = deps.getMainWindow;
  state.getContext = deps.getContext;
  state.BrowserWindow = deps.BrowserWindow;
  state.token = crypto.randomBytes(24).toString('hex');

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        json(res, 200, { ok: true });
        return;
      }
      if (req.method !== 'POST' || req.url !== '/tool') {
        json(res, 404, { ok: false, error: 'Not found' });
        return;
      }
      const auth = req.headers.authorization || '';
      if (auth !== `Bearer ${state.token}`) {
        json(res, 401, { ok: false, error: 'Unauthorized' });
        return;
      }
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      const name = body?.name;
      const args = body?.arguments ?? {};
      if (typeof name !== 'string' || !name) {
        json(res, 400, { ok: false, error: 'Missing tool name' });
        return;
      }
      const result = await dispatchTool(name, args);
      json(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      json(res, 500, { ok: false, error: message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  state.server = server;
  state.url = `http://127.0.0.1:${port}`;
  return { url: state.url, token: state.token };
}

export function getConcreteBridgeInfo() {
  if (!state.url || !state.token) return null;
  return { url: state.url, token: state.token };
}

/** Absolute path to concreteMcp.mjs (prefers asar.unpacked when packaged). */
export function resolveConcreteMcpPath() {
  const packed = fileURLToPath(new URL('./concreteMcp.mjs', import.meta.url));
  if (packed.includes(`${path.sep}app.asar${path.sep}`)) {
    const unpacked = packed.replace(
      `${path.sep}app.asar${path.sep}`,
      `${path.sep}app.asar.unpacked${path.sep}`,
    );
    return unpacked;
  }
  return packed;
}
