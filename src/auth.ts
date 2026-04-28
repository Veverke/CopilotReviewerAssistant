import * as vscode from 'vscode';

const SECRET_KEY = 'copilotReviewer.githubPat';

export async function getGitHubToken(secrets: vscode.SecretStorage): Promise<string> {
  const pat = (await secrets.get(SECRET_KEY))?.trim();
  if (pat) {
    return pat;
  }

  const session = await vscode.authentication.getSession(
    'github',
    ['repo'],
    { createIfNone: true }
  );

  if (!session) {
    throw new Error('GitHub sign-in was cancelled. Authentication is required to access PR comments.');
  }

  if (!session.accessToken) {
    throw new Error('GitHub authentication succeeded but no access token could be retrieved.');
  }

  return session.accessToken;
}

export async function storePat(secrets: vscode.SecretStorage, pat: string): Promise<void> {
  await secrets.store(SECRET_KEY, pat);
}

export async function clearPat(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(SECRET_KEY);
}
