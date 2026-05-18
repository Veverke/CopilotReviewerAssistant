# Copilot Reviewer Assistant — User Guide

## What It Does

GitHub Copilot's PR reviews produce two kinds of suggestions:

- **Commit Suggestion** — The proposed code change is shown inline in the PR comment. GitHub provides a one-click *Apply* button that commits it directly.
- **Fix with Copilot** — Copilot has a suggested fix but does not show it inline. Instead, a *Fix with Copilot* button opens an interactive Copilot session where you work through the fix manually, one suggestion at a time.

Both types still require manual action in the GitHub UI — either clicking *Apply* without seeing the full reasoning, or navigating an interactive session per suggestion.

This extension replaces that entire workflow. It fetches every pending Copilot review comment, delegates each fix to your local VS Code AI model, and applies the changes directly to your workspace — no browser, no per-suggestion interaction, no human in the loop. Because the fixes happen inside the IDE, the AI model's full reasoning is visible for every change: you can see exactly what was done and why before anything is committed. When you are done, a single button stages, commits, and pushes everything.

---

## Requirements

- VS Code **1.90** or later
- A GitHub account with access to the target repository
- GitHub Copilot enabled on the repository (so `copilot-pull-request-reviewer[bot]` has left review comments)
- An active VS Code Language Model (e.g. GitHub Copilot Chat)

---

## Opening the Panel

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run **Copilot Reviewer: Open PR Copilot Reviews Panel**.

> **Tip:** If `copilotReviewer.preFillFromClipboard` is enabled, copy the PR URL first — the input box will be pre-populated automatically.

---

## Authentication

The extension signs in automatically via VS Code's built-in GitHub auth provider. No manual token setup is needed in most cases.

**If access fails** (e.g. the PR belongs to a different GitHub account), a dialog appears with two options:

| Option | When to use |
|---|---|
| **Sign in with Browser** | You need to authenticate as a different GitHub account. You will be asked to choose a browser (Edge, Chrome, Firefox, or system default). |
| **Enter PAT** | You prefer a Personal Access Token. Paste a token with `repo` scope — it is stored securely in VS Code's secret storage. |

**To clear stored credentials** (revert to the default VS Code GitHub account):

Open the Command Palette and run **Copilot Reviewer: Clear Stored GitHub Authentication**.

---

## Selecting a Pull Request

After authentication, the extension fetches all open PRs in the workspace's GitHub repository that have pending Copilot review comments and match the configured PR filter.

**Example — PR picker with multiple PRs:**
```
#42 — Refactor authentication middleware
#38 — Fix null-pointer in payment processor
```

Select a PR from the list. If no open PRs are found automatically, an input box appears for you to paste any PR URL:

```
https://github.com/my-org/my-repo/pull/42
```

> **Branch mismatch:** If the PR's head branch does not match your checked-out branch, a warning notification appears. You can still proceed.

---

## The Review Panel

Once the PR loads, each Copilot review comment appears as a card.

### Card anatomy

```
☑  src/auth/middleware.ts  line 87  [MED]  [HIGH]   View on GitHub ↗
   ▼ Reviewer comment
     "Potential null dereference when `user` is undefined."
   ▼ Work plan
     "Add a null-check guard before accessing user.id on line 87.
      Return a 401 response if user is undefined."
   [Retry]  [pending]
```

| Element | Meaning |
|---|---|
| Checkbox | Checked = will be included when you click **Apply Selected Fixes** |
| File badge | The file the comment targets |
| `line N` | The line number within that file |
| `[LOW]` / `[MED]` / `[HIGH]` | Estimated fix complexity |
| `[CRIT]` / `[HIGH]` / `[MED]` / `[LOW]` | Copilot-assigned severity — only shown when the review comment includes a severity rating |
| **File not found locally** badge | The file is missing from the local workspace and will be skipped |
| **⚠ Scope check** badge | The fix may affect lines outside the commented range |
| Status chip | `pending` → `applying` → `done` or `failed` |

### Panel header

The header shows the total number of pending suggestions so you know the scope upfront.

---

## Grouping and Filtering

