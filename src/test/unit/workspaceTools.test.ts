import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

vi.mock('vscode');

import { readFileTool, listFilesTool, getDefinitionTool, getReferencesTool } from '../../workspaceTools';

const WORKSPACE_ROOT = '/workspace';

function makeDoc(lines: string[]) {
  return {
    lineCount: lines.length,
    lineAt: (i: number) => ({ text: lines[i] }),
  } as any;
}

function setWorkspaceRoot() {
  vi.mocked(vscode.workspace).workspaceFolders = [
    { uri: { fsPath: WORKSPACE_ROOT } },
  ] as any;
  vi.mocked(vscode.Uri.joinPath).mockImplementation((_base: any, ...parts: string[]) => ({
    fsPath: `${WORKSPACE_ROOT}/${parts.join('/')}`,
  }) as any);
}

function clearWorkspaceRoot() {
  vi.mocked(vscode.workspace).workspaceFolders = undefined as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// readFileTool
// ---------------------------------------------------------------------------
describe('readFileTool', () => {
  it('returns error when no workspace folders', async () => {
    clearWorkspaceRoot();
    const result = await readFileTool('src/foo.ts');
    expect(result).toContain('Error: No workspace is open');
  });

  it('returns full file content when no start/end given', async () => {
    setWorkspaceRoot();
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(
      makeDoc(['line 1', 'line 2', 'line 3'])
    );
    const result = await readFileTool('src/foo.ts');
    expect(result).toBe('line 1\nline 2\nline 3');
  });

  it('returns sliced content when start/end given (1-based)', async () => {
    setWorkspaceRoot();
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(
      makeDoc(['line 1', 'line 2', 'line 3', 'line 4', 'line 5'])
    );
    const result = await readFileTool('src/foo.ts', 2, 4);
    expect(result).toBe('line 2\nline 3\nline 4');
  });

  it('caps at 500 lines with truncation message when file is larger', async () => {
    setWorkspaceRoot();
    const bigLines = Array.from({ length: 600 }, (_, i) => `line ${i + 1}`);
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(makeDoc(bigLines));
    const result = await readFileTool('src/big.ts');
    const resultLines = result.split('\n');
    // 500 content lines + 1 truncation line
    expect(resultLines).toHaveLength(501);
    expect(resultLines[500]).toContain('truncated at 500 lines of 600 total');
  });

  it('returns error string when openTextDocument throws', async () => {
    setWorkspaceRoot();
    vi.mocked(vscode.workspace.openTextDocument).mockRejectedValue(new Error('file not found'));
    const result = await readFileTool('src/missing.ts');
    expect(result).toContain('Error reading file "src/missing.ts"');
    expect(result).toContain('file not found');
  });
});

// ---------------------------------------------------------------------------
// listFilesTool
// ---------------------------------------------------------------------------
describe('listFilesTool', () => {
  it('returns error when no workspace folders', async () => {
    clearWorkspaceRoot();
    const result = await listFilesTool();
    expect(result).toContain('Error: No workspace is open');
  });

  it('returns sorted newline-separated relative paths', async () => {
    setWorkspaceRoot();
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([
      { fsPath: `${WORKSPACE_ROOT}/src/b.ts` },
      { fsPath: `${WORKSPACE_ROOT}/src/a.ts` },
    ] as any);
    const result = await listFilesTool();
    expect(result).toBe('src/a.ts\nsrc/b.ts');
  });

  it('returns "No files found" message when findFiles returns empty', async () => {
    setWorkspaceRoot();
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([]);
    const result = await listFilesTool();
    expect(result).toBe('No files found in workspace.');
  });

  it('returns "No files found in directory" when directory provided and empty', async () => {
    setWorkspaceRoot();
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([]);
    const result = await listFilesTool('src');
    expect(result).toBe('No files found in "src".');
  });

  it('returns error string when findFiles throws', async () => {
    setWorkspaceRoot();
    vi.mocked(vscode.workspace.findFiles).mockRejectedValue(new Error('glob error'));
    const result = await listFilesTool();
    expect(result).toContain('Error listing files');
    expect(result).toContain('glob error');
  });
});

// ---------------------------------------------------------------------------
// getDefinitionTool
// ---------------------------------------------------------------------------
describe('getDefinitionTool', () => {
  it('returns error when no workspace folders', async () => {
    clearWorkspaceRoot();
    const result = await getDefinitionTool('src/foo.ts', 1, 'myFn');
    expect(result).toContain('Error: No workspace is open');
  });

  it('returns "Symbol not found on line" when symbol not in line text', async () => {
    setWorkspaceRoot();
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(
      makeDoc(['const x = 1;'])
    );
    const result = await getDefinitionTool('src/foo.ts', 1, 'myFn');
    expect(result).toContain('Symbol "myFn" not found on line 1');
  });

  it('returns "No definition found" when executeCommand returns empty', async () => {
    setWorkspaceRoot();
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(
      makeDoc(['const myFn = () => {};'])
    );
    vi.mocked(vscode.commands.executeCommand).mockResolvedValue([] as any);
    const result = await getDefinitionTool('src/foo.ts', 1, 'myFn');
    expect(result).toContain('No definition found for "myFn"');
  });

  it('returns formatted "file:line" results for valid definitions', async () => {
    setWorkspaceRoot();
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(
      makeDoc(['import { myFn } from "./bar";'])
    );
    vi.mocked(vscode.commands.executeCommand).mockResolvedValue([
      { uri: { fsPath: `${WORKSPACE_ROOT}/src/bar.ts` }, range: { start: { line: 9 } } },
    ] as any);
    const result = await getDefinitionTool('src/foo.ts', 1, 'myFn');
    expect(result).toBe('src/bar.ts:10');
  });

  it('excludes node_modules paths from results', async () => {
    setWorkspaceRoot();
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(
      makeDoc(['import { myFn } from "somelib";'])
    );
    vi.mocked(vscode.commands.executeCommand).mockResolvedValue([
      { uri: { fsPath: `${WORKSPACE_ROOT}/node_modules/somelib/index.ts` }, range: { start: { line: 0 } } },
    ] as any);
    const result = await getDefinitionTool('src/foo.ts', 1, 'myFn');
    expect(result).toContain('excluded paths');
  });

  it('returns error string when executeCommand throws', async () => {
    setWorkspaceRoot();
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(
      makeDoc(['const myFn = 1;'])
    );
    vi.mocked(vscode.commands.executeCommand).mockRejectedValue(new Error('LSP error'));
    const result = await getDefinitionTool('src/foo.ts', 1, 'myFn');
    expect(result).toContain('Error finding definition for "myFn"');
    expect(result).toContain('LSP error');
  });
});

// ---------------------------------------------------------------------------
// getReferencesTool
// ---------------------------------------------------------------------------
describe('getReferencesTool', () => {
  it('returns error when no workspace folders', async () => {
    clearWorkspaceRoot();
    const result = await getReferencesTool('src/foo.ts', 1, 'myFn');
    expect(result).toContain('Error: No workspace is open');
  });

  it('returns "Symbol not found on line" when symbol not in line text', async () => {
    setWorkspaceRoot();
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(
      makeDoc(['const x = 1;'])
    );
    const result = await getReferencesTool('src/foo.ts', 1, 'myFn');
    expect(result).toContain('Symbol "myFn" not found on line 1');
  });

  it('returns "No references found" when executeCommand returns empty', async () => {
    setWorkspaceRoot();
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(
      makeDoc(['export function myFn() {}'])
    );
    vi.mocked(vscode.commands.executeCommand).mockResolvedValue([] as any);
    const result = await getReferencesTool('src/foo.ts', 1, 'myFn');
    expect(result).toContain('No references found for "myFn"');
  });

  it('returns formatted results', async () => {
    setWorkspaceRoot();
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(
      makeDoc(['export function myFn() {}'])
    );
    vi.mocked(vscode.commands.executeCommand).mockResolvedValue([
      { uri: { fsPath: `${WORKSPACE_ROOT}/src/a.ts` }, range: { start: { line: 4 } } },
      { uri: { fsPath: `${WORKSPACE_ROOT}/src/b.ts` }, range: { start: { line: 9 } } },
    ] as any);
    const result = await getReferencesTool('src/foo.ts', 1, 'myFn');
    expect(result).toBe('src/a.ts:5\nsrc/b.ts:10');
  });

  it('caps results at 20', async () => {
    setWorkspaceRoot();
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(
      makeDoc(['export function myFn() {}'])
    );
    const manyLocs = Array.from({ length: 30 }, (_, i) => ({
      uri: { fsPath: `${WORKSPACE_ROOT}/src/file${i}.ts` },
      range: { start: { line: i } },
    }));
    vi.mocked(vscode.commands.executeCommand).mockResolvedValue(manyLocs as any);
    const result = await getReferencesTool('src/foo.ts', 1, 'myFn');
    expect(result.split('\n')).toHaveLength(20);
  });

  it('excludes node_modules paths', async () => {
    setWorkspaceRoot();
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(
      makeDoc(['export function myFn() {}'])
    );
    vi.mocked(vscode.commands.executeCommand).mockResolvedValue([
      { uri: { fsPath: `${WORKSPACE_ROOT}/node_modules/lib/index.ts` }, range: { start: { line: 0 } } },
    ] as any);
    const result = await getReferencesTool('src/foo.ts', 1, 'myFn');
    expect(result).toContain('excluded paths');
  });

  it('returns error string when executeCommand throws', async () => {
    setWorkspaceRoot();
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(
      makeDoc(['export function myFn() {}'])
    );
    vi.mocked(vscode.commands.executeCommand).mockRejectedValue(new Error('LSP timeout'));
    const result = await getReferencesTool('src/foo.ts', 1, 'myFn');
    expect(result).toContain('Error finding references for "myFn"');
    expect(result).toContain('LSP timeout');
  });
});
