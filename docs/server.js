const fs = require('fs');
const http = require('http');
const path = require('path');

const MarkdownIt = require('markdown-it');

const VAULT_ROOT = process.env.VAULT_ROOT ? path.resolve(process.env.VAULT_ROOT) : path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3150);
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH || '/vault');
const APP_NAME = process.env.SITE_NAME || 'Obsidian Vault Reader';
const VAULT_LABEL = process.env.VAULT_LABEL || 'Obsidian';

const md = new MarkdownIt({
  html: true,
  breaks: true,
  linkify: true,
  typographer: true
});

const notes = loadNotes(VAULT_ROOT);
const noteByPath = new Map(notes.map((note) => [note.relPathNoExt, note]));
const noteByAlias = buildAliasIndex(notes);
const backlinks = buildBacklinks(notes);
const tree = buildTree(notes);

function normalizeBasePath(value) {
  if (!value) {
    return '';
  }
  if (value === '/') {
    return '';
  }
  return `/${value.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(text) {
  return String(text)
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/['"’‘]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function normalizeLookup(text) {
  return String(text)
    .normalize('NFKC')
    .replace(/\.md$/i, '')
    .replace(/['"’‘]/g, '')
    .replace(/[^\p{L}\p{N}\/]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeBaseName(name) {
  return normalizeLookup(name.replace(/\.md$/i, ''));
}

function encodeSegments(relPath) {
  return relPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function withBase(route) {
  if (!BASE_PATH) {
    return route;
  }
  if (route === '/') {
    return BASE_PATH || '/';
  }
  return `${BASE_PATH}${route.startsWith('/') ? route : `/${route}`}`;
}

function loadNotes(rootDir) {
  const result = [];
  const ignoredFiles = new Set([
    'AGENTS.md',
    'package.json',
    'package-lock.json',
    'server.js'
  ]);

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.trash') {
        continue;
      }
      if (ignoredFiles.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue;
      }

      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      const raw = fs.readFileSync(fullPath, 'utf8');
      const lines = raw.split(/\r?\n/);
      const firstHeading = lines.find((line) => /^#\s+/.test(line));
      const title = firstHeading ? firstHeading.replace(/^#\s+/, '').trim() : entry.name.replace(/\.md$/i, '');
      const relPathNoExt = relPath.replace(/\.md$/i, '');
      result.push({
        absPath: fullPath,
        relPath,
        relPathNoExt,
        folder: path.posix.dirname(relPath),
        basename: path.posix.basename(relPath, '.md'),
        raw,
        searchText: normalizeLookup([relPathNoExt, path.posix.basename(relPath, '.md'), title, raw].join(' ')),
        title
      });
    }
  }

  walk(rootDir);
  result.sort((a, b) => a.relPath.localeCompare(b.relPath, 'en', { sensitivity: 'base' }));
  return result;
}

function buildAliasIndex(noteList) {
  const index = new Map();
  const push = (alias, note) => {
    const key = normalizeLookup(alias);
    if (!key) {
      return;
    }
    if (!index.has(key)) {
      index.set(key, note);
    }
  };

  for (const note of noteList) {
    push(note.relPathNoExt, note);
    push(note.basename, note);
    push(note.title, note);
    push(note.relPath, note);
    push(note.relPathNoExt.split('/').pop(), note);
  }

  return index;
}

function normalizeSearchQuery(query) {
  return normalizeLookup(query);
}

function stripMarkdownPreview(text) {
  return String(text)
    .replace(/!\[\[[^\]]+\]\]/g, ' ')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[#>*_`~\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightExcerpt(excerpt, query) {
  const text = String(excerpt || '');
  const trimmed = String(query || '').trim();
  if (!trimmed) {
    return esc(text);
  }

  const pattern = new RegExp(escapeRegExp(trimmed), 'ig');
  let lastIndex = 0;
  let out = '';
  let matched = false;

  for (const match of text.matchAll(pattern)) {
    matched = true;
    const start = match.index ?? 0;
    const value = match[0];
    out += esc(text.slice(lastIndex, start));
    out += `<mark class="search-hit">${esc(value)}</mark>`;
    lastIndex = start + value.length;
  }

  if (!matched) {
    return esc(text);
  }

  out += esc(text.slice(lastIndex));
  return out;
}

function buildSearchExcerpt(note, query) {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) {
    return '';
  }

  const lines = note.raw.split(/\r?\n/);
  const lowerRawQuery = String(query).toLowerCase();
  for (const line of lines) {
    const normalizedLine = normalizeLookup(line);
    const lowerLine = line.toLowerCase();
    if (
      (lowerRawQuery && lowerLine.includes(lowerRawQuery)) ||
      (normalizedQuery && normalizedLine.includes(normalizedQuery))
    ) {
      return stripMarkdownPreview(line);
    }
  }

  return stripMarkdownPreview(note.raw.slice(0, 180));
}

