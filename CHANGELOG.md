# Change Log

All notable changes to the "Copilot Reviewer Assistant" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.0.0] — 2026-04-30

### Added

- Initial public release.
- Fetches all pending Copilot review comments (both *Commit Suggestion* and *Fix with Copilot*) from a GitHub PR via the REST API.
- Generates an AI work plan per suggestion before applying any changes.
- Webview panel with per-suggestion checklist, complexity tagging, and sort/group controls.
- Applies fixes directly to the local workspace using the VS Code Language Model API.
- Git integration: stage, commit, and push with an auto-generated commit message.
- Automatic GitHub authentication via VS Code's built-in auth provider.
- Outdated/resolved comment filtering and closed/merged PR warning banner.
- Per-item retry on LM quota exhaustion.
- `copilotReviewer.additionalBotLogins` setting for custom bot accounts.
- `copilotReviewer.preFillFromClipboard` setting to pre-fill the PR URL from clipboard.