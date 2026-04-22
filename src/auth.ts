import * as vscode from 'vscode';

export async function getGitHubToken(): Promise<string> {
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
