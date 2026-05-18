/**
 * Phase 2 – GitHub Authentication
 *
 * Test plan:
 *  getGitHubToken()
 *    - calls getSession with the correct provider and scopes
 *    - returns the access token when a valid session is found
 *    - throws with a "cancelled" message when session is null/undefined
 *    - throws with a "no access token" message when accessToken is empty
 *    - uses stored account ID when present (browser auth path)
 *    - falls back to default sign-in when stored account session is not found
 *  signInWithBrowser()
 *    - calls getSession with forceNewSession
 *    - stores account ID in secrets
 *    - returns the access token
 *    - throws when session is null
 *    - throws when accessToken is empty
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  authentication: { getSession: vi.fn() },
  window: { showQuickPick: vi.fn(), showInformationMessage: vi.fn(), showWarningMessage: vi.fn() },
  workspace: { getConfiguration: vi.fn() },
  commands: { executeCommand: vi.fn() },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
}));

import * as vscode from 'vscode';
import { getGitHubToken, signInWithBrowser, refreshSession, hasPat, storePat, clearPat, setAuthOutputChannel } from '../../auth';

const noPatSecrets = { get: vi.fn().mockResolvedValue(undefined), store: vi.fn(), delete: vi.fn() } as any;

describe('getGitHubToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls getSession with the correct provider id and scopes', async () => {
    vi.mocked(vscode.authentication.getSession).mockResolvedValue({
      accessToken: 'tok',
      id: 's1',
      scopes: ['repo'],
      account: { id: 'user', label: 'User' },
    } as any);

    await getGitHubToken(noPatSecrets);

    expect(vscode.authentication.getSession).toHaveBeenCalledWith(
      'github',
      ['repo'],
      { createIfNone: true }
    );
  });

  it('returns the access token when a session is found', async () => {
    vi.mocked(vscode.authentication.getSession).mockResolvedValue({
      accessToken: 'mock-access-token',
      id: 's1',
      scopes: ['repo'],
      account: { id: 'user', label: 'User' },
    } as any);

    const token = await getGitHubToken(noPatSecrets);

    expect(token).toBe('mock-access-token');
  });

  it('throws when session is null (user cancelled sign-in)', async () => {
    vi.mocked(vscode.authentication.getSession).mockResolvedValue(null as any);

    await expect(getGitHubToken(noPatSecrets)).rejects.toThrow(
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

    await expect(getGitHubToken(noPatSecrets)).rejects.toThrow(
      'GitHub authentication succeeded but no access token could be retrieved.'
    );
  });

  it('returns the stored PAT from SecretStorage without calling getSession', async () => {
    const patSecrets = { get: vi.fn().mockResolvedValue('stored-pat-mock'), store: vi.fn(), delete: vi.fn() } as any;

    const token = await getGitHubToken(patSecrets);

    expect(token).toBe('stored-pat-mock');
    expect(vscode.authentication.getSession).not.toHaveBeenCalled();
  });

  it('uses stored account ID to request the specific GitHub session', async () => {
    const storedAccountId = 'company-account-id';
    const accountSecrets = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'copilotReviewer.githubAccountId') { return Promise.resolve(storedAccountId); }
        return Promise.resolve(undefined); // no PAT
      }),
      store: vi.fn(),
      delete: vi.fn(),
    } as any;

    vi.mocked(vscode.authentication.getSession).mockResolvedValue({
      accessToken: 'company_token',
      id: 's2',
      scopes: ['repo'],
      account: { id: storedAccountId, label: 'Company User' },
    } as any);

    const token = await getGitHubToken(accountSecrets);

    expect(token).toBe('company_token');
    expect(vscode.authentication.getSession).toHaveBeenCalledWith(
      'github',
      ['repo'],
      { createIfNone: false, account: { id: storedAccountId, label: '' } }
    );
  });

  it('falls back to default sign-in when the stored account session is not found', async () => {
    const storedAccountId = 'stale-account-id';
    const accountSecrets = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'copilotReviewer.githubAccountId') { return Promise.resolve(storedAccountId); }
        return Promise.resolve(undefined);
      }),
      store: vi.fn(),
      delete: vi.fn(),
    } as any;

    vi.mocked(vscode.authentication.getSession)
      .mockResolvedValueOnce(undefined as any)   // stored account not found
      .mockResolvedValueOnce({ accessToken: 'fallback_token', id: 's3', scopes: ['repo'], account: { id: 'other', label: 'Other' } } as any);

    const token = await getGitHubToken(accountSecrets);

    expect(token).toBe('fallback_token');
    expect(vscode.authentication.getSession).toHaveBeenCalledTimes(2);
    expect(vscode.authentication.getSession).toHaveBeenLastCalledWith('github', ['repo'], { createIfNone: true });
  });
});

describe('signInWithBrowser', () => {
  const mockUpdate = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn().mockReturnValue(undefined),
      update: mockUpdate,
    } as any);
  });

  /** Helper: sets up showQuickPick to resolve with a browser option by label. */
  function pickBrowser(label: string) {
    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items: any) => {
      const list: any[] = Array.isArray(items) ? items : await items;
      return list.find((i: any) => i.label === label) ?? undefined;
    });
  }

  /** Helper: sets up a successful getSession mock. */
  function mockSession(accessToken = 'browser_token', accountId = 'company-user') {
    vi.mocked(vscode.authentication.getSession).mockResolvedValue({
      accessToken,
      id: 's4',
      scopes: ['repo'],
      account: { id: accountId, label: 'User' },
    } as any);
  }

  const secrets = { get: vi.fn(), store: vi.fn().mockResolvedValue(undefined), delete: vi.fn() } as any;

  it('prompts for a browser before opening the auth flow', async () => {
    pickBrowser('Microsoft Edge');
    mockSession();

    await signInWithBrowser(secrets);

    expect(vscode.window.showQuickPick).toHaveBeenCalledTimes(1);
  });

  it('sets github-authentication.browser to "edge" when Edge is selected', async () => {
    pickBrowser('Microsoft Edge');
    mockSession();

    await signInWithBrowser(secrets);

    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('github-authentication');
    expect(mockUpdate).toHaveBeenCalledWith('browser', 'edge', 1 /* ConfigurationTarget.Global */);
  });

  it('sets github-authentication.browser to "chrome" when Chrome is selected', async () => {
    pickBrowser('Google Chrome');
    mockSession();

    await signInWithBrowser(secrets);

    expect(mockUpdate).toHaveBeenCalledWith('browser', 'chrome', 1);
  });

  it('sets github-authentication.browser to "firefox" when Firefox is selected', async () => {
    pickBrowser('Mozilla Firefox');
    mockSession();

    await signInWithBrowser(secrets);

    expect(mockUpdate).toHaveBeenCalledWith('browser', 'firefox', 1);
  });

  it('clears github-authentication.browser (sets undefined) when System Default is selected', async () => {
    pickBrowser('System Default');
    mockSession();

    await signInWithBrowser(secrets);

    // browserId is empty string for System Default — no update should be attempted
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('calls getSession with forceNewSession and createIfNone after browser is chosen', async () => {
    pickBrowser('Microsoft Edge');
    mockSession();

    await signInWithBrowser(secrets);

    expect(vscode.authentication.getSession).toHaveBeenCalledWith(
      'github',
      ['repo'],
      expect.objectContaining({ forceNewSession: expect.anything() })
    );
  });

  it('stores the account ID in secrets after successful sign-in', async () => {
    pickBrowser('Microsoft Edge');
    mockSession('browser_token', 'company-user');

    await signInWithBrowser(secrets);

    expect(secrets.store).toHaveBeenCalledWith('copilotReviewer.githubAccountId', 'company-user');
  });

  it('returns the access token after successful browser sign-in', async () => {
    pickBrowser('Google Chrome');
    mockSession('browser_token');

    const token = await signInWithBrowser(secrets);

    expect(token).toBe('browser_token');
  });

  it('skips all settings management when github-authentication.browser already has the chosen value', async () => {
    pickBrowser('Microsoft Edge');
    mockSession();
    // Return the already-correct value from getConfiguration().get()
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn().mockReturnValue('edge'),
      update: mockUpdate,
    } as any);

    await signInWithBrowser(secrets);

    // No update, no warning, no openSettingsJson — go straight to auth
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(vscode.authentication.getSession).toHaveBeenCalled();
  });

  it('opens settings.json and waits for Continue when config update fails, then proceeds with auth', async () => {
    pickBrowser('Microsoft Edge');
    mockSession();
    mockUpdate.mockRejectedValueOnce(new Error('not a registered configuration'));
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Continue' as any);

    const token = await signInWithBrowser(secrets);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.openSettingsJson');
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    // Auth flow proceeds because user clicked Continue
    expect(vscode.authentication.getSession).toHaveBeenCalled();
    expect(token).toBe('browser_token');
  });

  it('throws and does not start auth when config update fails and user cancels the warning', async () => {
    pickBrowser('Google Chrome');
    mockUpdate.mockRejectedValueOnce(new Error('not a registered configuration'));
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined as any);

    await expect(signInWithBrowser(secrets)).rejects.toThrow('GitHub browser sign-in was cancelled.');
    // Auth must NOT have started — we never called getSession
    expect(vscode.authentication.getSession).not.toHaveBeenCalled();
  });

  it('throws when the user dismisses the browser picker without selecting', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined as any);

    await expect(signInWithBrowser(secrets)).rejects.toThrow('GitHub browser sign-in was cancelled.');
    expect(vscode.authentication.getSession).not.toHaveBeenCalled();
  });

  it('throws when session is null (user cancelled browser sign-in)', async () => {
    pickBrowser('Microsoft Edge');
    vi.mocked(vscode.authentication.getSession).mockResolvedValue(null as any);

    await expect(signInWithBrowser(secrets)).rejects.toThrow('GitHub browser sign-in was cancelled.');
  });

  it('throws when accessToken is empty after browser sign-in', async () => {
    pickBrowser('Google Chrome');
    vi.mocked(vscode.authentication.getSession).mockResolvedValue({
      accessToken: '',
      id: 's4',
      scopes: ['repo'],
      account: { id: 'company-user', label: 'Company User' },
    } as any);

    await expect(signInWithBrowser(secrets)).rejects.toThrow(
      'GitHub authentication succeeded but no access token could be retrieved.'
    );
  });
});

