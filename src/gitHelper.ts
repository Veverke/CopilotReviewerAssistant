import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

// ─── Git extension API minimal interfaces ────────────────────────────────────

interface GitExtension {
  getAPI(version: 1): GitAPI;
}

interface GitAPI {
  repositories: Repository[];
  onDidOpenRepository: vscode.Event<Repository>;
}

interface GitRemote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

interface Repository {
  rootUri: vscode.Uri;
  state: {
    remotes: GitRemote[];
  };
  commit(message: string): Promise<void>;
  push(): Promise<void>;
}

// ─── Status type used by ReviewPanel to update the Webview ───────────────────

export type GitStatus =
  | { state: 'pushing' }
  | { state: 'pushed' }
  | { state: 'push-failed'; reason: string }
  | { state: 'no-repo' }
  | { state: 'ready' };

// ─── Internals ────────────────────────────────────────────────────────────────

async function getGitAPI(): Promise<GitAPI | undefined> {
  const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!extension) {
    return undefined;
  }
  const gitExtension = extension.isActive ? extension.exports : await extension.activate();
  return gitExtension?.getAPI(1);
}

async function getActiveRepository(): Promise<Repository | undefined> {
  const git = await getGitAPI();
  if (!git) {
    return undefined;
  }

  // The Git extension may still be scanning on first activation — poll up to 3 s
  if (git.repositories.length === 0) {
    await new Promise<void>((resolve) => {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (git.repositories.length > 0 || attempts >= 30) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return git.repositories[0];
  }

  const wsPath = workspaceFolders[0].uri.fsPath;
  return (
    git.repositories.find((r) => r.rootUri.fsPath === wsPath) ?? git.repositories[0]
  );
}

/**
 * Finds the local git repository whose GitHub remote matches the given
 * owner/repo. Returns the rootUri.fsPath of that repository, or undefined
 * if no match is found.
 */
async function findRepositoryRoot(owner: string, repo: string): Promise<string | undefined> {
  const git = await getGitAPI();
  if (!git) { return undefined; }
  for (const r of git.repositories) {
    const remotes = r.state?.remotes ?? [];
    for (const remote of remotes) {
      const url = remote.fetchUrl ?? remote.pushUrl ?? '';
      const m = url.match(GITHUB_REMOTE_PATTERN);
      if (m && m[1].toLowerCase() === owner.toLowerCase() && m[2].toLowerCase() === repo.toLowerCase()) {
        return r.rootUri.fsPath;
      }
    }
  }
  return undefined;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function stageFiles(
  paths: string[],
  owner: string,
  repo: string,
  outputChannel?: { appendLine(value: string): void },
): Promise<void> {
  // Find the local repo that matches the PR being reviewed — not just the
  // first workspace folder, which could be a completely different service.
  let rootFsPath = await findRepositoryRoot(owner, repo);
  if (!rootFsPath) {
    // Fallback: use the active repository (matches workspace folder)
    const activeRepo = await getActiveRepository();
    if (!activeRepo) { throw new Error('Git repository not found'); }
    rootFsPath = activeRepo.rootUri.fsPath;
  }
  outputChannel?.appendLine(`[stageFiles] rootFsPath="${rootFsPath}" (owner=${owner}, repo=${repo})`);
  const validPaths = paths.filter((p): p is string => typeof p === 'string' && p.length > 0);
  if (validPaths.length === 0) { return; }
  const absPaths: string[] = [];
  for (const p of validPaths) {
    const abs = path.join(rootFsPath, p);
    outputChannel?.appendLine(`[stageFiles] staging abs="${abs}"`);
    absPaths.push(abs);
  }
  outputChannel?.appendLine(`[stageFiles] running git add for ${absPaths.length} path(s)`);
  await execFileAsync('git', ['add', '--', ...absPaths], { cwd: rootFsPath });
  outputChannel?.appendLine(`[stageFiles] git add succeeded`);
}

export async function commitChanges(
  filePaths: string[],
  commentCount: number,
  owner: string,
  repo: string,
  issues: string[] = [],
  commitPrefix: string = '',
): Promise<void> {
  let rootFsPath = await findRepositoryRoot(owner, repo);
  if (!rootFsPath) {
    const activeRepo = await getActiveRepository();
    if (!activeRepo) { throw new Error('Git repository not found'); }
    rootFsPath = activeRepo.rootUri.fsPath;
  }
  const fileList = filePaths.map((p) => `- ${p}`).join('\n');
  const issueLines = issues.length > 0
    ? '\n\nIssues fixed:\n' + issues.map((s, i) => `${i + 1}. ${s.slice(0, 120)}`).join('\n')
    : '';
  const body = `fix: apply ${commentCount} Copilot PR review recommendation(s)\n\nAffected files:\n${fileList}${issueLines}`;
  const message = commitPrefix ? `${commitPrefix} ${body}` : body;
  await execFileAsync('git', ['commit', '-m', message], { cwd: rootFsPath });
}

export async function pushChanges(owner: string, repo: string): Promise<void> {
  let rootFsPath = await findRepositoryRoot(owner, repo);
  if (!rootFsPath) {
    const activeRepo = await getActiveRepository();
    if (!activeRepo) { throw new Error('Git repository not found'); }
    rootFsPath = activeRepo.rootUri.fsPath;
  }
  await execFileAsync('git', ['push'], { cwd: rootFsPath });
}

// ─── Detect owner/repo from git remote ────────────────────────────────────────

const GITHUB_REMOTE_PATTERN = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/;

export async function getRemoteOwnerRepo(): Promise<{ owner: string; repo: string } | undefined> {
  const repository = await getActiveRepository();
  if (!repository) {
    return undefined;
  }
  const remotes = repository.state?.remotes ?? [];
  // Prefer 'origin', then fall back to the first remote
  const remote = remotes.find((r) => r.name === 'origin') ?? remotes[0];
  if (!remote) {
    return undefined;
  }
  const url = remote.fetchUrl ?? remote.pushUrl ?? '';
  const match = url.match(GITHUB_REMOTE_PATTERN);
  if (!match) {
    return undefined;
  }
  return { owner: match[1], repo: match[2] };
}

/**
 * Returns the GitHub owner/repo coordinates for every git repository found in
 * the current VS Code workspace. Useful for multi-root workspaces.
 */
export async function getAllRemoteOwnerRepos(): Promise<Array<{ owner: string; repo: string }>> {
  const git = await getGitAPI();
  if (!git) { return []; }

  if (git.repositories.length === 0) {
    await new Promise<void>((resolve) => {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (git.repositories.length > 0 || attempts >= 30) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });
  }

  const results: Array<{ owner: string; repo: string }> = [];
  for (const repository of git.repositories) {
    const remotes = repository.state?.remotes ?? [];
    const remote = remotes.find((r) => r.name === 'origin') ?? remotes[0];
    if (!remote) { continue; }
    const url = remote.fetchUrl ?? remote.pushUrl ?? '';
    const match = url.match(GITHUB_REMOTE_PATTERN);
    if (!match) { continue; }
    results.push({ owner: match[1], repo: match[2] });
  }
  return results;
}
