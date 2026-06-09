# Obvision 🪨

### Obsidian Reading Mode on the Web

Obvision is a lightweight GitHub Pages viewer for reading Markdown files from an Obsidian vault on the web.

It runs entirely in the browser and provides document search, folder and note selection, an outline view, and backlink calculation without a separate build step.

[한국어 README 보기](README.ko.md)

## What It Does

- Publishes an Obsidian-style Markdown vault through GitHub Pages.
- Reads Markdown files directly from the current GitHub repository.
- Lets readers browse folders and documents from the web UI.
- Supports client-side search, document outlines, and backlink discovery.
- Works as a static `docs/index.html` page, so updating notes only requires commit and push.

## Use With an Obsidian Vault

You can use this repository as the root of an Obsidian vault, or copy its files into an existing vault.

A recommended structure looks like this:

```text
your-vault/
  README.md
  notes/
    index.md
    01 first document.md
  references/
    source.md
  docs/
    index.html
```

Setup steps:

1. Place this repository at the root of your Obsidian vault.
2. Include the Markdown notes you want to publish in the repository.
3. Commit the changed files and push them to GitHub.

```bash
git add docs .gitignore
git commit -m "Set up Obvision GitHub Pages viewer"
git push
```

The `docs/index.html` page deployed by GitHub Pages reads Markdown files from the current GitHub repository and renders them in the browser. After adding or editing notes, you only need to commit and push the changes.

## GitHub Pages Setup

Configure GitHub Pages to serve the `/docs` folder as the static site root.

1. Open the GitHub repository page.
2. Go to `Settings`.
3. Select `Pages` from the left sidebar.
4. Under `Build and deployment`, set `Source` to `Deploy from a branch`.
5. Select the branch to deploy, usually `main`.
6. Select `/docs` as the folder.
7. Click `Save`.

After deployment, the site is usually available at:

```text
https://<github-username>.github.io/<repository-name>/
```

For a repository named `Obvision`, the URL would look like:

```text
https://<github-username>.github.io/Obvision/
```

## Local Preview

You can open `docs/index.html` directly, or run a small local server:

```bash
cd docs
python3 -m http.server 4173
```

Then open `http://127.0.0.1:4173/` in your browser.

## Privacy Notes

- If your GitHub Pages repository is public, the Markdown content in the vault is public too.
- If you use GitHub Pages with a private repository, check your GitHub plan and Pages visibility settings.
- Do not include sensitive notes, attachments, or personal information in the repository.
