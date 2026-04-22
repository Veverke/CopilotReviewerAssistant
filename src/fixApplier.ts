import * as vscode from 'vscode';
import { AnnotatedComment } from './workPlanGenerator';

export type FixStatus =
  | { id: number; state: 'applying' }
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
  fileContent: string
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
    'Current file content:',
    fileContent,
    '',
    'Return the complete corrected file content only. Do not add explanations, markdown code fences, or any text outside the file content.',
  ].join('\n');
}

async function selectModel(): Promise<vscode.LanguageModelChat | undefined> {
  let models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
  if (models.length === 0) {
    models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  }
  return models[0];
}

const LM_TIMEOUT_MS = 30_000;

async function callLmWithTimeout(
  model: vscode.LanguageModelChat,
  messages: vscode.LanguageModelChatMessage[]
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Language model timed out after 30 seconds')),
      LM_TIMEOUT_MS
    );
  });

  const lmPromise = (async () => {
    try {
      const response = await model.sendRequest(messages, {});
      const parts: string[] = [];
      for await (const chunk of response.text) {
        parts.push(chunk);
      }
      return parts.join('').trim();
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  })();

  return Promise.race([lmPromise, timeoutPromise]);
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

  const prompt = buildFixPrompt(comment.path, comment.line, comment.body, comment.diffHunk, fileContent);
  const messages = [vscode.LanguageModelChatMessage.User(prompt)];

  let corrected: string;
  try {
    corrected = await callLmWithTimeout(model, messages);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    onProgress({ id: comment.id, state: 'failed', reason });
    return;
  }

  if (!corrected) {
    onProgress({ id: comment.id, state: 'failed', reason: 'Language model returned empty content' });
    return;
  }

  try {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(corrected, 'utf8'));
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    onProgress({ id: comment.id, state: 'failed', reason });
    return;
  }

  const { startLine, endLine } = computeChangedLineRange(fileContent, corrected, comment.line);
  onProgress({ id: comment.id, state: 'done', filePath: comment.path, startLine, endLine });
}
