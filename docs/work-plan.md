# Copilot Reviewer Assistant — Work Plan

## Phase 1 — Project Scaffold `[x]`

Set up a standard VS Code extension project.

- Run `yo code` (Yeoman VS Code generator) to scaffold a TypeScript extension
- Configure `package.json`:
  - `contributes.commands`: register `copilotReviewer.openPanel` command
  - `contributes.authentication`: declare dependency on the `github` auth provider
  - `engines.vscode`: target a minimum version that supports Webview panels and the LM API
- Configure `tsconfig.json`, `eslint`, and `.vscodeignore`
- Verify the extension activates and the command appears in the Command Palette

---

## Phase 2 — GitHub Authentication `[x]`

Implement transparent sign-in for both public and private repositories.

- Call `vscode.authentication.getSession('github', ['repo'])` on command invocation
- If no session exists, VS Code will prompt the user to sign in via the standard OAuth flow
- Store and reuse the returned `accessToken` for all API calls in the session
- Surface a clear error message if the user cancels authentication

---

## Phase 3 — PR URL Input & Parsing `[x]`

Accept and validate the target PR from the user.

- Show an input box (`vscode.window.showInputBox`) prompting for the GitHub PR URL
- Parse the URL to extract `owner`, `repo`, and `pull_number`
- Validate the format and show a descriptive error if it is malformed
- Pre-populate with a URL from clipboard if it matches the expected GitHub PR pattern

---

## Phase 4 — GitHub API Integration `[x]`

Fetch Copilot's review comments from the PR.

- Call `GET /repos/{owner}/{repo}/pulls/{pull_number}/comments` with the Bearer token
- Filter results to comments authored by `copilot-pull-request-reviewer[bot]`
- For each comment, extract:
  - `path` (file path)
  - `line` / `original_line` (affected line)
  - `body` (recommendation text)
  - `diff_hunk` (surrounding code context)
- Handle pagination (GitHub returns max 100 items per page)
- Handle API errors (404 not found, 403 forbidden, rate limiting)

---

## Phase 5 — Work Plan Generation `[x]`

Produce a human-readable work plan for each recommendation before any fix is applied.

- For each fetched comment, call the VS Code Language Model API (`vscode.lm.selectChatModels`) with a prompt that includes:
  - The recommendation body
  - The `diff_hunk` for context
  - The file path and line number
- Ask the model to return a concise one-paragraph description of what change needs to be made and why
- Store the generated plan alongside the comment data

---

## Phase 6 — Webview Panel UI `[x]`

Display the checklist panel and collect user selections.

- Create a `WebviewPanel` with `vscode.window.createWebviewPanel`
- Render an HTML page containing:
  - A header showing the PR URL and repo name
  - Select All / Deselect All controls
  - A scrollable list of recommendation cards, each showing:
    - Checkbox (checked by default)
    - File path and line number
    - Recommendation body (collapsible)
    - Generated work plan
  - An "Apply Selected Fixes" button (disabled when nothing is checked)
- Use VS Code's Webview theme variables (`--vscode-*`) so the panel respects the user's colour theme
- Wire the "Apply Selected Fixes" button to post a message back to the extension host with the list of selected comment IDs

---

## Phase 7 — Fix Application `[x]`

Apply each selected fix to the local workspace.

- For each selected comment, call the VS Code Language Model API with a prompt containing:
  - The recommendation body
  - The full content of the affected file (read via `vscode.workspace.fs`)
  - The `diff_hunk` and target line number
- Ask the model to return the corrected file content (or a targeted diff)
- Write the result back to the workspace file via `vscode.workspace.fs.writeFile`
- Report progress per file in the Webview (update each card: pending → applying → done / failed)

---

## Phase 8 — Git Integration (Optional) `[x]`

Allow the user to stage and commit the applied changes without leaving the extension.

- After all fixes are applied, offer a "Stage & Commit" button in the Webview
- Use the VS Code Git extension API (`vscode.extensions.getExtension('vscode.git')`) to:
  - Stage the modified files
  - Create a commit with a generated message summarising the applied fixes
- If the Git API is unavailable, show a message instructing the user to commit manually

---

## Phase 9 — Error Handling & Edge Cases `[x]`

Harden the extension for real-world use.

- No Copilot comments found → show an empty-state message in the Webview
- File not found in local workspace → warn per item and skip
- LM API unavailable or quota exceeded → surface a clear error per item, allow retry
- Network failures on GitHub API calls → retry once, then surface the error
- PR already merged / closed → still allow fetching and applying unresolved comments

---

## Phase 10 — UI Polish & UX Modernisation `[x]`

Make the Webview panel look modern and efficient while staying native to VS Code's design language.

- Sticky toolbar with live selection counter on the Apply button
- Card left-border accent colour changes with fix state (pending / applying / done / failed)
- Dim and disable done cards automatically
- Animated "Applying…" spinner using CSS `::after`
- Joined button group for Select All / Deselect All
- Smooth `<details>` expand/collapse transition
- Left-truncate long file-path badges with ellipsis; full path on hover
- Improved empty state with a codicon icon and explanatory sub-text
- Card hover highlight and accessible focus rings on all interactive elements
- Progress bar beneath the toolbar filling as fixes are applied

---

## Phase 11 — Packaging & Publishing `[x]`

Prepare the extension for distribution.

- Add an icon, display name, description, and categories to `package.json`
- Write a `README.md` covering installation, usage, and authentication
- Run `vsce package` to produce a `.vsix` file for local testing
- Test end-to-end against the example PR (`https://github.com/Veverke/ThemeStudioApp/pull/3`)
- Publish to the VS Code Marketplace via `vsce publish` (requires a publisher account)
