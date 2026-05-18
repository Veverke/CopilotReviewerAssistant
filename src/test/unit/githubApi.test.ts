/**
 * Phase 4 – GitHub API Integration
 *
 * Test plan:
 *  fetchCopilotComments()
 *    - returns only comments from copilot bot logins
 *    - recognises all known copilot login aliases
 *    - matches logins via broad /copilot/i pattern
 *    - skips and counts outdated comments (position=null)
 *    - paginates: requests successive pages until a page < 100 items
 *    - maps line/original_line/null correctly
 *    - throws on 401 (auth failed)
 *    - throws on 403 + rate-limit-remaining=0 (rate limit)
 *    - throws on 403 without rate limit (access denied)
 *    - throws on 404 (PR not found)
 *    - throws on 429 (secondary rate limit)
 *    - retries once on network error, succeeds on second call
 *    - propagates error after both fetch attempts fail
 *
 *  fetchPrState()
 *    - returns state/merged on success
 *    - returns { state:'unknown', merged:false } on network error
 *    - returns { state:'unknown', merged:false } on non-ok response
 *
 *  postReplyComment()
 *    - posts to the correct endpoint with POST method
 *    - throws on non-ok response
 *    - throws on network error
 *
 *  resolveReviewThread()
 *    - queries threads and resolves the matching thread via mutation
 *    - throws when the comment id has no matching thread
 *    - throws on GraphQL errors in list response
 *    - throws on non-ok HTTP for list request
 *    - throws on network error during list
 *    - throws on GraphQL errors in mutation response
 *    - throws on non-ok HTTP for mutation
 *    - throws on network error during mutation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchCopilotComments,
  fetchCurrentUser,
  fetchHasCopilotReview,
  fetchOpenPullRequests,
  fetchPrState,
  fetchPrDetails,
  postReplyComment,
  resolveReviewThread,
} from '../../githubApi';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRawComment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    path: 'src/foo.ts',
    line: 10,
    original_line: 10,
    position: 1,
    subject_type: 'line',
    body: 'Use const instead of let',
    diff_hunk: '@@ -1,1 +1,1 @@',
    html_url: 'https://github.com/owner/repo/pull/1#comment-1',
    user: { login: 'copilot-pull-request-reviewer[bot]' },
    ...overrides,
  };
}

function makeResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: () => Promise.resolve(body),
    headers: { get: (key: string) => headers[key] ?? null },
  } as unknown as Response;
}

// ─── fetchCopilotComments helpers ──────────────────────────────────────────────

/**
 * Empty resolved-threads GraphQL response — satisfies the fetchResolvedCommentIds
 * call that fetchCopilotComments makes before fetching inline comments.
 */
function makeGraphQLNoResolvedThreads(): Response {
  return makeResponse({
    data: {
      repository: { pullRequest: { reviewThreads: { nodes: [] } } },
    },
  });
}

/**
 * Minimal GitHub /users/:login response where name is null so the reviewer
 * field stays as the login string (name?.trim() || login → login).
 */
function makeDisplayNameResponse(login: string): Response {
  return makeResponse({ login, name: null });
}

// ─── fetchCopilotComments ─────────────────────────────────────────────────────

