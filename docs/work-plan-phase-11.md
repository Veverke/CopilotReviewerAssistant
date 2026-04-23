# Phase 11 — Packaging & Publishing

## Atomic Tasks

### 11.1 — Add extension icon
Create or source a 128×128 PNG icon. Place it at `media/icon.png` and reference it in `package.json`:

```json
"icon": "media/icon.png"
```

### 11.2 — Complete `package.json` metadata
Fill in all fields required by the VS Code Marketplace:

```json
"displayName": "Copilot Reviewer Assistant",
"description": "Fetch Copilot PR review recommendations and apply them locally from a VS Code Webview checklist.",
"version": "0.1.0",
"publisher": "<your-publisher-id>",
"categories": ["Other"],
"keywords": ["copilot", "github", "pull request", "code review", "ai"]
```

### 11.3 — Add repository and bugs fields to `package.json`
Required by the Marketplace for discoverability and issue tracking:

```json
"repository": { "type": "git", "url": "https://github.com/<owner>/CopilotReviewerAssistant" },
"bugs": { "url": "https://github.com/<owner>/CopilotReviewerAssistant/issues" }
```

### 11.4 — Verify `.vscodeignore` completeness
Ensure the packaged `.vsix` excludes: `src/`, `node_modules/`, `.vscode-test/`, `*.map`, `.eslintrc.json`, `tsconfig.json`, all `work-plan*.md`, `intent.md`.

### 11.5 — Run `vsce package` and inspect the `.vsix`
```
npx vsce package
```
Open the resulting `.vsix` (it is a ZIP) and verify only the expected files are included: `out/`, `media/`, `package.json`, `README.md`, `LICENSE`.

### 11.6 — Install the `.vsix` locally for end-to-end testing
```
code --install-extension copilot-reviewer-assistant-0.1.0.vsix
```
Test against the example PR `https://github.com/Veverke/ThemeStudioApp/pull/3` in a clean VS Code window (not the Extension Development Host).

### 11.7 — End-to-end test checklist
Verify the full flow works against the example PR:
- [ ] Authentication succeeds
- [ ] Copilot comments fetched and displayed in the panel
- [ ] Work plans generated and visible per card
- [ ] At least one fix applied and file written correctly
- [ ] Stage & Commit produces a correct commit

### 11.8 — Create a publisher account on the Marketplace (if not yet done)
Go to https://marketplace.visualstudio.com/manage and create a publisher matching the `publisher` field in `package.json`.

### 11.9 — Create release GitHub Actions workflow
Create `.github/workflows/release.yml` that automates the full release pipeline triggered by a version tag (e.g. `v0.1.0`) or manual `workflow_dispatch`:

1. **verify-version** — checks that the pushed tag matches `package.json`'s `version` field.
2. **build** — installs dependencies, runs unit tests (`npm run test:unit`), compiles TypeScript, and packages the `.vsix` with `vsce package`.
3. **publish** — downloads the `.vsix` artifact, then publishes to both the VS Code Marketplace (`vsce publish -p $VSCE_TOKEN`) and Open VSX Registry (`ovsx publish -p $OVSX_TOKEN`).

Required repository secrets:
- `VSCE_TOKEN` — Azure DevOps PAT with `Marketplace (Publish)` scope.
- `OVSX_TOKEN` — Open VSX access token (https://open-vsx.org/user-settings/tokens).

### 11.10 — Mark Phase 11 complete in work-plan.md
Change `## Phase 11 — Packaging & Publishing \`[ ]\`` to `## Phase 11 — Packaging & Publishing \`[x]\`` in `work-plan.md`.

---

## Deliverables

- `media/icon.png` (128×128)
- `package.json` with complete Marketplace metadata
- `.github/workflows/release.yml` — automated release pipeline (build → test → publish)
- A `.vsix` file containing only the necessary production artifacts
- Extension installed and verified end-to-end in a clean VS Code window against the example PR
- Extension published to the VS Code Marketplace and Open VSX Registry (or ready to publish)
- `work-plan.md` Phase 11 marked `[x]`

---

## Manual Testing at This Point

| What to test | How |
|---|---|
| `.vsix` contents | Unzip the `.vsix` — only `out/`, `media/`, `package.json`, `README.md`, `LICENSE` present; no `src/` or `node_modules/` |
| Clean install | Install `.vsix` in a fresh VS Code profile — extension loads with no errors |
| Full end-to-end with example PR | Run through tasks 10.7 checklist items one by one |
| Marketplace listing | After publish, open the Marketplace page — icon, description, and README render correctly |

