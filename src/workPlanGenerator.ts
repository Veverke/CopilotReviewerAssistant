import * as vscode from 'vscode';
import { ReviewComment } from './githubApi';
import { selectModel } from './modelSelector';

export type ComplexityScore = 'low' | 'medium' | 'high';

export interface AnnotatedComment {
  comment: ReviewComment;
  workPlan: string;
  complexity?: ComplexityScore;
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
    'After the numbered list, on its own line write exactly one of: "Complexity: low" or "Complexity: medium" or "Complexity: high"',
    'Use "low" for trivial one-liner fixes, "medium" for moderate refactoring, "high" for structural changes or fixes with risk of regression.',
  ].join('\n');
}

/** Extract and strip the Complexity: line from the raw LLM response. */
function parseComplexity(
  raw: string,
  comment: ReviewComment
): { workPlan: string; complexity: ComplexityScore } {
  const complexityMatch = raw.match(/^Complexity:\s*(low|medium|high)\s*$/im);
  const complexity: ComplexityScore = complexityMatch
    ? (complexityMatch[1].toLowerCase() as ComplexityScore)
    : inferComplexityHeuristic(raw, comment);

  const workPlan = raw
    .replace(/^Complexity:\s*(low|medium|high)\s*$/im, '')
    .trim();

  return { workPlan, complexity };
}

function inferComplexityHeuristic(workPlan: string, comment: ReviewComment): ComplexityScore {
  if (comment.type === 'commit-suggestion') {
    return 'low';
  }
  const steps = workPlan.split('\n').filter((l) => /^\d+\.\s+/.test(l)).length;
  if (steps <= 2) { return 'low'; }
  if (steps <= 4) { return 'medium'; }
  return 'high';
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

async function generateWorkPlanAnnotated(
  comment: ReviewComment
): Promise<{ workPlan: string; complexity: ComplexityScore }> {
  const raw = await generateWorkPlan(comment);
  // If we got a fallback/error message, assign heuristic complexity
  if (!raw || raw.startsWith('No language model') || raw.startsWith('Work plan unavailable')) {
    return { workPlan: raw, complexity: inferComplexityHeuristic(raw, comment) };
  }
  return parseComplexity(raw, comment);
}

export async function generateAllWorkPlans(
  comments: ReviewComment[],
  onProgress?: (completed: number, total: number) => void
): Promise<AnnotatedComment[]> {
  const results: AnnotatedComment[] = new Array(comments.length);
  let completed = 0;
  const total = comments.length;

  for (let i = 0; i < comments.length; i += CONCURRENCY) {
    const batch = comments.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((comment) =>
        generateWorkPlanAnnotated(comment).then(({ workPlan, complexity }) => {
          completed++;
          onProgress?.(completed, total);
          return { comment, workPlan, complexity };
        })
      )
    );
    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }
  }

  return results;
}
