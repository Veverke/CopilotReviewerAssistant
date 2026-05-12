/**
 * Phase 5 / Phase 8 – Work Plan Generation (including tool-calling loop)
 *
 * Test plan:
 *  generateWorkPlan()
 *    - returns the assembled work plan text from streaming chunks
 *    - trims whitespace from the assembled text
 *    - falls back when no model is available (empty list)
 *    - falls back when selectChatModels throws
 *    - shows QuickPick and uses chosen model when multiple are available
 *    - returns fallback when QuickPick is dismissed
 *    - returns error message when sendRequest throws
 *    - returns error message when the stream throws mid-stream
 *    - executes tool calls and returns final text after tool loop
 *    - stops after MAX_TOOL_ITERATIONS even if model keeps calling tools
 *
 *  generateAllWorkPlans()
 *    - returns an array matching the input length
 *    - each result has the original comment object attached
 *    - returns empty array for empty input
 *    - processes no more than CONCURRENCY items simultaneously
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => {
  class LanguageModelTextPart {
    constructor(public value: string) {}
  }
  class LanguageModelToolCallPart {
    constructor(public callId: string, public name: string, public input: unknown) {}
  }
  class LanguageModelToolResultPart {
    constructor(public callId: string, public content: any[]) {}
  }
  return {
    lm: { selectChatModels: vi.fn() },
    window: { showQuickPick: vi.fn() },
    LanguageModelChatMessage: {
      User: vi.fn((content: string | any[]) => ({ role: 'user', content })),
      Assistant: vi.fn((content: string | any[]) => ({ role: 'assistant', content })),
    },
    LanguageModelTextPart,
    LanguageModelToolCallPart,
    LanguageModelToolResultPart,
  };
});

vi.mock('../../workspaceTools', () => ({
  readFileTool: vi.fn().mockResolvedValue('file content'),
  listFilesTool: vi.fn().mockResolvedValue('src/foo.ts'),
  getDefinitionTool: vi.fn().mockResolvedValue('src/bar.ts:10'),
  getReferencesTool: vi.fn().mockResolvedValue('src/baz.ts:5'),
}));

vi.mock('../../modelSelector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../modelSelector')>();
  return actual; // use real implementation so we can test through it
});

import * as vscode from 'vscode';
import { generateWorkPlan, generateAllWorkPlans } from '../../workPlanGenerator';
import { clearModelCache } from '../../modelSelector';
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
    reviewer: 'copilot-pull-request-reviewer[bot]',
  };
}

/**
 * Build a mock LanguageModelChat.
 * @param chunks  - text chunk strings to yield from the stream
 * @param toolCalls - optional tool call parts to yield before text (simulates model requesting tools)
 */
function makeModel(
  chunks: string[],
  toolCalls: vscode.LanguageModelToolCallPart[] = []
): vscode.LanguageModelChat {
  return {
    sendRequest: vi.fn().mockImplementation(() =>
      Promise.resolve({
        stream: (async function* () {
          for (const tc of toolCalls) {
            yield tc;
          }
          for (const chunk of chunks) {
            yield new vscode.LanguageModelTextPart(chunk);
          }
        })(),
      })
    ),
  } as unknown as vscode.LanguageModelChat;
}

// ─── generateWorkPlan ─────────────────────────────────────────────────────────

