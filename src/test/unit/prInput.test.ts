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

import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  env: { clipboard: { readText: vi.fn() } },
  window: { showInputBox: vi.fn() },
}));

import { parsePrUrl } from '../../prInput';

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
