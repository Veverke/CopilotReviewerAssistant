import * as vscode from 'vscode';
import type { OpenPr } from './githubApi';

export interface PrCoordinates {
  owner: string;
  repo: string;
  pullNumber: number;
}

const PR_URL_PATTERN = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

export async function promptForPrUrl(): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration('copilotReviewer');
  const preFill: boolean = config.get<boolean>('preFillFromClipboard') ?? false;

  let clipValue: string | undefined;
  if (preFill) {
    const clip = await vscode.env.clipboard.readText();
    clipValue = PR_URL_PATTERN.test(clip.trim()) ? clip.trim() : undefined;
  }

  return vscode.window.showInputBox({
    title: 'Copilot Reviewer Assistant',
    prompt: 'Enter the GitHub Pull Request URL',
    placeHolder: 'https://github.com/owner/repo/pull/123',
    ignoreFocusOut: true,
    value: clipValue,
  });
}

export function parsePrUrl(url: string): PrCoordinates {
  const match = url.trim().match(PR_URL_PATTERN);
  if (!match) {
    throw new Error(`Invalid GitHub PR URL: "${url}". Expected format: https://github.com/owner/repo/pull/123`);
  }
  const pullNumber = parseInt(match[3], 10);
  if (pullNumber <= 0 || pullNumber > 2_147_483_647) {
    throw new Error(`Invalid pull request number: ${match[3]}. Must be between 1 and 2147483647.`);
  }
  return { owner: match[1], repo: match[2], pullNumber };
}

export async function pickFromOpenPrs(
  prs: OpenPr[],
): Promise<PrCoordinates | undefined> {
  if (prs.length === 0) {
    // No open PRs found — fall back to manual URL entry
    const rawUrl = await promptForPrUrl();
    if (rawUrl === undefined) {
      return undefined;
    }
    return parsePrUrl(rawUrl);
  }

  // Show owner/repo prefix in the label only when PRs span multiple repos
  const distinctRepos = new Set(prs.map((pr) => `${pr.owner}/${pr.repo}`));
  const multiRepo = distinctRepos.size > 1;

  const items = prs.map((pr) => ({
    label: multiRepo
      ? `${pr.owner}/${pr.repo} #${pr.pullNumber} — ${pr.title}`
      : `#${pr.pullNumber} — ${pr.title}`,
    owner: pr.owner,
    repo: pr.repo,
    pullNumber: pr.pullNumber,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Copilot Reviewer Assistant — Select a Pull Request',
    placeHolder: 'Select an open PR to load Copilot review recommendations',
    ignoreFocusOut: true,
  });

  if (!picked) {
    return undefined;
  }

  return { owner: picked.owner, repo: picked.repo, pullNumber: picked.pullNumber };
}
