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
import { stageFiles, commitChanges, pushChanges, getRemoteOwnerRepo, getAllRemoteOwnerRepos } from '../../gitHelper';

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

  it('throws "Git repository not found" when the extension is inactive and activate() resolves to null', async () => {
    vi.mocked(vscode.extensions.getExtension).mockReturnValue({
      isActive: false,
      activate: vi.fn().mockResolvedValue(null),
      exports: undefined,
    } as any);

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

  it('falls back to the active repository when findRepositoryRoot finds no remote match', async () => {
    const repo = makeRepo('/ws/fallback', [
      { name: 'origin', fetchUrl: 'https://github.com/other-org/other-repo.git' },
    ]);
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repo]) as any
    );

    await stageFiles(['src/foo.ts'], TEST_OWNER, TEST_REPO);

    const execFileMock = vi.mocked(execFile);
    const [, , opts] = execFileMock.mock.calls[0] as unknown as [string, string[], { cwd: string }, ...any[]];
    expect(opts.cwd).toBe('/ws/fallback');
  });

  it('uses the workspace-folder repo when workspaceFolders is set and rootUri matches (getActiveRepository find branch)', async () => {
    const repo = makeRepo('/ws/myproject', [
      { name: 'origin', fetchUrl: 'https://github.com/other-org/other-repo.git' },
    ]);
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repo]) as any
    );
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/ws/myproject' } }];

    await stageFiles(['src/foo.ts'], TEST_OWNER, TEST_REPO);

    const [, , opts] = vi.mocked(execFile).mock.calls[0] as unknown as [string, string[], { cwd: string }];
    expect(opts.cwd).toBe('/ws/myproject');
  });

  it('falls back to git.repositories[0] when workspaceFolders is set but no rootUri matches (getActiveRepository ?? branch)', async () => {
    const repo = makeRepo('/ws/other', [
      { name: 'origin', fetchUrl: 'https://github.com/other-org/other-repo.git' },
    ]);
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repo]) as any
    );
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/ws/different' } }];

    await stageFiles(['src/foo.ts'], TEST_OWNER, TEST_REPO);

    const [, , opts] = vi.mocked(execFile).mock.calls[0] as unknown as [string, string[], { cwd: string }];
    expect(opts.cwd).toBe('/ws/other'); // repos[0] used as fallback
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

    await commitChanges(['src/foo.ts'], 1, TEST_OWNER, TEST_REPO, [], '[abc-12345]');

    const [, args] = vi.mocked(execFile).mock.calls[0] as unknown as [string, string[], ...any[]];
    const msgArg: string = args[2];
    expect(msgArg.startsWith('[abc-12345] fix:')).toBe(true);
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

// ─── commitChanges (fallback path) ────────────────────────────────────────────────

describe('commitChanges (fallback when findRepositoryRoot has no match)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.workspace as any).workspaceFolders = undefined;
  });

  it('falls back to the active repository when no repo remote matches owner/repo', async () => {
    // Repo exists but its remote does not match TEST_OWNER/TEST_REPO
    const repo = makeRepo('/ws/other', [
      { name: 'origin', fetchUrl: 'https://github.com/other-org/other-repo.git' },
    ]);
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repo]) as any
    );

    // findRepositoryRoot returns undefined → getActiveRepository returns repos[0]
    await commitChanges(['src/foo.ts'], 1, TEST_OWNER, TEST_REPO);

    const [, args, opts] = vi.mocked(execFile).mock.calls[0] as unknown as [string, string[], { cwd: string }, ...any[]];
    expect(args[0]).toBe('commit');
    expect(opts.cwd).toBe('/ws/other');
  });
});

// ─── pushChanges (fallback path) ───────────────────────────────────────────────────

describe('pushChanges (fallback when findRepositoryRoot has no match)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.workspace as any).workspaceFolders = undefined;
  });

  it('falls back to the active repository when no repo remote matches owner/repo', async () => {
    const repo = makeRepo('/ws/other', [
      { name: 'origin', fetchUrl: 'https://github.com/other-org/other-repo.git' },
    ]);
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repo]) as any
    );

    await pushChanges(TEST_OWNER, TEST_REPO);

    const [, args, opts] = vi.mocked(execFile).mock.calls[0] as unknown as [string, string[], { cwd: string }, ...any[]];
    expect(args[0]).toBe('push');
    expect(opts.cwd).toBe('/ws/other');
  });
});

