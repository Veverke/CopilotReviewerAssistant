import * as vscode from 'vscode';

const SECRET_KEY = 'copilotReviewer.githubPat';
const ACCOUNT_ID_KEY = 'copilotReviewer.githubAccountId';

// Lightweight debug logger — writes to the shared output channel when available.
let _outputChannel: vscode.OutputChannel | undefined;
export function setAuthOutputChannel(ch: vscode.OutputChannel): void {
  _outputChannel = ch;
}
function log(msg: string): void {
  _outputChannel?.appendLine(`[auth] ${msg}`);
}

export async function getGitHubToken(secrets: vscode.SecretStorage): Promise<string> {
  const pat = (await secrets.get(SECRET_KEY))?.trim();
  if (pat) {
    log('getGitHubToken: using stored PAT');
    return pat;
  }

  // Use a stored preferred account if the user previously signed in via browser for an alternate account
  const storedAccountId = (await secrets.get(ACCOUNT_ID_KEY))?.trim();
  log(`getGitHubToken: storedAccountId=${storedAccountId ?? '(none)'}`);

  let session: vscode.AuthenticationSession | undefined;
  if (storedAccountId) {
    log('getGitHubToken: trying getSession with stored account id');
    session = await vscode.authentication.getSession('github', ['repo'], {
      createIfNone: false,
      account: { id: storedAccountId, label: '' },
    });
    log(`getGitHubToken: stored-account session => ${session ? `id=${session.account.id} scopes=[${session.scopes.join(',')}]` : 'null'}`);
  }

  if (!session) {
    log('getGitHubToken: falling back to createIfNone=true session');
    session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
    log(`getGitHubToken: createIfNone session => ${session ? `id=${session.account.id} scopes=[${session.scopes.join(',')}]` : 'null'}`);
  }

  if (!session) {
    throw new Error('GitHub sign-in was cancelled. Authentication is required to access PR comments.');
  }

  if (!session.accessToken) {
    throw new Error('GitHub authentication succeeded but no access token could be retrieved.');
  }

  return session.accessToken;
}

interface BrowserOption extends vscode.QuickPickItem {
  browserId: string;
}

const BROWSER_OPTIONS: readonly BrowserOption[] = [
  { label: 'Microsoft Edge',  browserId: 'edge' },
  { label: 'Google Chrome',   browserId: 'chrome' },
  { label: 'Mozilla Firefox', browserId: 'firefox' },
  { label: 'System Default',  browserId: '', description: 'Use whatever browser VS Code opens by default' },
];

/**
 * Prompts the user to pick a browser, sets the `github-authentication.browser`
 * VS Code setting to that browser so the OAuth page opens there, then forces a
 * new GitHub sign-in session. Stores the chosen account ID in secrets so that
 * getGitHubToken can reuse it on subsequent calls.
 */
export async function signInWithBrowser(secrets: vscode.SecretStorage): Promise<string> {
  const picked = await vscode.window.showQuickPick<BrowserOption>([...BROWSER_OPTIONS], {
    title: 'GitHub Browser Sign-in — Select Browser',
    placeHolder: 'Choose the browser where you are signed in to GitHub',
    ignoreFocusOut: true,
  });

  if (!picked) {
    throw new Error('GitHub browser sign-in was cancelled.');
  }

  // Try to persist the chosen browser into the VS Code github-authentication.browser
  // setting so the OAuth flow opens in that browser. This setting is owned by VS Code's
  // built-in GitHub Auth extension — if the write fails (not registered in this VS Code
  // version), open settings.json and wait for the user to add it manually before we
  // trigger the OAuth flow (so the correct browser is actually used).
  if (picked.browserId) {
    // Check if the setting already has the desired value — skip all prompting if so.
    const currentBrowser = vscode.workspace
      .getConfiguration('github-authentication')
      .get<string>('browser');

    if (currentBrowser !== picked.browserId) {
      let settingWritten = false;
      try {
        const authConfig = vscode.workspace.getConfiguration('github-authentication');
        await authConfig.update('browser', picked.browserId, vscode.ConfigurationTarget.Global);
        settingWritten = true;
      } catch {
        // Setting not registered via the API — ask the user to add it manually.
      }

      if (!settingWritten) {
        const settingSnippet = `"github-authentication.browser": "${picked.browserId}"`;
        await vscode.commands.executeCommand('workbench.action.openSettingsJson');
        const action = await vscode.window.showWarningMessage(
          `VS Code could not set the browser automatically. Add the following line to your user settings.json (already opened), then click Continue to authenticate with ${picked.label}:\n\n${settingSnippet}`,
          { modal: false },
          'Continue',
          'Cancel'
        );
        if (action !== 'Continue') {
          throw new Error('GitHub browser sign-in was cancelled.');
        }
      }
    }
  }

  // VS Code will show an "Allow" notification before opening the browser.
  // This message ensures the user knows to watch for it.
  vscode.window.showInformationMessage(
    `GitHub sign-in: look for an "Allow" prompt from VS Code — click it to open ${picked.label} and complete sign-in.`
  );

  const session = await vscode.authentication.getSession('github', ['repo'], {
    forceNewSession: { detail: 'Sign in with a different GitHub account to access this repository.' },
  });

  if (!session) {
    throw new Error('GitHub browser sign-in was cancelled.');
  }

  if (!session.accessToken) {
    throw new Error('GitHub authentication succeeded but no access token could be retrieved.');
  }

  await secrets.store(ACCOUNT_ID_KEY, session.account.id);
  return session.accessToken;
}

/**
 * Silently forces a fresh GitHub OAuth session with repo scope and stores the
 * account ID for future calls. Returns the access token, or undefined if the
 * user dismissed the VS Code "Allow" prompt.
 *
 * This is called automatically when an API call fails with an access error so
 * the user only sees VS Code's built-in consent notification rather than an
 * extra dialog from this extension.
 */
export async function refreshSession(secrets: vscode.SecretStorage): Promise<string | undefined> {
  try {
    const session = await vscode.authentication.getSession('github', ['repo'], {
      forceNewSession: { detail: 'Sign in again to grant repository access.' },
    });
    if (!session?.accessToken) { return undefined; }
    await secrets.store(ACCOUNT_ID_KEY, session.account.id);
    return session.accessToken;
  } catch {
    return undefined;
  }
}

/** Returns true if the user has a stored Personal Access Token. */
export async function hasPat(secrets: vscode.SecretStorage): Promise<boolean> {
  return !!((await secrets.get(SECRET_KEY))?.trim());
}

export async function storePat(secrets: vscode.SecretStorage, pat: string): Promise<void> {
  await secrets.store(SECRET_KEY, pat);
}

export async function clearPat(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(SECRET_KEY);
  await secrets.delete(ACCOUNT_ID_KEY);
}
