import * as vscode from 'vscode';

/**
 * Returns true if a workspace folder is open in VS Code.
 * Synchronous — safe to call at any point.
 */
export function isWorkspaceAvailable(): boolean {
  return (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
}

/**
 * Reads .git/HEAD to determine the currently checked-out branch.
 * If the branch does not match prHeadBranch, shows a warning message.
 * Never throws — failures are silently ignored.
 */
export async function warnIfBranchMismatch(
  prHeadBranch: string,
  repoName: string
): Promise<void> {
  if (!isWorkspaceAvailable()) { return; }
  const workspaceRoot = vscode.workspace.workspaceFolders![0].uri;
  try {
    const gitHeadUri = vscode.Uri.joinPath(workspaceRoot, '.git', 'HEAD');
    const headBytes = await vscode.workspace.fs.readFile(gitHeadUri);
    const headContent = Buffer.from(headBytes).toString('utf8').trim();
    const match = headContent.match(/^ref: refs\/heads\/(.+)$/);
    if (!match) { return; } // detached HEAD — skip
    const currentBranch = match[1];
    if (currentBranch !== prHeadBranch) {
      vscode.window.showWarningMessage(
        `This PR is on branch "${prHeadBranch}" of "${repoName}". ` +
        `Please open that repository and check out that branch in VS Code in order to generate review work plans.`
      );
    }
  } catch {
    // .git not found or unreadable — silently ignore
  }
}
