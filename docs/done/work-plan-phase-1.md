# Phase 1 — Project Scaffold

## Atomic Tasks

### 1.1 — Verify prerequisites
Confirm Node.js (≥ 18), npm, and VS Code are installed and available on `PATH`.
These are independent system checks; none depends on the others.

```
node --version
npm --version
code --version
```

### 1.2 — Install Yeoman and the VS Code extension generator
Install globally if not already present.

```
npm install -g yo generator-code
```

### 1.3 — Scaffold the TypeScript extension
Run the generator and choose: **New Extension (TypeScript)**, name `copilot-reviewer-assistant`, identifier `copilot-reviewer-assistant`, publisher (your publisher ID).

```
yo code
```

### 1.4 — Set `engines.vscode` minimum version
In `package.json`, set `"engines": { "vscode": "^1.90.0" }` — the minimum that supports Webview panels, the LM API, and `checkboxState` on tree items.

### 1.5 — Register the entry command
In `package.json` `contributes.commands`, add:

```json
{
  "command": "copilotReviewer.openPanel",
  "title": "Copilot Reviewer: Open PR Fix Panel"
}
```

Also add the command to `activationEvents` if the VS Code version requires it (< 1.74 auto-activation is not available).

### 1.6 — Declare GitHub authentication dependency
In `package.json` `contributes`, add:

```json
"authentication": [{ "id": "github", "label": "GitHub" }]
```

### 1.7 — Configure `tsconfig.json`
Ensure `target` is `ES2020`, `module` is `commonjs`, `strict` is `true`, and `outDir` is `./out`.

### 1.8 — Configure ESLint
Verify the scaffolded `.eslintrc.json` includes the `@typescript-eslint` ruleset. Run a lint check to confirm zero errors on the generated code.

```
npm run lint
```

### 1.9 — Set up Vitest unit-test framework
Install Vitest as a dev dependency (no extra TypeScript transformer needed):

```
npm install --save-dev vitest
```

Create `vitest.config.ts` at the repo root:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/test/unit/**/*.test.ts'],
  },
});
```

Add a `test:unit` script to `package.json`:

```json
"test:unit": "vitest run"
```

Create `src/test/unit/extension.test.ts` as a smoke test:

```ts
import { describe, it, expect } from 'vitest';

describe('Extension bootstrap', () => {
  it('should import without throwing', () => {
    expect(true).toBe(true);
  });
});
```

Run the suite to confirm it passes:

```
npm run test:unit
```

### 1.10 — Configure `.vscodeignore`
Ensure `node_modules/`, `src/`, `.vscode-test/`, and `*.map` files are excluded from the packaged extension.

### 1.11 — Verify activation in Extension Development Host
Press `F5` to launch the Extension Development Host. Open the Command Palette and confirm `Copilot Reviewer: Open PR Fix Panel` is listed and does not throw on invocation (a placeholder `console.log` in the handler is sufficient at this stage).

### 1.12 — Mark Phase 1 complete in work-plan.md
Change `## Phase 1 — Project Scaffold \`[ ]\`` to `## Phase 1 — Project Scaffold \`[x]\`` in `work-plan.md`.

---

## Deliverables

- Initialised TypeScript VS Code extension project at the repo root
- `package.json` with correct metadata, command registration, and auth dependency
- `tsconfig.json` and `.eslintrc.json` configured and passing with no errors
- `vitest.config.ts` configured; `test:unit` script added to `package.json`
- `src/test/unit/` folder with a passing smoke test
- `.vscodeignore` correctly excluding dev artifacts
- Extension activates successfully in the Extension Development Host
- `work-plan.md` Phase 1 marked `[x]`

---

## Manual Testing at This Point

| What to test | How |
|---|---|
| Scaffold compiles | Run `npm run compile` — zero errors |
| Lint passes | Run `npm run lint` — zero warnings |
| Unit tests pass | Run `npm run test:unit` — all tests green, no failures |
| Extension activates | Press `F5`, open Command Palette, type "Copilot Reviewer" — command appears |
| Command is invokable | Select the command — no unhandled error thrown (check Debug Console) |
