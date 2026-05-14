export type SeverityScore = 'critical' | 'high' | 'medium' | 'low';

export interface ReviewComment {
  id: number;
  path: string;
  line: number;
  body: string;
  diffHunk: string;
  htmlUrl: string;
  reviewer: string;
  severity?: SeverityScore;
}

export interface PrMetadata {
  title: string;
  assignee: string | null;
  filesChangedCount: number;
}


interface GitHubPrComment {
  id: number;
  path: string;
  line: number | null;
  original_line: number | null;
  position: number | null;
  in_reply_to_id?: number | null;
  subject_type?: string;
  body: string;
  diff_hunk: string;
  html_url: string;
  user: {
    login: string;
  } | null;
}

const COPILOT_BOT_LOGIN = 'copilot-pull-request-reviewer[bot]';

// Known Copilot bot login names.
// See https://docs.github.com/en/copilot for the authoritative list of GitHub Copilot bot accounts.
const COPILOT_BOT_LOGINS = new Set([
  'copilot-pull-request-reviewer[bot]',
  'github-copilot[bot]',
  'copilot[bot]',
  'Copilot',
  'copilot',
]);

/**
 * Returns true if `login` is a known Copilot bot account or appears in the
 * user-supplied `additionalLogins` list. The broad regex fallback has been
 * intentionally removed to prevent trust-bypass via accounts like "mycopilot".
 */
function isCopilotBot(login: string, additionalLogins: readonly string[] = []): boolean {
  if (COPILOT_BOT_LOGINS.has(login)) {
    return true;
  }
  // Check user-configured additional bot logins (explicit allowlist only — no regex)
  return additionalLogins.includes(login);
}

/**
 * Returns a human-readable display name for a reviewer login.
 * Known Copilot bot accounts are shown as "Copilot"; other bot accounts have
 * the "[bot]" suffix replaced with " (bot)".
 */
export function reviewerDisplayName(login: string): string {
  if (COPILOT_BOT_LOGINS.has(login)) { return 'Copilot'; }
  return login.replace('[bot]', ' (bot)').replace(/ \(bot\)$/, ' (bot)').trim();
}

async function fetchUserDisplayNames(
  token: string,
  logins: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await Promise.allSettled(
    logins.map(async (login) => {
      const resp = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      });
      if (resp.ok) {
        const data = await resp.json() as { login: string; name?: string | null };
        map.set(login, data.name?.trim() || login);
      }
    }),
  );
  return map;
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

/**
 * Extracts a severity level from the body of a Copilot review comment.
 * Tries multiple formats in order of specificity:
 *   GitHub alert blocks  — > [!CAUTION], > [!WARNING], > [!NOTE/TIP]
 *   Bold/bracket prefix  — **[High]**, **High**, **[CRITICAL]**
 *   Labelled field       — Severity: high, **Severity**: medium
 *   Plain word at start  — high: …, critical –
 */
function parseSeverityFromBody(body: string): SeverityScore | undefined {
  if (!body) { return undefined; }

  // Check the first four non-empty lines — some formats spread metadata across lines.
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).slice(0, 4);

  for (const line of lines) {
    // GitHub alert blockquote: > [!CAUTION] / [!IMPORTANT] / [!WARNING] / [!NOTE] / [!TIP]
    if (/^>?\s*\[!CAUTION\]/i.test(line))    { return 'critical'; }
    if (/^>?\s*\[!IMPORTANT\]/i.test(line))  { return 'high'; }
    if (/^>?\s*\[!WARNING\]/i.test(line))    { return 'medium'; }
    if (/^>?\s*\[!\s*(?:NOTE|TIP)\]/i.test(line)) { return 'low'; }

    // **[High]**, **[HIGH]**, **High**, **critical** — with optional blockquote >
    const boldMatch = line.match(/^(?:>\s*)?\*{1,2}\[?(critical|high|medium|low)\]?\*{0,2}\b/i);
    if (boldMatch) { return boldMatch[1].toLowerCase() as SeverityScore; }

    // Severity: High  /  **Severity**: high  /  Severity – medium
    const labelMatch = line.match(/\bseverity\b\s*\*{0,2}\s*[:\-–]\s*\*{0,2}\s*(critical|high|medium|low)\b/i);
    if (labelMatch) { return labelMatch[1].toLowerCase() as SeverityScore; }

    // Plain word followed by colon/dash at start: "high: description" or "Critical –"
    const plainMatch = line.match(/^(?:>\s*)?(critical|high|medium|low)\s*[:\-–]/i);
    if (plainMatch) { return plainMatch[1].toLowerCase() as SeverityScore; }
  }

  return undefined;
}

