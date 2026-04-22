/**
 * Phase 8 – Git Integration
 *
 * Test plan:
 *  stageFiles()
 *    - calls repo.add() with the correct URIs derived from rootUri
 *    - throws "Git repository not found" when git extension is missing
 *    - throws "Git repository not found" when no repositories exist
 *
 *  commitChanges()
 *    - calls repo.commit() with a message that includes the count and file list
 *    - commit message starts with the conventional "fix:" prefix
 *    - throws "Git repository not found" when no repo
 *
 *  pushChanges()
 *    - calls repo.push() on the active repository
 *    - throws "Git repository not found" when no repo
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  extensions: { getExtension: vi.fn() },
  workspace: { workspaceFolders: undefined as any },
  Uri: { joinPath: vi.fn() },
}));

import * as vscode from 'vscode';
import { stageFiles, commitChanges, pushChanges } from '../../gitHelper';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRepo(rootFsPath = '/workspace') {
  return {
    rootUri: { fsPath: rootFsPath },
    add: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
  };
}

function makeGitExtension(repos: ReturnType<typeof makeRepo>[]) {
  const api = { repositories: repos };
  const ext = { getAPI: vi.fn().mockReturnValue(api) };
  return { isActive: true, exports: ext };
}

// ─── stageFiles ───────────────────────────────────────────────────────────────

describe('stageFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.workspace as any).workspaceFolders = undefined;
  });

  it('calls repo.add() with URIs built from rootUri + relative paths', async () => {
    const repo = makeRepo('/ws');
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repo]) as any
    );
    vi.mocked(vscode.Uri.joinPath).mockImplementation(
      (_base: any, p: string) => ({ fsPath: `/ws/${p}` }) as any
    );

    await stageFiles(['src/foo.ts', 'src/bar.ts']);

    expect(repo.add).toHaveBeenCalledOnce();
    const uris: any[] = repo.add.mock.calls[0][0];
    expect(uris).toHaveLength(2);
    expect(uris[0].fsPath).toBe('/ws/src/foo.ts');
    expect(uris[1].fsPath).toBe('/ws/src/bar.ts');
  });

  it('throws "Git repository not found" when the git extension is missing', async () => {
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(undefined as any);

    await expect(stageFiles(['src/foo.ts'])).rejects.toThrow(
      'Git repository not found'
    );
  });

  it('throws "Git repository not found" when repositories array is empty', async () => {
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([]) as any
    );

    await expect(stageFiles(['src/foo.ts'])).rejects.toThrow(
      'Git repository not found'
    );
  });

  it('picks the repository matching the workspace folder', async () => {
    const repoA = makeRepo('/ws/project-a');
    const repoB = makeRepo('/ws/project-b');
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repoA, repoB]) as any
    );
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/ws/project-b' } },
    ];
    vi.mocked(vscode.Uri.joinPath).mockImplementation(
      (_base: any, p: string) => ({ fsPath: `/ws/project-b/${p}` }) as any
    );

    await stageFiles(['src/foo.ts']);

    expect(repoB.add).toHaveBeenCalled();
    expect(repoA.add).not.toHaveBeenCalled();
  });
});

// ─── commitChanges ────────────────────────────────────────────────────────────

describe('commitChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.workspace as any).workspaceFolders = undefined;
  });

  it('commits with a message that includes the file count and each file path', async () => {
    const repo = makeRepo();
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repo]) as any
    );

    await commitChanges(['src/foo.ts', 'src/bar.ts'], 2);

    expect(repo.commit).toHaveBeenCalledOnce();
    const message: string = repo.commit.mock.calls[0][0];
    expect(message).toContain('2');
    expect(message).toContain('src/foo.ts');
    expect(message).toContain('src/bar.ts');
  });

  it('commit message starts with "fix:"', async () => {
    const repo = makeRepo();
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repo]) as any
    );

    await commitChanges(['src/foo.ts'], 1);

    const message: string = repo.commit.mock.calls[0][0];
    expect(message.startsWith('fix:')).toBe(true);
  });

  it('throws "Git repository not found" when no repo', async () => {
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(undefined as any);

    await expect(commitChanges(['src/foo.ts'], 1)).rejects.toThrow(
      'Git repository not found'
    );
  });
});

// ─── pushChanges ──────────────────────────────────────────────────────────────

describe('pushChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.workspace as any).workspaceFolders = undefined;
  });

  it('calls repo.push() on the active repository', async () => {
    const repo = makeRepo();
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repo]) as any
    );

    await pushChanges();

    expect(repo.push).toHaveBeenCalledOnce();
  });

  it('throws "Git repository not found" when no repo', async () => {
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(undefined as any);

    await expect(pushChanges()).rejects.toThrow('Git repository not found');
  });
});