describe('fetchCopilotComments', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('returns all comments from all reviewers with reviewer field set', async () => {
    const copilot = makeRawComment();
    const human = makeRawComment({ id: 2, user: { login: 'human-dev' } });
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeGraphQLNoResolvedThreads()) // fetchResolvedCommentIds
      .mockResolvedValueOnce(makeResponse([copilot, human])) // fetchPage page 1
      .mockResolvedValueOnce(makeDisplayNameResponse('human-dev')); // fetchUserDisplayNames

    const { comments, outdatedCount } = await fetchCopilotComments('tok', 'o', 'r', 1);

    expect(comments).toHaveLength(2);
    expect(comments[0].reviewer).toBe('copilot-pull-request-reviewer[bot]');
    expect(comments[1].reviewer).toBe('human-dev');
    expect(outdatedCount).toBe(0);
  });

  it('sets reviewer field from user.login for all known copilot aliases', async () => {
    const aliases = [
      'copilot-pull-request-reviewer[bot]',
      'github-copilot[bot]',
      'copilot[bot]',
      'Copilot',
      'copilot',
    ];

    for (const login of aliases) {
      vi.mocked(fetch)
        .mockResolvedValueOnce(makeGraphQLNoResolvedThreads()) // fetchResolvedCommentIds
        .mockResolvedValueOnce(makeResponse([makeRawComment({ user: { login } })])); // fetchPage
      // Known copilot aliases are COPILOT_BOT_LOGINS members — no fetchUserDisplayNames call.
      const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1);
      expect(comments).toHaveLength(1);
      expect(comments[0].reviewer).toBe(login);
    }
  });

  it('includes comments from logins that merely resemble copilot but are not in the explicit allowlist', async () => {
    const comment = makeRawComment({ user: { login: 'myCopilot-internal[bot]' } });
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeGraphQLNoResolvedThreads()) // fetchResolvedCommentIds
      .mockResolvedValueOnce(makeResponse([comment])); // fetchPage — login ends with [bot], no display-name fetch

    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1);
    expect(comments).toHaveLength(1);
    expect(comments[0].reviewer).toBe('myCopilot-internal[bot]');
  });

  it('skips and counts outdated comments (position=null, subject_type=line)', async () => {
    const outdated = makeRawComment({ position: null });
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeGraphQLNoResolvedThreads()) // fetchResolvedCommentIds
      .mockResolvedValueOnce(makeResponse([outdated])); // fetchPage — outdated filtered out, no display-name fetch

    const { comments, outdatedCount } = await fetchCopilotComments('tok', 'o', 'r', 1);
    expect(comments).toHaveLength(0);
    expect(outdatedCount).toBe(1);
  });

  it('paginates until a page returns fewer than 100 items', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) =>
      makeRawComment({ id: i + 1 })
    );
    const page2 = [makeRawComment({ id: 101 })];
    // All items use the default copilot-pull-request-reviewer[bot] login — no display-name fetch.
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeGraphQLNoResolvedThreads()) // fetchResolvedCommentIds
      .mockResolvedValueOnce(makeResponse(page1))           // fetchPage page 1
      .mockResolvedValueOnce(makeResponse(page2));           // fetchPage page 2

    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1);
    expect(comments).toHaveLength(101);
    expect(fetch).toHaveBeenCalledTimes(3); // GraphQL + 2 page fetches
  });

  it('uses original_line as fallback when line is null', async () => {
    const c = makeRawComment({ line: null, original_line: 7 });
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeGraphQLNoResolvedThreads()) // fetchResolvedCommentIds
      .mockResolvedValueOnce(makeResponse([c])); // fetchPage — copilot bot, no display-name fetch

    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1);
    expect(comments[0].line).toBe(7);
  });

  it('falls back to 0 when both line and original_line are null', async () => {
    const c = makeRawComment({ line: null, original_line: null });
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeGraphQLNoResolvedThreads()) // fetchResolvedCommentIds
      .mockResolvedValueOnce(makeResponse([c])); // fetchPage — copilot bot, no display-name fetch

    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1);
    expect(comments[0].line).toBe(0);
  });

  it('throws a 401 auth-failed error', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeGraphQLNoResolvedThreads()) // fetchResolvedCommentIds
      .mockResolvedValueOnce(makeResponse({}, 401));          // fetchPage → 401
    await expect(fetchCopilotComments('tok', 'o', 'r', 1)).rejects.toThrow(
      'GitHub authentication failed'
    );
  });

  it('throws a rate-limit error on 403 with remaining=0', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeGraphQLNoResolvedThreads()) // fetchResolvedCommentIds
      .mockResolvedValueOnce(
        makeResponse({}, 403, {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': '9999999999',
        })
      );
    await expect(fetchCopilotComments('tok', 'o', 'r', 1)).rejects.toThrow(
      'rate limit'
    );
  });

  it('throws an access-denied error on 403 when rate limit is not exhausted', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeGraphQLNoResolvedThreads()) // fetchResolvedCommentIds
      .mockResolvedValueOnce(
        makeResponse({}, 403, { 'X-RateLimit-Remaining': '10' })
      );
    await expect(fetchCopilotComments('tok', 'o', 'r', 1)).rejects.toThrow(
      'Access denied'
    );
  });

  it('throws a "PR not found" error on 404', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeGraphQLNoResolvedThreads()) // fetchResolvedCommentIds
      .mockResolvedValueOnce(makeResponse({}, 404));          // fetchPage → 404
    await expect(fetchCopilotComments('tok', 'o', 'r', 1)).rejects.toThrow(
      'PR not found'
    );
  });

  it('throws a rate-limit error on 429', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeGraphQLNoResolvedThreads()) // fetchResolvedCommentIds
      .mockResolvedValueOnce(
        makeResponse({}, 429, { 'X-RateLimit-Reset': '9999999999' })
      );
    await expect(fetchCopilotComments('tok', 'o', 'r', 1)).rejects.toThrow(
      'rate limit'
    );
  });

  it('retries once on network error and succeeds on the second call', async () => {
    // fetchWithRetry retries the SAME comments-page request on network failure.
    // Sequence: GraphQL (success) → fetchPage attempt 1 (network error) → fetchPage retry (success).
    vi.useFakeTimers();
    try {
      const c = makeRawComment();
      vi.mocked(fetch)
        .mockResolvedValueOnce(makeGraphQLNoResolvedThreads())  // fetchResolvedCommentIds
        .mockRejectedValueOnce(new Error('Network down'))        // fetchPage attempt 1
        .mockResolvedValueOnce(makeResponse([c]));               // fetchPage retry (after 1s)

      const resultPromise = fetchCopilotComments('tok', 'o', 'r', 1);
      await vi.advanceTimersByTimeAsync(1100); // advance past the 1s retry delay
      const result = await resultPromise;

      expect(result.comments).toHaveLength(1);
      expect(fetch).toHaveBeenCalledTimes(3); // GraphQL + 2 fetchPage calls (attempt + retry)
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws a network error after both fetch attempts fail', async () => {
    // Sequence: GraphQL (success) → fetchPage attempt 1 (fail) → fetchPage retry (fail) → throws.
    vi.useFakeTimers();
    try {
      vi.mocked(fetch)
        .mockResolvedValueOnce(makeGraphQLNoResolvedThreads()) // fetchResolvedCommentIds
        .mockRejectedValueOnce(new Error('down'))              // fetchPage attempt 1
        .mockRejectedValueOnce(new Error('still down'));       // fetchPage retry
      const resultPromise = fetchCopilotComments('tok', 'o', 'r', 1);
      // Attach the rejection handler BEFORE advancing timers to avoid
      // an "unhandled rejection" Node.js warning.
      const assertion = expect(resultPromise).rejects.toThrow('Network error');
      await vi.advanceTimersByTimeAsync(1100);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('filters out comments whose review thread is already resolved (resolved IDs from GraphQL)', async () => {
    // Comment 100 is resolved, comment 200 is active. After filtering, only 200 should remain.
    const resolvedComment = makeRawComment({ id: 100 });
    const activeComment  = makeRawComment({ id: 200 });

    vi.mocked(fetch)
      .mockResolvedValueOnce(makeResponse({   // GraphQL: thread for comment 100 is resolved
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [{
                  isResolved: true,
                  comments: { nodes: [{ databaseId: 100 }] },
                }],
              },
            },
          },
        },
      }))
      .mockResolvedValueOnce(makeResponse([resolvedComment, activeComment])); // page 1

    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1);

    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe(200);
  });

  it('shows all comments (fail-open) when fetchResolvedCommentIds gets a non-ok HTTP response', async () => {
    const comment = makeRawComment();

    vi.mocked(fetch)
      .mockResolvedValueOnce(makeResponse({ message: 'Bad credentials' }, 401)) // GraphQL → non-ok
      .mockResolvedValueOnce(makeResponse([comment]));                           // page 1 proceeds normally

    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1);

    expect(comments).toHaveLength(1);
  });

  it('shows all comments (fail-open) when fetchResolvedCommentIds throws a network error', async () => {
    const comment = makeRawComment();

    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('Network error'))  // GraphQL → network error
      .mockResolvedValueOnce(makeResponse([comment]));    // page 1 proceeds normally

    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1);

    expect(comments).toHaveLength(1);
  });

  it('throws a generic GitHub API error when fetchPage returns an unexpected non-ok status', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeGraphQLNoResolvedThreads()) // fetchResolvedCommentIds
      .mockResolvedValueOnce(makeResponse({}, 500));         // fetchPage → 500 → !response.ok
    await expect(fetchCopilotComments('tok', 'o', 'r', 1)).rejects.toThrow(
      'GitHub API error: 500'
    );
  });

  it('skips reply comments (in_reply_to_id != null) and logs to outputChannel when provided', async () => {
    const topLevel = makeRawComment({ id: 1 });
    const reply = makeRawComment({ id: 2, in_reply_to_id: 1 });
    const channel = { appendLine: vi.fn() };
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeGraphQLNoResolvedThreads())    // fetchResolvedCommentIds
      .mockResolvedValueOnce(makeResponse([topLevel, reply]));  // fetchPage — 2 items < 100, break

    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1, channel);

    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe(1);
    expect(channel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('skipped reply comment id=2')
    );
  });
});