describe('generateWorkPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearModelCache();
  });

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

  it('shows QuickPick and uses the chosen model when multiple are available', async () => {
    const model1 = { ...makeModel(['ignored']), name: 'GPT-4o', vendor: 'copilot', family: 'gpt-4o' };
    const model2 = { ...makeModel(['1. step']), name: 'Claude Sonnet', vendor: 'copilot', family: 'claude-sonnet' };
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([model1, model2] as any);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: 'Claude Sonnet', model: model2 } as any);

    const result = await generateWorkPlan(makeComment());

    expect(result).toBe('1. step');
    expect(vscode.lm.selectChatModels).toHaveBeenCalledWith({});
    expect(vscode.window.showQuickPick).toHaveBeenCalledOnce();
  });

  it('returns the fallback message when QuickPick is dismissed', async () => {
    const model1 = { ...makeModel(['ignored']), name: 'GPT-4o', vendor: 'copilot', family: 'gpt-4o' };
    const model2 = { ...makeModel(['ignored']), name: 'Claude Sonnet', vendor: 'copilot', family: 'claude-sonnet' };
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([model1, model2] as any);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined as any);

    const result = await generateWorkPlan(makeComment());

    expect(result).toBe('No language model available. Work plan could not be generated.');
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

  it('returns an error message when the stream throws mid-stream', async () => {
    const model = {
      sendRequest: vi.fn().mockResolvedValue({
        stream: (async function* () {
          yield new vscode.LanguageModelTextPart('partial text');
          throw new Error('stream interrupted');
        })(),
      }),
    };
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([model] as any);

    const result = await generateWorkPlan(makeComment());
    expect(result).toContain('Work plan unavailable');
    expect(result).toContain('stream interrupted');
  });

  it('passes a User message and tools to sendRequest', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      stream: (async function* () {
        yield new vscode.LanguageModelTextPart('1. done');
      })(),
    });
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([
      { sendRequest } as unknown as vscode.LanguageModelChat,
    ] as any);

    await generateWorkPlan(makeComment());

    expect(vscode.LanguageModelChatMessage.User).toHaveBeenCalledOnce();
    expect(sendRequest).toHaveBeenCalledOnce();
    // Tools array should be passed in the options
    const callOptions = sendRequest.mock.calls[0][1];
    expect(callOptions).toHaveProperty('tools');
    expect(Array.isArray(callOptions.tools)).toBe(true);
    expect(callOptions.tools.length).toBeGreaterThan(0);
  });

  it('executes a tool call and returns the final text after the tool loop', async () => {
    const toolCall = new vscode.LanguageModelToolCallPart('call-1', 'read_file', { path: 'src/foo.ts' });
    // First response: one tool call, no text
    // Second response: final text, no tool calls
    const sendRequest = vi.fn()
      .mockResolvedValueOnce({
        stream: (async function* () { yield toolCall; })(),
      })
      .mockResolvedValueOnce({
        stream: (async function* () { yield new vscode.LanguageModelTextPart('1. Fix it'); })(),
      });

    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([
      { sendRequest } as unknown as vscode.LanguageModelChat,
    ] as any);

    const result = await generateWorkPlan(makeComment());

    expect(result).toBe('1. Fix it');
    expect(sendRequest).toHaveBeenCalledTimes(2);
    // Second call should include assistant + user messages with tool results
    expect(vscode.LanguageModelChatMessage.Assistant).toHaveBeenCalledOnce();
    expect(vscode.LanguageModelChatMessage.User).toHaveBeenCalledTimes(2); // initial + tool results
  });

  it('stops after MAX_TOOL_ITERATIONS if model keeps calling tools', async () => {
    const toolCall = new vscode.LanguageModelToolCallPart('call-x', 'list_files', {});
    // Always returns a fresh stream yielding a tool call, never text
    const sendRequest = vi.fn().mockImplementation(() =>
      Promise.resolve({
        stream: (async function* () { yield toolCall; })(),
      })
    );

    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([
      { sendRequest } as unknown as vscode.LanguageModelChat,
    ] as any);

    const result = await generateWorkPlan(makeComment());

    // Should have stopped at MAX_TOOL_ITERATIONS (10) and returned an error message
    expect(sendRequest).toHaveBeenCalledTimes(10);
    expect(result).toMatch(/model exceeded maximum tool call iterations/);
  });
});

// ─── generateAllWorkPlans ─────────────────────────────────────────────────────

describe('generateAllWorkPlans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearModelCache();
  });

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

  it('does not exceed CONCURRENCY simultaneous sendRequest calls', async () => {
    let active = 0;
    let maxConcurrent = 0;

    // Model that tracks concurrent sendRequest calls
    const trackingModel: vscode.LanguageModelChat = {
      sendRequest: vi.fn().mockImplementation(async () => {
        active++;
        maxConcurrent = Math.max(maxConcurrent, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        active--;
        return {
          stream: (async function* () {
            yield new vscode.LanguageModelTextPart('1. done');
          })(),
        };
      }),
    } as unknown as vscode.LanguageModelChat;

    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([trackingModel] as any);

    const comments = Array.from({ length: 10 }, (_, i) => makeComment(i + 1));
    await generateAllWorkPlans(comments);

    expect(maxConcurrent).toBeLessThanOrEqual(6); // CONCURRENCY = 6
    expect(maxConcurrent).toBeGreaterThan(1);     // actually ran concurrently
  });
});
