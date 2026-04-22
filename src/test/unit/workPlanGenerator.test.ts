/**
 * Phase 5 – Work Plan Generation
 *
 * Test plan:
 *  generateWorkPlan()
 *    - returns the assembled work plan text from streaming chunks
 *    - trims whitespace from the assembled text
 *    - falls back when no model is available (empty list)
 *    - falls back when selectChatModels throws
 *    - tries gpt-4o first; falls back to any copilot model
 *    - returns error message when sendRequest throws
 *    - returns error message when the text stream throws mid-stream
 *
 *  generateAllWorkPlans()
 *    - returns an array matching the input length
 *    - each result has the original comment object attached
 *    - returns empty array for empty input
 *    - processes no more than CONCURRENCY (3) items simultaneously
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  lm: { selectChatModels: vi.fn() },
  LanguageModelChatMessage: { User: vi.fn((content: string) => ({ role: 'user', content })) },
}));

import * as vscode from 'vscode';
import { generateWorkPlan, generateAllWorkPlans } from '../../workPlanGenerator';
import type { ReviewComment } from '../../githubApi';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeComment(id = 1): ReviewComment {
  return {
    id,
    path: 'src/foo.ts',
    line: 5,
    body: 'Use const instead of let',
    diffHunk: '@@ -1,1 +1,1 @@',
    htmlUrl: 'https://github.com/owner/repo/pull/1#comment-1',
  };
}

function makeModel(chunks: string[]): vscode.LanguageModelChat {
  return {
    sendRequest: vi.fn().mockImplementation(() =>
      Promise.resolve({
        text: (async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        })(),
      })
    ),
  } as unknown as vscode.LanguageModelChat;
}

// ─── generateWorkPlan ─────────────────────────────────────────────────────────

describe('generateWorkPlan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('assembles and returns streaming chunks as work plan text', async () => {
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([
      makeModel(['1. Do this\n', '2. Do that']),
    ] as any);

    const result = await generateWorkPlan(makeComment());
    expect(result).toBe('1. Do this\n2. Do that');
  });

  it('trims leading and trailing whitespace from the response', async () => {
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([
      makeModel(['\n  1. Fix it  \n']),
    ] as any);

    const result = await generateWorkPlan(makeComment());
    expect(result).toBe('1. Fix it');
  });

  it('returns the fallback message when no model is available', async () => {
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([] as any);

    const result = await generateWorkPlan(makeComment());
    expect(result).toBe('No language model available. Work plan could not be generated.');
  });

  it('returns the fallback message when selectChatModels throws', async () => {
    vi.mocked(vscode.lm.selectChatModels).mockRejectedValue(
      new Error('quota exceeded')
    );

    const result = await generateWorkPlan(makeComment());
    expect(result).toBe('No language model available. Work plan could not be generated.');
  });

  it('tries gpt-4o first, then any copilot model as fallback', async () => {
    vi.mocked(vscode.lm.selectChatModels)
      .mockResolvedValueOnce([] as any)       // gpt-4o not available
      .mockResolvedValueOnce([makeModel(['1. step'])] as any); // fallback

    const result = await generateWorkPlan(makeComment());

    expect(result).toBe('1. step');
    expect(vscode.lm.selectChatModels).toHaveBeenCalledTimes(2);
    expect(vscode.lm.selectChatModels).toHaveBeenNthCalledWith(
      1,
      { vendor: 'copilot', family: 'gpt-4o' }
    );
    expect(vscode.lm.selectChatModels).toHaveBeenNthCalledWith(2, { vendor: 'copilot' });
  });

  it('returns an error message when sendRequest throws', async () => {
    const model = {
      sendRequest: vi.fn().mockRejectedValue(new Error('model unavailable')),
    };
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([model] as any);

    const result = await generateWorkPlan(makeComment());
    expect(result).toContain('Work plan unavailable');
    expect(result).toContain('model unavailable');
  });

  it('returns an error message when the text stream throws mid-stream', async () => {
    const model = {
      sendRequest: vi.fn().mockResolvedValue({
        text: (async function* () {
          yield 'partial text';
          throw new Error('stream interrupted');
        })(),
      }),
    };
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([model] as any);

    const result = await generateWorkPlan(makeComment());
    expect(result).toContain('Work plan unavailable');
    expect(result).toContain('stream interrupted');
  });

  it('passes a User message to sendRequest', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      text: (async function* () {
        yield '1. done';
      })(),
    });
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([
      { sendRequest } as unknown as vscode.LanguageModelChat,
    ] as any);

    await generateWorkPlan(makeComment());

    expect(vscode.LanguageModelChatMessage.User).toHaveBeenCalledOnce();
    expect(sendRequest).toHaveBeenCalledOnce();
  });
});

// ─── generateAllWorkPlans ─────────────────────────────────────────────────────

describe('generateAllWorkPlans', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an AnnotatedComment for every input comment', async () => {
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([
      makeModel(['1. step']),
    ] as any);

    const comments = [makeComment(1), makeComment(2), makeComment(3)];
    const results = await generateAllWorkPlans(comments);

    expect(results).toHaveLength(3);
    results.forEach((r, i) => {
      expect(r.comment.id).toBe(i + 1);
      expect(r.workPlan).toBe('1. step');
    });
  });

  it('preserves the original order of comments in the result', async () => {
    vi.mocked(vscode.lm.selectChatModels).mockImplementation(async () => {
      return [makeModel(['plan'])] as any;
    });

    const ids = [10, 20, 30, 40, 50];
    const results = await generateAllWorkPlans(ids.map(makeComment));

    expect(results.map((r) => r.comment.id)).toEqual(ids);
  });

  it('returns an empty array when given no comments', async () => {
    const results = await generateAllWorkPlans([]);
    expect(results).toHaveLength(0);
  });

  it('does not run more than CONCURRENCY (3) work plans at the same time', async () => {
    let active = 0;
    let maxConcurrent = 0;

    vi.mocked(vscode.lm.selectChatModels).mockImplementation(async () => {
      active++;
      maxConcurrent = Math.max(maxConcurrent, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      active--;
      return [makeModel(['1. done'])] as any;
    });

    const comments = Array.from({ length: 7 }, (_, i) => makeComment(i + 1));
    await generateAllWorkPlans(comments);

    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });
});