describe('refreshSession', () => {
  const secrets = { get: vi.fn(), store: vi.fn().mockResolvedValue(undefined), delete: vi.fn() } as any;

  beforeEach(() => vi.clearAllMocks());

  it('calls getSession with forceNewSession', async () => {
    vi.mocked(vscode.authentication.getSession).mockResolvedValue({
      accessToken: 'refreshed_token',
      id: 's5',
      scopes: ['repo'],
      account: { id: 'user-id', label: 'User' },
    } as any);

    await refreshSession(secrets);

    expect(vscode.authentication.getSession).toHaveBeenCalledWith(
      'github',
      ['repo'],
      expect.objectContaining({ forceNewSession: expect.anything() })
    );
  });

  it('returns the access token on success', async () => {
    vi.mocked(vscode.authentication.getSession).mockResolvedValue({
      accessToken: 'refreshed_token',
      id: 's5',
      scopes: ['repo'],
      account: { id: 'user-id', label: 'User' },
    } as any);

    const token = await refreshSession(secrets);

    expect(token).toBe('refreshed_token');
  });

  it('stores the account ID in secrets on success', async () => {
    vi.mocked(vscode.authentication.getSession).mockResolvedValue({
      accessToken: 'refreshed_token',
      id: 's5',
      scopes: ['repo'],
      account: { id: 'user-id', label: 'User' },
    } as any);

    await refreshSession(secrets);

    expect(secrets.store).toHaveBeenCalledWith('copilotReviewer.githubAccountId', 'user-id');
  });

  it('returns undefined when the user dismisses the Allow prompt (getSession returns null)', async () => {
    vi.mocked(vscode.authentication.getSession).mockResolvedValue(null as any);

    const token = await refreshSession(secrets);

    expect(token).toBeUndefined();
  });

  it('returns undefined when getSession throws (e.g. user cancelled)', async () => {
    vi.mocked(vscode.authentication.getSession).mockRejectedValue(new Error('User cancelled'));

    const token = await refreshSession(secrets);

    expect(token).toBeUndefined();
  });
});

