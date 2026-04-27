# Phase 5 — Work Plan Generation

## Atomic Tasks

### 5.1 — Create `src/workPlanGenerator.ts` module
Dedicated module for LM API interaction. Accepts a `ReviewComment` and returns a plain-text work plan string. No GitHub API calls, no UI here.

### 5.2 — Select an available LM model
Use `vscode.lm.selectChatModels` to pick the best available model:

```typescript
const [model] = await vscode.lm.selectChatModels({
  vendor: 'copilot',
  family: 'gpt-4o',
});
```

Fall back to any available model if `gpt-4o` is unavailable.

### 5.3 — Define the work plan prompt template
The prompt must include all context needed for the model to understand the change without access to the full file:

```
You are a code review assistant.
A reviewer left the following comment on a pull request:

File: {path} (line {line})
Diff hunk (surrounding context):
{diffHunk}

Reviewer comment:
{body}

Write a concise, one-paragraph work plan describing exactly what code change should be made and why.
Do not write any code. Do not repeat the comment verbatim. Be specific about what to change.
```

### 5.4 — Implement `generateWorkPlan()` function
Send the prompt to the selected model and collect the streamed response into a single string:

```typescript
export async function generateWorkPlan(
  comment: ReviewComment
): Promise<string>
```

### 5.5 — Handle LM API unavailability
If `selectChatModels` returns an empty array, return a fallback string: `"No language model available. Work plan could not be generated."` — do not throw; the extension should still display the comment without a plan.

### 5.6 — Handle LM quota / access errors
Catch errors thrown by the LM API (error code `NoPermissions`, `Blocked`, etc.) and return a fallback string: `"Work plan unavailable: <error message>"`.

### 5.7 — Process all comments in parallel with concurrency cap
Generate work plans for all fetched comments concurrently, but cap at 3 concurrent LM calls to avoid quota exhaustion:

```typescript
// Process in batches of 3
```

### 5.8 — Attach generated plan to comment data
Extend the internal data model to carry the work plan alongside the original `ReviewComment` fields (use a wrapper type `AnnotatedComment` with `comment: ReviewComment` and `workPlan: string`).

### 5.9 — Mark Phase 5 complete in work-plan.md
Change `## Phase 5 — Work Plan Generation \`[ ]\`` to `## Phase 5 — Work Plan Generation \`[x]\`` in `work-plan.md`.

---

## Deliverables

- `src/workPlanGenerator.ts` exporting `generateWorkPlan()` and the `AnnotatedComment` type
- Work plans generated for all fetched Copilot comments before the Webview is shown
- Graceful degradation when LM is unavailable — extension continues with fallback text
- No more than 3 concurrent LM calls at any time
- `work-plan.md` Phase 5 marked `[x]`

---

## Manual Testing at This Point

| What to test | How |
|---|---|
| Work plan generated | Invoke command with the example PR — all `AnnotatedComment` objects in Debug Console have a non-empty `workPlan` |
| Plan is coherent | Read a generated plan in the log — it should describe the fix in plain English, not repeat the comment verbatim |
| LM unavailable gracefully handled | Temporarily set an invalid model family — fallback text appears instead of error |
| All comments processed | Comment count before and after work plan generation must match |