// ─── fetchPrState ─────────────────────────────────────────────────────────────

describe('fetchPrState', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('returns state and merged flag from the API', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ state: 'open', merged: false })
    );
    const result = await fetchPrState('tok', 'o', 'r', 1);
    expect(result).toEqual({ state: 'open', merged: false });
  });

  it('returns { state: "closed", merged: true } for a merged PR', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ state: 'closed', merged: true })
    );
    const result = await fetchPrState('tok', 'o', 'r', 1);
    expect(result).toEqual({ state: 'closed', merged: true });
  });

  it('returns { state:"unknown", merged:false } on network error', async () => {
    // fetchWithRetry retries once on network error — mock both attempts failing
    vi.useFakeTimers();
    try {
      vi.mocked(fetch)
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'));
      const resultPromise = fetchPrState('tok', 'o', 'r', 1);
      await vi.advanceTimersByTimeAsync(1100);
      const result = await resultPromise;
      expect(result).toEqual({ state: 'unknown', merged: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns { state:"unknown", merged:false } on non-ok HTTP response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({}, 404));
    const result = await fetchPrState('tok', 'o', 'r', 1);
    expect(result).toEqual({ state: 'unknown', merged: false });
  });
});

// ─── postReplyComment ─────────────────────────────────────────────────────────

