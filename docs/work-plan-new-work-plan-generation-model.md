# Work Plan: New Work Plan Generation Model (Tool-Calling / Agentic Context)

## Problem

Work plans are generated with only the diff hunk and review comment as context.
This makes them narrow and bounded — the model cannot see the full file, related types,
call sites, or architectural patterns. Plans consistently fail to address root causes
that require cross-file understanding.

## Goal

Let the model drive its own context discovery during work plan generation. Instead of
us guessing what files to inject upfront, the model calls tools to read files and
resolve symbols — just like a developer would open files and navigate to definitions.

---

## Approach: Tool-Calling (Agentic)

The VS Code LM API supports a `tools` parameter on `sendRequest`. The model can
request to call a named tool mid-response. The extension executes the tool and feeds
the result back in a new request. This repeats until the model produces a final text
response (the work plan).

The model sees the diff hunk + review comment, then decides for itself what files
and symbols it needs to understand before designing a solution.

---

## Tools to Expose

| Tool name | Description | Parameters |
|---|---|---|
| `read_file` | Read full or partial content of a workspace file | `path: string`, `start_line?: number`, `end_line?: number` |
| `list_files` | List files in a workspace directory (for repo structure overview) | `directory?: string` |
| `get_definition` | Find where a symbol is defined using VS Code's LSP | `file_path: string`, `line: number`, `symbol: string` |
| `get_references` | Find all call sites / usages of a symbol using VS Code's LSP | `file_path: string`, `line: number`, `symbol: string` |

---

## Request/Response Loop

```
1. Build initial messages: security notice + diff hunk + issue description + task instruction
2. Call model.sendRequest(messages, { tools })
3. Stream response parts:
   - vscode.LanguageModelTextPart   → accumulate as final text
   - vscode.LanguageModelToolCallPart → execute the tool, collect result
4. If any tool calls were made:
   - Append assistant message (with tool call parts) to messages
   - Append user message with LanguageModelToolResultPart(s)
   - Go to step 2
5. When response contains only text parts → that is the work plan
```

**Safety guard:** cap the loop at **10 iterations** to prevent infinite tool-call cycles.

---

## Phases

### Phase 1 — Workspace/Branch Validation

**Where:** `src/extension.ts`, before `loadPrData()` is called.

**What:**
- Check `vscode.workspace.workspaceFolders` is non-empty.
- Read `.git/HEAD` (via `vscode.workspace.fs`) to get the current checked-out branch.
- Compare against the PR head branch name returned by the GitHub API.
- If mismatch (or no workspace open): show `vscode.window.showWarningMessage`:
  > "This PR is on branch `{headBranch}` of `{repoName}`. Please open that repository and check out that branch in VS Code in order to generate review work plans."
- Do **not** block — work plan generation continues, just without workspace tool access.

**Files touched:** `src/extension.ts`, new `src/workspaceValidator.ts`.

---

### Phase 2 — Tool Implementations

**Where:** New `src/workspaceTools.ts`.

**`read_file(path, start_line?, end_line?)`**
- Resolve `path` relative to workspace root.
- Open via `vscode.workspace.openTextDocument`.
- If `start_line`/`end_line` provided, slice lines accordingly.
- Return file content as string. Cap at 500 lines to prevent oversized results.

**`list_files(directory?)`**
- Use `vscode.workspace.findFiles` with a glob rooted at `directory` (default: workspace root).
- Exclude `node_modules`, `dist`, `out`, `.git`, `*.d.ts`.
- Return relative file paths as a newline-separated list.

**`get_definition(file_path, line, symbol)`**
- Open the document, find the symbol on the given line.
- Call `vscode.commands.executeCommand('vscode.executeDefinitionProvider', uri, position)`.
- Return: definition file path + line number. If multiple, return all (deduped, exclude `node_modules`).

**`get_references(file_path, line, symbol)`**
- Same as above but `vscode.executeReferenceProvider`.
- Return: list of `{file, line}` pairs. Cap at 20 results.

**All tools:** wrap in try/catch. On error return a brief error string — never throw into the LM loop.

---

### Phase 3 — Tool Registration & LM Loop

**Where:** `src/workPlanGenerator.ts`.

**What:**
- Define `vscode.LanguageModelChatTool[]` array with JSON schemas for each tool.
- Replace the single `model.sendRequest(messages, {})` call with a loop:

