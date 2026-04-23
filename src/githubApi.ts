export type ReviewCommentType = 'commit-suggestion' | 'fix-with-copilot';

export interface ReviewComment {
  id: number;
  path: string;
  line: number;
  body: string;
  diffHunk: string;
  htmlUrl: string;
  type?: ReviewCommentType;
}

export interface PrMetadata {
  title: string;
  assignee: string | null;
  filesChangedCount: number;
}

function detectCommentType(body: string): ReviewCommentType {
  return /^```suggestion/m.test(body) ? 'commit-suggestion' : 'fix-with-copilot';
}

interface GitHubPrComment {
  id: number;
  path: string;
  line: number | null;
  original_line: number | null;
  position: number | null;
  subject_type?: string;
  body: string;
  diff_hunk: string;
  html_url: string;
  user: {
    login: string;
  };
}

const COPILOT_BOT_LOGIN = 'copilot-pull-request-reviewer[bot]';

// Additional known aliases — GitHub has used different login names across regions/tenants
const COPILOT_BOT_LOGINS = new Set([
  'copilot-pull-request-reviewer[bot]',
  'github-copilot[bot]',
  'copilot[bot]',
  'Copilot',
  'copilot',
]);

function isCopilotBot(login: string): boolean {
  if (COPILOT_BOT_LOGINS.has(login)) {
    return true;
  }
  // Broader pattern match in case GitHub rolls out a new alias
  return /copilot/i.test(login);
}

async function fetchWithRetry(url: string, options: RequestInit): Promise<Response> {
  const doFetch = (): Promise<Response> => fetch(url, options);
  try {
    return await doFetch();
  } catch {
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    return doFetch();
  }
}

async function fetchPage(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
  page: number
): Promise<GitHubPrComment[]> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/comments?per_page=100&page=${page}`;

  let response: Response;
  try {
    response = await fetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Network error while contacting GitHub: ${detail}`);
  }

  if (response.status === 401) {
    throw new Error('GitHub authentication failed. Please sign in again.');
  }

  if (response.status === 403) {
    const remaining = response.headers.get('X-RateLimit-Remaining');
    if (remaining === '0') {
      const reset = response.headers.get('X-RateLimit-Reset');
      const resetTime = reset
        ? new Date(parseInt(reset, 10) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'unknown';
      throw new Error(`GitHub rate limit reached. Resets at ${resetTime}.`);
    }
    throw new Error('Access denied. Ensure your GitHub account has access to this repository.');
  }

  if (response.status === 404) {
    throw new Error('PR not found: check the URL and that you have access to the repository.');
  }

  if (response.status === 429) {
    const reset = response.headers.get('X-RateLimit-Reset');
    const resetTime = reset
      ? new Date(parseInt(reset, 10) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'unknown';
    throw new Error(`GitHub rate limit reached. Resets at ${resetTime}.`);
  }

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<GitHubPrComment[]>;
}

export async function fetchCopilotComments(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
  outputChannel?: { appendLine(value: string): void }
): Promise<{ comments: ReviewComment[]; outdatedCount: number }> {
  const all: ReviewComment[] = [];
  let page = 1;
  let totalSeen = 0;
  let outdatedCount = 0;

  while (true) {
    const items = await fetchPage(token, owner, repo, pullNumber, page);
    totalSeen += items.length;

    for (const c of items) {
      outputChannel?.appendLine(`[githubApi] comment id=${c.id} user="${c.user.login}" path="${c.path}"`);
      if (!isCopilotBot(c.user.login)) {
        continue;
      }
      if (c.subject_type === 'line' && c.position === null) {
        outdatedCount++;
        outputChannel?.appendLine(`[githubApi] skipped outdated comment id=${c.id}`);
        continue;
      }
      all.push({
        id: c.id,
        path: c.path,
        line: c.line ?? c.original_line ?? 0,
        body: c.body,
        diffHunk: c.diff_hunk,
        htmlUrl: c.html_url,
        type: detectCommentType(c.body),
      });
    }

    if (items.length < 100) {
      break;
    }
    page++;
  }

  outputChannel?.appendLine(`[githubApi] total inline comments: ${totalSeen}, Copilot comments: ${all.length}, outdated skipped: ${outdatedCount}`);
  return { comments: all, outdatedCount };
}

// ─── Fetch PR metadata ────────────────────────────────────────────────────────

interface GitHubPrApiResponse {
  state: string;
  merged: boolean;
  title: string;
  assignees: Array<{ login: string }>;
  changed_files: number;
}

export async function fetchPrMetadata(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<PrMetadata> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}`;
  let response: Response;
  try {
    response = await fetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch {
    return { title: '', assignee: null, filesChangedCount: 0 };
  }
  if (!response.ok) {
    return { title: '', assignee: null, filesChangedCount: 0 };
  }
  const data = await response.json() as GitHubPrApiResponse;
  return {
    title: data.title ?? '',
    assignee: data.assignees?.[0]?.login ?? null,
    filesChangedCount: data.changed_files ?? 0,
  };
}

// ─── Fetch PR state ───────────────────────────────────────────────────────────

interface GitHubPrDetails {
  state: string;
  merged: boolean;
}

export async function fetchPrState(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<{ state: string; merged: boolean }> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}`;
  let response: Response;
  try {
    response = await fetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch {
    return { state: 'unknown', merged: false };
  }
  if (!response.ok) {
    return { state: 'unknown', merged: false };
  }
  const data = await response.json() as GitHubPrDetails;
  return { state: data.state, merged: data.merged };
}

// ─── List open pull requests ───────────────────────────────────────────────────

export interface OpenPr {
  pullNumber: number;
  title: string;
  htmlUrl: string;
}

interface GitHubPrListItem {
  number: number;
  title: string;
  html_url: string;
}

export async function fetchOpenPullRequests(
  token: string,
  owner: string,
  repo: string
): Promise<OpenPr[]> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=open&per_page=100`;
  let response: Response;
  try {
    response = await fetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch {
    return [];
  }
  if (!response.ok) {
    return [];
  }
  const items = await response.json() as GitHubPrListItem[];
  return items.map((pr) => ({
    pullNumber: pr.number,
    title: pr.title,
    htmlUrl: pr.html_url,
  }));
}

// ─── Reply to a PR review comment ─────────────────────────────────────────────

export async function postReplyComment(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
  commentId: number,
  body: string
): Promise<void> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/comments/${commentId}/replies`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ body }),
    });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Network error posting reply comment: ${detail}`);
  }

  if (!response.ok) {
    throw new Error(`Failed to post reply comment: ${response.status} ${response.statusText}`);
  }
}

