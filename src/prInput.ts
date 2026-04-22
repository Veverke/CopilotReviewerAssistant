import * as vscode from 'vscode';

export interface PrCoordinates {
  owner: string;
  repo: string;
  pullNumber: number;
}

const PR_URL_PATTERN = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

export async function promptForPrUrl(): Promise<string | undefined> {
  const clip = await vscode.env.clipboard.readText();
  const isGhPrUrl = PR_URL_PATTERN.test(clip.trim());

  return vscode.window.showInputBox({
    title: 'Copilot Reviewer Assistant',
    prompt: 'Enter the GitHub Pull Request URL',
    placeHolder: 'https://github.com/owner/repo/pull/123',
    ignoreFocusOut: true,
    value: isGhPrUrl ? clip.trim() : undefined,
  });
}

export function parsePrUrl(url: string): PrCoordinates {
  const match = url.trim().match(PR_URL_PATTERN);
  if (!match) {
    throw new Error(`Invalid GitHub PR URL: "${url}". Expected format: https://github.com/owner/repo/pull/123`);
  }
  return { owner: match[1], repo: match[2], pullNumber: parseInt(match[3], 10) };
}
