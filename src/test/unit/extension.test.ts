/**
 * Phase 9 – Error Handling & Edge Cases
 *
 * Test plan:
 *  buildReplyBody()
 *    - includes the file path in the message
 *    - includes the line range as [startLine-endLine]
 *    - includes a link to the VS Code marketplace
 *    - produces a multi-line string (contains newlines)
 *    - works correctly for a single-line change (startLine === endLine)
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: { createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), show: vi.fn(), dispose: vi.fn() })) },
  commands: { registerCommand: vi.fn() },
}));
vi.mock('../../auth', () => ({ getGitHubToken: vi.fn() }));
vi.mock('../../prInput', () => ({ promptForPrUrl: vi.fn(), parsePrUrl: vi.fn() }));
vi.mock('../../githubApi', () => ({
  fetchCopilotComments: vi.fn(),
  fetchPrState: vi.fn(),
  postReplyComment: vi.fn(),
  resolveReviewThread: vi.fn(),
}));
vi.mock('../../workPlanGenerator', () => ({ generateAllWorkPlans: vi.fn() }));
vi.mock('../../reviewPanel', () => ({ ReviewPanel: { createOrShow: vi.fn() } }));
vi.mock('../../fixApplier', () => ({ applyFix: vi.fn(), resolveWorkspaceFile: vi.fn() }));
vi.mock('../../gitHelper', () => ({ stageFiles: vi.fn(), commitChanges: vi.fn(), pushChanges: vi.fn() }));

import { buildReplyBody } from '../../extension';

describe('buildReplyBody', () => {
  it('includes the comment file path', () => {
    const body = buildReplyBody('src/foo.ts', 10, 12);
    expect(body).toContain('src/foo.ts');
  });

  it('includes the line range formatted as [startLine-endLine]', () => {
    const body = buildReplyBody('src/foo.ts', 10, 12);
    expect(body).toContain('[10-12]');
  });

  it('works for a single-line change (startLine === endLine)', () => {
    const body = buildReplyBody('src/bar.ts', 5, 5);
    expect(body).toContain('src/bar.ts');
    expect(body).toContain('[5-5]');
  });

  it('contains a link to the VS Code marketplace', () => {
    const body = buildReplyBody('src/foo.ts', 1, 1);
    expect(body).toContain('marketplace.visualstudio.com');
  });

  it('produces a multi-line string', () => {
    const body = buildReplyBody('src/foo.ts', 1, 3);
    expect(body).toContain('\n');
  });
});
