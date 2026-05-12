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
 *
 *  getRemoteOwnerRepo()
 *    - parses HTTPS and SSH remote URLs
 *    - returns undefined for non-GitHub remotes or missing extension
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execFile: vi.fn((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') { cb(null, '', ''); }
  }),
}));

vi.mock('vscode', () => ({
  extensions: { getExtension: vi.fn() },
  workspace: { workspaceFolders: undefined as any },
  Uri: { file: vi.fn((p: string) => ({ fsPath: p })) },
}));

import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { stageFiles, commitChanges, pushChanges, getRemoteOwnerRepo } from '../../gitHelper';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_OWNER = 'testorg';
const TEST_REPO = 'testrepo';
const TEST_REMOTE_URL = `https://github.com/${TEST_OWNER}/${TEST_REPO}.git`;

function makeRepo(rootFsPath = '/workspace', remotes: { name: string; fetchUrl?: string; pushUrl?: string }[] = [
  { name: 'origin', fetchUrl: TEST_REMOTE_URL },
]) {
  return {
    rootUri: { fsPath: rootFsPath },
    state: { remotes },
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

  it('calls git add with absolute paths derived from rootUri + relative paths', async () => {
    const repo = makeRepo('/ws');
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repo]) as any
    );

    await stageFiles(['src/foo.ts', 'src/bar.ts'], TEST_OWNER, TEST_REPO);

    const execFileMock = vi.mocked(execFile);
    expect(execFileMock).toHaveBeenCalledOnce();
    const [cmd, args] = execFileMock.mock.calls[0] as unknown as [string, string[], ...any[]];
    expect(cmd).toBe('git');
    expect(args[0]).toBe('add');
    expect(args[1]).toBe('--');
    expect(args.some((a: string) => /src.foo\.ts$/.test(a))).toBe(true);
    expect(args.some((a: string) => /src.bar\.ts$/.test(a))).toBe(true);
  });

  it('uses the repo that matches the PR owner/repo remote, not the first workspace folder', async () => {
    const wrongRepo = makeRepo('/ws/wrong-service', [
      { name: 'origin', fetchUrl: 'https://github.com/testorg/wrong-service.git' },
    ]);
    const correctRepo = makeRepo('/ws/testrepo', [
      { name: 'origin', fetchUrl: TEST_REMOTE_URL },
    ]);
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([wrongRepo, correctRepo]) as any
    );
    // Workspace folder points at wrong-service, but PR is for testrepo
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/ws/wrong-service' } }];

    await stageFiles(['src/foo.ts'], TEST_OWNER, TEST_REPO);

    const execFileMock = vi.mocked(execFile);
    const [,, opts] = execFileMock.mock.calls[0] as unknown as [string, string[], { cwd: string }, ...any[]];
    expect(opts.cwd).toBe('/ws/testrepo');
  });

  it('throws "Git repository not found" when the git extension is missing', async () => {
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(undefined as any);

    await expect(stageFiles(['src/foo.ts'], TEST_OWNER, TEST_REPO)).rejects.toThrow(
      'Git repository not found'
    );
  });

  it('throws "Git repository not found" when repositories array is empty', async () => {
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([]) as any
    );

    await expect(stageFiles(['src/foo.ts'], TEST_OWNER, TEST_REPO)).rejects.toThrow(
      'Git repository not found'
    );
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

    await commitChanges(['src/foo.ts', 'src/bar.ts'], 2, TEST_OWNER, TEST_REPO);

    const execFileMock = vi.mocked(execFile);
    expect(execFileMock).toHaveBeenCalledOnce();
    const [cmd, args] = execFileMock.mock.calls[0] as unknown as [string, string[], ...any[]];
    expect(cmd).toBe('git');
    expect(args[0]).toBe('commit');
    const message = args.join(' ');
    expect(message).toContain('2');
    expect(message).toContain('src/foo.ts');
    expect(message).toContain('src/bar.ts');
  });

  it('commit message starts with "fix:"', async () => {
    const repo = makeRepo();
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repo]) as any
    );

    await commitChanges(['src/foo.ts'], 1, TEST_OWNER, TEST_REPO);

    const [, args] = vi.mocked(execFile).mock.calls[0] as unknown as [string, string[], ...any[]];
    const msgArg: string = args[2]; // git commit -m <message>
    expect(msgArg.startsWith('fix:')).toBe(true);
  });

  it('prepends commitPrefix to commit message when provided', async () => {
    const repo = makeRepo();
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repo]) as any
    );

    await commitChanges(['src/foo.ts'], 1, TEST_OWNER, TEST_REPO, [], '[XLR-1234]');

    const [, args] = vi.mocked(execFile).mock.calls[0] as unknown as [string, string[], ...any[]];
    const msgArg: string = args[2];
    expect(msgArg.startsWith('[XLR-1234] fix:')).toBe(true);
  });

  it('does not prepend anything when commitPrefix is empty', async () => {
    const repo = makeRepo();
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repo]) as any
    );

    await commitChanges(['src/foo.ts'], 1, TEST_OWNER, TEST_REPO, [], '');

    const [, args] = vi.mocked(execFile).mock.calls[0] as unknown as [string, string[], ...any[]];
    const msgArg: string = args[2];
    expect(msgArg.startsWith('fix:')).toBe(true);
  });

  it('throws "Git repository not found" when no repo', async () => {
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(undefined as any);

    await expect(commitChanges(['src/foo.ts'], 1, TEST_OWNER, TEST_REPO)).rejects.toThrow(
      'Git repository not found'
    );
  });

  it('includes issues in commit message when provided', async () => {
    const repo = makeRepo();
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repo]) as any
    );
    const issues = ['[src/foo.ts:10] Remove unused import', '[src/bar.ts:20] Fix null check'];

    await commitChanges(['src/foo.ts', 'src/bar.ts'], 2, TEST_OWNER, TEST_REPO, issues);

    const [, args] = vi.mocked(execFile).mock.calls[0] as unknown as [string, string[], ...any[]];
    const msgArg: string = args[2];
    expect(msgArg).toContain('Issues fixed:');
    expect(msgArg).toContain('[src/foo.ts:10] Remove unused import');
    expect(msgArg).toContain('[src/bar.ts:20] Fix null check');
  });

  it('omits the "Issues fixed:" section when issues array is empty', async () => {
    const repo = makeRepo();
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repo]) as any
    );

    await commitChanges(['src/foo.ts'], 1, TEST_OWNER, TEST_REPO, []);

    const [, args] = vi.mocked(execFile).mock.calls[0] as unknown as [string, string[], ...any[]];
    expect(args[2]).not.toContain('Issues fixed:');
  });
});

