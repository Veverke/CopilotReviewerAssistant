# Copilot Reviewer Assistant

> **GitHub Copilot leaves review comments you still have to action in the browser. This extension brings all of them into VS Code — reviewed, organised, and resolved without leaving your editor.**

## What GitHub Copilot Review already does

As of mid-2026, GitHub Copilot can review a pull request entirely from the GitHub website. Here is what that workflow looks like:

- You add Copilot as a reviewer on a pull request (or configure it to run automatically).
- Copilot posts inline comments on the diff. Where it can, it includes a **Commit Suggestion** patch that you can apply with one click.
- For comments without an inline patch, a **Fix with Copilot** / **Implement suggestion** button (currently in public preview) instructs the Copilot cloud agent to apply the fix.
- You work through the comments in the browser. Inline patches can be batched into a single commit, but comments without a patch still require individual action.
- Re-reviewing after a push requires a manual re-request.

That is a solid starting point. But several things remain unresolved once the review is posted.

## The gap this extension fills

| GitHub Web UI | Copilot Reviewer Assistant |
|---|---|
| Comments are scattered across the diff view — no single list | All pending comments collected in one panel, numbered and sortable |
| Commit Suggestion patches can be batched, but comments without a patch still need individual action in the browser | All selected comments — with or without an inline patch — sent to VS Code Copilot Chat in a single structured prompt |
| No complexity signal on individual comments | Every card is auto-tagged LOW / MED / HIGH based on the comment text and diff hunk |
| No batch selection | Check or uncheck individual suggestions before applying |
| No reviewer filter | When multiple reviewers left comments, filter by reviewer |
| Stage → commit → push requires separate git commands or another tool | Single **Push & Mark Resolved** button stages, commits, pushes, and auto-resolves every thread |
| Resolving threads is manual, one at a time | Every applied suggestion's thread is resolved automatically after push |
| Browser-centric — context switches between editor and web | Everything stays inside VS Code |

## How it works

1. **Open the panel** via the Command Palette: `Copilot Reviewer: Open PR Copilot Reviews Panel`.
2. The extension scans your workspace's git remotes, fetches all open PRs you are assigned to (or created, configurable), and shows only those with pending Copilot review comments. Pick one from the list, or paste a URL directly.
3. The panel loads every pending Copilot comment as a numbered card. Each card shows the file path, line number, complexity tag, the reviewer's comment, and a link back to GitHub.
4. Review the cards. Uncheck any you want to skip. Optionally group by file or complexity.
5. Click **Apply Fixes**. The extension opens VS Code Copilot Chat with a structured prompt containing every selected comment. An overlay blocks the panel while you work through the fixes in Chat.
6. Once you are satisfied with the changes, dismiss the overlay. Click **Push & Mark Resolved**.
7. The extension asks for an optional commit message prefix (for ticket-number policies), then stages the changed files, commits, pushes, posts a reply on each resolved comment, and marks every thread as resolved on GitHub.

## Features

### Panel and triage

- **Smart PR picker** — automatically lists open PRs from all detected git remotes, pre-filtered to only those with open Copilot review comments, and respects your `prFilter` setting (assigned / created / both).
- **Unified card view** — every pending Copilot comment in one place: file, line, comment body, reviewer.
- **Complexity tagging** — each card is automatically classified as LOW, MED, or HIGH based on the diff hunk size and comment content (architectural signals, cross-cutting scope, async patterns, etc.).
- **Group by file or complexity** — collapse and expand groups; Collapse All / Expand All toggle.
- **Reviewer filter** — when a PR has comments from multiple reviewers, filter cards by reviewer.
- **Selective apply** — check or uncheck individual cards; select/deselect all at once.
- **Outdated comment notice** — stale (outdated-position) comments are excluded automatically and counted in a banner.
- **Closed/merged PR banner** — warns you if the PR is no longer open.
- **File-not-found warning** — flags any comment whose target file is absent from the local workspace.

### Fix workflow

- **Batch Copilot Chat prompt** — "Apply Fixes" opens Copilot Chat with all selected comments formatted as a structured, numbered list of issues, instructing the model to find and implement solutions across the workspace.
- **Overlay guard** — the panel stays blocked until you confirm fixes are done, preventing accidental double-pushes.

### Git integration

- **Stage → commit → push in one step** — after fixes are applied, a single button does everything.
- **Commit message prefix** — optional input to prepend a ticket number (e.g. `[ABC-12345]`).
- **Auto-resolve threads** — after a successful push, the extension posts a reply on every resolved comment and marks the thread as resolved via the GitHub API.
- **Build/test confirmation gate** — before pushing, the extension asks you to confirm you have built the project and run the tests.

### Authentication

- **Zero-config OAuth** — signs in via VS Code's built-in GitHub auth provider; no manual token setup.
- **PAT fallback** — if the workspace belongs to a different GitHub account, you can sign in with a browser session or paste a Personal Access Token. Stored securely in VS Code's secret storage.
- **Rate-limit handling** — surfaces clear error messages with reset times when GitHub API limits are hit.

## Requirements

- VS Code **1.90** or later.
- A GitHub account with access to the target repository.
- GitHub Copilot review comments already posted on the PR (by `copilot-pull-request-reviewer[bot]` or a configured equivalent).
- An active VS Code Language Model (GitHub Copilot Chat) to process the fix prompt.

## Extension Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `copilotReviewer.prFilter` | `string` | `"assigned"` | Which open PRs to show: `"assigned"` (PRs you are assigned to), `"created"` (PRs you authored), or `"both"`. Only PRs with open Copilot review comments are displayed regardless of this setting. |
| `copilotReviewer.additionalBotLogins` | `string[]` | `[]` | Extra GitHub login names to treat as trusted Copilot bot accounts. Exact names only — no wildcards. Useful if your organisation uses a custom bot alongside the standard `copilot-pull-request-reviewer[bot]`. |
| `copilotReviewer.preFillFromClipboard` | `boolean` | `false` | When enabled, pre-populates the PR URL input box with clipboard contents if they match a GitHub pull request URL. |

## Commands

| Command | Description |
|---|---|
| `Copilot Reviewer: Open PR Copilot Reviews Panel` | Opens the review panel and shows the PR picker. |
| `Copilot Reviewer: Clear Stored GitHub Authentication` | Removes any stored PAT and reverts to the default VS Code GitHub account. |

## Known Issues

- Applying fixes via Copilot Chat rewrites file content as the model outputs it. Always review the diff in the Source Control panel before committing.
- Very large PRs may hit language model context limits. Reduce the selection to smaller batches if this happens.
- The "Push & Mark Resolved" button resolves threads sequentially via the GitHub GraphQL API. On PRs with many comments this may take a few seconds.

## Release Notes

### 1.5.0

- Smart PR picker: automatically finds open PRs with pending Copilot reviews across all workspace remotes.
- PR filter setting (`assigned` / `created` / `both`).
- Reviewer filter row when multiple reviewers are present.
- Group by file or complexity.
- Push progress bar with per-step labels.
- Auto-resolve review threads after push.
- Commit message prefix prompt.
- Build/test confirmation gate before push.

### 1.0.0

Initial public release.
