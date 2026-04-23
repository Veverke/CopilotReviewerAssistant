import * as vscode from 'vscode';
import { AnnotatedComment } from './workPlanGenerator';
import { selectModel } from './modelSelector';

export type FixStatus =
  | { id: number; state: 'applying' }
  | { id: number; state: 'thinking'; text: string }
  | { id: number; state: 'done'; filePath: string; startLine: number; endLine: number }
  | { id: number; state: 'failed'; reason: string };

export interface DoneFixResult {
  commentId: number;
  commentPath: string;
  startLine: number;
  endLine: number;
}

export function computeChangedLineRange(
  oldContent: string,
  newContent: string,
  fallbackLine: number
): { startLine: number; endLine: number } {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const minLen = Math.min(oldLines.length, newLines.length);

  let start = 0;
  while (start < minLen && oldLines[start] === newLines[start]) {
    start++;
  }

  if (start === oldLines.length && start === newLines.length) {
    return { startLine: fallbackLine, endLine: fallbackLine };
  }

  let oldTail = oldLines.length - 1;
  let newTail = newLines.length - 1;
  while (oldTail > start && newTail > start && oldLines[oldTail] === newLines[newTail]) {
    oldTail--;
    newTail--;
  }

  return { startLine: start + 1, endLine: newTail + 1 };
}

export async function resolveWorkspaceFile(repoPath: string): Promise<vscode.Uri | undefined> {
  const files = await vscode.workspace.findFiles(repoPath, undefined, 1);
  return files[0];
}

async function readFileContent(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString('utf8');
}

function buildFixPrompt(
  path: string,
  line: number,
  body: string,
  diffHunk: string,
  contextSection: string,
  sectionStartLine: number,
  sectionEndLine: number
): string {
  return [
    'You are a code fix assistant. Apply the following code review recommendation to the file.',
    '',
    `File: ${path}`,
    `Target line: ${line}`,
    '',
    'Reviewer recommendation:',
    body,
    '',
    'Diff hunk (context around the target line):',
    diffHunk,
    '',
    `Relevant file section (lines ${sectionStartLine}\u2013${sectionEndLine}):`,
    contextSection,
    '',
    `Return the complete corrected version of lines ${sectionStartLine}\u2013${sectionEndLine} only. Do not add explanations, markdown code fences, or any text outside the section content.`,
  ].join('\n');
}

const LM_TIMEOUT_MS = 90_000;
const CONTEXT_LINES = 100;

function extractFileContext(
  fileContent: string,
  targetLine: number
): { contextSection: string; sectionStart: number; sectionEnd: number } {
  const lines = fileContent.split('\n');
  const zeroIndexed = Math.max(0, targetLine - 1);
  const sectionStart = Math.max(0, zeroIndexed - CONTEXT_LINES);
  const sectionEnd = Math.min(lines.length, zeroIndexed + CONTEXT_LINES + 1);
  return {
    contextSection: lines.slice(sectionStart, sectionEnd).join('\n'),
    sectionStart,
    sectionEnd,
  };
}

async function callLmWithTimeout(
  model: vscode.LanguageModelChat,
  messages: vscode.LanguageModelChatMessage[],
  onChunk?: (chunk: string) => void
): Promise<string> {
  // Use a CancellationToken so the LM stream is truly terminated on timeout.
  // A bare Promise.race leaves the for-await loop running in the background,
  // keeping the LM API busy and causing every subsequent call to time out too.
  const cts = new vscode.CancellationTokenSource();
  const timeoutId = setTimeout(() => cts.cancel(), LM_TIMEOUT_MS);
  try {
    const response = await model.sendRequest(messages, {}, cts.token);
    const parts: string[] = [];
    for await (const chunk of response.text) {
      parts.push(chunk);
      onChunk?.(chunk);
    }
    return parts.join('').trim();
  } catch (err: unknown) {
    if (cts.token.isCancellationRequested) {
      throw new Error('Language model timed out after 90 seconds');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    cts.dispose();
  }
}

export async function applyFix(
  annotated: AnnotatedComment,
  onProgress: (status: FixStatus) => void
): Promise<void> {
  const { comment } = annotated;

  onProgress({ id: comment.id, state: 'applying' });

  const uri = await resolveWorkspaceFile(comment.path);
  if (!uri) {
    onProgress({ id: comment.id, state: 'failed', reason: 'File not found in workspace' });
    return;
  }

  let fileContent: string;
  try {
    fileContent = await readFileContent(uri);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    onProgress({ id: comment.id, state: 'failed', reason });
    return;
  }

  let model: vscode.LanguageModelChat | undefined;
  try {
    model = await selectModel();
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    onProgress({ id: comment.id, state: 'failed', reason });
    return;
  }

  if (!model) {
    onProgress({ id: comment.id, state: 'failed', reason: 'No language model available' });
    return;
  }

  const { contextSection, sectionStart, sectionEnd } = extractFileContext(fileContent, comment.line);
  const prompt = buildFixPrompt(
    comment.path,
    comment.line,
    comment.body,
    comment.diffHunk,
    contextSection,
    sectionStart + 1,
    sectionEnd
  );
  const messages = [vscode.LanguageModelChatMessage.User(prompt)];

  let correctedSection: string;
  try {
    correctedSection = await callLmWithTimeout(model, messages);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    onProgress({ id: comment.id, state: 'failed', reason });
    return;
  }

  if (!correctedSection) {
    onProgress({ id: comment.id, state: 'failed', reason: 'Language model returned empty content' });
    return;
  }

  const fileLines = fileContent.split('\n');
  const correctedLines = correctedSection.split('\n');
  const newContent = [
    ...fileLines.slice(0, sectionStart),
    ...correctedLines,
    ...fileLines.slice(sectionEnd),
  ].join('\n');

  try {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(newContent, 'utf8'));
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    onProgress({ id: comment.id, state: 'failed', reason });
    return;
  }

  const { startLine, endLine } = computeChangedLineRange(fileContent, newContent, comment.line);
  onProgress({ id: comment.id, state: 'done', filePath: comment.path, startLine, endLine });
}