describe('postReplyComment', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('posts to the correct URL with POST method', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({}));
    await postReplyComment('tok', 'owner', 'repo', 42, 7, 'reply body');

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/pulls/42/comments/7/replies',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('sends the body as JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({}));
    await postReplyComment('tok', 'owner', 'repo', 42, 7, 'my reply');

    const callArgs = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(callArgs.body as string)).toEqual({ body: 'my reply' });
  });

  it('resolves without error on 201', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({}, 201));
    await expect(postReplyComment('tok', 'o', 'r', 1, 1, 'ok')).resolves.toBeUndefined();
  });

  it('throws on a non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({}, 422));
    await expect(postReplyComment('tok', 'o', 'r', 1, 1, 'body')).rejects.toThrow(
      'Failed to post reply comment'
    );
  });

  it('throws on a network error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('connection refused'));
    await expect(postReplyComment('tok', 'o', 'r', 1, 1, 'body')).rejects.toThrow(
      'Network error posting reply comment'
    );
  });
});

// ─── resolveReviewThread ──────────────────────────────────────────────────────

describe('resolveReviewThread', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  function makeThreadsBody(commentId: number, threadId: string) {
    return {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                { id: threadId, comments: { nodes: [{ databaseId: commentId }] } },
              ],
            },
          },
        },
      },
    };
  }

  it('resolves the thread matching the given commentId', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeResponse(makeThreadsBody(99, 'PRRT_1')))
      .mockResolvedValueOnce(
        makeResponse({
          data: { resolveReviewThread: { thread: { isResolved: true } } },
        })
      );

    await expect(
      resolveReviewThread('tok', 'o', 'r', 1, 99)
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('sends the resolved threadId in the mutation variables', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeResponse(makeThreadsBody(5, 'PRRT_thread5')))
      .mockResolvedValueOnce(makeResponse({}));

    await resolveReviewThread('tok', 'o', 'r', 1, 5);

    const mutCall = vi.mocked(fetch).mock.calls[1][1] as RequestInit;
    const body = JSON.parse(mutCall.body as string);
    expect(body.variables).toEqual({ threadId: 'PRRT_thread5' });
  });

  it('throws when no thread is found for the commentId', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({
        data: {
          repository: { pullRequest: { reviewThreads: { nodes: [] } } },
        },
      })
    );
    await expect(resolveReviewThread('tok', 'o', 'r', 1, 999)).rejects.toThrow(
      'Review thread for comment 999 not found'
    );
  });

  it('throws on GraphQL errors in the list response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ errors: [{ message: 'forbidden' }] })
    );
    await expect(resolveReviewThread('tok', 'o', 'r', 1, 1)).rejects.toThrow(
      'GraphQL errors: forbidden'
    );
  });

  it('throws on non-ok HTTP for the list request', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({}, 500));
    await expect(resolveReviewThread('tok', 'o', 'r', 1, 1)).rejects.toThrow(
      'GraphQL request failed'
    );
  });

  it('throws on network error during list', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('timeout'));
    await expect(resolveReviewThread('tok', 'o', 'r', 1, 1)).rejects.toThrow(
      'Network error querying review threads'
    );
  });

  it('throws on GraphQL errors in the mutation response', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeResponse(makeThreadsBody(5, 'PRRT_5')))
      .mockResolvedValueOnce(makeResponse({ errors: [{ message: 'unauthorized' }] }));
    await expect(resolveReviewThread('tok', 'o', 'r', 1, 5)).rejects.toThrow(
      'GraphQL mutation errors: unauthorized'
    );
  });

  it('throws on non-ok HTTP for the mutation request', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeResponse(makeThreadsBody(5, 'PRRT_5')))
      .mockResolvedValueOnce(makeResponse({}, 403));
    await expect(resolveReviewThread('tok', 'o', 'r', 1, 5)).rejects.toThrow(
      'GraphQL mutation failed'
    );
  });

  it('throws on network error during mutation', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeResponse(makeThreadsBody(5, 'PRRT_5')))
      .mockRejectedValueOnce(new Error('network error'));
    await expect(resolveReviewThread('tok', 'o', 'r', 1, 5)).rejects.toThrow(
      'Network error resolving review thread'
    );
  });
});

