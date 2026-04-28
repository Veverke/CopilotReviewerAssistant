import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';

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
  add(resources: vscode.Uri[]): Promise<void>;
  commit(message: string): Promise<void>;
  push(): Promise<void>;
}

// ─── Status type used by ReviewPanel to update the Webview ───────────────────

export type GitStatus =
  | { state: 'building' }
  | { state: 'build-failed'; reason: string }
  | { state: 'build-succeeded' }
  | { state: 'pushing' }
  | { state: 'pushed' }
  | { state: 'push-failed'; reason: string }
  | { state: 'no-repo' };

// ─── Build detection & execution ────────────────────────────────────────────

export type BuildResult =
  | { ok: true; skipped?: true; reason?: string }
  | { ok: false; reason: string };

/** Returns the shell command to build the project at `rootPath`, or undefined if unrecognised. */
export function detectBuildCommand(rootPath: string): string | undefined {
  // 1. package.json scripts (JS/TS/Node)
  const pkgPath = path.join(rootPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
      const scripts = pkg.scripts ?? {};
      for (const name of ['build', 'compile', 'typecheck', 'type-check']) {
        if (scripts[name]) {
          return `npm run ${name}`;
        }
      }
    } catch {
      // malformed package.json – fall through
    }
  }

  // 2. tsconfig.json only (no matching npm script found)
  if (fs.existsSync(path.join(rootPath, 'tsconfig.json'))) {
    return 'npx tsc --noEmit';
  }

  // 3. Go
  if (fs.existsSync(path.join(rootPath, 'go.mod'))) {
    return 'go build ./...';
  }

  // 4. Python — prefer static type-checker if configured, otherwise skip
  if (
    fs.existsSync(path.join(rootPath, 'pyrightconfig.json')) ||
    fs.existsSync(path.join(rootPath, '.pyrightconfig.json'))
  ) {
    return 'pyright';
  }
  if (
    fs.existsSync(path.join(rootPath, 'mypy.ini')) ||
    fs.existsSync(path.join(rootPath, '.mypy.ini'))
  ) {
    return 'python -m mypy .';
  }
  // pyproject.toml with a [tool.mypy] or [tool.pyright] section
  const pyrootPkg = path.join(rootPath, 'pyproject.toml');
  if (fs.existsSync(pyrootPkg)) {
    try {
      const pyproj = fs.readFileSync(pyrootPkg, 'utf8');
      if (/\[tool\.mypy\]/.test(pyproj)) { return 'python -m mypy .'; }
      if (/\[tool\.pyright\]/.test(pyproj)) { return 'pyright'; }
    } catch {
      // fall through
    }
  }

  // 5. .NET (solution or project files)
  const rootEntries = fs.readdirSync(rootPath);
  if (rootEntries.some((f) => f.endsWith('.sln') || f.endsWith('.csproj'))) {
    return 'dotnet build --nologo -q';
  }

  // 6. Rust
  if (fs.existsSync(path.join(rootPath, 'Cargo.toml'))) {
    return 'cargo check';
  }

  // 7. Maven
  if (fs.existsSync(path.join(rootPath, 'pom.xml'))) {
    return 'mvn compile -q';
  }

  // 8. Gradle
  if (
    fs.existsSync(path.join(rootPath, 'build.gradle')) ||
    fs.existsSync(path.join(rootPath, 'build.gradle.kts'))
  ) {
    const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    return `${gradlew} build`;
  }

  return undefined;
}

export async function buildProject(): Promise<BuildResult> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return { ok: true, skipped: true, reason: 'No workspace folder open' };
  }

  const rootPath = workspaceFolders[0].uri.fsPath;
  const cmd = detectBuildCommand(rootPath);

  if (!cmd) {
    return { ok: true, skipped: true, reason: 'No recognised build system found in workspace root' };
  }

  return new Promise((resolve) => {
    cp.exec(cmd, { cwd: rootPath, timeout: 120_000 }, (error, stdout, stderr) => {
      if (error) {
        const output = (stderr.trim() || stdout.trim() || error.message).slice(0, 3000);
        resolve({ ok: false, reason: `\`${cmd}\` failed:\n${output}` });
      } else {
        resolve({ ok: true });
      }
    });
  });
}

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
