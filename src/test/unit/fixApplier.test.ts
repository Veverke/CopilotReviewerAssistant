/**
 * Phase 7 – Fix Application
 *
 * Test plan:
 *  computeChangedLineRange()
 *    - identical files return the fallback line
 *    - change at the very first line
 *    - change at the very last line
 *    - change in the middle of the file
 *    - inserted lines (new content is longer)
 *    - deleted lines (new content is shorter)
 *
 *  resolveWorkspaceFile()
 *    - returns the first Uri when findFiles has a match
 *    - returns undefined when findFiles returns empty array
 *
 *  applyFix()
 *    - calls onProgress with state:'applying' immediately
 *    - calls onProgress with state:'failed' when file is not found in workspace
 *    - calls onProgress with state:'failed' when readFile throws
 *    - calls onProgress with state:'failed' when no LM model is available
 *    - calls onProgress with state:'failed' when selectChatModels throws
 *    - calls onProgress with state:'failed' when LM returns empty string
 *    - calls onProgress with state:'failed' when callLmWithTimeout throws
 *    - calls onProgress with state:'failed' when writeFile throws
 *    - calls onProgress with state:'done' including startLine and endLine on success
 *    - calls onProgress with state:'failed' on LM timeout
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    findFiles: vi.fn(),
    fs: { readFile: vi.fn(), writeFile: vi.fn() },
  },
  lm: { selectChatModels: vi.fn() },
  LanguageModelChatMessage: { User: vi.fn((content: string) => ({ role: 'user', content })) },
}));

import * as vscode from 'vscode';
import { computeChangedLineRange, resolveWorkspaceFile, applyFix } from '../../fixApplier';
import type { AnnotatedComment } from '../../workPlanGenerator';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAnnotated(overrides: Partial<AnnotatedComment['comment']> = {}): AnnotatedComment {
  return {
    comment: {
      id: 1,
      path: 'src/foo.ts',
      line: 5,
      body: 'Use const',
      diffHunk: '@@ -1 +1 @@',
      htmlUrl: 'https://github.com/owner/repo/pull/1#comment-1',
      ...overrides,
    },
    workPlan: '1. Replace let with const',
  };
}

function makeModel(response: string): vscode.LanguageModelChat {
  return {
    sendRequest: vi.fn().mockResolvedValue({
      text: (async function* () {
        yield response;
      })(),
    }),
  } as unknown as vscode.LanguageModelChat;
}

const FAKE_URI = { fsPath: '/workspace/src/foo.ts', toString: () => '/workspace/src/foo.ts' } as unknown as vscode.Uri;

// ─── computeChangedLineRange ──────────────────────────────────────────────────

describe('computeChangedLineRange', () => {
  it('returns the fallback line when the files are identical', () => {
    const content = 'line1\nline2\nline3';
    expect(computeChangedLineRange(content, content, 7)).toEqual({
      startLine: 7,
      endLine: 7,
    });
  });

  it('detects a change on the first line', () => {
    const old = 'let x = 1;\nconst y = 2;';
    const next = 'const x = 1;\nconst y = 2;';
    expect(computeChangedLineRange(old, next, 99)).toEqual({
      startLine: 1,
      endLine: 1,
    });
  });

  it('detects a change on the last line', () => {
    const old = 'const a = 1;\nconst b = 2;\nlet c = 3;';
    const next = 'const a = 1;\nconst b = 2;\nconst c = 3;';
    expect(computeChangedLineRange(old, next, 99)).toEqual({
      startLine: 3,
      endLine: 3,
    });
  });

  it('detects a change in the middle of the file', () => {
    const old = 'a\nb\nc\nd';
    const next = 'a\nB\nc\nd';
    expect(computeChangedLineRange(old, next, 99)).toEqual({
      startLine: 2,
      endLine: 2,
    });
  });

  it('detects inserted lines (new content longer)', () => {
    const old = 'a\nb\nd';
    const next = 'a\nb\nc\nd';
    // lines 3-4 changed in new file
    const result = computeChangedLineRange(old, next, 99);
    expect(result.startLine).toBeLessThanOrEqual(3);
    expect(result.endLine).toBeGreaterThanOrEqual(3);
  });

  it('detects deleted lines (new content shorter)', () => {
    const old = 'a\nb\nc\nd';
    const next = 'a\nd';
    // change starts at line 2 in old; in new file endLine is line 2
    const result = computeChangedLineRange(old, next, 99);
    expect(result.startLine).toBeLessThanOrEqual(2);
    expect(result.endLine).toBeGreaterThanOrEqual(1);
  });
});

// ─── resolveWorkspaceFile ─────────────────────────────────────────────────────

describe('resolveWorkspaceFile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the first Uri when a file is found', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([FAKE_URI] as any);

    const result = await resolveWorkspaceFile('src/foo.ts');
    expect(result).toBe(FAKE_URI);
  });

  it('returns undefined when no file is found', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([] as any);

    const result = await resolveWorkspaceFile('src/missing.ts');
    expect(result).toBeUndefined();
  });
});

// ─── applyFix ─────────────────────────────────────────────────────────────────

describe('applyFix', () => {
  beforeEach(() => vi.clearAllMocks());

  it('emits state:applying immediately', async () => {
    const statuses: string[] = [];
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([] as any);

    await applyFix(makeAnnotated(), (s) => statuses.push(s.state));

    expect(statuses[0]).toBe('applying');
  });

  it('emits state:failed when the file is not found in workspace', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([] as any);

    const statuses: ReturnType<typeof applyFix> extends Promise<void> ? any[] : never[] = [];
    await applyFix(makeAnnotated(), (s) => statuses.push(s));

    const failed = statuses.find((s) => s.state === 'failed');
    expect(failed).toBeDefined();
    expect(failed.reason).toContain('File not found');
  });

  it('emits state:failed when readFile throws', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([FAKE_URI] as any);
    vi.mocked(vscode.workspace.fs.readFile).mockRejectedValue(
      new Error('permission denied')
    );

    const statuses: any[] = [];
    await applyFix(makeAnnotated(), (s) => statuses.push(s));

    const failed = statuses.find((s) => s.state === 'failed');
    expect(failed?.reason).toContain('permission denied');
  });

  it('emits state:failed when no LM model is available', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([FAKE_URI] as any);
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      Buffer.from('const x = 1;') as any
    );
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([] as any);

    const statuses: any[] = [];
    await applyFix(makeAnnotated(), (s) => statuses.push(s));

    const failed = statuses.find((s) => s.state === 'failed');
    expect(failed?.reason).toContain('No language model available');
  });

  it('emits state:failed when selectChatModels throws', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([FAKE_URI] as any);
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      Buffer.from('const x = 1;') as any
    );
    vi.mocked(vscode.lm.selectChatModels).mockRejectedValue(
      new Error('model service down')
    );

    const statuses: any[] = [];
    await applyFix(makeAnnotated(), (s) => statuses.push(s));

    const failed = statuses.find((s) => s.state === 'failed');
    expect(failed?.reason).toContain('model service down');
  });

  it('emits state:failed when LM returns empty content', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([FAKE_URI] as any);
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      Buffer.from('const x = 1;') as any
    );
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([
      makeModel(''),  // empty response
    ] as any);

    const statuses: any[] = [];
    await applyFix(makeAnnotated(), (s) => statuses.push(s));

    const failed = statuses.find((s) => s.state === 'failed');
    expect(failed?.reason).toContain('empty content');
  });

  it('emits state:failed when writeFile throws', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([FAKE_URI] as any);
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      Buffer.from('const x = 1;') as any
    );
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([
      makeModel('const x = 2;'),
    ] as any);
    vi.mocked(vscode.workspace.fs.writeFile).mockRejectedValue(
      new Error('disk full')
    );

    const statuses: any[] = [];
    await applyFix(makeAnnotated(), (s) => statuses.push(s));

    const failed = statuses.find((s) => s.state === 'failed');
    expect(failed?.reason).toContain('disk full');
  });

  it('emits state:done with correct filePath on success', async () => {
    const oldContent = 'let x = 1;\nconst y = 2;';
    const newContent = 'const x = 1;\nconst y = 2;';

    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([FAKE_URI] as any);
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      Buffer.from(oldContent) as any
    );
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([
      makeModel(newContent),
    ] as any);
    vi.mocked(vscode.workspace.fs.writeFile).mockResolvedValue(undefined as any);

    const statuses: any[] = [];
    await applyFix(makeAnnotated(), (s) => statuses.push(s));

    const done = statuses.find((s) => s.state === 'done');
    expect(done).toBeDefined();
    expect(done.filePath).toBe('src/foo.ts');
    expect(typeof done.startLine).toBe('number');
    expect(typeof done.endLine).toBe('number');
  });

  it('emits state:failed when the LM call times out', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(vscode.workspace.findFiles).mockResolvedValue([FAKE_URI] as any);
      vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
        Buffer.from('const x = 1;') as any
      );

      // Model that never resolves
      const hangingModel = {
        sendRequest: vi.fn().mockReturnValue(
          new Promise(() => { /* never resolves */ })
        ),
      };
      vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([
        hangingModel,
      ] as any);

      const statuses: any[] = [];
      const fixPromise = applyFix(makeAnnotated(), (s) => statuses.push(s));
      await vi.advanceTimersByTimeAsync(31_000);
      await fixPromise;

      const failed = statuses.find((s) => s.state === 'failed');
      expect(failed?.reason).toContain('timed out');
    } finally {
      vi.useRealTimers();
    }
  });
});