// ─── fetchOpenPullRequests ────────────────────────────────────────────────────

describe('fetchOpenPullRequests', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  function makePrItem(n: number, authorLogin = 'author', assigneeLogins: string[] = []) {
    return {
      number: n,
      title: `PR ${n}`,
      html_url: `https://github.com/o/r/pull/${n}`,
      assignees: assigneeLogins.map((login) => ({ login })),
      user: { login: authorLogin },
    };
  }

  it('returns mapped OpenPr objects for a successful response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([makePrItem(1), makePrItem(2)]));
    const prs = await fetchOpenPullRequests('tok', 'o', 'r');
    expect(prs).toHaveLength(2);
    expect(prs[0]).toEqual({ owner: 'o', repo: 'r', pullNumber: 1, title: 'PR 1', htmlUrl: 'https://github.com/o/r/pull/1' });
    expect(prs[1]).toEqual({ owner: 'o', repo: 'r', pullNumber: 2, title: 'PR 2', htmlUrl: 'https://github.com/o/r/pull/2' });
  });

  it('returns an empty array for an empty list', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([]));
    const prs = await fetchOpenPullRequests('tok', 'o', 'r');
    expect(prs).toEqual([]);
  });

  it('throws an access-denied error on a 403 response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({}, 403));
    await expect(fetchOpenPullRequests('tok', 'o', 'r')).rejects.toThrow('Access denied');
  });

  it('throws a network error when fetch fails for open PRs', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('still down'));
    await expect(fetchOpenPullRequests('tok', 'o', 'r')).rejects.toThrow('Network error while contacting GitHub');
  });

  it('requests the open PRs endpoint with state=open and no extra params', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([]));
    await fetchOpenPullRequests('tok', 'owner', 'repo');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/pulls?state=open&per_page=100',
      expect.anything()
    );
  });

  it('returns all PRs when currentUser is not provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([makePrItem(1, 'alice'), makePrItem(2, 'bob')]));
    const prs = await fetchOpenPullRequests('tok', 'o', 'r');
    expect(prs).toHaveLength(2);
  });

  it('filters to PRs authored by the currentUser', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse([makePrItem(1, 'alice'), makePrItem(2, 'bob')])
    );
    const prs = await fetchOpenPullRequests('tok', 'o', 'r', 'alice');
    expect(prs).toHaveLength(1);
    expect(prs[0].pullNumber).toBe(1);
  });

  it('filters to PRs where the currentUser is an assignee', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse([makePrItem(1, 'alice', ['bob']), makePrItem(2, 'alice', ['carol'])])
    );
    const prs = await fetchOpenPullRequests('tok', 'o', 'r', 'bob');
    expect(prs).toHaveLength(1);
    expect(prs[0].pullNumber).toBe(1);
  });

  it('includes a PR where the currentUser is both author and assignee', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse([makePrItem(1, 'alice', ['alice'])])
    );
    const prs = await fetchOpenPullRequests('tok', 'o', 'r', 'alice');
    expect(prs).toHaveLength(1);
  });

  it('returns empty array when no PRs match the currentUser', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse([makePrItem(1, 'alice'), makePrItem(2, 'bob')])
    );
    const prs = await fetchOpenPullRequests('tok', 'o', 'r', 'charlie');
    expect(prs).toHaveLength(0);
  });

  it('does not append any query params beyond state and per_page', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([]));
    await fetchOpenPullRequests('tok', 'owner', 'repo', 'octocat');
    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://api.github.com/repos/owner/repo/pulls?state=open&per_page=100');
  });

  it('filterMode "created" returns only PRs authored by the current user', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse([makePrItem(1, 'alice', ['bob']), makePrItem(2, 'bob')])
    );
    const prs = await fetchOpenPullRequests('tok', 'o', 'r', 'alice', 'created');
    expect(prs).toHaveLength(1);
    expect(prs[0].pullNumber).toBe(1);
  });

  it('filterMode "created" excludes PRs where user is only an assignee', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse([makePrItem(1, 'bob', ['alice'])])
    );
    const prs = await fetchOpenPullRequests('tok', 'o', 'r', 'alice', 'created');
    expect(prs).toHaveLength(0);
  });

  it('filterMode "assigned" returns only PRs where user is an assignee', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse([makePrItem(1, 'alice', ['alice']), makePrItem(2, 'alice', ['bob'])])
    );
    const prs = await fetchOpenPullRequests('tok', 'o', 'r', 'alice', 'assigned');
    expect(prs).toHaveLength(1);
    expect(prs[0].pullNumber).toBe(1);
  });

  it('filterMode "assigned" excludes PRs where user is only the author', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse([makePrItem(1, 'alice', [])])
    );
    const prs = await fetchOpenPullRequests('tok', 'o', 'r', 'alice', 'assigned');
    expect(prs).toHaveLength(0);
  });

  it('throws authentication error on a 401 response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({}, 401));
    await expect(fetchOpenPullRequests('tok', 'o', 'r')).rejects.toThrow('GitHub authentication failed');
  });

  it('throws repository-not-found error on a 404 response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({}, 404));
    await expect(fetchOpenPullRequests('tok', 'o', 'r')).rejects.toThrow('Repository not found');
  });

  it('throws a generic API error for non-ok responses other than 401/403/404', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({}, 500));
    await expect(fetchOpenPullRequests('tok', 'o', 'r')).rejects.toThrow('GitHub API error: 500');
  });
});

