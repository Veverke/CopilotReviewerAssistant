import * as vscode from 'vscode';

/**
 * Session-scoped cache so the user is only prompted once per VS Code session
 * when multiple language models are available.
 */
let cachedModel: vscode.LanguageModelChat | undefined;

/**
 * In-flight selection promise — concurrent callers wait on the same promise
 * instead of each showing their own QuickPick simultaneously.
 */
let selectionInProgress: Promise<vscode.LanguageModelChat | undefined> | undefined;

/**
 * Returns the language model to use, honouring whatever model is active in
 * VS Code's chat window:
 *  - If only one model is installed/available, it is used automatically.
 *  - If multiple models are available the user is shown a QuickPick once per
 *    session and the choice is cached for the remainder of the session.
 *  - Returns `undefined` if no model is available or the user cancels.
 */
export async function selectModel(): Promise<vscode.LanguageModelChat | undefined> {
  if (cachedModel) {
    return cachedModel;
  }

  // If another call is already doing selection, wait for it instead of showing a second QuickPick
  if (selectionInProgress) {
    return selectionInProgress;
  }

  selectionInProgress = (async () => {
    try {
      const models = await vscode.lm.selectChatModels({});

      if (models.length === 0) {
        return undefined;
      }

      if (models.length === 1) {
        cachedModel = models[0];
        return cachedModel;
      }

      // Multiple models available — ask the user which one to use for this session.
      const items = models.map((m) => ({
        label: m.name ?? m.family ?? m.id,
        description: `${m.vendor} · ${m.family}`,
        model: m,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        title: 'Select a language model',
        placeHolder: 'Choose which model to use for this review session',
      });

      if (!picked) {
        return undefined;
      }

      cachedModel = picked.model;
      return cachedModel;
    } finally {
      selectionInProgress = undefined;
    }
  })();

  return selectionInProgress;
}

/** Clear the cached model (e.g. for testing or when the user wants to re-select). */
export function clearModelCache(): void {
  cachedModel = undefined;
  selectionInProgress = undefined;
}

/** Returns the display name of the currently cached model, or undefined if none selected yet. */
export function getSelectedModelName(): string | undefined {
  if (!cachedModel) { return undefined; }
  return cachedModel.name ?? cachedModel.family ?? cachedModel.id;
}