function searchNotes(query) {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) {
    return [];
  }

  return notes
    .filter((note) => note.searchText.includes(normalizedQuery))
    .map((note) => ({
      note,
      excerpt: buildSearchExcerpt(note, query)
    }))
    .sort((a, b) => {
      const titleDiff = a.note.title.localeCompare(b.note.title, 'ko', { sensitivity: 'base', numeric: true });
      if (titleDiff !== 0) {
        return titleDiff;
      }
      return a.note.relPath.localeCompare(b.note.relPath, 'ko', { sensitivity: 'base', numeric: true });
    });
}

function buildBacklinks(noteList) {
  const backlinksMap = new Map();
  for (const note of noteList) {
    backlinksMap.set(note.relPathNoExt, new Set());
  }
  for (const note of noteList) {
    const outgoing = collectWikiTargets(note.raw, note.relPathNoExt);
    for (const target of outgoing) {
      const resolved = resolveTarget(target.target, note.relPathNoExt);
      if (resolved) {
        backlinksMap.get(resolved.note.relPathNoExt)?.add(note.relPathNoExt);
      }
    }
  }
  return backlinksMap;
}

function buildTree(noteList) {
  const root = { name: '', path: '', type: 'dir', children: new Map(), notes: [] };

  for (const note of noteList) {
    const parts = note.relPath.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, path: parts.slice(0, i + 1).join('/'), type: 'dir', children: new Map(), notes: [] });
      }
      node = node.children.get(part);
    }
    node.notes.push(note);
  }

  return root;
}

function extractLeadingNumber(text) {
  const match = String(text).match(/^(\d+)/);
  return match ? Number(match[1]) : null;
}

function compareFolders(a, b) {
  return a.name.localeCompare(b.name, 'ko', { sensitivity: 'base', numeric: true });
}

function compareFolderNotes(folderName, a, b) {
  const aOverview = a.basename === folderName;
  const bOverview = b.basename === folderName;
  if (aOverview !== bOverview) {
    return aOverview ? -1 : 1;
  }

  const aNumber = extractLeadingNumber(a.basename);
  const bNumber = extractLeadingNumber(b.basename);
  if (aNumber !== null && bNumber !== null && aNumber !== bNumber) {
    return aNumber - bNumber;
  }
  if (aNumber !== null && bNumber === null) {
    return -1;
  }
  if (aNumber === null && bNumber !== null) {
    return 1;
  }

  const titleDiff = a.basename.localeCompare(b.basename, 'en', { sensitivity: 'base', numeric: true });
  if (titleDiff !== 0) {
    return titleDiff;
  }
  return a.relPath.localeCompare(b.relPath, 'en', { sensitivity: 'base' });
}

function getFolders() {
  const rootFolder = notes.some((note) => note.folder === '.')
    ? { name: '.', path: '', type: 'dir', children: new Map(), notes: notes.filter((note) => note.folder === '.') }
    : null;
  const folders = [...tree.children.values()].sort(compareFolders);
  return [rootFolder, ...folders].filter(Boolean);
}

function getFolderNotes(folderName) {
  if (!folderName || folderName === '.') {
    return notes.filter((note) => note.folder === '.').sort((a, b) => compareFolderNotes(folderName, a, b));
  }
  const folder = tree.children.get(folderName);
  if (!folder) {
    return [];
  }
  return [...folder.notes].sort((a, b) => compareFolderNotes(folderName, a, b));
}

function getFolderIntroNote(folderName) {
  const notesInFolder = getFolderNotes(folderName);
  if (!notesInFolder.length) {
    return null;
  }
  const exact = notesInFolder.find((note) => note.basename === folderName);
  return exact || notesInFolder[0];
}

function getDefaultFolderName() {
  const folders = getFolders();
  if (folders.length) {
    return folders[0].name;
  }
  return '';
}

function getDefaultNote() {
  const defaultFolder = getDefaultFolderName();
  const folderIntro = defaultFolder ? getFolderIntroNote(defaultFolder) : null;
  if (folderIntro) {
    return folderIntro;
  }
  return notes[0] || null;
}

function getSelectedFolderName(note) {
  if (note && note.folder !== '.') {
    return note.folder;
  }
  if (note && note.folder === '.') {
    return '.';
  }
  return getDefaultFolderName();
}

function renderFolderSelect(currentFolderName) {
  const options = getFolders()
    .map((folder) => {
      const intro = getFolderIntroNote(folder.name);
      const target = intro || folder.notes[0] || null;
      const value = target ? noteUrl(target) : '#';
      const selected = folder.name === currentFolderName ? ' selected' : '';
      const count = folder.notes.length;
      const label = folder.name === '.' ? 'Root' : folder.name;
      return `<option value="${esc(value)}"${selected}>${esc(label)} (${count})</option>`;
    })
    .join('');

  return `
    <label class="control">
      <span>폴더</span>
      <select id="folder-select" aria-label="폴더 선택">
        ${options}
      </select>
    </label>
  `;
}

