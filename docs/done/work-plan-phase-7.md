# Phase 7 — Fix Application

## Atomic Tasks

### 7.1 — Create `src/fixApplier.ts` module
Dedicated module responsible for reading workspace files, calling the LM API to produce corrected content, and writing results back. No UI rendering here; progress is communicated via a callback.

### 7.2 — Implement `resolveWorkspaceFile()` helper
Given a repo-relative `path` from the comment, locate the file in the open VS Code workspace:

```typescript
async function resolveWorkspaceFile(repoPath: string): Promise<vscode.Uri | undefined>
```

Use `vscode.workspace.findFiles` with the path as a glob. Return `undefined` if not found.

### 7.3 — Implement `readFileContent()` helper
Read the full text of a workspace file via `vscode.workspace.fs.readFile` and decode it to a UTF-8 string.

### 7.4 — Define the fix prompt template
The prompt must be unambiguous about returning only corrected file content:

```
You are a code fix assistant. Apply the following code review recommendation to the file.

File: {path}
Target line: {line}

Reviewer recommendation:
{body}

Diff hunk (context around the target line):
{diffHunk}

Current file content:
{fileContent}

Return the complete corrected file content only. Do not add explanations, markdown code fences, or any text outside the file content.
```

### 7.5 — Implement `applyFix()` function
For a single `AnnotatedComment`:
1. Resolve and read the workspace file
2. Send the fix prompt to the LM API
3. Collect the streamed response into a complete string
4. Write the result back with `vscode.workspace.fs.writeFile`

```typescript
export async function applyFix(
  comment: AnnotatedComment,
  onProgress: (status: FixStatus) => void
): Promise<void>
```

### 7.6 — Define `FixStatus` type
Used to report back to the Webview per comment:

```typescript
export type FixStatus =
  | { id: number; state: 'applying' }
  | { id: number; state: 'done' }
  | { id: number; state: 'failed'; reason: string };
```

### 7.7 — Apply fixes sequentially
Apply selected fixes one at a time (not in parallel) to avoid concurrent writes to the same file in case two comments target the same file.

### 7.8 — Send progress updates to the Webview
After each fix attempt, call `webview.postMessage({ command: 'fixStatus', status })` so the card updates to "Applying…", "Done", or "Failed: <reason>" in real time.

### 7.9 — Handle file not found in workspace
If `resolveWorkspaceFile` returns `undefined`, call `onProgress` with `state: 'failed'` and `reason: 'File not found in workspace'`. Continue with remaining fixes.

### 7.10 — Handle LM API errors per fix
Catch per-item LM errors; call `onProgress` with `state: 'failed'` and the error message. Do not abort remaining fixes.

### 7.11 — Handle `fixStatus` message in `reviewPanel.ts`
Receive `fixStatus` from the extension host and update the card's visual state (spinner → tick / cross with reason text) in `panel.js`.

### 7.12 — Mark Phase 7 complete in work-plan.md
Change `## Phase 7 — Fix Application \`[ ]\`` to `## Phase 7 — Fix Application \`[x]\`` in `work-plan.md`.

---

## Deliverables

- `src/fixApplier.ts` exporting `applyFix()` and `FixStatus`
- Each selected fix applied to the correct workspace file
- Real-time per-card status updates visible in the Webview
- Failures are isolated — one failed fix does not stop the others
- File-not-found cases surfaced per card without crashing
- `work-plan.md` Phase 7 marked `[x]`

---

## Manual Testing at This Point

| What to test | How |
|---|---|
| Fix applied to file | Select one comment, click Apply — open the target file in the editor and verify the change |
| Card updates to "Done" | After fix, the card in the Webview shows a success indicator |
| File not in workspace | Remove a file from the workspace, apply its fix — card shows "Failed: File not found in workspace" |
| Other fixes continue after failure | Have one bad file and two good ones — the two good fixes still apply |
| Multiple fixes sequential | Select 3 comments — they apply one after another (visible via the spinner moving card to card) |
| LM produces clean output | Open the modified file — no markdown fences or extra text prepended/appended |
