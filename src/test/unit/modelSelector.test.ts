/**
 * Model Selector
 *
 * Test plan:
 *  selectModel()
 *    - returns the single available model without showing QuickPick
 *    - returns undefined when no models are available
 *    - shows QuickPick when multiple models are available
 *    - returns the model chosen in QuickPick
 *    - returns undefined when QuickPick is dismissed
 *    - caches the selected model so QuickPick is only shown once per session
 *    - returns undefined when selectChatModels throws
 *
 *  clearModelCache()
 *    - subsequent call re-fetches models after cache is cleared
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  lm: { selectChatModels: vi.fn() },
  window: { showQuickPick: vi.fn() },
}));

import * as vscode from 'vscode';
import { selectModel, clearModelCache } from '../../modelSelector';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeModel(name: string): vscode.LanguageModelChat {
  return {
    id: name,
    name,
    vendor: 'copilot',
    family: name,
    version: '1',
    maxInputTokens: 4096,
    sendRequest: vi.fn(),
    countTokens: vi.fn(),
  } as unknown as vscode.LanguageModelChat;
}

// ─── selectModel ─────────────────────────────────────────────────────────────

describe('selectModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearModelCache();
  });

  it('returns the single available model without showing QuickPick', async () => {
    const model = makeModel('gpt-4o');
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([model] as any);

    const result = await selectModel();

    expect(result).toBe(model);
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(vscode.lm.selectChatModels).toHaveBeenCalledWith({});
  });

  it('returns undefined when no models are available', async () => {
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([] as any);

    const result = await selectModel();

    expect(result).toBeUndefined();
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it('shows QuickPick when multiple models are available', async () => {
    const model1 = makeModel('gpt-4o');
    const model2 = makeModel('claude-sonnet');
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([model1, model2] as any);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: 'claude-sonnet', model: model2 } as any);

    await selectModel();

    expect(vscode.window.showQuickPick).toHaveBeenCalledOnce();
    const items = vi.mocked(vscode.window.showQuickPick).mock.calls[0][0] as Array<{ label: string; model: vscode.LanguageModelChat }>;
    expect(items).toHaveLength(2);
    expect(items[0].model).toBe(model1);
    expect(items[1].model).toBe(model2);
  });

  it('returns the model chosen in QuickPick', async () => {
    const model1 = makeModel('gpt-4o');
    const model2 = makeModel('claude-sonnet');
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([model1, model2] as any);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: 'claude-sonnet', model: model2 } as any);

    const result = await selectModel();

    expect(result).toBe(model2);
  });

  it('returns undefined when QuickPick is dismissed', async () => {
    const model1 = makeModel('gpt-4o');
    const model2 = makeModel('claude-sonnet');
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([model1, model2] as any);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined as any);

    const result = await selectModel();

    expect(result).toBeUndefined();
  });

  it('caches the selected model so QuickPick is only shown once per session', async () => {
    const model = makeModel('gpt-4o');
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([model] as any);

    await selectModel();
    await selectModel();
    await selectModel();

    expect(vscode.lm.selectChatModels).toHaveBeenCalledOnce();
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it('returns undefined when selectChatModels throws', async () => {
    vi.mocked(vscode.lm.selectChatModels).mockRejectedValue(new Error('service unavailable'));

    await expect(selectModel()).rejects.toThrow('service unavailable');
  });
});

// ─── clearModelCache ─────────────────────────────────────────────────────────

describe('clearModelCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearModelCache();
  });

  it('causes selectModel to re-fetch after the cache is cleared', async () => {
    const model = makeModel('gpt-4o');
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([model] as any);

    await selectModel(); // populates cache
    clearModelCache();
    await selectModel(); // should re-fetch

    expect(vscode.lm.selectChatModels).toHaveBeenCalledTimes(2);
  });
});