function renderNoteSelect(notesInFolder, currentRelPathNoExt) {
  const options = notesInFolder
    .map((note) => {
      const selected = note.relPathNoExt === currentRelPathNoExt ? ' selected' : '';
      return `<option value="${esc(noteUrl(note))}"${selected}>${esc(note.basename)}</option>`;
    })
    .join('');

  return `
    <label class="control">
      <span>문서</span>
      <select id="note-select" aria-label="문서 선택">
        ${options}
      </select>
    </label>
  `;
}

function renderNoteLinks(notesInFolder, currentRelPathNoExt) {
  if (!notesInFolder.length) {
    return '<p class="muted">이 폴더에 표시할 문서가 없습니다.</p>';
  }

  return `
    <div class="note-links">
      ${notesInFolder
      .map((note) => {
        const active = note.relPathNoExt === currentRelPathNoExt ? ' active' : '';
        return `<a class="note-link${active}" href="${esc(noteUrl(note))}">${esc(note.basename)}</a>`;
      })
      .join('')}
    </div>
  `;
}

function renderSearchPanel(query) {
  const trimmed = String(query || '').trim();

  return `
    <section class="panel search-panel">
      <div class="folder-summary">
        <div>
          <strong>전체 검색</strong>
        </div>
      </div>
      <form class="search-form" action="${esc(withBase('/search'))}" method="get">
        <input
          type="search"
          name="q"
          value="${esc(trimmed)}"
          placeholder="제목·본문·링크에서 키워드 검색"
          autocomplete="off"
          spellcheck="false"
        />
        <button type="submit">검색</button>
      </form>
    </section>
  `;
}

