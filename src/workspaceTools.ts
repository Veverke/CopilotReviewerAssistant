import * as vscode from 'vscode';
import * as path from 'path';

/** Returns the workspace root Uri, or undefined if no workspace is open. */
function getWorkspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

/** Clamps a number to [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const EXCLUDED_PATTERNS = ['**/node_modules/**', '**/dist/**', '**/out/**', '**/.git/**', '**/*.d.ts'];

/**
 * Read file content from the workspace.
 * @param filePath - path relative to workspace root
 * @param startLine - 1-based start line (optional)
 * @param endLine - 1-based end line (optional)
 * Returns file content (sliced if start/end provided). Max 500 lines returned.
 */
export async function readFileTool(
  filePath: string,
  startLine?: number,
  endLine?: number
): Promise<string> {
  const root = getWorkspaceRoot();
  if (!root) {
    return 'Error: No workspace is open. Please open the repository in VS Code.';
  }
  try {
    const uri = vscode.Uri.joinPath(root, filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const totalLines = doc.lineCount;
    const start = startLine !== undefined ? clamp(startLine - 1, 0, totalLines - 1) : 0;
    const end = endLine !== undefined ? clamp(endLine, start + 1, totalLines) : totalLines;
    const lineCount = end - start;
    if (lineCount > 500) {
      // Cap at 500 lines from start
      const lines: string[] = [];
      for (let i = start; i < start + 500; i++) {
        lines.push(doc.lineAt(i).text);
      }
      return lines.join('\n') + `\n... (truncated at 500 lines of ${lineCount} total)`;
    }
    const lines: string[] = [];
    for (let i = start; i < end; i++) {
      lines.push(doc.lineAt(i).text);
    }
    return lines.join('\n');
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return `Error reading file "${filePath}": ${detail}`;
  }
}

/**
 * List files in a workspace directory.
 * @param directory - path relative to workspace root (default: root)
 * Returns newline-separated list of relative file paths.
 */
export async function listFilesTool(directory?: string): Promise<string> {
  const root = getWorkspaceRoot();
  if (!root) {
    return 'Error: No workspace is open. Please open the repository in VS Code.';
  }
  try {
    const base = directory ? `${directory.replace(/\\/g, '/')}/**` : '**/*';
    const include = new vscode.RelativePattern(root, base);
    const exclude = `{${EXCLUDED_PATTERNS.map(p => p.replace('**/', '')).join(',')}}`;
    const files = await vscode.workspace.findFiles(include, exclude, 500);
    if (files.length === 0) {
      return directory ? `No files found in "${directory}".` : 'No files found in workspace.';
    }
    const rootPath = root.fsPath;
    return files
      .map(f => path.relative(rootPath, f.fsPath).replace(/\\/g, '/'))
      .sort()
      .join('\n');
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return `Error listing files: ${detail}`;
  }
}

export interface DefinitionLocation {
  file: string;
  line: number;
}

/**
 * Find where a symbol is defined using VS Code's LSP (Go to Definition).
 * @param filePath - path relative to workspace root where the symbol appears
 * @param line - 1-based line number where the symbol appears
 * @param symbol - symbol name to locate on that line
 * Returns definition locations, or an error/empty string.
 */
export async function getDefinitionTool(
  filePath: string,
  line: number,
  symbol: string
): Promise<string> {
  const root = getWorkspaceRoot();
  if (!root) {
    return 'Error: No workspace is open. Please open the repository in VS Code.';
  }
  try {
    const uri = vscode.Uri.joinPath(root, filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const zeroLine = clamp(line - 1, 0, doc.lineCount - 1);
    const lineText = doc.lineAt(zeroLine).text;
    const col = lineText.indexOf(symbol);
    if (col === -1) {
      return `Symbol "${symbol}" not found on line ${line} of "${filePath}".`;
    }
    const position = new vscode.Position(zeroLine, col);
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeDefinitionProvider',
      uri,
      position
    );
    if (!locations || locations.length === 0) {
      return `No definition found for "${symbol}".`;
    }
    const rootPath = root.fsPath;
    const results: DefinitionLocation[] = [];
    const seen = new Set<string>();
    for (const loc of locations) {
      const absPath = loc.uri.fsPath;
      // Exclude node_modules, dist, out, .d.ts
      if (/node_modules|[\\/]dist[\\/]|[\\/]out[\\/]|\.d\.ts$/.test(absPath)) { continue; }
      const rel = path.relative(rootPath, absPath).replace(/\\/g, '/');
      const key = `${rel}:${loc.range.start.line + 1}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ file: rel, line: loc.range.start.line + 1 });
      }
    }
    if (results.length === 0) {
      return `No definition found for "${symbol}" (all results were in excluded paths).`;
    }
    return results.map(r => `${r.file}:${r.line}`).join('\n');
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return `Error finding definition for "${symbol}": ${detail}`;
  }
}

/**
 * Find all references/usages of a symbol using VS Code's LSP (Find References).
 * @param filePath - path relative to workspace root where the symbol appears
 * @param line - 1-based line number where the symbol appears
 * @param symbol - symbol name to find references for
 * Returns up to 20 reference locations, or an error/empty string.
 */
export async function getReferencesTool(
  filePath: string,
  line: number,
  symbol: string
): Promise<string> {
  const root = getWorkspaceRoot();
  if (!root) {
    return 'Error: No workspace is open. Please open the repository in VS Code.';
  }
  try {
    const uri = vscode.Uri.joinPath(root, filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const zeroLine = clamp(line - 1, 0, doc.lineCount - 1);
    const lineText = doc.lineAt(zeroLine).text;
    const col = lineText.indexOf(symbol);
    if (col === -1) {
      return `Symbol "${symbol}" not found on line ${line} of "${filePath}".`;
    }
    const position = new vscode.Position(zeroLine, col);
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider',
      uri,
      position
    );
    if (!locations || locations.length === 0) {
      return `No references found for "${symbol}".`;
    }
    const rootPath = root.fsPath;
    const results: Array<{ file: string; line: number }> = [];
    const seen = new Set<string>();
    for (const loc of locations) {
      const absPath = loc.uri.fsPath;
      if (/node_modules|[\\/]dist[\\/]|[\\/]out[\\/]|\.d\.ts$/.test(absPath)) { continue; }
      const rel = path.relative(rootPath, absPath).replace(/\\/g, '/');
      const key = `${rel}:${loc.range.start.line + 1}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ file: rel, line: loc.range.start.line + 1 });
      }
      if (results.length >= 20) { break; }
    }
    if (results.length === 0) {
      return `No references found for "${symbol}" (all results were in excluded paths).`;
    }
    return results.map(r => `${r.file}:${r.line}`).join('\n');
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return `Error finding references for "${symbol}": ${detail}`;
  }
}