// ─── fetchHasCopilotReview ────────────────────────────────────────────────

describe('fetchHasCopilotReview', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  function makeReview(login: string, state: string) {
    return { user: { login }, state };
  }

  it('returns true when a known Copilot bot has a CHANGES_REQUESTED review', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse([makeReview('copilot-pull-request-reviewer[bot]', 'CHANGES_REQUESTED')])
    );
    expect(await fetchHasCopilotReview('tok', 'o', 'r', 1)).toBe(true);
  });

  it('returns true when a known Copilot bot has a COMMENTED review', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse([makeReview('github-copilot[bot]', 'COMMENTED')])
    );
    expect(await fetchHasCopilotReview('tok', 'o', 'r', 1)).toBe(true);
  });

  it('returns false when the only Copilot review is APPROVED', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse([makeReview('copilot-pull-request-reviewer[bot]', 'APPROVED')])
    );
    expect(await fetchHasCopilotReview('tok', 'o', 'r', 1)).toBe(false);
  });

  it('returns false when the only Copilot review is DISMISSED', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse([makeReview('copilot-pull-request-reviewer[bot]', 'DISMISSED')])
    );
    expect(await fetchHasCopilotReview('tok', 'o', 'r', 1)).toBe(false);
  });

  it('returns false when there are no reviews at all', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([]));
    expect(await fetchHasCopilotReview('tok', 'o', 'r', 1)).toBe(false);
  });

  it('returns false when reviews are only from human users', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse([makeReview('human-dev', 'CHANGES_REQUESTED')])
    );
    expect(await fetchHasCopilotReview('tok', 'o', 'r', 1)).toBe(false);
  });

  it('returns true when an additional bot login has a CHANGES_REQUESTED review', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse([makeReview('my-custom-bot', 'CHANGES_REQUESTED')])
    );
    expect(await fetchHasCopilotReview('tok', 'o', 'r', 1, ['my-custom-bot'])).toBe(true);
  });

  it('returns false on a non-ok response (does not throw)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({}, 403));
    expect(await fetchHasCopilotReview('tok', 'o', 'r', 1)).toBe(false);
  });

  it('returns false on a network error (does not throw)', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetch)
        .mockRejectedValueOnce(new Error('down'))
        .mockRejectedValueOnce(new Error('down'));
      const p = fetchHasCopilotReview('tok', 'o', 'r', 1);
      await vi.advanceTimersByTimeAsync(1100);
      expect(await p).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('calls the /reviews endpoint URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([]));
    await fetchHasCopilotReview('tok', 'owner', 'repo', 42);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/pulls/42/reviews?per_page=100',
      expect.anything()
    );
  });
});