function renderSearchResultsPage(query) {
  const trimmed = String(query || '').trim();
  const results = trimmed ? searchNotes(trimmed) : [];
  const countLabel = trimmed ? `${results.length}개 결과` : '검색어를 입력하면 결과가 표시됩니다.';
  const resultItems = trimmed
    ? results
      .map(({ note, excerpt }) => {
        return `
            <article class="search-result">
              <a class="search-result-title" href="${esc(noteUrl(note))}">${esc(note.title)}</a>
              <div class="search-result-meta">${esc(note.relPath)}</div>
              ${excerpt ? `<p class="search-result-excerpt">${highlightExcerpt(excerpt, trimmed)}</p>` : ''}
            </article>
          `;
      })
      .join('')
    : '';

  return `<!doctype html>
  <html lang="ko">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${trimmed ? `${esc(trimmed)} 검색 결과` : '검색 결과'} · ${esc(APP_NAME)}</title>
      <style>
        :root {
          color-scheme: light;
          --bg: #eff2f4;
          --panel: rgba(255, 255, 255, 0.88);
          --panel-strong: #ffffff;
          --panel-soft: rgba(248, 250, 251, 0.95);
          --text: #20252b;
          --muted: #66717f;
          --border: rgba(37, 48, 62, 0.12);
          --shadow: 0 20px 45px rgba(29, 39, 54, 0.09);
          --accent: #3454d1;
          --accent-2: #18366f;
          --code-bg: #eef3f8;
        }

        * { box-sizing: border-box; }
        html, body { margin: 0; min-height: 100%; }
        body {
          font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background:
            radial-gradient(circle at top left, rgba(92, 121, 223, 0.16), transparent 24%),
            radial-gradient(circle at bottom right, rgba(29, 58, 132, 0.08), transparent 20%),
            var(--bg);
          color: var(--text);
        }
        a { color: var(--accent-2); text-decoration: none; }
        a:hover { text-decoration: underline; }
        .page {
          max-width: 1180px;
          margin: 0 auto;
          min-height: 100vh;
          padding: 1rem 1rem 2rem;
        }
        .workspace {
          display: grid;
          gap: 1rem;
        }
        .hero {
          display: flex;
          flex-wrap: wrap;
          gap: 0.9rem 1rem;
          align-items: end;
          justify-content: space-between;
          padding: 1rem 1rem 0.2rem;
        }
        .hero-copy {
          max-width: 62ch;
        }
        .hero-copy h1 {
          margin: 0;
          font-size: clamp(1.95rem, 3.5vw, 3.25rem);
          line-height: 1.08;
        }
        .hero-copy p {
          margin: 0.6rem 0 0;
          color: #3c4756;
          font-size: 1.03rem;
          line-height: 1.7;
        }
        .hero-meta {
          min-width: min(100%, 320px);
          display: grid;
          gap: 0.7rem;
        }
        .panel {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 18px;
          padding: 1rem;
          box-shadow: var(--shadow);
          backdrop-filter: blur(10px);
        }
        .panel h2 {
          margin: 0 0 0.7rem;
          font-size: 1rem;
        }
        .control-row {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.75rem;
        }
        .control {
          display: grid;
          gap: 0.35rem;
        }
        .control span {
          font-size: 0.82rem;
          color: var(--muted);
          letter-spacing: 0.02em;
        }
        select {
          width: 100%;
          font: inherit;
          color: var(--text);
          background: rgba(255, 255, 255, 0.9);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 0.82rem 0.9rem;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.6);
        }
        .search-panel {
          display: grid;
          gap: 0.9rem;
        }
        .search-form {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 0.55rem;
        }
        .search-form input[type="search"] {
          width: 100%;
          font: inherit;
          color: var(--text);
          background: rgba(255, 255, 255, 0.94);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 0.62rem 0.85rem;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.6);
        }
        .search-form button {
          font: inherit;
          color: white;
          background: linear-gradient(135deg, var(--accent), var(--accent-2));
          border: 0;
          border-radius: 12px;
          padding: 0.62rem 0.95rem;
          cursor: pointer;
          font-weight: 700;
        }
        .search-form button:hover {
          filter: brightness(1.03);
        }
        .search-result {
          padding: 0.85rem 0;
          border-top: 1px solid var(--border);
        }
        .search-result:first-of-type {
          border-top: 0;
          padding-top: 0.15rem;
        }
        .search-result-title {
          display: inline-block;
          font-weight: 700;
          font-size: 1rem;
        }
        .search-result-meta {
          margin-top: 0.2rem;
          color: var(--muted);
          font-size: 0.9rem;
        }
        .search-result-excerpt {
          margin: 0.35rem 0 0;
          color: #3c4756;
          line-height: 1.65;
        }
        .search-hit {
          background: rgba(255, 217, 102, 0.92);
          color: inherit;
          padding: 0 0.18rem;
          border-radius: 0.25rem;
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
        }
        .muted {
          color: var(--muted);
          margin: 0.3rem 0 0;
        }
        .eyebrow {
          margin: 0;
          text-transform: uppercase;
          letter-spacing: 0.18em;
          color: var(--muted);
          font-size: 0.77rem;
        }
        .subtle {
          color: var(--muted);
          font-size: 0.92rem;
        }
        .folder-summary {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          gap: 0.75rem;
          align-items: center;
          margin-bottom: 0.75rem;
        }
        .folder-summary strong {
          font-size: 1rem;
        }
        .search-toolbar {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
          align-items: center;
        }
        .search-back {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.7rem 0.95rem;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: rgba(255,255,255,0.82);
          color: var(--text);
          text-decoration: none;
          font-weight: 600;
        }
        .search-back:hover {
          text-decoration: none;
        }
        @media (max-width: 880px) {
          .page { padding: 0.75rem 0.75rem 1.5rem; }
          .hero {
            padding: 0.6rem 0.25rem 0.1rem;
          }
          .control-row {
            grid-template-columns: 1fr;
          }
          .search-form {
            grid-template-columns: 1fr;
          }
          .hero-meta {
            min-width: 100%;
          }
        }
      </style>
    </head>
    <body>
      <main class="page">
        <section class="workspace">
          <header class="hero">
            <div class="hero-copy">
              <p class="eyebrow">${esc(VAULT_LABEL)} Vault</p>
              <h1>검색 결과</h1>
              <p>${trimmed ? `${esc(trimmed)}를 포함한 노트를 전부 모아 보여줍니다.` : '검색어를 입력하면 결과가 표시됩니다.'}</p>
            </div>
            <div class="hero-meta panel">
              <div class="search-toolbar">
                <a class="search-back" href="${esc(withBase('/'))}">홈으로</a>
                <div class="subtle">${esc(countLabel)}</div>
              </div>
              <div class="subtle">노트 제목과 해당 문구가 포함된 부분을 함께 표시합니다.</div>
            </div>
          </header>

          ${renderSearchPanel(trimmed)}

          <section class="panel">
            <div class="folder-summary">
              <div>
                <strong>${trimmed ? esc(trimmed) : '검색어 없음'}</strong>
                <div class="subtle">${esc(countLabel)}</div>
              </div>
              <div class="subtle">전체 md 파일 검색</div>
            </div>
            ${trimmed
      ? resultItems || '<p class="muted">일치하는 노트가 없습니다.</p>'
      : '<p class="muted">검색창에 문자열을 입력하고 검색 버튼을 누르세요.</p>'
    }
          </section>
        </section>
      </main>
    </body>
  </html>`;
}

