# Copilot Reviewer Assistant

A VS Code extension that fetches pending Copilot PR review recommendations and lets you review, select, and apply them to your local workspace — all without leaving the editor.

## The Problem

When GitHub Copilot is added as a PR reviewer, it leaves code recommendations as review comments. The "Fix with Copilot" button in the GitHub UI is unreliable — it frequently adds another comment instead of producing a committable change. There is no native way to bulk-review and apply Copilot's pending recommendations with per-item control.

## Features

- **Paste a PR URL** — enter any GitHub pull request URL (public or private repository).
- **Automatic authentication** — signs in transparently via VS Code's built-in GitHub auth provider; no manual token setup required.
- **Fetches Copilot's comments** — retrieves all review comments left by `copilot-pull-request-reviewer[bot]` via the GitHub REST API, with full pagination support.
- **AI-generated work plans** — for each recommendation, calls the VS Code Language Model API to produce a concise description of what change needs to be made and why, shown before any file is touched.
- **Interactive checklist panel** — a Webview panel lists all recommendations as cards (all selected by default), each showing:
  - Affected file path and line number
  - Copilot's recommendation body (collapsible)
  - The AI-generated work plan
  - Live status indicator (pending → applying → done / failed)
- **Selective apply** — uncheck any items you want to skip, then click **Apply Selected Fixes**. Each fix is written to your local workspace file using the Language Model API.
- **Git integration** — after fixes are applied, a **Stage, Commit & Push** button stages the changed files and creates a commit with a generated message summarising the applied recommendations.
- **Robust error handling** — outdated comments are excluded (with a count notice), files absent from the workspace are pre-flagged, closed/merged PRs show a banner, and per-item retry is available when LM quota is exceeded.
- **Themed UI** — the panel uses VS Code's CSS variable system and looks correct in every theme (dark, light, high contrast).

## Usage

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run **Copilot Reviewer: Open PR Fix Panel**.
3. Paste a GitHub PR URL when prompted (e.g. `https://github.com/owner/repo/pull/42`). The URL is pre-populated from the clipboard if it matches the expected pattern.
4. Sign in to GitHub if prompted.
5. Review the checklist — uncheck any recommendations you want to skip.
6. Click **Apply Selected Fixes**.
7. Optionally click **Stage, Commit & Push** once fixes are applied.

## Requirements

- VS Code **1.90** or later.
- A GitHub account with access to the target repository.
- GitHub Copilot enabled on the repository (so that `copilot-pull-request-reviewer[bot]` has left review comments).
- An active VS Code Language Model (e.g. GitHub Copilot Chat) for work plan generation and fix application.

## Extension Settings

This extension does not contribute any user-configurable settings.

## Known Issues

- Applying a fix rewrites the entire file content as returned by the language model. Review the diff in the Source Control panel before committing.
- Very large files may hit LM context limits; the affected card will show a failure state with a Retry option.

## Release Notes

### 1.0.0

Initial release — full pipeline from PR URL input through Copilot comment fetch, AI work plan generation, Webview checklist, fix application, and Git commit.


## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
