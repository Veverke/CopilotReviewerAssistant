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

// ─── fetchCopilotComments ─────────────────────────────────────────────────────

describe('fetchCopilotComments', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('returns copilot comments and filters out others', async () => {
    const copilot = makeRawComment();
    const human = makeRawComment({ id: 2, user: { login: 'human-dev' } });
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([copilot, human]));

    const { comments, outdatedCount } = await fetchCopilotComments('tok', 'o', 'r', 1);

    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe(1);
    expect(outdatedCount).toBe(0);
  });

  it('recognises all explicit copilot login aliases', async () => {
    const aliases = [
      'copilot-pull-request-reviewer[bot]',
      'github-copilot[bot]',
      'copilot[bot]',
      'Copilot',
      'copilot',
    ];

    for (const login of aliases) {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse([makeRawComment({ user: { login } })])
      );
      const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1);
      expect(comments).toHaveLength(1);
    }
  });

  it('rejects logins that merely contain "copilot" but are not in the explicit allowlist', async () => {
    const comment = makeRawComment({ user: { login: 'myCopilot-internal[bot]' } });
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([comment]));

    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1);
    expect(comments).toHaveLength(0);
  });

  it('skips and counts outdated comments (position=null, subject_type=line)', async () => {
    const outdated = makeRawComment({ position: null });
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([outdated]));

    const { comments, outdatedCount } = await fetchCopilotComments('tok', 'o', 'r', 1);
    expect(comments).toHaveLength(0);
    expect(outdatedCount).toBe(1);
  });

  it('paginates until a page returns fewer than 100 items', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) =>
      makeRawComment({ id: i + 1 })
    );
    const page2 = [makeRawComment({ id: 101 })];
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeResponse(page1))
      .mockResolvedValueOnce(makeResponse(page2));

    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1);
    expect(comments).toHaveLength(101);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('uses original_line as fallback when line is null', async () => {
    const c = makeRawComment({ line: null, original_line: 7 });
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([c]));

    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1);
    expect(comments[0].line).toBe(7);
  });

  it('falls back to 0 when both line and original_line are null', async () => {
    const c = makeRawComment({ line: null, original_line: null });
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([c]));

    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1);
    expect(comments[0].line).toBe(0);
  });

  it('throws a 401 auth-failed error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({}, 401));
    await expect(fetchCopilotComments('tok', 'o', 'r', 1)).rejects.toThrow(
      'GitHub authentication failed'
    );
  });

  it('throws a rate-limit error on 403 with remaining=0', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
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
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({}, 403, { 'X-RateLimit-Remaining': '10' })
    );
    await expect(fetchCopilotComments('tok', 'o', 'r', 1)).rejects.toThrow(
      'Access denied'
    );
  });

  it('throws a "PR not found" error on 404', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({}, 404));
    await expect(fetchCopilotComments('tok', 'o', 'r', 1)).rejects.toThrow(
      'PR not found'
    );
  });

  it('throws a rate-limit error on 429', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({}, 429, { 'X-RateLimit-Reset': '9999999999' })
    );
    await expect(fetchCopilotComments('tok', 'o', 'r', 1)).rejects.toThrow(
      'rate limit'
    );
  });

  it('retries once on network error and succeeds on the second call', async () => {
    vi.useFakeTimers();
    try {
      const c = makeRawComment();
      vi.mocked(fetch)
        .mockRejectedValueOnce(new Error('Network down'))
        .mockResolvedValueOnce(makeResponse([c]));

      const resultPromise = fetchCopilotComments('tok', 'o', 'r', 1);
      await vi.advanceTimersByTimeAsync(1100);
      const result = await resultPromise;

      expect(result.comments).toHaveLength(1);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws a network error after both fetch attempts fail', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetch)
        .mockRejectedValueOnce(new Error('down'))
        .mockRejectedValueOnce(new Error('still down'));
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

  function makePrItem(n: number) {
    return { number: n, title: `PR ${n}`, html_url: `https://github.com/o/r/pull/${n}` };
  }

  it('returns mapped OpenPr objects for a successful response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([makePrItem(1), makePrItem(2)]));
    const prs = await fetchOpenPullRequests('tok', 'o', 'r');
    expect(prs).toHaveLength(2);
    expect(prs[0]).toEqual({ pullNumber: 1, title: 'PR 1', htmlUrl: 'https://github.com/o/r/pull/1' });
    expect(prs[1]).toEqual({ pullNumber: 2, title: 'PR 2', htmlUrl: 'https://github.com/o/r/pull/2' });
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

  it('requests the open PRs endpoint with the correct URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([]));
    await fetchOpenPullRequests('tok', 'owner', 'repo');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/pulls?state=open&per_page=100',
      expect.anything()
    );
  });
});

// ─── isCopilotBot trust-bypass prevention (Security Issue #4) ────────────────

describe('isCopilotBot trust-bypass prevention', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('rejects a login that merely contains "copilot" (mycopilot)', async () => {
    const comment = makeRawComment({ user: { login: 'mycopilot' } });
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([comment]));
    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1);
    expect(comments).toHaveLength(0);
  });

  it('rejects "notcopilot"', async () => {
    const comment = makeRawComment({ user: { login: 'notcopilot' } });
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([comment]));
    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1);
    expect(comments).toHaveLength(0);
  });

  it('rejects "Copilot-evil[bot]"', async () => {
    const comment = makeRawComment({ user: { login: 'Copilot-evil[bot]' } });
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([comment]));
    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1);
    expect(comments).toHaveLength(0);
  });

  it('accepts a login that is in additionalBotLogins', async () => {
    const comment = makeRawComment({ user: { login: 'my-custom-bot[bot]' } });
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([comment]));
    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1, undefined, ['my-custom-bot[bot]']);
    expect(comments).toHaveLength(1);
  });

  it('does not accept via additionalBotLogins when login does not exactly match', async () => {
    const comment = makeRawComment({ user: { login: 'my-custom-bot-v2[bot]' } });
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([comment]));
    const { comments } = await fetchCopilotComments('tok', 'o', 'r', 1, undefined, ['my-custom-bot[bot]']);
    expect(comments).toHaveLength(0);
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
