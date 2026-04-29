/**
 * Phase 1 – Workspace/Branch Validation
 *
 * Test plan:
 *  isWorkspaceAvailable()
 *    - returns false when vscode.workspace.workspaceFolders is undefined
 *    - returns false when vscode.workspace.workspaceFolders is empty array
 *    - returns true when workspace folders are present
 *
 *  warnIfBranchMismatch()
 *    - shows warning when current branch differs from PR head branch
 *    - does NOT show warning when branches match
 *    - does NOT show warning or throw when no workspace is open
 *    - does NOT show warning or throw when .git/HEAD read fails
 *    - handles detached HEAD without warning or throwing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode');

import * as vscode from 'vscode';
import { isWorkspaceAvailable, warnIfBranchMismatch } from '../../workspaceValidator';

function encodeHead(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

describe('isWorkspaceAvailable', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns false when workspaceFolders is undefined', () => {
    (vscode.workspace as any).workspaceFolders = undefined;
    expect(isWorkspaceAvailable()).toBe(false);
  });

  it('returns false when workspaceFolders is empty array', () => {
    (vscode.workspace as any).workspaceFolders = [];
    expect(isWorkspaceAvailable()).toBe(false);
  });

  it('returns true when workspace folders are present', () => {
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/repo' } }];
    expect(isWorkspaceAvailable()).toBe(true);
  });
});

describe('warnIfBranchMismatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/repo' } }];
    vi.mocked(vscode.Uri.joinPath).mockReturnValue({ fsPath: '/repo/.git/HEAD' } as any);
  });

  it('shows warning when current branch differs from PR head branch', async () => {
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      encodeHead('ref: refs/heads/feature-xyz') as any
    );

    await warnIfBranchMismatch('main', 'my-repo');

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'This PR is on branch "main" of "my-repo". ' +
      'Please open that repository and check out that branch in VS Code in order to generate review work plans.'
    );
  });

  it('does NOT show warning when branches match', async () => {
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      encodeHead('ref: refs/heads/main') as any
    );

    await warnIfBranchMismatch('main', 'my-repo');

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('does NOT show warning or throw when no workspace is open', async () => {
    (vscode.workspace as any).workspaceFolders = undefined;

    await expect(warnIfBranchMismatch('main', 'my-repo')).resolves.toBeUndefined();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('does NOT show warning or throw when .git/HEAD read fails', async () => {
    vi.mocked(vscode.workspace.fs.readFile).mockRejectedValue(new Error('file not found'));

    await expect(warnIfBranchMismatch('main', 'my-repo')).resolves.toBeUndefined();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('handles detached HEAD without warning or throwing', async () => {
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      encodeHead('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2') as any
    );

    await expect(warnIfBranchMismatch('main', 'my-repo')).resolves.toBeUndefined();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });
});
