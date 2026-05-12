/**
 * Phase 6 – Webview Panel UI (pure helper functions)
 *
 * Test plan:
 *  escapeHtml()
 *    - escapes & < > " ' to HTML entities
 *    - leaves plain text untouched
 *    - escapes all special characters in one string
 *
 *  safeGithubUrl()
 *    - returns the escaped URL for a valid https github.com URL
 *    - returns null for http (non-https) URLs
 *    - returns null for non-github.com HTTPS URLs
 *    - returns null for an invalid URL string
 *    - returns null for an empty string
 *    - escapes HTML special characters in a returned URL
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { escapeHtml, safeGithubUrl } from '../../reviewPanel';

// ─── escapeHtml ───────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('escapes ampersand &', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than <', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes greater-than >', () => {
    expect(escapeHtml('1 > 0')).toBe('1 &gt; 0');
  });

  it('escapes double-quote "', () => {
    expect(escapeHtml('"value"')).toBe('&quot;value&quot;');
  });

  it("escapes single-quote '", () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('escapes multiple special characters in a single string', () => {
    expect(escapeHtml('<a href="x">it\'s & fun</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;it&#39;s &amp; fun&lt;/a&gt;'
    );
  });
});

// ─── safeGithubUrl ────────────────────────────────────────────────────────────

describe('safeGithubUrl', () => {
  it('returns the escaped URL for a valid github.com HTTPS link', () => {
    const url = 'https://github.com/owner/repo/pull/1#comment-1';
    expect(safeGithubUrl(url)).toBe(escapeHtml(url));
  });

  it('returns null for an http (non-https) github.com URL', () => {
    expect(safeGithubUrl('http://github.com/owner/repo/pull/1')).toBeNull();
  });

  it('returns null for an HTTPS URL on a different domain', () => {
    expect(safeGithubUrl('https://evil.com/path')).toBeNull();
  });

  it('returns null for an invalid URL string', () => {
    expect(safeGithubUrl('not-a-url')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(safeGithubUrl('')).toBeNull();
  });

  it('returns null for a javascript: protocol URL', () => {
    expect(safeGithubUrl('javascript:alert(1)')).toBeNull();
  });

  it('escapes HTML characters in the returned URL', () => {
    // A URL with an ampersand in the query string
    const url = 'https://github.com/owner/repo/pull/1?a=1&b=2';
    const result = safeGithubUrl(url);
    expect(result).not.toContain('&b');
    expect(result).toContain('&amp;b');
  });
});
