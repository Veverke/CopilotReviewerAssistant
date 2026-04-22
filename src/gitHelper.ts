import * as vscode from 'vscode';

// ─── Git extension API minimal interfaces ────────────────────────────────────

interface GitExtension {
  getAPI(version: 1): GitAPI;
}

interface GitAPI {
  repositories: Repository[];
}

interface Repository {
  rootUri: vscode.Uri;
  add(resources: vscode.Uri[]): Promise<void>;
  commit(message: string): Promise<void>;
  push(): Promise<void>;
}

// ─── Status type used by ReviewPanel to update the Webview ───────────────────

export type GitStatus =
  | { state: 'pushing' }
  | { state: 'pushed' }
  | { state: 'push-failed'; reason: string }
  | { state: 'no-repo' };

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

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return git.repositories[0];
  }

  const wsPath = workspaceFolders[0].uri.fsPath;
  return (
    git.repositories.find((r) => r.rootUri.fsPath === wsPath) ?? git.repositories[0]
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function stageFiles(paths: string[]): Promise<void> {
  const repo = await getActiveRepository();
  if (!repo) {
    throw new Error('Git repository not found');
  }
  const uris = paths.map((p) => vscode.Uri.joinPath(repo.rootUri, p));
  await repo.add(uris);
}

export async function commitChanges(filePaths: string[], commentCount: number): Promise<void> {
  const repo = await getActiveRepository();
  if (!repo) {
    throw new Error('Git repository not found');
  }
  const fileList = filePaths.map((p) => `- ${p}`).join('\n');
  const message = `fix: apply ${commentCount} Copilot PR review recommendation(s)\n\nAffected files:\n${fileList}`;
  await repo.commit(message);
}

export async function pushChanges(): Promise<void> {
  const repo = await getActiveRepository();
  if (!repo) {
    throw new Error('Git repository not found');
  }
  await repo.push();
}
