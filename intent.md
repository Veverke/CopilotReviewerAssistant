# Copilot Reviewer Assistant — Intent

## Problem

When Copilot is added as a GitHub PR reviewer, it leaves code recommendations as review comments. The "Fix with Copilot" button in the GitHub UI is unreliable — it frequently adds another comment instead of producing a committable code change. There is no native way to bulk-review and apply Copilot's pending recommendations with per-item control.

## Goal

A VS Code extension that:

1. Accepts a GitHub PR URL as input.
2. Fetches all pending review comments left by `copilot-pull-request-reviewer[bot]` via the GitHub REST API.
3. Displays a **Webview Panel** (embedded browser panel inside VS Code, using HTML/CSS/JS) as a checklist — all items selected by default — showing for each recommendation:
   - The affected file and line(s)
   - A summary / work plan of what the fix entails
4. Waits for the user to confirm (unchecking any items they want to skip).
5. Applies each selected fix to the local workspace files using the VS Code Language Model API.
6. Optionally stages / commits the changes via the VS Code Git extension API.

### Supported repositories

Both public and private repositories are supported. Authentication is handled transparently via VS Code's built-in GitHub authentication provider — no manual token setup required from the user.

### Example PR used for development / testing

`https://github.com/Veverke/ThemeStudioApp/pull/3`

---

## Alternatives Considered

### 1. GitHub MCP Server + Copilot Chat

Configure the [official GitHub MCP server](https://github.com/github/github-mcp-server) and ask Copilot Chat directly:

> "Fetch all open Copilot review comments from [PR URL] and fix them."

**Limitations compared to this extension:**
- No structured checklist UI — no per-recommendation accept/reject
- No pre-computed work plan shown before changes are made
- No diff preview per recommendation before committing
- Requires MCP server setup by the user

### 2. Copilot Coding Agent

Assign the PR to the GitHub Copilot agent (via `@copilot` mention or as an Assignee). It opens its own branch and pushes fixes autonomously.

**Limitations:**
- No local control over which fixes are applied
- You review a new PR instead of editing locally
- Not universally available across all GitHub plans

### 3. `gh` CLI + Copilot Chat (manual)

Use `gh api /repos/.../pulls/.../comments` to retrieve comments and paste them into a Chat prompt manually.

**Limitations:**
- Fully manual and repetitive
- No UI, no structured workflow
- Does not scale across multiple recommendations

---

## Why This Extension Still Has Value

Even if the GitHub MCP server is available, this extension provides a **structured review-before-apply UX** that none of the alternatives offer:

- Checklist with per-item accept/reject before any file is touched
- Work plan visible upfront for each recommendation
- Changes applied locally with full diff visibility
- Operates entirely within VS Code without switching context to the browser
