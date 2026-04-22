/**
 * Phase 2 – GitHub Authentication
 *
 * Test plan:
 *  getGitHubToken()
 *    - calls getSession with the correct provider and scopes
 *    - returns the access token when a valid session is found
 *    - throws with a "cancelled" message when session is null/undefined
 *    - throws with a "no access token" message when accessToken is empty
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  authentication: { getSession: vi.fn() },
}));

import * as vscode from 'vscode';
import { getGitHubToken } from '../../auth';

describe('getGitHubToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls getSession with the correct provider id and scopes', async () => {
    vi.mocked(vscode.authentication.getSession).mockResolvedValue({
      accessToken: 'tok',
      id: 's1',
      scopes: ['repo'],
      account: { id: 'user', label: 'User' },
    } as any);

    await getGitHubToken();

    expect(vscode.authentication.getSession).toHaveBeenCalledWith(
      'github',
      ['repo'],
      { createIfNone: true }
    );
  });

  it('returns the access token when a session is found', async () => {
    vi.mocked(vscode.authentication.getSession).mockResolvedValue({
      accessToken: 'ghp_test_token_123',
      id: 's1',
      scopes: ['repo'],
      account: { id: 'user', label: 'User' },
    } as any);

    const token = await getGitHubToken();

    expect(token).toBe('ghp_test_token_123');
  });

  it('throws when session is null (user cancelled sign-in)', async () => {
    vi.mocked(vscode.authentication.getSession).mockResolvedValue(null as any);

    await expect(getGitHubToken()).rejects.toThrow(
      'GitHub sign-in was cancelled. Authentication is required to access PR comments.'
    );
  });

  it('throws when session.accessToken is an empty string', async () => {
    vi.mocked(vscode.authentication.getSession).mockResolvedValue({
      accessToken: '',
      id: 's1',
      scopes: ['repo'],
      account: { id: 'user', label: 'User' },
    } as any);

    await expect(getGitHubToken()).rejects.toThrow(
      'GitHub authentication succeeded but no access token could be retrieved.'
    );
  });
});
