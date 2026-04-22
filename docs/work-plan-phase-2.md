# Phase 2 — GitHub Authentication

## Atomic Tasks

### 2.1 — Create `src/auth.ts` module
Add a dedicated module responsible solely for acquiring and returning a GitHub access token. No other logic belongs here.

### 2.2 — Implement `getGitHubToken()` function
Inside `auth.ts`, call `vscode.authentication.getSession` with the `repo` scope:

```typescript
export async function getGitHubToken(): Promise<string> {
  const session = await vscode.authentication.getSession(
    'github',
    ['repo'],
    { createIfNone: true }
  );
  return session.accessToken;
}
```

`createIfNone: true` triggers the VS Code OAuth flow automatically if no session exists.

### 2.3 — Handle user cancellation
Wrap the `getSession` call so that if the user dismisses the sign-in dialog (returns `undefined` when using `createIfNone: false` fallback), a descriptive `Error` is thrown:

```typescript
if (!session) {
  throw new Error('GitHub sign-in was cancelled. Authentication is required to access PR comments.');
}
```

### 2.4 — Surface the error to the user
In the command handler (`extension.ts`), catch the auth error and call:

```typescript
vscode.window.showErrorMessage(err.message);
```

so the user sees a human-readable notification rather than an unhandled rejection.

### 2.5 — Verify token is non-empty before returning
Add a guard: if `session.accessToken` is an empty string, throw with a message indicating the token could not be retrieved.

### 2.6 — Mark Phase 2 complete in work-plan.md
Change `## Phase 2 — GitHub Authentication \`[ ]\`` to `## Phase 2 — GitHub Authentication \`[x]\`` in `work-plan.md`.

---

## Deliverables

- `src/auth.ts` exporting `getGitHubToken(): Promise<string>`
- Command handler in `extension.ts` calls `getGitHubToken()` and surfaces errors gracefully
- No raw token is logged to any output channel or console
- `work-plan.md` Phase 2 marked `[x]`

---

## Manual Testing at This Point

| What to test | How |
|---|---|
| First-time sign-in | Press `F5`, invoke command — VS Code GitHub OAuth dialog appears |
| Token retrieved silently on second run | Invoke command again without signing out — no dialog, no error |
| Cancellation handled | When the OAuth dialog appears, close it — a VS Code error notification appears with the cancellation message |
| Token not leaked | Check the Debug Console — the token must not appear in any log output |