export async function fetchCopilotComments(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
  outputChannel?: { appendLine(value: string): void },
  additionalBotLogins?: readonly string[]
): Promise<{ comments: ReviewComment[]; outdatedCount: number }> {
  const resolvedIds = await fetchResolvedCommentIds(token, owner, repo, pullNumber, outputChannel);

  const all: ReviewComment[] = [];
  let page = 1;
  let totalSeen = 0;
  let outdatedCount = 0;

  while (true) {
    const items = await fetchPage(token, owner, repo, pullNumber, page);
    totalSeen += items.length;

    for (const c of items) {
      if (c.subject_type === 'line' && c.position === null) {
        outdatedCount++;
        outputChannel?.appendLine(`[githubApi] skipped outdated comment id=${c.id}`);
        continue;
      }
      if (c.in_reply_to_id != null) {
        outputChannel?.appendLine(`[githubApi] skipped reply comment id=${c.id} (reply to ${c.in_reply_to_id})`);
        continue;
      }
      if (resolvedIds.has(c.id)) {
        outputChannel?.appendLine(`[githubApi] skipped resolved comment id=${c.id}`);
        continue;
      }
      outputChannel?.appendLine(`[githubApi] id=${c.id} reviewer=${c.user?.login ?? '(unknown)'} path="${c.path}"`);
      const body = c.body ?? '';
      all.push({
        id: c.id,
        path: c.path ?? '',
        line: c.line ?? c.original_line ?? 0,
        body,
        diffHunk: c.diff_hunk ?? '',
        htmlUrl: c.html_url,
        reviewer: c.user?.login ?? '',
        severity: parseSeverityFromBody(body),
      });
    }

    if (items.length < 100) {
      break;
    }
    page++;
  }

  outputChannel?.appendLine(`[githubApi] total inline comments: ${totalSeen}, returned: ${all.length}, outdated skipped: ${outdatedCount}`);

  // Resolve display names for non-bot reviewers in parallel.
  // Bots already have a fixed display name from reviewerDisplayName().
  const uniqueHumanLogins = [...new Set(
    all.map((c) => c.reviewer).filter((login) => login && !COPILOT_BOT_LOGINS.has(login) && !login.endsWith('[bot]'))
  )];
  const displayNames = await fetchUserDisplayNames(token, uniqueHumanLogins);
  for (const c of all) {
    if (displayNames.has(c.reviewer)) {
      c.reviewer = displayNames.get(c.reviewer)!;
    }
  }

  return { comments: all, outdatedCount };
}

// ─── Fetch PR details (state + metadata in one request) ──────────────────────

interface GitHubPrApiResponse {
  state: string;
  merged: boolean;
  title: string;
  assignees: Array<{ login: string }>;
  changed_files: number;
  head: { ref: string };
}

export interface PrDetails extends PrMetadata {
  state: string;
  merged: boolean;
  headBranch: string;
}

/**
 * Fetches PR state and metadata in a single HTTP request, reducing token exposure
 * from the duplicate calls previously made by fetchPrState and fetchPrMetadata.
 */
export async function fetchPrDetails(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<PrDetails> {
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
    return { state: 'unknown', merged: false, title: '', assignee: null, filesChangedCount: 0, headBranch: '' };
  }
  if (!response.ok) {
    return { state: 'unknown', merged: false, title: '', assignee: null, filesChangedCount: 0, headBranch: '' };
  }
  const data = await response.json() as GitHubPrApiResponse;
  return {
    state: data.state ?? 'unknown',
    merged: data.merged ?? false,
    title: data.title ?? '',
    assignee: data.assignees?.[0]?.login ?? null,
    filesChangedCount: data.changed_files ?? 0,
    headBranch: data.head?.ref ?? '',
  };
}

