# Copilot Reviewer Assistant

> **GitHub Copilot review suggestions don't always come with an "Apply" button. This extension makes sure every single one can be applied automatically.**

## The Problem

When you add GitHub Copilot as a reviewer on a pull request, it does a great job analysing your code and leaving detailed suggestions. For some of them, GitHub provides an **Apply suggestion** button directly in the web UI — convenient, but inconsistent. For many others, no such button appears: you are left reading the comment and making the change by hand.

This is the gap the extension was built to close.

**Copilot Reviewer Assistant** fetches every pending Copilot review comment from your PR and applies all the suggested fixes automatically to your local workspace — including the ones GitHub's UI could not handle. No copy-pasting, no hunting through files, no manual edits. If you want automated code review, you should be able to see it through from start to finish.

If you have ever stared at a batch of Copilot suggestions with no Apply button and thought *"I just want these done"*, this extension is for you.

## Additional Benefits

Beyond the core "apply Copilot suggestions" workflow, the extension gives you a richer review experience than the GitHub web UI:

- **AI-generated work plan per suggestion** — before touching any file, the extension generates a plain-English description of exactly what change will be made and why, so you always know what you are approving.
- **Complexity indicator** — each review card is tagged with an estimated complexity (trivial / moderate / complex) so you can triage at a glance.
- **Grouped by file** — suggestions are organised by the file they affect. You can choose to handle all suggestions for a single file at a time, rather than processing the entire PR in one go.
- **Selective apply** — uncheck any suggestion you want to skip. Apply one, some, or all — your choice.
- **Live progress feedback** — each card shows a real-time status (pending → applying → done / failed) so you always know where things stand.
- **Git integration** — a single **Stage, Commit & Push** button stages the changed files and creates a commit with an auto-generated message summarising everything that was applied.
- **Themed UI** — the panel respects VS Code's theme system and looks correct in dark, light, and high-contrast modes.

## Features

- **Paste a PR URL** — enter any GitHub pull request URL (public or private repository).
- **Automatic authentication** — signs in transparently via VS Code's built-in GitHub auth provider; no manual token setup required.
- **Fetches Copilot's comments** — retrieves all review comments left by `copilot-pull-request-reviewer[bot]` via the GitHub REST API, with full pagination support.
- **Outdated comment filtering** — stale or resolved comments are excluded automatically (shown as a count notice).
- **Per-item retry** — if the language model quota is exceeded mid-run, individual cards can be retried without restarting.
- **Robust pre-flight checks** — files absent from the local workspace are flagged before anything is applied; closed/merged PRs display a warning banner.

## Usage

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run **Copilot Reviewer: Open PR Copilot Reviews Panel**.
3. Paste the GitHub PR URL when prompted. The URL is pre-populated from the clipboard if it matches the expected pattern.
4. Sign in to GitHub if prompted.
5. Review the generated work plans and complexity tags — uncheck anything you want to skip.
6. Optionally switch to per-file view to focus on one file at a time.
7. Click **Apply Selected Fixes**.
8. Click **Stage, Commit & Push** once you are satisfied with the applied changes.

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

### 0.1.0

Initial release — full pipeline from PR URL input through Copilot comment fetch, AI work plan generation, Webview checklist, fix application, and Git commit.