function collectWikiTargets(raw, currentRelPathNoExt) {
  const targets = [];
  const lines = raw.split(/\r?\n/);
  let inFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }

    line.replace(/(!?)\[\[([^\]]+)\]\]/g, (match, embed, target) => {
      targets.push({
        embed: embed === '!',
        target,
        currentRelPathNoExt
      });
      return match;
    });
  }

  return targets;
}

function resolveTarget(rawTarget, currentRelPathNoExt) {
  const [pathPart, headingPart] = String(rawTarget).split('#');
  const trimmedPath = pathPart.trim();
  const candidates = [];

  if (trimmedPath) {
    candidates.push(trimmedPath);
    candidates.push(trimmedPath.replace(/\.md$/i, ''));

    if (!trimmedPath.includes('/')) {
      const currentFolder = path.posix.dirname(currentRelPathNoExt);
      if (currentFolder && currentFolder !== '.') {
        candidates.push(`${currentFolder}/${trimmedPath}`);
        candidates.push(`${currentFolder}/${trimmedPath.replace(/\.md$/i, '')}`);
      }
    }
  }

  for (const candidate of candidates) {
    const exact = noteByPath.get(candidate.replace(/\.md$/i, ''));
    if (exact) {
      return { note: exact, heading: headingPart ? slugify(headingPart) : null };
    }
  }

  for (const candidate of candidates) {
    const resolved = noteByAlias.get(normalizeLookup(candidate));
    if (resolved) {
      return { note: resolved, heading: headingPart ? slugify(headingPart) : null };
    }
  }

  return null;
}

function renderWikiLinks(raw, currentRelPathNoExt, collectedTargets) {
  const lines = raw.split(/\r?\n/);
  const out = [];
  let inFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }

    if (inFence) {
      out.push(line);
      continue;
    }

    out.push(
      line.replace(/(!?)\[\[([^\]]+)\]\]/g, (match, embed, body) => {
        const [targetPart, labelPart] = body.split('|');
        const target = targetPart.trim();
        const label = (labelPart || targetPart).trim();
        const resolved = resolveTarget(target, currentRelPathNoExt);
        if (resolved) {
          collectedTargets.push(resolved.note.relPathNoExt);
          const href = withBase(`/${encodeSegments(resolved.note.relPathNoExt)}${resolved.heading ? `#${resolved.heading}` : ''}`);
          const cls = embed === '!' ? 'wikilink embed' : 'wikilink';
          return `<a class="${cls}" href="${esc(href)}">${esc(label)}</a>`;
        }
        return `<span class="wikilink unresolved">[[${esc(label)}]]</span>`;
      })
    );
  }

  return out.join('\n');
}

function uniqueHeadingSlugs(tokens) {
  const seen = new Map();
  const headings = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type !== 'heading_open') {
      continue;
    }
    const inline = tokens[i + 1];
    const title = inline && inline.type === 'inline' ? inline.content : '';
    const level = Number(token.tag.slice(1));
    const baseSlug = slugify(title) || 'section';
    const count = seen.get(baseSlug) || 0;
    const slug = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;
    seen.set(baseSlug, count + 1);
    token.attrSet('id', slug);
    headings.push({ level, title, slug });
  }

  return headings;
}

function renderMarkdown(raw, currentRelPathNoExt, meta) {
  const transformed = renderWikiLinks(raw, currentRelPathNoExt, meta.outgoing);
  const tokens = md.parse(transformed, meta);
  meta.headings = uniqueHeadingSlugs(tokens);
  return md.renderer.render(tokens, md.options, meta);
}

function noteUrl(note) {
  return withBase(`/${encodeSegments(note.relPathNoExt)}`);
}

function renderTreeNode(node, currentRelPathNoExt, depth = 0) {
  const parts = [];
  const folderName = node.name ? esc(node.name) : 'Vault';
  if (node.name) {
    parts.push(`<div class="tree-folder" style="--depth:${depth}">${folderName}</div>`);
  }
  if (node.notes.length) {
    parts.push('<ul class="tree-list">');
    for (const note of node.notes) {
      const active = note.relPathNoExt === currentRelPathNoExt ? ' active' : '';
      parts.push(`<li class="tree-item${active}"><a href="${esc(noteUrl(note))}">${esc(note.basename)}</a></li>`);
    }
    parts.push('</ul>');
  }
  for (const child of [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))) {
    parts.push(`<div class="tree-node">${renderTreeNode(child, currentRelPathNoExt, depth + 1)}</div>`);
  }
  return parts.join('');
}

function renderOutline(headings) {
  if (!headings || !headings.length) {
    return '<p class="muted">이 문서에는 개요가 없습니다.</p>';
  }
  const items = headings.map((heading) => {
    const indent = Math.max(0, heading.level - 1);
    return `<li style="margin-left:${indent * 0.75}rem"><a href="#${esc(heading.slug)}">${esc(heading.title)}</a></li>`;
  });
  return `<ul class="outline-list">${items.join('')}</ul>`;
}

