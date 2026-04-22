import * as vscode from 'vscode';
import { ReviewComment } from './githubApi';

export interface AnnotatedComment {
  comment: ReviewComment;
  workPlan: string;
  fileFound?: boolean;
}

const FALLBACK_NO_MODEL = 'No language model available. Work plan could not be generated.';
const CONCURRENCY = 3;

function buildPrompt(comment: ReviewComment): string {
  return [
    'You are a code review assistant.',
    'A reviewer left the following comment on a pull request:',
    '',
    `File: ${comment.path} (line ${comment.line})`,
    'Diff hunk (surrounding context):',
    comment.diffHunk,
    '',
    'Reviewer comment:',
    comment.body,
    '',
    'Write a concise work plan as a numbered list of steps describing exactly what code changes should be made and why.',
    'Each step should be a single, specific action. Do not write any code. Do not repeat the comment verbatim.',
    'Format your response strictly as a numbered list (e.g. "1. Do this\\n2. Do that"). Do not include any prose before or after the list.',
  ].join('\n');
}

async function selectModel(): Promise<vscode.LanguageModelChat | undefined> {
  let models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
  if (models.length === 0) {
    models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  }
  return models[0];
}

export async function generateWorkPlan(comment: ReviewComment): Promise<string> {
  let model: vscode.LanguageModelChat | undefined;
  try {
    model = await selectModel();
  } catch {
    return FALLBACK_NO_MODEL;
  }

  if (!model) {
    return FALLBACK_NO_MODEL;
  }

  const messages = [vscode.LanguageModelChatMessage.User(buildPrompt(comment))];

  let response: vscode.LanguageModelChatResponse;
  try {
    response = await model.sendRequest(messages, {});
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return `Work plan unavailable: ${detail}`;
  }

  const parts: string[] = [];
  try {
    for await (const chunk of response.text) {
      parts.push(chunk);
    }
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return `Work plan unavailable: ${detail}`;
  }

  return parts.join('').trim();
}

export async function generateAllWorkPlans(comments: ReviewComment[]): Promise<AnnotatedComment[]> {
  const results: AnnotatedComment[] = new Array(comments.length);

  for (let i = 0; i < comments.length; i += CONCURRENCY) {
    const batch = comments.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((comment) => generateWorkPlan(comment).then((workPlan) => ({ comment, workPlan })))
    );
    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }
  }

  return results;
}