// ─── fetchCurrentUser ─────────────────────────────────────────────────────────

describe('fetchCurrentUser', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('returns the login of the authenticated user', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ login: 'octocat' }));
    const login = await fetchCurrentUser('tok');
    expect(login).toBe('octocat');
  });

  it('requests the /user endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ login: 'octocat' }));
    await fetchCurrentUser('tok');
    expect(fetch).toHaveBeenCalledWith('https://api.github.com/user', expect.anything());
  });

  it('returns null on a non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({}, 401));
    const login = await fetchCurrentUser('tok');
    expect(login).toBeNull();
  });

  it('returns null on a network error', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetch)
        .mockRejectedValueOnce(new Error('down'))
        .mockRejectedValueOnce(new Error('down'));
      const resultPromise = fetchCurrentUser('tok');
      await vi.advanceTimersByTimeAsync(1100);
      expect(await resultPromise).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── isCopilotBot trust-bypass prevention (Security Issue #4) ────────────────

describe('isCopilotBot trust-bypass prevention', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('includes a login that merely contains "copilot" (mycopilot) since all comments are returned', async () => {
    // 'mycopilot' is not in COPILOT_BOT_LOGINS and has no [bot] suffix → fetchUserDisplayNames is called.
    const comment = makeRawComment({ user: { login: 'mycopilot' } });
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeGraphQLNoResolvedThreads())        // fetchResolvedCommentIds
      .mockResolvedValueOnce(makeResponse([comment]))               // fetchPage
      .mockResolvedValueOnce(makeDisplayNameResponse('mycopilot')); // fetchUserDisplayNames
    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1);
    expect(comments).toHaveLength(1);
    expect(comments[0].reviewer).toBe('mycopilot');
  });

  it('includes "notcopilot" login since all comments are returned', async () => {
    // 'notcopilot' is not in COPILOT_BOT_LOGINS and has no [bot] suffix → display-name fetch.
    const comment = makeRawComment({ user: { login: 'notcopilot' } });
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeGraphQLNoResolvedThreads())         // fetchResolvedCommentIds
      .mockResolvedValueOnce(makeResponse([comment]))                // fetchPage
      .mockResolvedValueOnce(makeDisplayNameResponse('notcopilot')); // fetchUserDisplayNames
    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1);
    expect(comments).toHaveLength(1);
    expect(comments[0].reviewer).toBe('notcopilot');
  });

  it('includes "Copilot-evil[bot]" login since all comments are returned', async () => {
    // Login ends with [bot] — excluded from fetchUserDisplayNames.
    const comment = makeRawComment({ user: { login: 'Copilot-evil[bot]' } });
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeGraphQLNoResolvedThreads()) // fetchResolvedCommentIds
      .mockResolvedValueOnce(makeResponse([comment]));       // fetchPage — no display-name fetch
    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1);
    expect(comments).toHaveLength(1);
    expect(comments[0].reviewer).toBe('Copilot-evil[bot]');
  });

  it('accepts a login that is in additionalBotLogins', async () => {
    // 'my-custom-bot[bot]' ends with [bot] — no display-name fetch.
    const comment = makeRawComment({ user: { login: 'my-custom-bot[bot]' } });
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeGraphQLNoResolvedThreads()) // fetchResolvedCommentIds
      .mockResolvedValueOnce(makeResponse([comment]));       // fetchPage
    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1, undefined, ['my-custom-bot[bot]']);
    expect(comments).toHaveLength(1);
  });

  it('returns comment when login does not match additionalBotLogins since all comments are returned', async () => {
    // 'my-custom-bot-v2[bot]' ends with [bot] — no display-name fetch.
    const comment = makeRawComment({ user: { login: 'my-custom-bot-v2[bot]' } });
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeGraphQLNoResolvedThreads()) // fetchResolvedCommentIds
      .mockResolvedValueOnce(makeResponse([comment]));       // fetchPage
    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1, undefined, ['my-custom-bot[bot]']);
    expect(comments).toHaveLength(1);
    expect(comments[0].reviewer).toBe('my-custom-bot-v2[bot]');
  });
});

