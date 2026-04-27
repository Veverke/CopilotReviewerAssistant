# Phase 9 — Error Handling & Edge Cases

## Atomic Tasks

### 9.1 — Handle zero Copilot comments (empty state)
In `reviewPanel.ts`, if `comments` is an empty array, render an empty-state page instead of the checklist:

```html
<p class="empty-state">No pending Copilot review recommendations found for this PR.</p>
```

Do not show the Apply button.

### 9.2 — Handle resolved / outdated comments
GitHub marks comments as outdated when the underlying code has changed since the comment was left. Filter out comments where `subject_type` is `line` and `position` is `null` (outdated). Show a notice in the Webview if any were skipped: "N outdated comment(s) were excluded."

### 9.3 — Handle file not in local workspace (pre-flight check)
Before showing the Webview, run a pre-flight check: for each comment, attempt `resolveWorkspaceFile()`. Flag comments whose file cannot be found and show a warning badge on the card. Still include them in the list but pre-uncheck them.

### 9.4 — Handle GitHub API network failure with one retry
In `githubApi.ts`, wrap the fetch in a retry: if the first call throws a network error, wait 1 second and try once more. If the second attempt also fails, throw with a clear message.

### 9.5 — Handle LM quota exceeded with per-item retry button
In the Webview, for cards whose work plan generation or fix application failed due to quota, show a "Retry" button. Clicking it posts `{ command: 'retryFix', id }` to re-attempt that single item.

### 9.6 — Handle closed / merged PR
GitHub still returns review comments for closed and merged PRs. Do not block on this — but show a banner in the Webview: "Note: this PR is {state}. Fixes will still be applied locally."

### 9.7 — Handle token expiry mid-session
If a GitHub API call returns 401 after the session was already established, clear the cached token and call `getGitHubToken()` again once. If it fails again, show an error and abort.

### 9.8 — Validate that the LM response is non-empty before writing
Before calling `vscode.workspace.fs.writeFile`, verify the LM response string is non-empty and does not consist solely of whitespace. If it is empty, fail the item with `reason: 'Language model returned empty content'` rather than writing a blank file.

### 9.9 — Add timeout to LM calls
Wrap each LM API call in a `Promise.race` with a 30-second timeout. If it expires, fail the item gracefully rather than hanging indefinitely.

### 9.10 — Mark Phase 9 complete in work-plan.md
Change `## Phase 9 — Error Handling & Edge Cases \`[ ]\`` to `## Phase 9 — Error Handling & Edge Cases \`[x]\`` in `work-plan.md`.

---

## Deliverables

- Empty-state Webview for PRs with no Copilot comments
- Outdated comments excluded with a count notice
- Files absent from workspace pre-flagged and pre-unchecked
- GitHub API network errors retried once before surfacing
- Per-item LM retry button in the Webview
- Closed/merged PR banner displayed without blocking
- LM empty response detected and reported as a failure
- LM calls time out after 30 seconds
- `work-plan.md` Phase 9 marked `[x]`

---

## Manual Testing at This Point

| What to test | How |
|---|---|
| No Copilot comments | Use a PR with no Copilot reviews — empty-state message appears |
| File missing from workspace | Delete a file locally, open panel — card is pre-unchecked with a warning badge |
| Network failure retry | Block network for 1 second during API call — verify one retry attempt in the Debug Console |
| Closed PR | Use the example PR if already merged — banner shown, fixes still apply |
| Empty LM response | Mock an empty LM response — card shows "Language model returned empty content" failure |
| LM timeout | Mock a 31-second LM delay — card fails with timeout message after 30 seconds |
| Retry button | Trigger a quota error on one card — Retry button appears; click it — fix re-attempted |