// ─── Resolve a PR review thread via GraphQL ───────────────────────────────────

interface ReviewThreadNode {
  id: string;
  comments: { nodes: Array<{ databaseId: number }> };
}

interface GraphQLThreadsResponse {
  data?: {
    repository?: {
      pullRequest?: {
        reviewThreads?: { nodes: ReviewThreadNode[] };
      };
    };
  };
  errors?: Array<{ message: string }>;
}

export async function resolveReviewThread(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
  commentId: number
): Promise<void> {
  const listQuery = `
    query GetReviewThreads($owner: String!, $repo: String!, $pullNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pullNumber) {
          reviewThreads(first: 100) {
            nodes {
              id
              comments(first: 1) {
                nodes { databaseId }
              }
            }
          }
        }
      }
    }
  `;

  let listResponse: Response;
  try {
    listResponse = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ query: listQuery, variables: { owner, repo, pullNumber } }),
    });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Network error querying review threads: ${detail}`);
  }

  if (!listResponse.ok) {
    throw new Error(`GraphQL request failed: ${listResponse.status} ${listResponse.statusText}`);
  }

  const listData = await listResponse.json() as GraphQLThreadsResponse;
  if (listData.errors && listData.errors.length > 0) {
    throw new Error(`GraphQL errors: ${listData.errors.map((e) => e.message).join('; ')}`);
  }

  const threads = listData.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
  const thread = threads.find(
    (t) => t.comments.nodes[0]?.databaseId === commentId
  );

  if (!thread) {
    throw new Error(`Review thread for comment ${commentId} not found`);
  }

  const mutation = `
    mutation ResolveThread($threadId: ID!) {
      resolveReviewThread(input: { threadId: $threadId }) {
        thread { isResolved }
      }
    }
  `;

  let mutResponse: Response;
  try {
    mutResponse = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ query: mutation, variables: { threadId: thread.id } }),
    });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Network error resolving review thread: ${detail}`);
  }

  if (!mutResponse.ok) {
    throw new Error(`GraphQL mutation failed: ${mutResponse.status} ${mutResponse.statusText}`);
  }

  const mutData = await mutResponse.json() as { errors?: Array<{ message: string }> };
  if (mutData.errors && mutData.errors.length > 0) {
    throw new Error(`GraphQL mutation errors: ${mutData.errors.map((e) => e.message).join('; ')}`);
  }
}

