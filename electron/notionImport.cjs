const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const { unzipSync } = require('fflate');

const SKIP_DIRS = new Set([
  '.git',
  '.obsidian',
  '.trash',
  '.vault',
  'agent-trajectories',
  '__MACOSX',
]);

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function safeRelative(value) {
  const normalized = path.posix.normalize(String(value).replace(/\\/g, '/'));
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..' || normalized.startsWith('/')) {
    return null;
  }
  if (normalized.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  return normalized;
}

function isHiddenPart(relativePath) {
  return relativePath.split('/').some((part) => part.startsWith('.') || SKIP_DIRS.has(part));
}

function decodeLink(value) {
  let link = value.trim().replace(/^<|>$/g, '');
  const hash = link.indexOf('#');
  if (hash >= 0) link = link.slice(0, hash);
  const query = link.indexOf('?');
  if (query >= 0) link = link.slice(0, query);
  try { return decodeURIComponent(link); } catch { return link; }
}

function markdownLinks(markdown) {
  const links = [];
  const re = /!?\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = re.exec(markdown)) !== null) {
    const link = decodeLink(match[1]);
    if (!link || /^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith('//')) continue;
    links.push(link);
  }
  return [...new Set(links)];
}

function normalizeName(value) {
  return String(value)
    .normalize('NFKC')
    .replace(/\.[^.]+$/, '')
    .replace(/\s+[a-f0-9]{32}$/i, '')
    .replace(/\s+[a-f0-9-]{36}$/i, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function splitList(value) {
  if (value == null) return [];
  const raw = String(value).trim();
  if (!raw) return [];
  if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('"') && raw.endsWith('"'))) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.flatMap(splitList);
      if (typeof parsed === 'string') return splitList(parsed);
    } catch {}
  }
  return raw
    .replace(/^\[|\]$/g, '')
    .split(/[,;\n]+/)
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function normalizeTag(value) {
  return String(value).trim().replace(/^#/, '').toLowerCase();
}

function uniqueTags(values) {
  const seen = new Set();
  return values.flatMap(splitList).map(normalizeTag).filter((tag) => {
    if (!tag || seen.has(tag)) return false;
    seen.add(tag);
    return true;
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ''));
    if (row.some((value) => value.trim())) rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows[0].map((header, index) => header.trim() || `property_${index + 1}`);
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? '').trim()])));
}

function propertyKey(value) {
  const key = String(value).trim().replace(/^[*_]+|[*_]+$/g, '').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '');
  return key || 'property';
}

function parsePropertyLines(content) {
  const lines = content.split(/\r?\n/);
  let start = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end >= 0) start = end + 1;
  }
  while (start < lines.length && !lines[start].trim()) start += 1;
  if (/^#\s+/.test(lines[start] ?? '')) start += 1;

  const properties = {};
  let blankCount = 0;
  for (let i = start; i < Math.min(lines.length, start + 50); i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      blankCount += 1;
      if (blankCount >= 2) break;
      continue;
    }
    const match = /^\s*(?:[-*]\s+)?(?:\*\*)?([^:*\n]+?)(?:\*\*)?\s*:\s*(.+?)\s*$/.exec(line);
    if (!match || /^https?$/i.test(match[1].trim())) {
      if (Object.keys(properties).length > 0) break;
      continue;
    }
    blankCount = 0;
    properties[propertyKey(match[1])] = match[2].trim();
  }
  return properties;
}

function parseFrontmatterTags(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) return [];
  const lines = match[1].split(/\r?\n/);
  const tags = [];
  for (let i = 0; i < lines.length; i += 1) {
    const tagLine = /^\s*tags\s*:\s*(.*)$/i.exec(lines[i]);
    if (!tagLine) continue;
    if (tagLine[1].trim()) tags.push(...splitList(tagLine[1]));
    for (let j = i + 1; j < lines.length; j += 1) {
      const item = /^\s*-\s+(.+)$/.exec(lines[j]);
      if (!item) break;
      tags.push(...splitList(item[1]));
    }
  }
  return tags;
}

function yamlScalar(value) {
  return JSON.stringify(String(value));
}

function mergeImportedFrontmatter(content, tags, properties) {
  if (!tags.length && Object.keys(properties).length === 0) return content;
  const existing = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  const raw = existing ? existing[1] : '';
  const kept = raw ? raw.split(/\r?\n/) : [];
  const filtered = [];
  for (let i = 0; i < kept.length; i += 1) {
    if (/^\s*(tags|notion_properties)\s*:/.test(kept[i])) {
      i += 1;
      while (i < kept.length && (/^\s*-\s+/.test(kept[i]) || /^\s{2,}\S/.test(kept[i]))) i += 1;
      i -= 1;
      continue;
    }
    filtered.push(kept[i]);
  }
  if (tags.length) {
    filtered.push(`tags: [${tags.map(yamlScalar).join(', ')}]`);
  }
  if (Object.keys(properties).length) {
    filtered.push('notion_properties:');
    for (const [key, value] of Object.entries(properties)) {
      filtered.push(`  ${propertyKey(key)}: ${yamlScalar(value)}`);
    }
  }
  const frontmatter = `---\n${filtered.join('\n')}\n---\n`;
  return `${frontmatter}${existing ? content.slice(existing[0].length) : content}`;
}