function renderBacklinks(currentNote) {
  const incoming = [...(backlinks.get(currentNote.relPathNoExt) || [])]
    .map((relPathNoExt) => noteByPath.get(relPathNoExt))
    .filter(Boolean)
    .sort((a, b) => a.relPath.localeCompare(b.relPath, 'en', { sensitivity: 'base' }));

  if (!incoming.length) {
    return '<p class="muted">백링크가 없습니다.</p>';
  }

  return `<ul class="link-list">${incoming
    .map((note) => `<li><a href="${esc(noteUrl(note))}">${esc(note.basename)}</a></li>`)
    .join('')}</ul>`;
}

function renderApp(note, query = '') {
  const meta = { outgoing: [], headings: [] };
  const contentHtml = renderMarkdown(note.raw, note.relPathNoExt, meta);
  const incoming = renderBacklinks(note);
  const outline = renderOutline(meta.headings);
  const selectedFolderName = getSelectedFolderName(note);
  const notesInFolder = selectedFolderName ? getFolderNotes(selectedFolderName) : [];
  const selectedFolder = selectedFolderName && selectedFolderName !== '.' ? tree.children.get(selectedFolderName) : null;
  const selectedFolderNoteCount = selectedFolder ? selectedFolder.notes.length : notesInFolder.length;
  const searchPanelHtml = renderSearchPanel(query);
  const breadcrumbParts = note.relPathNoExt.split('/');
  const breadcrumbs = breadcrumbParts.map((part, idx, arr) => {
    const rel = arr.slice(0, idx + 1).join('/');
    const resolved = noteByPath.get(rel) || noteByAlias.get(normalizeLookup(rel));
    if (resolved) {
      return `<a href="${esc(noteUrl(resolved))}">${esc(part.replace(/\.md$/i, ''))}</a>`;
    }
    return `<span>${esc(part)}</span>`;
  }).join('<span class="crumb-sep">/</span>');

  return `<!doctype html>
  <html lang="ko">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${esc(note.title)} · ${esc(APP_NAME)}</title>
      <style>
        :root {
          color-scheme: light;
          --bg: #eff2f4;
          --panel: rgba(255, 255, 255, 0.88);
          --panel-strong: #ffffff;
          --panel-soft: rgba(248, 250, 251, 0.95);
          --text: #20252b;
          --muted: #66717f;
          --border: rgba(37, 48, 62, 0.12);
          --shadow: 0 20px 45px rgba(29, 39, 54, 0.09);
          --accent: #3454d1;
          --accent-2: #18366f;
          --code-bg: #eef3f8;
        }

        * { box-sizing: border-box; }
        html, body { margin: 0; min-height: 100%; }
        body {
          font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background:
            radial-gradient(circle at top left, rgba(92, 121, 223, 0.16), transparent 24%),
            radial-gradient(circle at bottom right, rgba(29, 58, 132, 0.08), transparent 20%),
            var(--bg);
          color: var(--text);
        }
        a { color: var(--accent-2); text-decoration: none; }
        a:hover { text-decoration: underline; }
        .page {
          max-width: 1180px;
          margin: 0 auto;
          min-height: 100vh;
          padding: 1rem 1rem 2rem;
        }
        .workspace {
          display: grid;
          gap: 1rem;
        }
        .hero {
          display: flex;
          flex-wrap: wrap;
          gap: 0.9rem 1rem;
          align-items: end;
          justify-content: space-between;
          padding: 1rem 1rem 0.2rem;
        }
        .hero-copy {
          max-width: 62ch;
        }
        .hero-copy h1 {
          margin: 0;
          font-size: clamp(1.95rem, 3.5vw, 3.25rem);
          line-height: 1.08;
        }
        .hero-copy p {
          margin: 0.6rem 0 0;
          color: #3c4756;
          font-size: 1.03rem;
          line-height: 1.7;
        }
        .hero-meta {
          min-width: min(100%, 320px);
          display: grid;
          gap: 0.7rem;
        }
        .panel {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 18px;
          padding: 1rem;
          box-shadow: var(--shadow);
          backdrop-filter: blur(10px);
        }
        .panel h2 {
          margin: 0 0 0.7rem;
          font-size: 1rem;
        }
        .control-row {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.75rem;
        }
        .control {
          display: grid;
          gap: 0.35rem;
        }
        .control span {
          font-size: 0.82rem;
          color: var(--muted);
          letter-spacing: 0.02em;
        }
        select {
          width: 100%;
          font: inherit;
          color: var(--text);
          background: rgba(255, 255, 255, 0.9);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 0.82rem 0.9rem;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.6);
        }
        .note-links {
          display: flex;
          flex-wrap: wrap;
          gap: 0.55rem;
        }
        .search-panel {
          display: grid;
          gap: 0.9rem;
        }
        .search-form {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 0.55rem;
        }
        .search-form input[type="search"] {
          width: 100%;
          font: inherit;
          color: var(--text);
          background: rgba(255, 255, 255, 0.94);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 0.62rem 0.85rem;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.6);
        }
        .search-form button {
          font: inherit;
          color: white;
          background: linear-gradient(135deg, var(--accent), var(--accent-2));
          border: 0;
          border-radius: 12px;
          padding: 0.62rem 0.95rem;
          cursor: pointer;
          font-weight: 700;
        }
        .search-form button:hover {
          filter: brightness(1.03);
        }
        .search-result {
          padding: 0.85rem 0;
          border-top: 1px solid var(--border);
        }
        .search-result:first-of-type {
          border-top: 0;
          padding-top: 0.15rem;
        }
        .search-result-title {
          display: inline-block;
          font-weight: 700;
          font-size: 1rem;
        }
        .search-result-meta {
          margin-top: 0.2rem;
          color: var(--muted);
          font-size: 0.9rem;
        }
        .search-result-excerpt {
          margin: 0.35rem 0 0;
          color: #3c4756;
          line-height: 1.65;
        }
        .note-link {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.55rem 0.8rem;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: rgba(255,255,255,0.78);
          color: var(--text);
          text-decoration: none;
        }
        .note-link.active {
          border-color: rgba(52, 84, 209, 0.4);
          background: rgba(52, 84, 209, 0.09);
          color: var(--accent-2);
          font-weight: 700;
        }
        .note-link:hover { text-decoration: none; }
        .breadcrumbs {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
          align-items: center;
          font-size: 0.86rem;
          color: var(--muted);
          padding: 0 0.25rem;
        }
        .crumb-sep { opacity: 0.55; }
        .note-shell {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 24px;
          box-shadow: var(--shadow);
          overflow: hidden;
        }
        .note-header {
          padding: 1.45rem 1.45rem 1rem;
          background: linear-gradient(180deg, rgba(255,255,255,0.94), rgba(248,250,252,0.72));
          border-bottom: 1px solid var(--border);
        }
        .note-header h1 {
          margin: 0;
          font-size: clamp(1.7rem, 3vw, 2.65rem);
          line-height: 1.15;
        }
        .note-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem 1rem;
          margin-top: 0.75rem;
          color: var(--muted);
          font-size: 0.9rem;
        }
        .note-body {
          padding: 1.45rem 1.5rem 1.8rem;
          font-size: 1.03rem;
          line-height: 1.8;
          background: var(--panel-strong);
        }
        .note-body h1, .note-body h2, .note-body h3, .note-body h4, .note-body h5, .note-body h6 {
          scroll-margin-top: 1rem;
          line-height: 1.25;
          margin-top: 1.6em;
          margin-bottom: 0.45em;
        }
        .note-body p { margin: 0.7em 0; }
        .note-body ul, .note-body ol { padding-left: 1.3rem; }
        .note-body li { margin: 0.3em 0; }
        .note-body blockquote {
          margin: 1.1rem 0;
          padding: 0.9rem 1rem;
          border-left: 4px solid var(--accent);
          background: rgba(52, 84, 209, 0.06);
          color: #354052;
          border-radius: 0 14px 14px 0;
        }
        .note-body code {
          padding: 0.15rem 0.35rem;
          background: var(--code-bg);
          border-radius: 7px;
          font-size: 0.95em;
        }
        .note-body pre {
          overflow: auto;
          padding: 1rem;
          background: #111827;
          color: #eef2ff;
          border-radius: 14px;
        }
        .note-body pre code {
          padding: 0;
          background: transparent;
          color: inherit;
        }
        .note-body img {
          display: block;
          width: 100%;
          max-width: 100%;
          height: auto;
          max-height: 500px;
          object-fit: contain;
          margin: 1rem 0;
          border-radius: 14px;
        }
        .note-body hr {
          border: 0;
          border-top: 1px solid var(--border);
          margin: 1.5rem 0;
        }
        .wikilink {
          color: #2546b8;
          font-weight: 600;
        }
        .wikilink.unresolved {
          color: #a15b2c;
          background: rgba(255, 193, 125, 0.25);
          padding: 0.05rem 0.25rem;
          border-radius: 0.35rem;
        }
        .section-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 300px;
          gap: 1rem;
        }
        .stack {
          display: grid;
          gap: 1rem;
        }
        .link-list, .outline-list {
          list-style: none;
          padding: 0;
          margin: 0.35rem 0 0;
        }
        .link-list li, .outline-list li { margin: 0.28rem 0; }
        .muted {
          color: var(--muted);
          margin: 0.3rem 0 0;
        }
        .eyebrow {
          margin: 0;
          text-transform: uppercase;
          letter-spacing: 0.18em;
          color: var(--muted);
          font-size: 0.77rem;
        }
        .subtle {
          color: var(--muted);
          font-size: 0.92rem;
        }
        .folder-summary {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          gap: 0.75rem;
          align-items: center;
          margin-bottom: 0.75rem;
        }
        .folder-summary strong {
          font-size: 1rem;
        }
        .note-links-panel {
          margin-top: 0.15rem;
        }
        .mobile-only { display: none; }
        @media (max-width: 880px) {
          .page { padding: 0.75rem 0.75rem 1.5rem; }
          .hero {
            padding: 0.6rem 0.25rem 0.1rem;
          }
          .control-row,
          .section-grid {
            grid-template-columns: 1fr;
          }
          .search-form {
            grid-template-columns: 1fr;
          }
          .note-shell { border-radius: 18px; }
          .note-body { padding: 1.1rem; }
          .note-header { padding: 1.15rem 1.1rem 0.95rem; }
          .hero-meta {
            min-width: 100%;
          }
        }
      </style>
    </head>
    <body>
      <main class="page">
        <section class="workspace">
          <header class="hero">
            <div class="hero-copy">
              <p class="eyebrow">${esc(VAULT_LABEL)} Vault</p>
              <h1>Obsidian 읽기모드 뷰어</h1>
              <p>폴더를 고르고, 같은 화면에서 문서 목록과 읽기 모드를 함께 봅니다. 모바일에서는 하나의 세로 흐름으로 내려오게 정리했습니다.</p>
            </div>
            <div class="hero-meta panel">
              <div class="control-row">
                ${renderFolderSelect(selectedFolderName)}
                ${renderNoteSelect(notesInFolder, note.relPathNoExt)}
              </div>
              <div class="subtle">현재 경로: ${esc(note.relPath)}</div>
            </div>
          </header>

          ${searchPanelHtml}

          <div class="note-shell">
            <header class="note-header">
              <div class="breadcrumbs">${breadcrumbs}</div>
              <h1>${esc(note.title)}</h1>
              <div class="note-meta">
                <span>${esc(note.relPath)}</span>
                <span>${meta.outgoing.length} outgoing links</span>
                <span>${(backlinks.get(note.relPathNoExt) || new Set()).size} backlinks</span>
              </div>
            </header>
            <article class="note-body">
              ${contentHtml}
            </article>
          </div>

          <section class="section-grid">
            <div class="panel">
              <h2>개요</h2>
              ${outline}
            </div>
            <div class="panel">
              <h2>백링크</h2>
              ${incoming}
            </div>
          </section>

          <section class="panel note-links-panel">
            <div class="folder-summary">
              <div>
                <strong>${esc(selectedFolderName === '.' ? 'Root' : selectedFolderName || 'Root')}</strong>
                <div class="subtle">${selectedFolderNoteCount}개 문서</div>
              </div>
              <div class="subtle">${notes.length} notes · ${meta.outgoing.length} outgoing links</div>
            </div>
            ${renderNoteLinks(notesInFolder, note.relPathNoExt)}
          </section>
        </section>
      </main>
      <script>
        const folderSelect = document.getElementById('folder-select');
        const noteSelect = document.getElementById('note-select');
        if (folderSelect) {
          folderSelect.addEventListener('change', (event) => {
            if (event.target.value) {
              window.location.href = event.target.value;
            }
          });
        }
        if (noteSelect) {
          noteSelect.addEventListener('change', (event) => {
            if (event.target.value) {
              window.location.href = event.target.value;
            }
          });
        }
      </script>
    </body>
  </html>`;
}

function renderHomePage() {
  return renderApp(getDefaultNote() || notes[0]);
}

function serve(req, res) {
  const requestUrl = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(requestUrl.pathname);
  const query = requestUrl.searchParams.get('q') || '';

  if (BASE_PATH && pathname.startsWith(BASE_PATH)) {
    pathname = pathname.slice(BASE_PATH.length) || '/';
  }

  if (pathname === '/search' || pathname === '/search/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderSearchResultsPage(query));
    return;
  }

  if (pathname === '/' || pathname === '') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderApp(getDefaultNote() || notes[0], query));
    return;
  }

  const cleanPath = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  const pathNoExt = cleanPath.replace(/\.md$/i, '');
  const note = noteByPath.get(pathNoExt) || noteByAlias.get(normalizeLookup(pathNoExt));

  if (note) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderApp(note, query));
    return;
  }

  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><title>Not found</title><p>Note not found: ${esc(cleanPath)}</p>`);
}

http.createServer(serve).listen(PORT, '0.0.0.0', () => {
  console.log(`${APP_NAME} listening on http://0.0.0.0:${PORT}`);
});