```typescript
const tools: vscode.LanguageModelChatTool[] = [ /* read_file, list_files, get_definition, get_references */ ];
const messages = [/* initial prompt */];
let iteration = 0;
const MAX_ITERATIONS = 10;

while (iteration++ < MAX_ITERATIONS) {
  const response = await model.sendRequest(messages, { tools });
  const textParts: string[] = [];
  const toolCalls: vscode.LanguageModelToolCallPart[] = [];

  for await (const part of response.stream) {
    if (part instanceof vscode.LanguageModelTextPart) textParts.push(part.value);
    if (part instanceof vscode.LanguageModelToolCallPart) toolCalls.push(part);
  }

  if (toolCalls.length === 0) {
    return textParts.join('').trim(); // done
  }

  // Execute tools, build result messages
  const toolResults = await Promise.all(toolCalls.map(executeToolCall));
  messages.push(new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.Assistant, toolCalls));
  messages.push(new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.User, toolResults));
}

return textParts.join('').trim(); // hit iteration cap
```

---

### Phase 4 — Prompt Update

**Where:** `src/workPlanGenerator.ts` — `buildPrompt()`.

**What:**
Add an instruction block telling the model it has tools available and how to use them:

```
You have access to tools to read files and navigate the codebase.
Before designing the solution:
- Use read_file to read the full content of the affected file.
- Use get_definition to find where key symbols are defined, then read those files.
- Use get_references to understand how types and functions are used across the codebase.
- Use list_files if you need an overview of the project structure.

Only generate the work plan once you have sufficient context to address the root cause.
```

The diff hunk and issue description remain. The `<file-content>` injection approach is removed.

---

## Constraints & Decisions

| Decision | Choice |
|---|---|
| Max tool-call iterations | 10 |
| `read_file` max lines returned | 500 |
| `get_references` max results | 20 |
| Files excluded from all tools | `node_modules`, `dist`, `out`, `.git`, `*.d.ts` |
| Tool failure handling | Return error string, never throw |
| Branch mismatch | Warn, do not block |
| Workspace not open | Tools return "workspace not available", model falls back to diff context |

---

## Files to Create / Modify

| File | Action |
|---|---|
| `src/workspaceValidator.ts` | Create — branch/workspace check logic |
| `src/workspaceTools.ts` | Create — tool implementations (read_file, list_files, get_definition, get_references) |
| `src/workPlanGenerator.ts` | Modify — tool definitions, request loop, updated prompt |
| `src/extension.ts` | Modify — call workspace validator on startup |
| `src/test/unit/workspaceTools.test.ts` | Create — unit tests for tool implementations |


---

## Strategy

1. **Validate workspace state** — warn the user if the open workspace/branch does not match the PR.
2. **Read the commented file** — always include the full file the comment is on.
3. **Extract symbols from the diff hunk** — identify identifiers referenced in the changed lines.
4. **LSP hop 1: definitions** — for each symbol, resolve its definition file via `executeDefinitionProvider`.
5. **LSP hop 2: references (optional)** — for key types/functions found in hop 1, resolve callers via `executeReferenceProvider`.
6. **Assemble context** — deduplicate files, apply a token budget, inject as `<file-content>` sections into the prompt.
7. **Generate work plan** — same LM call, now with full cross-file context.

---

## Phases

### Phase 1 — Workspace/Branch Validation

**Where:** `extension.ts`, before `loadPrData()` is called.

**What:**
- Check `vscode.workspace.workspaceFolders` is non-empty.
- Read `.git/HEAD` (via `vscode.workspace.fs` or `fs.readFile`) to get the current branch name.
- Compare against the PR head branch name already returned by `fetchPrDetails()` / GitHub API.
- If mismatch (or no workspace): show `vscode.window.showWarningMessage`:
  > "This PR is on branch `{headBranch}` of `{repoName}`. Please open that repository and check out that branch in VS Code in order to generate review work plans."
- Do **not** block execution — work plan generation continues, but without file context (graceful degradation).

**Files touched:** `src/extension.ts`, possibly a new `src/workspaceValidator.ts`.

---

### Phase 2 — Symbol Extraction from Diff Hunk

**Where:** New helper `src/symbolExtractor.ts`.