function pageMetadata(markdown, csvProperties = {}) {
  const propertyLines = parsePropertyLines(markdown);
  const tags = uniqueTags([
    ...parseFrontmatterTags(markdown),
    ...Object.entries(propertyLines).filter(([key]) => /tag|label/i.test(key)).flatMap(([, value]) => splitList(value)),
    ...Object.entries(csvProperties).filter(([key]) => /tag|label/i.test(key)).flatMap(([, value]) => splitList(value)),
  ]);
  const properties = {};
  for (const [key, value] of Object.entries(propertyLines)) {
    if (!/tag|label/i.test(key)) properties[key] = value;
  }
  for (const [key, value] of Object.entries(csvProperties)) {
    if (!/tag|label|^(name|title|page)$/i.test(key) && String(value).trim()) properties[key] = value;
  }
  return { tags, properties };
}

async function walk(root) {
  const files = [];
  const folders = [];
  async function visit(directory, relativeBase) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
      if (isHiddenPart(relative)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        folders.push(relative);
        await visit(absolute, relative);
      } else if (entry.isFile()) {
        files.push({ relative, absolute });
      }
    }
  }
  await visit(root, '');
  files.sort((a, b) => a.relative.localeCompare(b.relative));
  folders.sort((a, b) => a.localeCompare(b));
  return { files, folders };
}

function csvPropertiesForPages(csvFiles, markdownFiles) {
  const byPage = new Map();
  const pagesByDirectory = new Map();
  for (const page of markdownFiles) {
    const directory = path.posix.dirname(page.relative);
    const key = `${directory}\0${normalizeName(path.posix.basename(page.relative))}`;
    pagesByDirectory.set(key, page.relative);
  }
  const warnings = [];
  for (const csv of csvFiles) {
    let rows;
    try {
      rows = parseCsv(fsSync.readFileSync(csv.absolute, 'utf8'));
    } catch (error) {
      warnings.push(`Could not read ${csv.relative}: ${error.message}`);
      continue;
    }
    const directory = path.posix.dirname(csv.relative);
    for (const row of rows) {
      const titleKey = Object.keys(row).find((key) => /^(name|title|page)$/i.test(key)) ?? Object.keys(row)[0];
      const title = titleKey ? row[titleKey] : '';
      const pagePath = pagesByDirectory.get(`${directory}\0${normalizeName(title)}`);
      if (!pagePath) {
        warnings.push(`Could not match a Markdown page for ${title || 'an unnamed row'} in ${csv.relative}`);
        continue;
      }
      byPage.set(pagePath, { ...(byPage.get(pagePath) ?? {}), ...row });
    }
  }
  return { byPage, warnings };
}

async function readUtf8(absolute, relative) {
  const buffer = await fs.readFile(absolute);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`Unreadable UTF-8 text in ${relative}`);
  }
}

async function analyzeNotionFiles(all) {
  const obvious = [];
  const uncertain = [];
  const visibleFiles = new Set(all.files.map(({ relative }) => relative));
  const fileDetails = new Map();

  for (const file of all.files) {
    const size = (await fs.stat(file.absolute)).size;
    const lower = file.relative.toLowerCase();
    if (size === 0) {
      obvious.push({ path: file.relative, reason: 'empty file' });
      continue;
    }
    if (!lower.endsWith('.md') && !lower.endsWith('.csv')) continue;

    let text;
    try {
      text = await readUtf8(file.absolute, file.relative);
    } catch (error) {
      obvious.push({ path: file.relative, reason: error.message });
      continue;
    }
    fileDetails.set(file.relative, text);
    if (!text.trim()) {
      obvious.push({ path: file.relative, reason: 'blank file' });
      continue;
    }
    if (!lower.endsWith('.md')) continue;

    const missing = [];
    for (const link of markdownLinks(text)) {
      const linkedRelative = safeRelative(toPosix(path.posix.join(path.posix.dirname(file.relative), link)));
      if (!linkedRelative) continue;
      const candidates = [linkedRelative, `${linkedRelative}.md`];
      if (!candidates.some((candidate) => visibleFiles.has(candidate))) {
        missing.push(link);
      }
    }
    if (missing.length) {
      uncertain.push({
        path: file.relative,
        reason: `missing local link${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 3).join(', ')}`,
      });
    }
  }

  return { obvious, uncertain, fileDetails };
}