// ─── fetchPrDetails (Security Issue #9) ──────────────────────────────────────

describe('fetchPrDetails', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('returns combined state, merged, and metadata in one request', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({
        state: 'open', merged: false,
        title: 'My PR', assignees: [{ login: 'alice' }], changed_files: 5,
        head: { ref: 'feature/my-branch' },
      })
    );
    const result = await fetchPrDetails('tok', 'o', 'r', 1);
    expect(result).toEqual({
      state: 'open', merged: false,
      title: 'My PR', assignee: 'alice', filesChangedCount: 5,
      headBranch: 'feature/my-branch',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns safe defaults on network error', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetch)
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'));
      const resultPromise = fetchPrDetails('tok', 'o', 'r', 1);
      await vi.advanceTimersByTimeAsync(1100);
      const result = await resultPromise;
      expect(result).toEqual({ state: 'unknown', merged: false, title: '', assignee: null, filesChangedCount: 0, headBranch: '' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns safe defaults on non-ok HTTP response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({}, 404));
    const result = await fetchPrDetails('tok', 'o', 'r', 1);
    expect(result).toEqual({ state: 'unknown', merged: false, title: '', assignee: null, filesChangedCount: 0, headBranch: '' });
  });

  it('fetchPrState still works as a thin wrapper that makes only one HTTP call', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ state: 'closed', merged: true, title: 'T', assignees: [], changed_files: 0 })
    );
    const result = await fetchPrState('tok', 'o', 'r', 1);
    expect(result).toEqual({ state: 'closed', merged: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