**What:**
- Parse the diff hunk string. Focus on lines starting with `+`, `-`, or context lines near the comment line number.
- Extract candidate identifiers using a regex for common patterns:
  - PascalCase types/classes: `/\b[A-Z][a-zA-Z0-9]+\b/g`
  - camelCase functions/variables: `/\b[a-z][a-zA-Z0-9]{2,}\b/g`
  - Exclude language keywords (configurable list per language, or generic short list).
- Return a deduplicated list of symbol strings + their approximate character offset in the file (needed for LSP position).

**Output:** `Array<{ name: string; line: number }>`

---

### Phase 3 — LSP Symbol Resolution

**Where:** New helper `src/lspContextBuilder.ts`.

**What:**

```
resolveContext(comment: ReviewComment): Promise<ResolvedContext>
```

Steps:
1. Open the commented file: `vscode.workspace.openTextDocument(Uri.file(absPath))`.
2. For each extracted symbol near `comment.line`, call:
   ```
   vscode.commands.executeCommand('vscode.executeDefinitionProvider', docUri, position)
   ```
3. Collect unique definition `Uri`s (exclude `node_modules`, `dist`, `.d.ts` files).
4. **Cap at 5 definition files** to avoid runaway context growth.
5. (Optional, controlled by a flag) For each definition file found, call:
   ```
   vscode.commands.executeCommand('vscode.executeReferenceProvider', defUri, defPosition)
   ```
   Collect unique caller files. **Cap at 3 additional caller files.**
6. Return the set of relevant file URIs + the commented file itself.

**Graceful degradation:** If LSP returns nothing (server not ready, language not supported), return only the commented file URI. Never throw.

---

### Phase 4 — File Content Assembly

**Where:** `src/lspContextBuilder.ts` (same module).

**What:**
- For each resolved file URI, read content via `vscode.workspace.fs.readFile`.
- Apply a **per-file line budget**: keep at most 300 lines centred around the most relevant line (definition line or comment line). For files where no anchor line is known, take the first 300 lines.
- Format each file as:
  ```
  <file-content path="relative/path/to/file.ts">
  ...lines...
  </file-content>
  ```
- Apply a **total context budget**: if total characters across all files exceeds ~12,000, drop lower-priority files (caller files dropped first, then definition files, keeping only the commented file).

**Output:** `string` — the assembled `<file-content>` block(s) ready for prompt injection.

---

### Phase 5 — Prompt Update

**Where:** `src/workPlanGenerator.ts` — `buildPrompt()`.

**What:**

Add the file context block between `</diff-hunk>` and `<issue-description>`:

```
<diff-hunk>
{diffHunk}
</diff-hunk>

{fileContextBlock}    ← new: <file-content> sections, or empty string if none

<issue-description>
{body}
</issue-description>
```

Update the instruction lines to reference the available context:

> "The file content sections above provide the full source of the affected file and related files identified via symbol analysis. Use this context to reason about the root cause before designing the solution."

---

### Phase 6 — Wiring in `generateAllWorkPlans`

**Where:** `src/workPlanGenerator.ts`.

**What:**
- Before the rolling semaphore loop, pre-fetch file context for all unique `comment.path` values in parallel (deduplicated — one LSP traversal per unique file, not per comment).
- Build a `Map<commentId, fileContextBlock>` and pass it into `generateWorkPlanWithModel`.
- `generateWorkPlanWithModel` gains a third optional parameter `fileContext?: string`.

---

## Constraints & Decisions

| Decision | Choice |
|---|---|
| LSP availability check | Try/catch around `executeDefinitionProvider`; empty result = skip silently |
| Branch mismatch | Warn, do not block |
| Max definition files | 5 |
| Max caller files | 3 |
| Per-file line budget | 300 lines centred on anchor |
| Total character budget | ~12,000 chars across all injected files |
| `.d.ts` / `node_modules` | Always excluded from LSP results |
| Monorepo / subfolder workspace | Detect workspace root vs repo root mismatch; log warning, proceed |

---

## Files to Create / Modify

| File | Action |
|---|---|
| `src/workspaceValidator.ts` | Create — branch/workspace check logic |
| `src/symbolExtractor.ts` | Create — diff hunk symbol extraction |
| `src/lspContextBuilder.ts` | Create — LSP traversal + file assembly |
| `src/workPlanGenerator.ts` | Modify — `buildPrompt` + `generateAllWorkPlans` wiring |
| `src/extension.ts` | Modify — call workspace validator before panel open |
| `src/test/unit/` | Add unit tests for new modules |