async function extractZip(zipPath) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'concrete-notion-'));
  try {
    const entries = unzipSync(new Uint8Array(await fs.readFile(zipPath)));
    for (const [rawName, data] of Object.entries(entries)) {
      const relative = safeRelative(rawName);
      if (!relative || relative === '__MACOSX' || isHiddenPart(relative)) continue;
      const target = path.resolve(temporaryRoot, relative);
      if (!target.startsWith(`${path.resolve(temporaryRoot)}${path.sep}`)) throw new Error(`Unsafe ZIP path: ${rawName}`);
      if (rawName.endsWith('/')) {
        await fs.mkdir(target, { recursive: true });
      } else {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, data);
      }
    }
    return temporaryRoot;
  } catch (error) {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    throw new Error(`Could not read the Notion export ZIP: ${error.message}`);
  }
}

async function openNotionSource(sourcePath) {
  const source = path.resolve(sourcePath);
  const sourceStat = await fs.stat(source);
  let workingRoot = source;
  let temporaryRoot = null;
  if (sourceStat.isFile()) {
    if (path.extname(source).toLowerCase() !== '.zip') throw new Error('Choose a Notion export ZIP or folder.');
    temporaryRoot = await extractZip(source);
    workingRoot = temporaryRoot;
  } else if (!sourceStat.isDirectory()) {
    throw new Error('The selected Notion export is not a file or folder.');
  }

  if (temporaryRoot) {
    const topEntries = await fs.readdir(workingRoot, { withFileTypes: true });
    const visibleTop = topEntries.filter((entry) => !entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name));
    if (visibleTop.length === 1 && visibleTop[0].isDirectory()) workingRoot = path.join(workingRoot, visibleTop[0].name);
  }
  return { workingRoot, temporaryRoot };
}

async function inspectNotionExport(sourcePath) {
  const { workingRoot, temporaryRoot } = await openNotionSource(sourcePath);
  try {
    const all = await walk(workingRoot);
    const analysis = await analyzeNotionFiles(all);
    return { obvious: analysis.obvious, uncertain: analysis.uncertain };
  } finally {
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function importNotionExport(sourcePath, destinationRoot, options = {}) {
  const destination = path.resolve(destinationRoot);
  const { workingRoot, temporaryRoot } = await openNotionSource(sourcePath);
  try {
    const all = await walk(workingRoot);
    const analysis = await analyzeNotionFiles(all);
    const removed = new Map(analysis.obvious.map((item) => [item.path, item.reason]));
    if (options.uncertainAction === 'remove') {
      for (const item of analysis.uncertain) removed.set(item.path, item.reason);
    }
    const excluded = new Set(removed.keys());
    const markdownFiles = all.files.filter(({ relative }) => relative.toLowerCase().endsWith('.md'));
    const csvFiles = all.files.filter(({ relative }) => relative.toLowerCase().endsWith('.csv'));
    const activeMarkdownFiles = markdownFiles.filter(({ relative }) => !excluded.has(relative));
    const { byPage: csvByPage, warnings } = csvPropertiesForPages(csvFiles, activeMarkdownFiles);
    const importedNotes = [];
    const skippedNotes = [];
    const preservedFiles = [];
    const skippedFiles = [];
    const copiedAssets = [];
    await fs.mkdir(destination, { recursive: true });

    for (const folder of all.folders) {
      await fs.mkdir(path.join(destination, folder), { recursive: true });
    }

    for (const page of activeMarkdownFiles) {
      const target = path.join(destination, page.relative);
      if (fsSync.existsSync(target)) {
        skippedNotes.push(page.relative);
        continue;
      }
      const markdown = analysis.fileDetails.get(page.relative) ?? await readUtf8(page.absolute, page.relative);
      const metadata = pageMetadata(markdown, csvByPage.get(page.relative));
      const converted = mergeImportedFrontmatter(markdown, metadata.tags, metadata.properties);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, converted, { flag: 'wx' });
      importedNotes.push(page.relative);
    }

    // Keep every visible non-Markdown export file at the same relative path.
    // This includes Notion's database CSVs and unreferenced attachments, which
    // are still part of the user's exported workspace structure.
    for (const file of all.files.filter(({ relative }) => !relative.toLowerCase().endsWith('.md') && !excluded.has(relative))) {
      const target = path.join(destination, file.relative);
      if (fsSync.existsSync(target)) {
        skippedFiles.push(file.relative);
        continue;
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(file.absolute, target, fsSync.constants.COPYFILE_EXCL);
      preservedFiles.push(file.relative);
      if (!file.relative.toLowerCase().endsWith('.csv')) copiedAssets.push(file.relative);
    }

    return {
      importedNotes,
      skippedNotes,
      removedFiles: [...removed.keys()],
      uncertainFilesKept: options.uncertainAction === 'remove'
        ? []
        : analysis.uncertain.map((item) => item.path),
      preservedFiles,
      skippedFiles,
      copiedAssets,
      warnings: [...new Set(warnings)],
    };
  } finally {
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

module.exports = {
  importNotionExport,
  inspectNotionExport,
  parseCsv,
  parsePropertyLines,
  pageMetadata,
  mergeImportedFrontmatter,
  safeRelative,
};
