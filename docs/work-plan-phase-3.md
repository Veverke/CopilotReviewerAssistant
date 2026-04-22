# Phase 3 — PR URL Input & Parsing

## Atomic Tasks

### 3.1 — Create `src/prInput.ts` module
Dedicated module for prompting the user and parsing the resulting URL. No API calls or UI rendering here.

### 3.2 — Implement `promptForPrUrl()` function
Show an input box with a placeholder and prompt text:

```typescript
export async function promptForPrUrl(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: 'Copilot Reviewer Assistant',
    prompt: 'Enter the GitHub Pull Request URL',
    placeHolder: 'https://github.com/owner/repo/pull/123',
    ignoreFocusOut: true,
  });
}
```

Returns `undefined` if the user presses Escape.

### 3.3 — Implement `parsePrUrl()` function
Extract `owner`, `repo`, and `pull_number` from the URL using a strict regex:

```typescript
export interface PrCoordinates {
  owner: string;
  repo: string;
  pullNumber: number;
}

export function parsePrUrl(url: string): PrCoordinates {
  const match = url.trim().match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/
  );
  if (!match) {
    throw new Error(`Invalid GitHub PR URL: "${url}". Expected format: https://github.com/owner/repo/pull/123`);
  }
  return { owner: match[1], repo: match[2], pullNumber: parseInt(match[3], 10) };
}
```

### 3.4 — Implement clipboard pre-population
Before showing the input box, read the clipboard. If it matches the GitHub PR URL pattern, set it as the `value` default in `showInputBox`:

```typescript
const clip = await vscode.env.clipboard.readText();
const isGhPrUrl = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(clip.trim());
```

### 3.5 — Handle user cancellation
In the command handler, if `promptForPrUrl()` returns `undefined`, return early without error — the user simply dismissed the dialog.

### 3.6 — Surface parse errors to the user
In the command handler, catch the `parsePrUrl` error and call `vscode.window.showErrorMessage(err.message)`.

### 3.7 — Mark Phase 3 complete in work-plan.md
Change `## Phase 3 — PR URL Input & Parsing \`[ ]\`` to `## Phase 3 — PR URL Input & Parsing \`[x]\`` in `work-plan.md`.

---

## Deliverables

- `src/prInput.ts` exporting `promptForPrUrl()` and `parsePrUrl()`
- Clipboard auto-fill working when a GitHub PR URL is present
- Invalid URLs produce a VS Code error notification with the expected format shown
- Cancellation is handled silently
- `work-plan.md` Phase 3 marked `[x]`

---

## Manual Testing at This Point

| What to test | How |
|---|---|
| Valid URL parsed | Invoke command, paste `https://github.com/Veverke/ThemeStudioApp/pull/3` — no error, correct owner/repo/number logged to Debug Console |
| Invalid URL rejected | Enter `not-a-url` — error notification with expected format appears |
| Clipboard pre-fill | Copy a GitHub PR URL to clipboard, invoke command — input box pre-filled |
| Clipboard ignored for non-PR content | Copy a random string, invoke command — input box is empty |
| Escape / cancellation | Press Escape in the input box — command exits silently |
