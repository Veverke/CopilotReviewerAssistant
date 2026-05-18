/**
 * Phase 3 – PR URL Input & Parsing
 *
 * Test plan:
 *  parsePrUrl()
 *    - valid URL returns correct owner / repo / pullNumber
 *    - leading/trailing whitespace is trimmed before matching
 *    - URL with query-string suffix is still accepted (regex is non-anchored at end)
 *    - URL with fragment suffix is still accepted
 *    - invalid URL (plain string) throws
 *    - empty string throws
 *    - malformed URL (missing pull segment) throws
 *    - pullNumber is parsed as an integer
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  env: { clipboard: { readText: vi.fn() } },
  window: { showInputBox: vi.fn(), showQuickPick: vi.fn() },
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(false),
    }),
  },
}));

vi.mock('../../githubApi', () => ({}));

import { parsePrUrl, pickFromOpenPrs } from '../../prInput';
import type { OpenPr } from '../../githubApi';

describe('parsePrUrl', () => {
  it('parses a standard GitHub PR URL', () => {
    const result = parsePrUrl('https://github.com/owner/repo/pull/42');
    expect(result).toEqual({ owner: 'owner', repo: 'repo', pullNumber: 42 });
  });

  it('trims leading and trailing whitespace', () => {
    const result = parsePrUrl('  https://github.com/org/my-repo/pull/7  ');
    expect(result).toEqual({ owner: 'org', repo: 'my-repo', pullNumber: 7 });
  });

  it('accepts owner and repo names with hyphens and dots', () => {
    const result = parsePrUrl('https://github.com/my-org/my.repo/pull/100');
    expect(result).toEqual({ owner: 'my-org', repo: 'my.repo', pullNumber: 100 });
  });

  it('accepts URLs that contain a trailing query string', () => {
    const result = parsePrUrl('https://github.com/owner/repo/pull/5?foo=bar');
    expect(result).toEqual({ owner: 'owner', repo: 'repo', pullNumber: 5 });
  });

  it('accepts URLs that contain a trailing fragment', () => {
    const result = parsePrUrl('https://github.com/owner/repo/pull/3#discussion_r12345');
    expect(result).toEqual({ owner: 'owner', repo: 'repo', pullNumber: 3 });
  });

  it('pullNumber is returned as a number (not a string)', () => {
    const result = parsePrUrl('https://github.com/a/b/pull/999');
    expect(typeof result.pullNumber).toBe('number');
    expect(result.pullNumber).toBe(999);
  });

  it('throws for an empty string', () => {
    expect(() => parsePrUrl('')).toThrow('Invalid GitHub PR URL');
  });

  it('throws for a plain text value', () => {
    expect(() => parsePrUrl('not-a-url')).toThrow('Invalid GitHub PR URL');
  });

  it('throws for a GitHub URL that is not a PR URL', () => {
    expect(() => parsePrUrl('https://github.com/owner/repo/issues/42')).toThrow('Invalid GitHub PR URL');
  });

  it('throws for http (not https) URLs', () => {
    expect(() => parsePrUrl('http://github.com/owner/repo/pull/1')).toThrow('Invalid GitHub PR URL');
  });

  it('throws for a URL missing the pull segment', () => {
    expect(() => parsePrUrl('https://github.com/owner/repo')).toThrow('Invalid GitHub PR URL');
  });

  it('throws when pull number is missing', () => {
    expect(() => parsePrUrl('https://github.com/owner/repo/pull/')).toThrow('Invalid GitHub PR URL');
  });

  it('error message includes the invalid URL', () => {
    const bad = 'not-a-pr-url';
    expect(() => parsePrUrl(bad)).toThrow(bad);
  });
});

// ─── pickFromOpenPrs ─────────────────────────────────────────────────────────────────

import * as vscode from 'vscode';

describe('pickFromOpenPrs', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeOpenPr(n: number): OpenPr {
    return { owner: 'owner', repo: 'repo', pullNumber: n, title: `Fix issue ${n}`, htmlUrl: `https://github.com/owner/repo/pull/${n}` };
  }

  it('shows a QuickPick with one item per PR', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined as any);
    await pickFromOpenPrs([makeOpenPr(1), makeOpenPr(2)]);
    expect(vscode.window.showQuickPick).toHaveBeenCalledOnce();
    const items: any[] = vi.mocked(vscode.window.showQuickPick).mock.calls[0][0] as any[];
    expect(items).toHaveLength(2);
  });

  it('returns PrCoordinates for the selected PR', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(
      { label: '#7 — Fix issue 7', owner: 'owner', repo: 'repo', pullNumber: 7 } as any
    );
    const result = await pickFromOpenPrs([makeOpenPr(7)]);
    expect(result).toEqual({ owner: 'owner', repo: 'repo', pullNumber: 7 });
  });

  it('returns undefined when the user cancels the QuickPick', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined as any);
    const result = await pickFromOpenPrs([makeOpenPr(1)]);
    expect(result).toBeUndefined();
  });

  it('falls back to showInputBox when the PR list is empty and user enters a URL', async () => {
    vi.mocked(vscode.env.clipboard.readText).mockResolvedValue('');
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(
      'https://github.com/owner/repo/pull/42'
    );
    const result = await pickFromOpenPrs([]);
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(result).toEqual({ owner: 'owner', repo: 'repo', pullNumber: 42 });
  });

  it('returns undefined when the PR list is empty and user cancels the fallback input', async () => {
    vi.mocked(vscode.env.clipboard.readText).mockResolvedValue('');
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);
    const result = await pickFromOpenPrs([]);
    expect(result).toBeUndefined();
  });

  it('QuickPick label format is "#N — <title>" for a single repo', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined as any);
    await pickFromOpenPrs([makeOpenPr(3)]);
    const items: any[] = vi.mocked(vscode.window.showQuickPick).mock.calls[0][0] as any[];
    expect(items[0].label).toBe('#3 — Fix issue 3');
  });

  it('QuickPick label includes "owner/repo" prefix when PRs span multiple repos', async () => {
    const pr1: OpenPr = { owner: 'org1', repo: 'repoA', pullNumber: 1, title: 'Fix A', htmlUrl: '' };
    const pr2: OpenPr = { owner: 'org2', repo: 'repoB', pullNumber: 2, title: 'Fix B', htmlUrl: '' };
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined as any);
    await pickFromOpenPrs([pr1, pr2]);
    const items: any[] = vi.mocked(vscode.window.showQuickPick).mock.calls[0][0] as any[];
    expect(items[0].label).toBe('org1/repoA #1 — Fix A');
    expect(items[1].label).toBe('org2/repoB #2 — Fix B');
  });
});

// ─── parsePrUrl pull number bounds (Security Issue #8) ───────────────────────

describe('parsePrUrl pull number bounds', () => {
  it('throws for pull/0', () => {
    expect(() => parsePrUrl('https://github.com/owner/repo/pull/0')).toThrow('Invalid pull request number');
  });

  it('throws for an astronomically large pull number', () => {
    expect(() => parsePrUrl('https://github.com/owner/repo/pull/99999999999')).toThrow('Invalid pull request number');
  });

  it('accepts the GraphQL Int max value 2147483647', () => {
    const result = parsePrUrl('https://github.com/owner/repo/pull/2147483647');
    expect(result.pullNumber).toBe(2147483647);
  });

  it('accepts pull number 1 (minimum valid)', () => {
    const result = parsePrUrl('https://github.com/owner/repo/pull/1');
    expect(result.pullNumber).toBe(1);
  });
});

// ─── promptForPrUrl clipboard gating (Security Issue #7) ─────────────────────

import { promptForPrUrl } from '../../prInput';

describe('promptForPrUrl clipboard gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn().mockReturnValue(false),
    } as any);
  });

  it('does NOT read clipboard when preFillFromClipboard is false (default)', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);
    await promptForPrUrl();
    expect(vscode.env.clipboard.readText).not.toHaveBeenCalled();
  });

  it('reads clipboard and pre-fills when preFillFromClipboard is true and clipboard has a PR URL', async () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn().mockReturnValue(true),
    } as any);
    vi.mocked(vscode.env.clipboard.readText).mockResolvedValue('https://github.com/owner/repo/pull/5');
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);

    await promptForPrUrl();

    expect(vscode.env.clipboard.readText).toHaveBeenCalled();
    const callOpts: any = vi.mocked(vscode.window.showInputBox).mock.calls[0][0];
    expect(callOpts.value).toBe('https://github.com/owner/repo/pull/5');
  });

  it('does not pre-fill when clipboard content is not a PR URL even if preFillFromClipboard is true', async () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn().mockReturnValue(true),
    } as any);
    vi.mocked(vscode.env.clipboard.readText).mockResolvedValue('some random text');
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);

    await promptForPrUrl();

    const callOpts: any = vi.mocked(vscode.window.showInputBox).mock.calls[0][0];
    expect(callOpts.value).toBeUndefined();
  });

  it('treats undefined from config.get as false (preFillFromClipboard not set)', async () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn().mockReturnValue(undefined),
    } as any);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);

    await promptForPrUrl();

    // config returned undefined → preFill defaults to false → clipboard never read
    expect(vscode.env.clipboard.readText).not.toHaveBeenCalled();
  });
});
