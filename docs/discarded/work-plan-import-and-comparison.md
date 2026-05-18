# Work Plan — Import Work Plans & Automated Comparison Workflow

## Decisions

| Question | Decision |
|---|---|
| Import matching key | Comment ID (add to export) |
| Import collision | Replace silently + imported badge on affected cards |
| Comparison winner | Model picks automatically |
| Trigger | Button in panel toolbar |
| Comparison output | Inline in panel (each card gets a comparison section) |

---

## Phase A — Add comment ID to export JSON

The exported JSON must carry a stable identifier so that a later import can match items back to their panel cards precisely.

**A.1** In `media/panel.js`, in the export button click handler, add `id: Number(card.dataset.id)` to each exported item object alongside the existing `number`, `file`, `complexity`, `issue`, `workPlan` fields. The `data-id` attribute already holds the GitHub comment ID on every card.

**A.2** Update the `reviewPanel.test.ts` or add a note that the export schema now includes `id`.

---

## Phase B — Import work plans

Imports a previously exported JSON file, matches each item to the current panel by comment ID, and silently replaces the displayed work plan.

### B.1 — Toolbar button

In `reviewPanel.ts` `_getHtmlForWebview`, add an **Import** button to the toolbar HTML, after the Export button:

```html
<button id="import-btn" class="secondary">Import</button>
```

### B.2 — Extension-side file open dialog

In `reviewPanel.ts`, add a new message handler for `command === 'importWorkPlans'` in the constructor's `onDidReceiveMessage` block. It should:

1. Call `vscode.window.showOpenDialog({ filters: { 'JSON': ['json'] }, canSelectMany: false, title: 'Import Work Plans' })`.
2. If no file selected, return.
3. Read the file with `vscode.workspace.fs.readFile`.
4. Parse the JSON; if malformed, call `vscode.window.showErrorMessage` and return.
5. For each item in `data.reviews`, compute `workPlanHtml` via `workPlanToHtml(item.workPlan.join('\n'))` (join the steps array back to text for `workPlanToHtml`; or add a new `workPlanArrayToHtml` helper that takes `string[]`).
6. Post `{ command: 'applyImportedWorkPlans', items: [{ id, workPlan, workPlanHtml, complexity }] }` back to the webview.
7. Also call `this._onImportWorkPlans?.(items)` so the extension can update the in-memory `annotated` array.

### B.4 — In-memory update callback

Add `_onImportWorkPlans: ((items: ImportedWorkPlanItem[]) => void) | undefined` field to `ReviewPanel` where `ImportedWorkPlanItem = { id: number; workPlan: string; complexity: string }`.

Add `onImportWorkPlans` parameter to `setContent` and wire it in `extension.ts`:

```ts
(items) => {
  for (const item of items) {
    const target = annotated!.find((a) => a.comment.id === item.id);
    if (target) {
      target.workPlan = item.workPlan;
      target.complexity = item.complexity as ComplexityScore;
    }
  }
}
```

### B.4 — panel.js: trigger and receive

Add a click handler for `#import-btn` that posts `{ command: 'importWorkPlans' }` to the extension.

In the `window.addEventListener('message')` handler, handle `command === 'applyImportedWorkPlans'`: iterate `message.items`, call the existing `updateWorkPlan(item.id, item.workPlan, item.workPlanHtml, item.complexity)` for each. After all updates, show a transient banner via a new `showBanner`-style function: `"N work plans imported."`.

### B.5 — Imported badge

After `updateWorkPlan` replaces a work plan, add a small `<span class="work-plan-imported-badge" title="Work plan was imported from file">↥ imported</span>` element into the `.work-plan-label` row of the affected card (inserted before the copy button). If a badge already exists on that card (e.g. from a previous import), do not duplicate it — check with `card.querySelector('.work-plan-imported-badge')` first.

Add CSS for `.work-plan-imported-badge`: small, muted, styled similarly to `.work-plan-label` but using `var(--vscode-textLink-foreground)` at low opacity, with a left border accent. The badge should not appear on cards that were not imported.

## Phase C — Automated comparison workflow

For each review item the extension already holds a generated work plan. This phase sends each to the model with a prompt that asks it to independently generate its own plan, compare both, and pick the winner. The winning plan replaces the current one inline in each card, with a comparison section appended showing the rationale.

### C.1 — New prompt: `buildComparisonPrompt`

Add `buildComparisonPrompt(comment: ReviewComment, existingWorkPlan: string): string` to `workPlanGenerator.ts`.

The prompt must:

- Contain the same security header as `buildPrompt`.
- Include the review comment (file, line, diff hunk, issue description) in tagged sections.
- Include the existing work plan in a `<existing-work-plan>` tagged section.
- Instruct the model to:
  1. Use tools (read_file, get_definition, get_references) to understand the codebase context, same as the original prompt.
  2. Generate its own independent work plan without being influenced by the existing one.
  3. Compare both plans on: correctness (addresses root cause), depth (tackles the full problem, not just the symptom), specificity (actionable steps, no vague language), minimal footprint (fewest steps that fully solve the problem).
  4. Pick the better plan.
  5. Output in this exact structure:
     ```
     Model plan:
     1. ...
     2. ...

     Comparison: <one paragraph rationale>
     Winner: original | model
     Final plan:
     1. ...
     2. ...
     Complexity: low|medium|high
     ```

### C.2 — `parseComparisonResult` function

Add `parseComparisonResult(raw: string, comment: ReviewComment): ComparisonResult` to `workPlanGenerator.ts`.

```ts
export interface ComparisonResult {
  modelPlan: string;       // extracted model plan steps as plain text
  rationale: string;       // comparison paragraph
  winner: 'original' | 'model';
  finalPlan: string;       // the winning plan steps as plain text
  complexity: ComplexityScore;
}
```

Parse each section from the structured output. Fall back gracefully: if parsing fails, set `winner: 'model'` and use the raw text as `finalPlan`.

### C.3 — `generateComparison` / `generateAllComparisons`

Add `generateAllComparisons(items: AnnotatedComment[], onProgress?: (done: number, total: number) => void): Promise<(ComparisonResult | null)[]>` to `workPlanGenerator.ts`.

Use the same rolling semaphore pattern (CONCURRENCY = 6) as `generateAllWorkPlans`. For each item, call `generateWorkPlanWithModel` but with `buildComparisonPrompt` instead of `buildPrompt`. Catch errors and return `null` for failed items.

### C.4 — Toolbar button

In `reviewPanel.ts`, add a **Compare Plans** button to the toolbar, after Import:

```html
<button id="compare-btn" class="secondary">Compare Plans</button>
```

### C.5 — Extension wiring

Add `_onCompareWorkPlans: (() => void) | undefined` to `ReviewPanel`. Wire in `setContent` and `extension.ts`:

```ts
() => {
  void (async () => {
    panel.postBanner('Running comparison…', 'info');
    const results = await generateAllComparisons(annotated!, (done, total) => {
      // optionally post progress
    });
    for (let i = 0; i < annotated!.length; i++) {
      const r = results[i];
      if (!r) { continue; }
      annotated![i].workPlan = r.finalPlan;
      annotated![i].complexity = r.complexity;
      panel.postComparisonResult(annotated![i].comment.id, r);
    }
  })();
}
```

### C.6 — `postComparisonResult`

Add to `ReviewPanel`:

```ts
public postComparisonResult(id: number, result: ComparisonResult): void {
  void this._panel.webview.postMessage({
    command: 'comparisonResult',
    id,
    modelPlanHtml: workPlanToHtml(result.modelPlan),
    rationale: result.rationale,
    winner: result.winner,
    finalPlanHtml: workPlanToHtml(result.finalPlan),
    finalPlan: result.finalPlan,
    complexity: result.complexity,
  });
}
```

### C.7 — panel.js: trigger and receive

Add click handler for `#compare-btn`:
- Disable button and set text to `Comparing…`.
- Post `{ command: 'compareWorkPlans' }`.

In `window.addEventListener('message')`, handle `command === 'comparisonResult'`:

1. Find the card by `data-id`.
2. Call existing `updateWorkPlan(id, finalPlan, finalPlanHtml, complexity)` to replace the active plan.
3. Append a collapsible `<details class="comparison-section">` inside the card's `.card-body` (or replace an existing one if the user re-runs comparison):

```
Comparison details
  ├── Winner badge: "Original was better" | "Model plan was better"
  ├── Rationale paragraph
  └── Model's independent plan (collapsed by default)
```

4. When all cards receive a result (track count), re-enable the Compare button and restore its label.

### C.8 — CSS

Add styles for `.comparison-section`, `.comparison-winner-badge` (two variants: `original` and `model`), and `.comparison-rationale`.

---

## Phase D — Export includes comparison data (optional, post-C)

Once comparison results exist in-memory on the cards, the Export button can optionally include them per item:

```json
{
  "id": 12345678,
  "number": 3,
  "file": "src/foo.ts",
  "complexity": "medium",
  "issue": "...",
  "workPlan": ["step A", "step B"],
  "comparison": {
    "modelPlan": ["step X", "step Y"],
    "winner": "model",
    "rationale": "...",
    "finalPlan": ["step X", "step Y"]
  }
}
```

`comparison` is omitted when the comparison workflow has not been run. No schema change needed — absence of the key is valid.

---

## Sequencing

```
A (export ID)  →  B (import)  →  C (comparison)  →  D (export comparison)
```

A is a prerequisite for B. B and C are independent of each other and can be worked in parallel. D depends on C.