/** Thin wrapper kept for backward compatibility with existing tests. */
export async function fetchPrState(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<{ state: string; merged: boolean }> {
  const details = await fetchPrDetails(token, owner, repo, pullNumber);
  return { state: details.state, merged: details.merged };
}

// ─── List open pull requests ───────────────────────────────────────────────────

export type PrFilterMode = 'both' | 'created' | 'assigned';

export interface OpenPr {
  owner: string;
  repo: string;
  pullNumber: number;
  title: string;
  htmlUrl: string;
}

interface GitHubPrListItem {
  number: number;
  title: string;
  html_url: string;
  assignees: Array<{ login: string }>;
  user: { login: string };
}

export async function fetchCurrentUser(token: string): Promise<string | null> {
  const url = 'https://api.github.com/user';
  try {
    const response = await fetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) { return null; }
    const data = await response.json() as { login: string };
    return data.login ?? null;
  } catch {
    return null;
  }
}

export async function fetchOpenPullRequests(
  token: string,
  owner: string,
  repo: string,
  currentUser?: string,
  filterMode: PrFilterMode = 'both'
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
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Network error while contacting GitHub: ${detail}`);
  }

  if (response.status === 401) {
    throw new Error('GitHub authentication failed. Please sign in again.');
  }
  if (response.status === 403) {
    throw new Error('Access denied. Ensure your GitHub account has access to this repository.');
  }
  if (response.status === 404) {
    throw new Error('Repository not found: check the owner/repo in your extension settings and ensure your token has access.');
  }
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  const items = await response.json() as GitHubPrListItem[];
  const filtered = currentUser
    ? items.filter((pr) => {
        if (filterMode === 'created') { return pr.user.login === currentUser; }
        if (filterMode === 'assigned') { return pr.assignees.some((a) => a.login === currentUser); }
        return pr.user.login === currentUser || pr.assignees.some((a) => a.login === currentUser);
      })
    : items;
  return filtered.map((pr) => ({
    owner,
    repo,
    pullNumber: pr.number,
    title: pr.title,
    htmlUrl: pr.html_url,
  }));
}

// ─── Check for open Copilot reviews ─────────────────────────────────────────────

interface GitHubReviewItem {
  user: { login: string };
  state: string;
}

/**
 * Returns true if the PR has at least one non-dismissed Copilot review
 * (state is CHANGES_REQUESTED or COMMENTED). Returns false on any error so the
 * PR is silently excluded rather than crashing the list.
 */
export async function fetchHasCopilotReview(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
  additionalBotLogins: readonly string[] = []
): Promise<boolean> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/reviews?per_page=100`;
  try {
    const response = await fetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) { return false; }
    const reviews = await response.json() as GitHubReviewItem[];
    return reviews.some(
      (r) =>
        isCopilotBot(r.user.login, additionalBotLogins) &&
        (r.state === 'CHANGES_REQUESTED' || r.state === 'COMMENTED')
    );
  } catch {
    return false;
  }
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
  isResolved: boolean;
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

async function fetchResolvedCommentIds(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
  outputChannel?: { appendLine(value: string): void }
): Promise<Set<number>> {
  const query = `
    query GetReviewThreads($owner: String!, $repo: String!, $pullNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pullNumber) {
          reviewThreads(first: 100) {
            nodes {
              isResolved
              comments(first: 1) {
                nodes { databaseId }
              }
            }
          }
        }
      }
    }
  `;

  let response: Response;
  try {
    response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ query, variables: { owner, repo, pullNumber } }),
    });
  } catch {
    // If we can't fetch resolved threads, fail open (return empty set) so
    // the user still sees comments rather than crashing the entire review.
    outputChannel?.appendLine('[githubApi] fetchResolvedCommentIds: network error, skipping resolved filter');
    return new Set();
  }

  if (!response.ok) {
    outputChannel?.appendLine(`[githubApi] fetchResolvedCommentIds: HTTP ${response.status}, skipping resolved filter`);
    return new Set();
  }

  const data = await response.json() as GraphQLThreadsResponse;
  const threads = data.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
  const resolved = new Set<number>();
  for (const t of threads) {
    if (t.isResolved) {
      const id = t.comments.nodes[0]?.databaseId;
      if (id !== undefined) {
        resolved.add(id);
      }
    }
  }
  outputChannel?.appendLine(`[githubApi] fetchResolvedCommentIds: ${resolved.size} resolved thread(s) found`);
  return resolved;
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

