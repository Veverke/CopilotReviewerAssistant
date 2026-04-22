# Phase 6 — Webview Panel UI

## Atomic Tasks

### 6.1 — Create `src/reviewPanel.ts` module
Dedicated module that owns the `WebviewPanel` lifecycle. Responsible for creating, populating, disposing, and receiving messages from the panel. No fix application logic here.

### 6.2 — Implement `ReviewPanel.createOrShow()` static factory
Follow the VS Code recommended pattern: if a panel already exists, reveal it; otherwise create a new one.

```typescript
static createOrShow(
  context: vscode.ExtensionContext,
  prUrl: string,
  comments: AnnotatedComment[]
): ReviewPanel
```

### 6.3 — Set Webview options
Enable scripts; restrict `localResourceRoots` to the extension's `media/` folder to prevent arbitrary local file access.

```typescript
webview.options = { enableScripts: true, localResourceRoots: [mediaUri] };
```

### 6.4 — Create `media/` folder with `panel.css` and `panel.js`
- `panel.css`: layout and card styling using VS Code theme variables (`--vscode-editor-background`, `--vscode-foreground`, `--vscode-button-background`, etc.)
- `panel.js`: handles checkbox state, Select All / Deselect All logic, enables/disables the Apply button, and posts the `applyFixes` message on button click

### 6.5 — Implement `_getHtmlForWebview()` private method
Generate the panel HTML. Use a nonce and `Content-Security-Policy` meta tag to allow only scripts with a matching nonce — required for Webview security:

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
```

### 6.6 — Render the PR header
Show the repo name, PR number, and a direct link to the PR (rendered as plain text — Webview cannot open external links via `<a href>` without `vscode.env.openExternal`).

### 6.7 — Render recommendation cards
For each `AnnotatedComment`, render a card containing:
- Checkbox input (checked by default), keyed to `comment.id`
- File path badge and line number
- Recommendation body (collapsed `<details>` block)
- Work plan paragraph

### 6.8 — Implement Select All / Deselect All buttons
Pure client-side JS in `panel.js` — toggle all checkbox states and update the Apply button's disabled state.

### 6.9 — Implement Apply Selected Fixes button
Disabled when zero checkboxes are checked. On click, collects all checked IDs and posts:

```javascript
vscode.postMessage({ command: 'applyFixes', selectedIds: [1, 2, 3] });
```

### 6.10 — Handle `applyFixes` message in `reviewPanel.ts`
Register `webview.onDidReceiveMessage`; on `applyFixes`, emit an event or call a callback with the array of selected IDs. Fix application logic stays in Phase 7.

### 6.11 — Handle panel disposal
Register `panel.onDidDispose` to clean up references so the extension does not hold stale objects.

### 6.12 — Mark Phase 6 complete in work-plan.md
Change `## Phase 6 — Webview Panel UI \`[ ]\`` to `## Phase 6 — Webview Panel UI \`[x]\`` in `work-plan.md`.

---

## Deliverables

- `src/reviewPanel.ts` with full panel lifecycle management
- `media/panel.css` with theme-aware styling
- `media/panel.js` with checkbox/button interactivity
- Content-Security-Policy nonce correctly applied
- Panel renders all fetched comments with work plans
- "Apply Selected Fixes" message posted to extension host when confirmed
- `work-plan.md` Phase 6 marked `[x]`

---

## Manual Testing at This Point

| What to test | How |
|---|---|
| Panel opens | Invoke command with example PR — Webview Panel appears with all comments listed |
| All checkboxes checked by default | Verify every card has its checkbox ticked on open |
| Select All / Deselect All | Click each — all checkboxes toggle accordingly |
| Apply button disabled state | Deselect all — Apply button becomes disabled; re-check one — it re-enables |
| Recommendation body collapsible | Click the `<details>` toggle — comment body expands and collapses |
| Theme consistency | Switch VS Code theme (light/dark/high-contrast) — panel colours update |
| Apply button posts message | Click Apply — Debug Console shows the `applyFixes` message with correct IDs |
| Panel survives re-invocation | Invoke command again — existing panel is revealed, not duplicated |
