# Phase 10 — UI Polish & UX Modernisation

## Goal
Make the Webview panel look modern, efficient, and visually polished while staying native to VS Code's design language. Every change must respect VS Code's CSS variable system so the panel looks great in every theme (dark, light, high contrast).

---

## Atomic Tasks

### 10.1 — Sticky toolbar with live selection counter
Make the toolbar stick to the top of the scroll container so it is always accessible on long lists.  
Add a live badge inside the **Apply Selected Fixes** button that shows `(N selected)`, updated on every checkbox change.

**Files:** `media/panel.css`, `media/panel.js`, `src/reviewPanel.ts`

```css
.toolbar {
  position: sticky;
  top: 0;
  z-index: 10;
  background-color: var(--vscode-editor-background);
  padding-bottom: 10px;
  border-bottom: 1px solid var(--vscode-panel-border);
  margin-bottom: 16px;
}
```

JS: replace the static `disabled` toggle with a function that also writes `Apply (${n} selected)` to the button text.

---

### 10.2 — Card left-border accent by fix status
Replace the flat card border with a 3-px coloured left accent that communicates state at a glance:

| State     | Accent colour token                               |
|-----------|---------------------------------------------------|
| pending   | `--vscode-panel-border` (neutral, same as today)  |
| applying  | `--vscode-progressBar-background`                 |
| done      | `--vscode-testing-iconPassed` (`#4caf50` fallback)|
| failed    | `--vscode-testing-iconFailed` (`#f44336` fallback)|

```css
.card {
  border-left: 3px solid var(--vscode-panel-border);
  transition: border-color 0.2s ease;
}
.card.state-applying { border-left-color: var(--vscode-progressBar-background); }
.card.state-done     { border-left-color: var(--vscode-testing-iconPassed, #4caf50); }
.card.state-failed   { border-left-color: var(--vscode-testing-iconFailed, #f44336); }
```

JS: `updateCardStatus` adds/removes the `state-*` class on the `.card` element in addition to updating the `.fix-status` text.

---

### 10.3 — Dim & check-mark applied cards
When a fix reaches `done` state, visually retire the card:
- Reduce opacity of `.card-body` to `0.55`
- Auto-uncheck and disable the checkbox
- Show a ✓ overlay or the status badge turns green

```css
.card.state-done .card-body { opacity: 0.55; }
.card.state-done input[type="checkbox"] { pointer-events: none; }
```

JS: in `updateCardStatus`, when `state === 'done'`, set `checkbox.checked = false; checkbox.disabled = true;` and call `updateApplyButton()`.

---

### 10.4 — Spinner animation for "Applying…" state
Replace the plain "Applying…" text with a CSS-animated spinner dot sequence so the user knows something is actively happening.

```css
@keyframes ellipsis {
  0%   { content: 'Applying'; }
  33%  { content: 'Applying.'; }
  66%  { content: 'Applying..'; }
  100% { content: 'Applying...'; }
}
.fix-applying::after {
  content: '';
  animation: ellipsis 1.2s steps(1, end) infinite;
}
```

Remove the hard-coded `Applying…` text from JS and rely on the CSS `::after` pseudo-element.

---

### 10.5 — Button group for Select All / Deselect All
Visually group the two secondary buttons into a joined pill so they read as a single control.

```css
.btn-group {
  display: flex;
}
.btn-group button {
  border-radius: 0;
}
.btn-group button:first-child {
  border-radius: 2px 0 0 2px;
  border-right: 1px solid var(--vscode-button-secondaryHoverBackground);
}
.btn-group button:last-child {
  border-radius: 0 2px 2px 0;
}
```

HTML (in `_getHtmlForWebview`): wrap the two secondary buttons in `<div class="btn-group">`.

---

### 10.6 — Smooth `<details>` expand/collapse animation
The native `<details>` open/close is instant. Add a CSS height-transition via a wrapper:

```css
.details-body {
  overflow: hidden;
  max-height: 0;
  transition: max-height 0.2s ease;
}
details[open] .details-body {
  max-height: 600px; /* large enough for any comment */
}
```

JS: intercept the `toggle` event on every `<details>` element and toggle the `open` attribute manually so the transition fires correctly.

---

### 10.7 — File-path badge overflow handling
Long file paths currently overflow the card header. Truncate with an ellipsis from the left (most informative part is the filename, not the root) and show the full path on hover via `title`.

```css
.badge {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;   /* left-truncate: "…src/foo/bar.ts" */
  text-align: left;
}
```

In the HTML template, add `title="${escapeHtml(comment.path)}"` to the `.badge` span.

---

### 10.8 — Improved empty-state illustration
Replace the bare text with a centred icon + message using a VS Code codicon:

```html
<div class="empty-state">
  <span class="codicon codicon-pass-filled empty-icon"></span>
  <p>No Copilot review comments found on this PR.</p>
  <p class="empty-sub">Try a PR that has been reviewed by GitHub Copilot.</p>
</div>
```

```css
.empty-icon {
  font-size: 48px;
  color: var(--vscode-descriptionForeground);
  display: block;
  margin-bottom: 12px;
}
.empty-sub {
  font-size: 0.85em;
  color: var(--vscode-descriptionForeground);
  margin-top: 6px;
}
```

Enable the codicon font in the `WebviewPanel` options: `enableFindWidget` is already set; add `enableCommandUris: false` (already default). Load the VS Code codicon stylesheet by referencing the bundled font from `vscode.Uri`.

---

### 10.9 — Card hover highlight
Give cards a subtle hover lift so the interactive nature is clear.

```css
.card {
  transition: border-color 0.2s ease, background-color 0.15s ease;
}
.card:hover {
  background-color: var(--vscode-list-hoverBackground);
}
```

---

### 10.10 — Keyboard focus ring polish
VS Code resets outlines on many elements. Restore accessible, theme-consistent focus rings:

```css
button:focus-visible,
input[type="checkbox"]:focus-visible,
summary:focus-visible,
a:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 2px;
}
```

---

### 10.11 — Summary/progress bar
Add a small progress bar beneath the toolbar showing applied fixes out of total:

```html
<div class="progress-bar-track" id="progress-track" aria-hidden="true">
  <div class="progress-bar-fill" id="progress-fill"></div>
</div>
```

```css
.progress-bar-track {
  height: 2px;
  background-color: var(--vscode-panel-border);
  margin-bottom: 16px;
  border-radius: 1px;
  overflow: hidden;
}
.progress-bar-fill {
  height: 100%;
  width: 0%;
  background-color: var(--vscode-testing-iconPassed, #4caf50);
  transition: width 0.3s ease;
}
```

JS: every time a `done` status arrives, increment a counter and set `progressFill.style.width = (doneCount / totalCount * 100) + '%'`.

---

### 10.12 — Visual QA pass (both themes)
Open the extension in the Extension Development Host and verify every task above in:
- Default **Dark+** theme
- Default **Light+** theme
- **High Contrast Black** theme

Fix any colour, contrast, or layout regressions before marking phase complete.

---

## Acceptance Criteria
- [ ] Toolbar is sticky; Apply button shows live selection count.
- [ ] Card left border changes colour for each fix state.
- [ ] Done cards are dimmed and their checkbox is disabled.
- [ ] "Applying" state shows an animated indicator.
- [ ] Select All / Deselect All appear as a joined button group.
- [ ] `<details>` expand/collapse animates smoothly.
- [ ] Long file paths are truncated with `…` and full path visible on hover.
- [ ] Empty state shows a codicon icon and explanatory sub-text.
- [ ] Cards show a hover background highlight.
- [ ] Focus rings are visible on all interactive elements.
- [ ] Progress bar fills as fixes are applied.
- [ ] All visuals pass QA in Dark+, Light+, and High Contrast themes.