// ─── getAllRemoteOwnerRepos ──────────────────────────────────────────────────────────

describe('getAllRemoteOwnerRepos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.workspace as any).workspaceFolders = undefined;
  });

  it('returns an empty array when the git extension is not found', async () => {
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(undefined as any);

    const result = await getAllRemoteOwnerRepos();
    expect(result).toEqual([]);
  });

  it('returns owner/repo pairs from all repositories with a GitHub remote', async () => {
    const repo1 = makeRepo('/ws/a', [{ name: 'origin', fetchUrl: 'https://github.com/org1/project-a.git' }]);
    const repo2 = makeRepo('/ws/b', [{ name: 'origin', fetchUrl: 'https://github.com/org2/project-b.git' }]);
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repo1, repo2]) as any
    );

    const result = await getAllRemoteOwnerRepos();

    expect(result).toEqual([
      { owner: 'org1', repo: 'project-a' },
      { owner: 'org2', repo: 'project-b' },
    ]);
  });

  it('skips repositories that have no remotes', async () => {
    const withRemote = makeRepo('/ws/a', [{ name: 'origin', fetchUrl: 'https://github.com/org/repo.git' }]);
    const noRemote = makeRepo('/ws/b', []);
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([withRemote, noRemote]) as any
    );

    const result = await getAllRemoteOwnerRepos();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ owner: 'org', repo: 'repo' });
  });

  it('skips repositories whose remote URL is not a GitHub URL', async () => {
    const github = makeRepo('/ws/a', [{ name: 'origin', fetchUrl: 'https://github.com/org/repo.git' }]);
    const gitlab = makeRepo('/ws/b', [{ name: 'origin', fetchUrl: 'https://gitlab.com/org/other.git' }]);
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([github, gitlab]) as any
    );

    const result = await getAllRemoteOwnerRepos();

    expect(result).toHaveLength(1);
    expect(result[0].owner).toBe('org');
  });

  it('prefers the origin remote over other remotes', async () => {
    const repo = makeRepo('/ws/a', [
      { name: 'upstream', fetchUrl: 'https://github.com/upstream-org/repo.git' },
      { name: 'origin', fetchUrl: 'https://github.com/my-org/repo.git' },
    ]);
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repo]) as any
    );

    const result = await getAllRemoteOwnerRepos();

    expect(result).toEqual([{ owner: 'my-org', repo: 'repo' }]);
  });

  it('parses SSH remote URLs correctly', async () => {
    const repo = makeRepo('/ws/a', [{ name: 'origin', fetchUrl: 'git@github.com:my-org/ssh-repo.git' }]);
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repo]) as any
    );

    const result = await getAllRemoteOwnerRepos();

    expect(result).toEqual([{ owner: 'my-org', repo: 'ssh-repo' }]);
  });

  it('uses the first remote when no origin remote exists in the repository', async () => {
    const repo = makeRepo('/ws/a', [
      { name: 'upstream', fetchUrl: 'https://github.com/upstream-org/upstream-repo.git' },
    ]);
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(
      makeGitExtension([repo]) as any
    );

    const result = await getAllRemoteOwnerRepos();

    expect(result).toEqual([{ owner: 'upstream-org', repo: 'upstream-repo' }]);
  });

  it('waits for repositories to appear when git has none on initial activation', async () => {
    const repo = makeRepo('/ws/a', [{ name: 'origin', fetchUrl: 'https://github.com/org/late-repo.git' }]);
    const api = { repositories: [] as ReturnType<typeof makeRepo>[] };
    const ext = { getAPI: vi.fn().mockReturnValue(api) };
    vi.mocked(vscode.extensions.getExtension).mockReturnValue({ isActive: true, exports: ext } as any);

    // Invoke the setInterval callback in the next microtask (not synchronously)
    // so that `const interval = setInterval(...)` is assigned before fn() runs,
    // avoiding the temporal dead zone. This lets V8 track the polling-loop body.
    const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation((fn: any) => {
      api.repositories.push(repo); // simulate repos appearing before the first tick
      queueMicrotask(() => fn());   // defer so `interval` is in scope when fn executes
      return 999 as any;
    });
    try {
      const result = await getAllRemoteOwnerRepos();
      expect(result).toEqual([{ owner: 'org', repo: 'late-repo' }]);
    } finally {
      setIntervalSpy.mockRestore();
    }
  });
});
