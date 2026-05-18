# Scalability Issues — Work Plan

Issues sorted by severity (highest first). Each item includes the affected file(s), a description, and concrete steps to address it.

---

## 1. Singleton `ReviewPanel` — no concurrent PR review

**File:** `src/reviewPanel.ts`  
**Severity:** Critical

The static `ReviewPanel.currentPanel` field means only one PR can ever be open at a time. Opening a second PR silently resets all state from the first.

### Steps
1. Remove the static `currentPanel` singleton.
2. Change `showLoading` and `createOrShow` to always create a new `WebviewPanel` instance and return it.
3. Track open panels in a `Map<string, ReviewPanel>` keyed by PR URL if reuse is desired, or simply always create new panels.
4. Update `dispose()` to remove the panel from the map instead of nulling the singleton.
5. Update callers in `extension.ts` to hold the returned panel reference locally.

---

## 2. Open PRs list hard-capped at 100 with no pagination

**File:** `src/githubApi.ts`  
**Severity:** High

`fetchOpenPullRequests` fetches only the first page (`per_page=100`). Repos with >100 open PRs silently omit the rest. The GraphQL `reviewThreads(first: 100)` in `resolveReviewThread` has the same cap.

### Steps
1. Add a pagination loop to `fetchOpenPullRequests` (same pattern as `fetchCopilotComments`) that increments `page` until `items.length < 100`.
2. Increase the GraphQL `reviewThreads(first: 100)` argument or add cursor-based pagination if review thread count can exceed 100.
3. Add a reasonable max-page guard (e.g., 10 pages / 1,000 PRs) to prevent runaway loops.

---

## 3. No caching of API responses or LM work plans

**Files:** `src/githubApi.ts`, `src/workPlanGenerator.ts`  
**Severity:** High

Every `openPanel` invocation re-fetches all PR comments and re-calls the LM for every work plan. Repeat opens on the same PR waste seconds to minutes of network and LM time.

### Steps
1. Introduce an in-memory cache keyed by `{owner}/{repo}#{pullNumber}` for fetched comments, storing the result and a timestamp.
2. Introduce a similar cache in `workPlanGenerator.ts` keyed by `comment.id` (or a hash of `comment.body`) for generated work plans.
3. Add a TTL (e.g., 5 minutes for comments, session-length for work plans) and a manual "Refresh" button in the panel to bust the cache.
4. Persist work-plan cache to `ExtensionContext.workspaceState` so it survives panel closes within the same session.

---

## 4. Fix application is fully sequential

**File:** `src/extension.ts`  
**Severity:** High

Fixes are applied one at a time in a `for...await` loop. A PR with 20 comments at 10–15 s each means 3–5 minutes of sequential waiting.

> **⚠️ Preliminary investigation note:** The VS Code Language Model API (`model.sendRequest`) appears to enforce sequential execution at the API level — concurrent calls were found to queue or error rather than run in parallel. Parallelizing this loop may not be feasible without a workaround. Worth attempting again, but **set low expectations**: the bottleneck may be an intentional GitHub/VS Code LM API constraint rather than a code-level issue.

### Steps
1. Attempt to replace the sequential loop with a bounded `Promise.all` or a concurrency-limited queue (similar to `generateAllWorkPlans`) and measure whether real parallelism is achieved.
2. If the LM API still serializes calls, explore whether spawning separate requests with small delays (staggered start) improves throughput.
3. Use a concurrency limit of 3–5 simultaneous fixes to avoid saturating the LM API.
4. Ensure `onProgress` callbacks remain safe to call concurrently (they post messages to the webview, which is already async/safe).
5. Add integration tests to verify partial-failure behavior when one fix in a batch fails.

---

## 5. `generateAllWorkPlans` uses a hardcoded concurrency of 3

**File:** `src/workPlanGenerator.ts`  
**Severity:** Medium

`CONCURRENCY = 3` is unconditional. It neither adapts to rate limits nor scales up when safe to do so.

### Steps
1. Expose `CONCURRENCY` as a named constant with a comment explaining the rationale, or read it from a VS Code configuration setting (`copilotReviewer.workPlanConcurrency`).
2. Add respect for the GitHub rate-limit response headers: if a 429 is received during batch generation, reduce concurrency temporarily.
3. Consider raising the default to 5 since these are LM API calls (not GitHub REST), which have separate rate limits.

---

## 6. `fetchWithRetry` has no exponential backoff or `Retry-After` respect

**File:** `src/githubApi.ts`  
**Severity:** Medium

Only one retry with a fixed 1-second delay. Under rate limiting or transient failures, this is insufficient.

### Steps
1. Replace the single retry with a configurable retry loop (e.g., max 3 attempts).
2. Implement exponential backoff with jitter: `delay = baseDelay * 2^attempt + random(0, 200ms)`.
3. Read the `Retry-After` or `X-RateLimit-Reset` response header and wait the indicated duration before retrying on 429/403 rate-limit responses.
4. Propagate a structured error after all retries are exhausted rather than throwing immediately.

---

## 7. `detectBuildCommand` calls `fs.readdirSync` on the main extension host thread

**File:** `src/gitHelper.ts`  
**Severity:** Medium

Synchronous directory scanning of the workspace root can block the VS Code UI thread in large repositories.

### Steps
1. Replace `fs.readdirSync(rootPath)` with `fs.promises.readdir(rootPath)` and `await` it.
2. Make `detectBuildCommand` an `async` function accordingly.
3. Update `buildProject` to `await detectBuildCommand(rootPath)`.
4. Replace other synchronous `fs.existsSync` / `fs.readFileSync` calls in the same function with their async counterparts.

---

## 8. Full webview HTML regenerated as a string on every update

**File:** `src/reviewPanel.ts`  
**Severity:** Medium

`_getHtmlForWebview` rebuilds the entire HTML string including all comment cards on every `_update()` call, causing full webview reloads for any state change.

### Steps
1. Set the static HTML shell (head, toolbar, empty containers) once, and communicate all dynamic data via `postMessage` instead of re-serializing HTML.
2. Move comment card rendering entirely to `panel.js` (client side), driven by a JSON payload posted from the extension host.
3. Keep `_getHtmlForWebview` only for the initial page structure; remove it from the update path.
4. Update `panel.js` to handle a `setComments` message type that renders cards from a data array.

---

## 9. `cachedModel` has no staleness invalidation

**File:** `src/modelSelector.ts`  
**Severity:** Low

The module-level `cachedModel` is held for the entire VS Code session. If the model is uninstalled or degrades mid-session, all subsequent fixes fail with no automatic recovery.

### Steps
1. Wrap each use of `cachedModel` in a try/catch; on failure, clear the cache and retry model selection once.
2. Subscribe to a VS Code LM availability event (if available in the API) to proactively clear the cache when models change.
3. Expose a `copilotReviewer.clearModelCache` command so users can manually re-select without restarting VS Code.

---

## 10. `resolveWorkspaceFile` pre-flight loop runs sequentially

**File:** `src/extension.ts`  
**Severity:** Low

The `for (const item of annotated)` loop that checks whether each file exists in the workspace calls `resolveWorkspaceFile` one at a time, even though the calls are fully independent.

### Steps
1. Replace the sequential loop with `await Promise.all(annotated.map(async (item) => { item.fileFound = (await resolveWorkspaceFile(item.comment.path)) !== undefined; }))`.
2. Verify that `vscode.workspace.findFiles` is safe to call concurrently (it is — it returns independent promises).
3. Add a unit test asserting that all items are checked even when some files are missing.
