# Obvision

Obvision은 Obsidian vault의 Markdown 파일을 웹에서 읽기 좋게 보여주는 정적 GitHub Pages용 뷰어입니다. `[[wikilink]]`, 문서 검색, 폴더/문서 선택, 개요, 백링크 계산을 브라우저에서 처리합니다.

## Obsidian Vault에 적용하기

이 repo를 Obsidian vault의 루트로 사용하거나, 기존 vault 안에 이 repo의 파일을 넣어서 사용할 수 있습니다.

권장 구조는 다음과 같습니다.

```text
your-vault/
  README.md
  1주차/
    1주차.md
    01 첫 문서.md
  2주차/
    2주차.md
  docs/
    index.html
    package.json
    package-lock.json
    build-docs.js
    server.js
```

적용 절차:

1. 이 repo를 Obsidian vault 루트에 둡니다.
2. 공개할 Markdown 노트를 repo 안에 포함합니다.
3. `docs` 폴더로 이동해 의존성을 설치합니다.

```bash
cd docs
npm install
```

4. Markdown 파일을 `docs/index.html` 안에 embedded 데이터로 반영합니다.

```bash
npm run build:pages
```

5. 변경된 파일을 커밋하고 GitHub에 push합니다.

```bash
git add README.md docs .gitignore
git commit -m "Set up Obvision GitHub Pages viewer"
git push
```

`npm run build:pages`는 repo 안의 `.md` 파일을 읽어 `docs/index.html`에 포함합니다. GitHub Pages에서 GitHub API 접근이 실패해도 embedded 데이터로 기본 동작할 수 있게 하기 위한 단계입니다. 노트를 추가하거나 수정한 뒤에는 다시 실행하세요.

## 로컬에서 확인하기

정적 GitHub Pages 화면은 `docs/index.html`을 열어서 확인할 수 있습니다. 간단한 로컬 서버로 확인하려면 다음을 실행합니다.

```bash
cd docs
python3 -m http.server 4173
```

브라우저에서 `http://127.0.0.1:4173/`을 엽니다.

Node 서버 방식으로 기존 동적 뷰어를 확인하려면 다음을 실행합니다.

```bash
cd docs
npm start
```

기본 주소는 `http://127.0.0.1:3150/vault`입니다.

## GitHub Pages 설정

GitHub Pages는 `/docs` 폴더를 정적 사이트 루트로 배포하도록 설정합니다.

1. GitHub repo 페이지로 이동합니다.
2. `Settings`를 엽니다.
3. 왼쪽 메뉴에서 `Pages`를 선택합니다.
4. `Build and deployment`에서 `Source`를 `Deploy from a branch`로 선택합니다.
5. `Branch`를 배포할 브랜치로 선택합니다. 보통 `main`입니다.
6. 폴더를 `/docs`로 선택합니다.
7. `Save`를 누릅니다.

배포가 완료되면 보통 다음 형식의 URL에서 확인할 수 있습니다.

```text
https://<github-username>.github.io/<repository-name>/
```

이 repo 이름이 `Obvision`이라면 예시는 다음과 같습니다.

```text
https://<github-username>.github.io/Obvision/
```

## 동작 방식

- `docs/index.html`: GitHub Pages에서 실행되는 정적 웹앱입니다.
- `docs/build-docs.js`: repo 안의 Markdown 파일을 수집해 `docs/index.html`에 embedded note 데이터로 삽입합니다.
- `docs/server.js`: 로컬 또는 Node 호스팅 환경에서 사용할 수 있는 기존 서버형 뷰어입니다.
- `docs/package.json`: 빌드와 로컬 서버 실행 스크립트를 정의합니다.

GitHub Pages는 Node 서버를 실행하지 않습니다. Pages에서 실제로 서비스되는 파일은 `docs/index.html`이며, `server.js`는 로컬 확인이나 별도 Node 호스팅용입니다.

## 주의사항

- GitHub Pages에 올리는 repo가 public이면 vault의 Markdown 내용도 공개됩니다.
- private repo에서 Pages를 쓰는 경우 GitHub 요금제와 Pages 공개 범위를 확인하세요.
- 민감한 노트, 첨부파일, 개인 정보는 repo에 포함하지 마세요.
- `docs/node_modules/`는 커밋하지 않습니다.
