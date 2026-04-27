# Phase 4 — GitHub API Integration

## Atomic Tasks

### 4.1 — Create `src/githubApi.ts` module
Dedicated module for all GitHub REST API communication. Accepts a token and PR coordinates; returns typed data. No UI, no LM calls here.

### 4.2 — Define the `ReviewComment` interface
Internal typed representation of a Copilot review comment:

```typescript
export interface ReviewComment {
  id: number;
  path: string;             // file path relative to repo root
  line: number;             // line number in the file (or original_line)
  body: string;             // recommendation text
  diffHunk: string;         // surrounding code context from the PR
  htmlUrl: string;          // link back to the comment on GitHub
}
```

### 4.3 — Implement `fetchCopilotComments()` function
Call `GET /repos/{owner}/{repo}/pulls/{pullNumber}/comments` with the Bearer token. Map the response to `ReviewComment[]`, filtering to only those where `user.login === 'copilot-pull-request-reviewer[bot]'`.

```typescript
export async function fetchCopilotComments(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<ReviewComment[]>
```

### 4.4 — Implement pagination
GitHub returns at most 100 results per page. Loop with `?per_page=100&page=N` until the response contains fewer than 100 items.

### 4.5 — Map API fields to `ReviewComment`
Use `comment.line ?? comment.original_line ?? 0` for the line number (the `line` field is `null` for comments on the last line of a deleted hunk).

### 4.6 — Handle HTTP 404 (PR or repo not found)
Throw a descriptive error: `"PR not found: check the URL and that you have access to the repository."`.

### 4.7 — Handle HTTP 403 (insufficient scope / private repo)
Throw: `"Access denied. Ensure your GitHub account has access to this repository."`.

### 4.8 — Handle HTTP 401 (token expired or invalid)
Throw: `"GitHub authentication failed. Please sign in again."` — the command handler should re-trigger `getGitHubToken()` on this error.

### 4.9 — Handle rate limiting (HTTP 429 / `X-RateLimit-Remaining: 0`)
Inspect the `X-RateLimit-Reset` response header and throw with a human-readable message: `"GitHub rate limit reached. Resets at HH:MM."`.

### 4.10 — Handle network failures
Wrap the `fetch` call in a try/catch; rethrow with `"Network error while contacting GitHub: <original message>"`.

### 4.11 — Mark Phase 4 complete in work-plan.md
Change `## Phase 4 — GitHub API Integration \`[ ]\`` to `## Phase 4 — GitHub API Integration \`[x]\`` in `work-plan.md`.

---

## Deliverables

- `src/githubApi.ts` exporting `fetchCopilotComments()` and the `ReviewComment` interface
- Pagination handled transparently — all comments returned regardless of count
- All HTTP error codes produce typed, human-readable thrown errors
- No raw token is logged
- `work-plan.md` Phase 4 marked `[x]`

---

## Manual Testing at This Point

| What to test | How |
|---|---|
| Copilot comments fetched | Invoke command with `https://github.com/Veverke/ThemeStudioApp/pull/3` — count of fetched comments logged to Debug Console |
| Non-Copilot comments excluded | Confirm only `copilot-pull-request-reviewer[bot]` comments appear in the log |
| Invalid PR URL (404) | Use a non-existent PR number — "PR not found" error notification |
| Private repo without auth | Use a private repo URL without signing in — "Access denied" error |
| Comment fields populated | Log first comment to Debug Console — `path`, `line`, `body`, `diffHunk` all present and non-empty |
