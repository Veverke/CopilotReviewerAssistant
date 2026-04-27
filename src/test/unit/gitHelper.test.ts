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

vi.mock('fs');

import * as vscode from 'vscode';
import * as fs from 'fs';
import { stageFiles, commitChanges, pushChanges, getRemoteOwnerRepo, detectBuildCommand, splitBuildCommand } from '../../gitHelper';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRepo(rootFsPath = '/workspace', remotes: { name: string; fetchUrl?: string; pushUrl?: string }[] = []) {
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

// ─── detectBuildCommand ───────────────────────────────────────────────────────

describe('detectBuildCommand', () => {
  beforeEach(() => vi.clearAllMocks());

  function mockFs({
    existsMap = {} as Record<string, boolean>,
    pkgJson = undefined as Record<string, unknown> | undefined,
    dirEntries = [] as string[],
  }) {
    // Normalize to forward slashes so tests work on both Windows and Unix
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const key = (p as string).replace(/\\/g, '/');
      return existsMap[key] ?? false;
    });
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      if (pkgJson) { return JSON.stringify(pkgJson); }
      throw new Error('not found');
    });
    vi.mocked(fs.readdirSync).mockReturnValue(dirEntries as any);
  }

  it('returns npm run build when package.json has a build script', () => {
    mockFs({
      existsMap: { '/ws/package.json': true },
      pkgJson: { scripts: { build: 'tsc' } },
    });
    expect(detectBuildCommand('/ws')).toBe('npm run build');
  });

  it('prefers build over compile in package.json scripts', () => {
    mockFs({
      existsMap: { '/ws/package.json': true },
      pkgJson: { scripts: { build: 'webpack', compile: 'tsc' } },
    });
    expect(detectBuildCommand('/ws')).toBe('npm run build');
  });

  it('returns npm run compile when only compile script exists', () => {
    mockFs({
      existsMap: { '/ws/package.json': true },
      pkgJson: { scripts: { compile: 'tsc' } },
    });
    expect(detectBuildCommand('/ws')).toBe('npm run compile');
  });

  it('falls back to npx tsc --noEmit when tsconfig.json exists but no matching npm script', () => {
    mockFs({
      existsMap: { '/ws/package.json': true, '/ws/tsconfig.json': true },
      pkgJson: { scripts: { test: 'vitest' } },
    });
    expect(detectBuildCommand('/ws')).toBe('npx tsc --noEmit');
  });

  it('returns npx tsc --noEmit when only tsconfig.json exists', () => {
    mockFs({ existsMap: { '/ws/tsconfig.json': true } });
    expect(detectBuildCommand('/ws')).toBe('npx tsc --noEmit');
  });

  it('returns dotnet build for a .sln file', () => {
    mockFs({ existsMap: {}, dirEntries: ['MyApp.sln'] });
    expect(detectBuildCommand('/ws')).toBe('dotnet build --nologo -q');
  });

  it('returns dotnet build for a .csproj file', () => {
    mockFs({ existsMap: {}, dirEntries: ['MyApp.csproj'] });
    expect(detectBuildCommand('/ws')).toBe('dotnet build --nologo -q');
  });

  it('returns cargo check for a Cargo.toml', () => {
    mockFs({ existsMap: { '/ws/Cargo.toml': true } });
    expect(detectBuildCommand('/ws')).toBe('cargo check');
  });

  it('returns mvn compile for a pom.xml', () => {
    mockFs({ existsMap: { '/ws/pom.xml': true } });
    expect(detectBuildCommand('/ws')).toBe('mvn compile -q');
  });

  it('returns undefined when no build system is found', () => {
    mockFs({ existsMap: {}, dirEntries: ['README.md'] });
    expect(detectBuildCommand('/ws')).toBeUndefined();
  });

  it('falls through gracefully when package.json is malformed', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => p === '/ws/package.json');
    vi.mocked(fs.readFileSync).mockReturnValue('not json' as any);
    vi.mocked(fs.readdirSync).mockReturnValue([] as any);
    // Should not throw; falls through to return undefined
    expect(() => detectBuildCommand('/ws')).not.toThrow();
  });

  it('does not use scripts entry when scripts is not an object (JSON type guard)', () => {
    mockFs({
      existsMap: { '/ws/package.json': true, '/ws/tsconfig.json': true },
      pkgJson: { scripts: 'invalid' },
    });
    // Falls through to tsconfig.json detection since scripts is not a valid object
    expect(detectBuildCommand('/ws')).toBe('npx tsc --noEmit');
  });

  it('does not use scripts entry when a script value is not a string', () => {
    mockFs({
      existsMap: { '/ws/package.json': true, '/ws/tsconfig.json': true },
      pkgJson: { scripts: { build: 42 } },
    });
    // Falls through since build value is not a string
    expect(detectBuildCommand('/ws')).toBe('npx tsc --noEmit');
  });
});

// ─── splitBuildCommand (Security Issue #2) ────────────────────────────────────

describe('splitBuildCommand', () => {
  it('splits "npm run build" into executable npm and args [run, build]', () => {
    expect(splitBuildCommand('npm run build')).toEqual({ executable: 'npm', args: ['run', 'build'] });
  });

  it('splits "npx tsc --noEmit" correctly', () => {
    expect(splitBuildCommand('npx tsc --noEmit')).toEqual({ executable: 'npx', args: ['tsc', '--noEmit'] });
  });

  it('splits "cargo check" correctly', () => {
    expect(splitBuildCommand('cargo check')).toEqual({ executable: 'cargo', args: ['check'] });
  });

  it('splits "dotnet build --nologo -q" correctly', () => {
    expect(splitBuildCommand('dotnet build --nologo -q')).toEqual({
      executable: 'dotnet',
      args: ['build', '--nologo', '-q'],
    });
  });

  it('returns undefined for an unlisted executable', () => {
    expect(splitBuildCommand('bash -c "rm -rf /"')).toBeUndefined();
  });

  it('returns undefined for "sh -c evil"', () => {
    expect(splitBuildCommand('sh -c evil')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(splitBuildCommand('')).toBeUndefined();
  });

  it('handles leading/trailing whitespace', () => {
    const result = splitBuildCommand('  npm run build  ');
    expect(result?.executable).toBe('npm');
    expect(result?.args).toEqual(['run', 'build']);
  });
});
