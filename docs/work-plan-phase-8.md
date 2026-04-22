# Phase 8 — Git Integration (Optional)

## Atomic Tasks

### 8.1 — Create `src/gitHelper.ts` module
Dedicated module for all VS Code Git extension API interactions. No UI rendering, no fix application here.

### 8.2 — Acquire the Git extension API
Use the VS Code extension API to get the built-in Git extension's exported API:

```typescript
const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
const git = gitExtension?.exports.getAPI(1);
```

Return `undefined` if unavailable.

### 8.3 — Implement `getActiveRepository()` helper
From the Git API, find the repository whose `rootUri` matches the current workspace folder. Return `undefined` if none.

### 8.4 — Implement `stageFiles()` function
Accept a list of repo-relative file paths and stage them:

```typescript
export async function stageFiles(paths: string[]): Promise<void>
```

Resolve each path to an absolute `vscode.Uri` and call `repository.add([uri])`.

### 8.5 — Implement `commitChanges()` function
Generate a commit message summarising the applied fixes, then commit:

```typescript
export async function commitChanges(
  filePaths: string[],
  commentCount: number
): Promise<void>
```

Generated message format: `"fix: apply {N} Copilot PR review recommendation(s)\n\nAffected files:\n- {path}\n..."`.

### 8.6 — Add "Stage, Commit & Push" button to the Webview
Show the button in `panel.js` only after at least one fix has succeeded (state `done`). On click, post `{ command: 'stageCommitAndPush' }`.

### 8.7 — Handle `stageCommitAndPush` message in `reviewPanel.ts`
Collect the file paths of all successfully fixed comments and call `stageFiles()`, `commitChanges()`, then `repository.push()` from `gitHelper.ts` in sequence.

### 8.8 — Handle Git extension unavailability
If `getActiveRepository()` returns `undefined`, post a Webview message to show a notice: "Git repository not found. Please stage and commit manually." Hide the Stage & Commit button.

### 8.9 — Notify the user on successful commit and push
After a successful commit and push, post a Webview message to update the button label to "Pushed ✓" and show a `vscode.window.showInformationMessage` toast.

### 8.10 — Push committed changes to the remote branch
After `commitChanges()` succeeds, push the current branch to its remote tracking branch using the Git extension API:

```typescript
await repository.push();
```

If push fails (e.g. no upstream configured, authentication error), post a Webview message to display a notice: "Commit created locally but push failed: <reason>. Please push manually." Still proceed to attempt resolving comments.

### 8.11 — Post a resolution reply to each fixed GitHub PR review comment
After a successful push, for each comment whose fix succeeded call the GitHub REST API to post a reply comment.

The reply body must follow this exact template, where **"Files changed" lists every file that was modified when applying that specific comment's fix** (a single fix may touch more than one file; list all of them with their changed line ranges):

```
Fixed by [Copilot Reviewer Assistant VS Code Extension](https://marketplace.visualstudio.com/items?itemName=Veverke.CopilotReviewerAssistant).
Files changed:
  - File: <path1> Lines: [<startLine1>-<endLine1>]
  - File: <path2> Lines: [<startLine2>-<endLine2>]
```

- `applyFix()` (task 7.5) must return — or communicate via `onProgress` — the list of files it wrote and the line range affected in each, so 8.11 can populate the template accurately.
- `startLine`/`endLine` for each entry should reflect the actual changed lines; fall back to the comment's `line` number for both when a precise range is unavailable.
- The extension name "Copilot Reviewer Assistant VS Code Extension" must be rendered as a Markdown hyperlink pointing to `https://marketplace.visualstudio.com/items?itemName=Veverke.CopilotReviewerAssistant`.

Endpoint:
```
POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies
Body: { "body": "<message>" }
```

Collect the `id` of the created reply — it is needed for thread resolution in 8.12.

### 8.12 — Resolve the review thread via GitHub GraphQL API
The GitHub REST API does not expose a thread-resolve endpoint; use the GraphQL API instead.

For each fixed comment, first retrieve its `pullRequestReviewThread.id` by querying:
```graphql
{
  repository(owner: "...", name: "...") {
    pullRequest(number: ...) {
      reviewThreads(first: 100) {
        nodes { id, comments(first: 1) { nodes { databaseId } } }
      }
    }
  }
}
```
Match the thread whose first comment's `databaseId` equals the `ReviewComment.id`. Then call:
```graphql
mutation { resolveReviewThread(input: { threadId: "<threadId>" }) { thread { isResolved } } }
```

Endpoint: `POST https://api.github.com/graphql` with `Authorization: Bearer <token>`.

If the thread cannot be resolved (e.g. already resolved, insufficient permissions), log a warning but do not fail the overall flow.

### 8.13 — Mark Phase 8 complete in work-plan.md
Change `## Phase 8 — Git Integration (Optional) \`[ ]\`` to `## Phase 8 — Git Integration (Optional) \`[x]\`` in `work-plan.md`.

---

## Deliverables

- `src/gitHelper.ts` exporting `stageFiles()` and `commitChanges()`
- "Stage, Commit & Push" button appears in Webview after at least one successful fix — clicking it stages, commits, and pushes in one action
- Button is hidden / replaced with a notice when no Git repo is detected
- Commit message lists affected files and the number of applied recommendations
- Changes pushed to the remote PR branch immediately after commit; graceful degradation if push fails
- Resolution reply posted on GitHub for each successfully fixed comment, using the defined template with a clickable marketplace link and the list of changed files/lines
- Review thread resolved via GitHub GraphQL API for each fixed comment; warnings logged if resolution fails
- `work-plan.md` Phase 8 marked `[x]`

---

## Manual Testing at This Point

| What to test | How |
|---|---|
| Stage, Commit & Push button appears | Apply at least one fix successfully — button becomes visible |
| Files staged, committed, pushed | Click Stage, Commit & Push — open Source Control panel and confirm commit in `git log`; verify branch is updated on GitHub |
| No Git repo | Open a folder with no `.git` — button is hidden and notice appears |
| Button state after push | After push, button shows "Pushed ✓" and is no longer clickable |
| Push fails gracefully | Remove upstream config — notice appears, flow continues to resolution step |
| Reply comment posted | After push, open the PR on GitHub — each fixed comment thread has a new reply with the correct template and a clickable marketplace link |
| Thread resolved | After the reply is posted, confirm the review thread shows as "Resolved" on GitHub |
| Resolution skipped gracefully | Use a token without `write:discussion` scope — warning logged, no crash |