describe('hasPat', () => {
  it('returns true when a non-empty PAT is stored', async () => {
    const secrets = { get: vi.fn().mockResolvedValue('my-pat-mock'), store: vi.fn(), delete: vi.fn() } as any;
    expect(await hasPat(secrets)).toBe(true);
  });

  it('returns false when no PAT is stored', async () => {
    const secrets = { get: vi.fn().mockResolvedValue(undefined), store: vi.fn(), delete: vi.fn() } as any;
    expect(await hasPat(secrets)).toBe(false);
  });

  it('returns false when the stored PAT is an empty/whitespace string', async () => {
    const secrets = { get: vi.fn().mockResolvedValue('   '), store: vi.fn(), delete: vi.fn() } as any;
    expect(await hasPat(secrets)).toBe(false);
  });
});

describe('storePat', () => {
  it('stores the PAT in SecretStorage under the correct key', async () => {
    const secrets = { get: vi.fn(), store: vi.fn().mockResolvedValue(undefined), delete: vi.fn() } as any;

    await storePat(secrets, 'my-new-pat-mock');

    expect(secrets.store).toHaveBeenCalledWith('copilotReviewer.githubPat', 'my-new-pat-mock');
  });

  it('stores the exact PAT string provided without modification', async () => {
    const secrets = { get: vi.fn(), store: vi.fn().mockResolvedValue(undefined), delete: vi.fn() } as any;

    await storePat(secrets, 'another-pat-mock');

    expect(secrets.store).toHaveBeenCalledWith('copilotReviewer.githubPat', 'another-pat-mock');
    expect(secrets.store).toHaveBeenCalledOnce();
  });
});

describe('clearPat', () => {
  it('deletes both the PAT and the stored account ID', async () => {
    const secrets = { get: vi.fn(), store: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) } as any;

    await clearPat(secrets);

    expect(secrets.delete).toHaveBeenCalledWith('copilotReviewer.githubPat');
    expect(secrets.delete).toHaveBeenCalledWith('copilotReviewer.githubAccountId');
    expect(secrets.delete).toHaveBeenCalledTimes(2);
  });
});

describe('setAuthOutputChannel', () => {
  it('does not throw when called with a valid output channel', () => {
    const ch = { appendLine: vi.fn() } as any;
    expect(() => setAuthOutputChannel(ch)).not.toThrow();
  });

  it('routes internal log messages through the supplied output channel', async () => {
    const ch = { appendLine: vi.fn() } as any;
    setAuthOutputChannel(ch);

    const secrets = {
      get: vi.fn().mockResolvedValue('pat-mock-for-logging'),
      store: vi.fn(),
      delete: vi.fn(),
    } as any;

    await getGitHubToken(secrets);

    expect(ch.appendLine).toHaveBeenCalledWith(expect.stringContaining('[auth]'));

    // Reset channel so it does not bleed into other tests
    setAuthOutputChannel(undefined as any);
  });
});