The toolbar above the cards provides several ways to organise the list:

| Control | Options |
|---|---|
| **Group by** | None, File, Complexity, Severity |
| **Filter by reviewer** | Shown when multiple bots have left comments; toggle each reviewer independently |

> **Note on Severity grouping:** the severity chip (and therefore Severity grouping) only appears when Copilot includes a severity rating in the comment body. If the PR's comments do not contain one, all cards fall into an *Unknown* group.

**Example — focus on low-complexity items first:**
1. Click **Group by → Complexity** to split cards into High / Medium / Low sections.
2. Uncheck the High cards to skip them for now.
3. Apply the remaining fixes first.

---

## Applying Fixes

1. Uncheck any suggestions you want to skip.
2. Click **Apply Selected Fixes**.

The extension generates a work plan for each selected comment and applies the change to the local file. Each card shows live progress: `pending → applying → done / failed`.

> **After applying:** inspect the diff in VS Code's Source Control panel before committing. The extension rewrites the entire file as returned by the language model.

**If a card fails** (e.g. LM quota exceeded), a **Retry** button appears on that card. Other cards are unaffected.

---

## Stage, Commit & Push

Once you are satisfied with the applied changes:

1. Click **Stage, Commit & Push**.
2. Optionally enter a commit message prefix (e.g. `[abc-12345]`) if your repository enforces a policy. Leave blank to skip.
3. The extension stages the changed files, creates a commit with an auto-generated summary, and pushes to the remote branch.

After a successful push, each resolved review thread receives an automated reply and is marked as resolved on GitHub.

**Example commit message (auto-generated):**
```
fix: apply 3 Copilot review suggestions

[src/auth/middleware.ts:87] Potential null dereference when `user` is undefined.
[src/payment/processor.ts:124] Missing error handling for failed charge.
[src/utils/logger.ts:45] Unused import increases bundle size.
```

---

## Settings

Open **Settings** (`Ctrl+,`) and search for `copilotReviewer`.

| Setting | Type | Default | Description |
|---|---|---|---|
| `copilotReviewer.additionalBotLogins` | `string[]` | `[]` | Extra GitHub login names to treat as Copilot bot accounts. Useful for custom org bots that leave review comments alongside the standard bot. Exact names only — no wildcards. **Example:** `["my-org-bot"]` |
| `copilotReviewer.preFillFromClipboard` | `boolean` | `false` | Pre-populate the PR URL input box from the clipboard when a GitHub PR URL is detected. |
| `copilotReviewer.prFilter` | `"both"` / `"created"` / `"assigned"` | `"assigned"` | Controls which open PRs appear in the picker. `"both"` shows PRs you authored or are assigned to; `"created"` shows only your authored PRs; `"assigned"` shows only assigned PRs. |

---

## Typical Workflow

```
1. Open Command Palette → Copilot Reviewer: Open PR Copilot Reviews Panel
2. Select PR from the list  (or paste URL if no PR is detected automatically)
3. Review the work plans — uncheck anything you want to skip
4. [Optional] Group by Complexity; uncheck High items to tackle LOW items first
5. Click  Apply Selected Fixes
6. Inspect diffs in Source Control
7. Click  Stage, Commit & Push  → enter prefix if needed → done
```

---

## Troubleshooting

| Symptom | Resolution |
|---|---|
| No PRs appear in the picker | Ensure the workspace is a git repo with a GitHub remote named `origin`, and that at least one open PR has Copilot review comments. Check the PR filter setting. |
| "Repository not found / Access denied" | The PR belongs to a different account. Use **Sign in with Browser** or **Enter PAT** when prompted. |
| Card shows "File not found locally" | Check out the correct branch, or the file may have been renamed/moved. |
| Fix looks wrong after applying | Review the diff in Source Control. Retry the card or fix manually — the extension does not overwrite your manual edits until you click Apply again. |
| Push failed after commit | The commit is already local. Run `git push` manually, or check the Output panel (`Copilot Reviewer Assistant`) for details. |
| LM quota exceeded | Individual cards show a **Retry** button. Wait for quota to reset, then retry. |
