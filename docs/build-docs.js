const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS_INDEX = path.join(REPO_ROOT, 'docs', 'index.html');

const ignoredFiles = new Set([
  'AGENTS.md',
  'package.json',
  'package-lock.json',
  'server.js',
  'build-docs.js'
]);

function shouldSkipDirectory(name, relPath) {
  return (
    name === '.git' ||
    name === 'node_modules' ||
    name === '.trash'
  );
}

function collectMarkdown(rootDir) {
  const result = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(entry.name, relPath)) {
          walk(fullPath);
        }
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith('.md') || ignoredFiles.has(entry.name)) {
        continue;
      }

      result.push({
        relPath,
        raw: fs.readFileSync(fullPath, 'utf8'),
        source: 'embedded'
      });
    }
  }

  walk(rootDir);
  result.sort((a, b) => a.relPath.localeCompare(b.relPath, 'ko', { sensitivity: 'base', numeric: true }));
  return result;
}

function replaceEmbeddedNotes(html, notes) {
  const serialized = JSON.stringify(notes, null, 8)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

  const nextBlock = `window.__OBVISION_EMBEDDED_NOTES__ = ${serialized};`;
  const pattern = /window\.__OBVISION_EMBEDDED_NOTES__\s*=\s*\[[\s\S]*?\];/;
  if (!pattern.test(html)) {
    throw new Error('Could not find embedded notes block in docs/index.html');
  }
  return html.replace(pattern, nextBlock);
}

function main() {
  const notes = collectMarkdown(REPO_ROOT);
  const html = fs.readFileSync(DOCS_INDEX, 'utf8');
  fs.writeFileSync(DOCS_INDEX, replaceEmbeddedNotes(html, notes));
  console.log(`Embedded ${notes.length} markdown file(s) into ${path.relative(REPO_ROOT, DOCS_INDEX)}`);
}

main();