// ─── pushChanges ──────────────────────────────────────────────────────────────

describe('pushChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.workspace as any).workspaceFolders = undefined;
  });

  it('runs git push in the correct repo directory', async () => {
    const repo = makeRepo('/ws/testrepo');
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repo]) as any
    );

    await pushChanges(TEST_OWNER, TEST_REPO);

    const execFileMock = vi.mocked(execFile);
    expect(execFileMock).toHaveBeenCalledOnce();
    const [cmd, args, opts] = execFileMock.mock.calls[0] as unknown as [string, string[], { cwd: string }, ...any[]];
    expect(cmd).toBe('git');
    expect(args).toContain('push');
    expect(opts.cwd).toBe('/ws/testrepo');
  });

  it('throws "Git repository not found" when no repo', async () => {
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(undefined as any);

    await expect(pushChanges(TEST_OWNER, TEST_REPO)).rejects.toThrow('Git repository not found');
  });
});

// ─── getRemoteOwnerRepo ───────────────────────────────────────────────────────

describe('getRemoteOwnerRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.workspace as any).workspaceFolders = undefined;
  });

  it('returns owner and repo parsed from an HTTPS origin remote', async () => {
    const repo = makeRepo('/ws', [{ name: 'origin', fetchUrl: 'https://github.com/acme/my-project.git' }]);
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(makeGitExtension([repo]) as any);

    const result = await getRemoteOwnerRepo();
    expect(result).toEqual({ owner: 'acme', repo: 'my-project' });
  });

  it('returns owner and repo parsed from an SSH origin remote', async () => {
    const repo = makeRepo('/ws', [{ name: 'origin', fetchUrl: 'git@github.com:org/repo-name.git' }]);
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(makeGitExtension([repo]) as any);

    const result = await getRemoteOwnerRepo();
    expect(result).toEqual({ owner: 'org', repo: 'repo-name' });
  });

  it('falls back to pushUrl when fetchUrl is undefined', async () => {
    const repo = makeRepo('/ws', [{ name: 'origin', pushUrl: 'https://github.com/owner/repo.git' }]);
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(makeGitExtension([repo]) as any);

    const result = await getRemoteOwnerRepo();
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('uses the first remote when there is no "origin"', async () => {
    const repo = makeRepo('/ws', [{ name: 'upstream', fetchUrl: 'https://github.com/upstream-owner/upstream-repo.git' }]);
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(makeGitExtension([repo]) as any);

    const result = await getRemoteOwnerRepo();
    expect(result).toEqual({ owner: 'upstream-owner', repo: 'upstream-repo' });
  });

  it('returns undefined when there are no remotes', async () => {
    const repo = makeRepo('/ws', []);
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(makeGitExtension([repo]) as any);

    const result = await getRemoteOwnerRepo();
    expect(result).toBeUndefined();
  });

  it('returns undefined when the remote URL is not a GitHub URL', async () => {
    const repo = makeRepo('/ws', [{ name: 'origin', fetchUrl: 'https://gitlab.com/owner/repo.git' }]);
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(makeGitExtension([repo]) as any);

    const result = await getRemoteOwnerRepo();
    expect(result).toBeUndefined();
  });

  it('returns undefined when the git extension is missing', async () => {
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(undefined as any);

    const result = await getRemoteOwnerRepo();
    expect(result).toBeUndefined();
  });
});
