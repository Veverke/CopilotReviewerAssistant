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
vi.mock('../../prInput', () => ({ promptForPrUrl: vi.fn(), parsePrUrl: vi.fn(), pickFromOpenPrs: vi.fn() }));
vi.mock('../../githubApi', () => ({
  fetchCopilotComments: vi.fn(),
  fetchCurrentUser: vi.fn(),
  fetchHasCopilotReview: vi.fn(),
  fetchPrState: vi.fn(),
  fetchPrDetails: vi.fn(),
  fetchOpenPullRequests: vi.fn(),
  postReplyComment: vi.fn(),
  resolveReviewThread: vi.fn(),
}));
vi.mock('../../workPlanGenerator', () => ({}));
vi.mock('../../reviewPanel', () => ({ ReviewPanel: { createOrShow: vi.fn() } }));
vi.mock('../../fixApplier', () => ({}));
vi.mock('../../gitHelper', () => ({ stageFiles: vi.fn(), commitChanges: vi.fn(), pushChanges: vi.fn(), getRemoteOwnerRepo: vi.fn(), getAllRemoteOwnerRepos: vi.fn() }));

import { buildReplyBody, extractGitHubSeverity, classifyComplexity } from '../../extension';

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

// ─── Helper ─────────────────────────────────────────────────────────────────
const makeComment = (body: string, diffHunk = '') => ({
  id: 1, path: 'src/foo.ts', line: 1, body, diffHunk, htmlUrl: '', reviewer: '',
});

describe('extractGitHubSeverity', () => {
  it('returns "high" for a body starting with "High"', () => {
    expect(extractGitHubSeverity('High\n\nSome issue here.')).toBe('high');
  });

  it('returns "medium" for a body starting with "Medium"', () => {
    expect(extractGitHubSeverity('Medium\n\nSome issue here.')).toBe('medium');
  });

  it('returns "low" for a body starting with "Low"', () => {
    expect(extractGitHubSeverity('Low\n\nSome issue here.')).toBe('low');
  });

  it('is case-insensitive', () => {
    expect(extractGitHubSeverity('HIGH\n\nIssue.')).toBe('high');
    expect(extractGitHubSeverity('MEDIUM\n\nIssue.')).toBe('medium');
    expect(extractGitHubSeverity('LOW\n\nIssue.')).toBe('low');
  });

  it('returns null when the first line is not a severity keyword', () => {
    expect(extractGitHubSeverity('The quick brown fox')).toBeNull();
    expect(extractGitHubSeverity('')).toBeNull();
  });

  it('handles leading whitespace before the severity word', () => {
    expect(extractGitHubSeverity('  High\n\nIssue.')).toBe('high');
  });
});

describe('classifyComplexity – GitHub severity chip takes precedence', () => {
  it('uses GitHub "High" chip and ignores heuristic signals', () => {
    // Body starts with "High" — should return high regardless of neutral diff
    const c = makeComment('High\n\nMinor rename.');
    expect(classifyComplexity(c)).toBe('high');
  });

  it('uses GitHub "Medium" chip', () => {
    expect(classifyComplexity(makeComment('Medium\n\nUpdate the filter.'))).toBe('medium');
  });

  it('uses GitHub "Low" chip', () => {
    expect(classifyComplexity(makeComment('Low\n\nFix a typo.'))).toBe('low');
  });

  it('falls back to heuristics when no severity chip is present', () => {
    // A body with heavy architectural signals but no chip → heuristic should give 'high'
    const c = makeComment(
      'Refactor the abstraction layer to decouple all callers.',
      Array(20).fill('+code').join('\n'),
    );
    expect(classifyComplexity(c)).toBe('high');
  });

  it('falls back to heuristics for low-signal body without chip', () => {
    const c = makeComment('Please rename this variable.', '');
    expect(classifyComplexity(c)).toBe('low');
  });
});
