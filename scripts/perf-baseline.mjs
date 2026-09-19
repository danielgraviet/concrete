#!/usr/bin/env node
/**
 * Concrete perf scorecard — prints disk footprints that matter for issue #9.
 * Usage: node scripts/perf-baseline.mjs
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function du(target) {
  const abs = path.isAbsolute(target) ? target : path.join(root, target);
  if (!fs.existsSync(abs)) return null;
  try {
    const out = execSync(`du -sh ${JSON.stringify(abs)}`, { encoding: 'utf8' }).trim();
    return out.split('\t')[0] || out.split(/\s+/)[0];
  } catch {
    return null;
  }
}

function fileSize(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  const bytes = fs.statSync(abs).size;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${bytes}B`;
}

function listDistAssets() {
  const dir = path.join(root, 'dist/assets');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
    .map((name) => {
      const bytes = fs.statSync(path.join(dir, name)).size;
      return { name, bytes };
    })
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 8);
}

const home = os.homedir();
const rows = [
  ['repo (working tree)', du('.')],
  ['node_modules (dev)', du('node_modules')],
  ['release/ (local pack artifacts)', du('release')],
  ['dist/ (renderer build)', du('dist')],
  ['packaged app.asar', fileSize('release/mac-arm64/Concrete.app/Contents/Resources/app.asar')],
  ['packaged Concrete.app tree', du('release/mac-arm64')],
  ['App Support concrete', du(path.join(home, 'Library/Application Support/concrete'))],
  ['App Support Cache', du(path.join(home, 'Library/Application Support/concrete/Cache'))],
  ['App Support Code Cache', du(path.join(home, 'Library/Application Support/concrete/Code Cache'))],
];

console.log('Concrete performance / footprint scorecard');
console.log(`cwd: ${root}`);
console.log(`date: ${new Date().toISOString()}`);
console.log('');
console.log('| Layer | Size |');
console.log('| --- | --- |');
for (const [label, size] of rows) {
  console.log(`| ${label} | ${size ?? 'n/a'} |`);
}

const assets = listDistAssets();
if (assets.length) {
  console.log('');
  console.log('Top dist assets:');
  for (const asset of assets) {
    const mb = (asset.bytes / (1024 * 1024)).toFixed(2);
    console.log(`  ${mb.padStart(6)}M  ${asset.name}`);
  }
}

console.log('');
console.log('Tips:');
console.log('  ANALYZE=1 npm run build   # writes docs/bundle-stats.html');
console.log('  npm run clean             # wipe release/ + local vite cache');
console.log('  npm run perf:baseline     # re-run this scorecard');
