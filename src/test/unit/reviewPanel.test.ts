/**
 * Phase 6 – Webview Panel UI (pure helper functions)
 *
 * Test plan:
 *  escapeHtml()
 *    - escapes & < > " ' to HTML entities
 *    - leaves plain text untouched
 *    - escapes all special characters in one string
 *
 *  safeGithubUrl()
 *    - returns the escaped URL for a valid https github.com URL
 *    - returns null for http (non-https) URLs
 *    - returns null for non-github.com HTTPS URLs
 *    - returns null for an invalid URL string
 *    - returns null for an empty string
 *    - escapes HTML special characters in a returned URL
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createWebviewPanel: vi.fn(),
    activeTextEditor: undefined,
  },
  ViewColumn: { One: 1 },
  Uri: {
    joinPath: vi.fn(),
  },
}));

import * as vscode from 'vscode';
import { escapeHtml, safeGithubUrl, ReviewPanel, workPlanToHtml } from '../../reviewPanel';

// ─── escapeHtml ───────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('escapes ampersand &', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than <', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes greater-than >', () => {
    expect(escapeHtml('1 > 0')).toBe('1 &gt; 0');
  });

  it('escapes double-quote "', () => {
    expect(escapeHtml('"value"')).toBe('&quot;value&quot;');
  });

  it("escapes single-quote '", () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('escapes multiple special characters in a single string', () => {
    expect(escapeHtml('<a href="x">it\'s & fun</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;it&#39;s &amp; fun&lt;/a&gt;'
    );
  });
});

// ─── safeGithubUrl ────────────────────────────────────────────────────────────

describe('safeGithubUrl', () => {
  it('returns the escaped URL for a valid github.com HTTPS link', () => {
    const url = 'https://github.com/owner/repo/pull/1#comment-1';
    expect(safeGithubUrl(url)).toBe(escapeHtml(url));
  });

  it('returns null for an http (non-https) github.com URL', () => {
    expect(safeGithubUrl('http://github.com/owner/repo/pull/1')).toBeNull();
  });

  it('returns null for an HTTPS URL on a different domain', () => {
    expect(safeGithubUrl('https://evil.com/path')).toBeNull();
  });

  it('returns null for an invalid URL string', () => {
    expect(safeGithubUrl('not-a-url')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(safeGithubUrl('')).toBeNull();
  });

  it('returns null for a javascript: protocol URL', () => {
    expect(safeGithubUrl('javascript:alert(1)')).toBeNull();
  });

  it('escapes HTML characters in the returned URL', () => {
    // A URL with an ampersand in the query string
    const url = 'https://github.com/owner/repo/pull/1?a=1&b=2';
    const result = safeGithubUrl(url);
    expect(result).not.toContain('&b');
    expect(result).toContain('&amp;b');
  });
});

// ─── workPlanToHtml ───────────────────────────────────────────────────────────

describe('workPlanToHtml', () => {
  it('converts a numbered list to an <ol> with <li> items', () => {
    const html = workPlanToHtml('1. First step\n2. Second step\n3. Third step');
    expect(html).toBe('<ol><li>First step</li><li>Second step</li><li>Third step</li></ol>');
  });

  it('wraps non-list text in a <p> element', () => {
    const html = workPlanToHtml('Just a plain paragraph.');
    expect(html).toBe('<p>Just a plain paragraph.</p>');
  });

  it('escapes HTML special characters in list items', () => {
    const html = workPlanToHtml('1. Use <strong> tags & entities');
    expect(html).toContain('&lt;strong&gt;');
    expect(html).toContain('&amp;');
  });

  it('escapes HTML special characters in paragraph text', () => {
    const html = workPlanToHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('ignores non-numbered lines when numbered items are also present', () => {
    const html = workPlanToHtml('Header:\n1. Do this\nFooter note');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>Do this</li>');
    expect(html).not.toContain('Footer note');
    expect(html).not.toContain('Header:');
  });
});

// ─── ReviewPanel class ────────────────────────────────────────────────────────

describe('ReviewPanel', () => {
  type FakeWebview = {
    html: string;
    postMessage: ReturnType<typeof vi.fn>;
    asWebviewUri: ReturnType<typeof vi.fn>;
    cspSource: string;
    onDidReceiveMessage: ReturnType<typeof vi.fn>;
  };
  type FakePanel = {
    webview: FakeWebview;
    reveal: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    onDidDispose: ReturnType<typeof vi.fn>;
  };

  let fakeWebview: FakeWebview;
  let fakePanel: FakePanel;
  let fakeContext: { extensionUri: { fsPath: string } };
  let capturedMessageHandler: ((msg: { command: string; selectedIds?: number[] }) => void) | undefined;
  let capturedDisposeHandler: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    ReviewPanel.currentPanel = undefined;
    capturedMessageHandler = undefined;
    capturedDisposeHandler = undefined;

    fakeWebview = {
      html: '',
      postMessage: vi.fn().mockResolvedValue(undefined),
      asWebviewUri: vi.fn((uri: any) => `wvu:${uri?.fsPath ?? uri}`),
      cspSource: 'https:',
      onDidReceiveMessage: vi.fn().mockImplementation((handler: any, _thisArg?: any, disposables?: any[]) => {
        capturedMessageHandler = handler;
        const d = { dispose: vi.fn() };
        if (Array.isArray(disposables)) { disposables.push(d); }
        return d;
      }),
    };

    fakePanel = {
      webview: fakeWebview,
      reveal: vi.fn(),
      dispose: vi.fn(),
      onDidDispose: vi.fn().mockImplementation((cb: any, _thisArg?: any, disposables?: any[]) => {
        capturedDisposeHandler = cb;
        const d = { dispose: vi.fn() };
        if (Array.isArray(disposables)) { disposables.push(d); }
        return d;
      }),
    };

    vi.mocked(vscode.Uri.joinPath).mockImplementation((...args: any[]) => {
      const parts = args.map((a: any) => (typeof a === 'string' ? a : (a?.fsPath ?? String(a))));
      return { fsPath: parts.join('/') } as any;
    });

    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(fakePanel as any);

    fakeContext = { extensionUri: { fsPath: '/ext' } } as any;
  });

  afterEach(() => {
    ReviewPanel.currentPanel = undefined;
  });

  it('showLoading creates a webview panel and sets loading HTML', () => {
    ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/42');

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
    expect(fakeWebview.html).toContain('loading-spinner');
  });

  it('showLoading extracts repo label and PR number from a github.com URL', () => {
    ReviewPanel.showLoading(fakeContext as any, 'https://github.com/acme/myrepo/pull/99');

    expect(fakeWebview.html).toContain('acme/myrepo');
    expect(fakeWebview.html).toContain('#99');
  });

  it('showLoading falls back to the full URL when the path does not match the GitHub PR pattern', () => {
    ReviewPanel.showLoading(fakeContext as any, 'https://example.com/not-a-pr');

    expect(fakeWebview.html).toContain('https://example.com/not-a-pr');
  });

  it('showLoading stores the new panel as ReviewPanel.currentPanel', () => {
    ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');

    expect(ReviewPanel.currentPanel).toBeDefined();
  });

  it('showLoading reuses the existing panel and does not create a second one', () => {
    ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
    ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/2');

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
    expect(fakePanel.reveal).toHaveBeenCalledOnce();
  });

  it('showError sets HTML containing the error message', () => {
    ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
    ReviewPanel.currentPanel!.showError('Something went wrong');

    expect(fakeWebview.html).toContain('Something went wrong');
    expect(fakeWebview.html).toContain('error-message');
  });

  it('showError escapes HTML special characters in the message', () => {
    ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
    ReviewPanel.currentPanel!.showError('<script>alert("xss")</script>');

    expect(fakeWebview.html).not.toContain('<script>');
    expect(fakeWebview.html).toContain('&lt;script&gt;');
  });

  it('postLoadingProgress sends a loadingProgress message to the webview', () => {
    ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
    ReviewPanel.currentPanel!.postLoadingProgress(3, 10, 'Fetching comments…');

    expect(fakeWebview.postMessage).toHaveBeenCalledWith({
      type: 'loadingProgress',
      completed: 3,
      total: 10,
      label: 'Fetching comments…',
    });
  });

  it('setContent renders the full webview HTML and includes the comment path and body', () => {
    const panel = ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
    const comments = [{
      comment: { id: 1, path: 'src/foo.ts', line: 10, body: 'Fix this', reviewer: 'copilot[bot]', htmlUrl: 'https://github.com/owner/repo/pull/1#comment-1', diffHunk: '' },
      workPlan: '1. Apply fix',
      fileFound: true,
      complexity: 'low' as const,
    }];

    panel.setContent(
      'https://github.com/owner/repo/pull/1',
      comments,
      { title: 'My PR', assignee: 'dev', filesChangedCount: 2 },
      vi.fn(),
      vi.fn()
    );

    expect(fakeWebview.html).toContain('src/foo.ts');
    expect(fakeWebview.html).toContain('Fix this');
  });

  it('setContent shows the empty-state block when there are no comments', () => {
    const panel = ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');

    panel.setContent(
      'https://github.com/owner/repo/pull/1',
      [],
      { title: '', assignee: null, filesChangedCount: 0 },
      vi.fn(),
      vi.fn()
    );

    expect(fakeWebview.html).toContain('empty-state');
    expect(fakeWebview.html).toContain('No pending Copilot review recommendations');
  });

  it('onDidReceiveMessage triggers the fixWithCopilotChat callback with selectedIds', () => {
    const onFix = vi.fn();
    const onPush = vi.fn();
    const panel = ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
    panel.setContent('https://github.com/owner/repo/pull/1', [], { title: '', assignee: null, filesChangedCount: 0 }, onFix, onPush);

    capturedMessageHandler!({ command: 'fixWithCopilotChat', selectedIds: [1, 2] });

    expect(onFix).toHaveBeenCalledWith([1, 2]);
    expect(onPush).not.toHaveBeenCalled();
  });

  it('onDidReceiveMessage triggers the stageCommitAndPush callback with selectedIds', () => {
    const onFix = vi.fn();
    const onPush = vi.fn();
    const panel = ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
    panel.setContent('https://github.com/owner/repo/pull/1', [], { title: '', assignee: null, filesChangedCount: 0 }, onFix, onPush);

    capturedMessageHandler!({ command: 'stageCommitAndPush', selectedIds: [3] });

    expect(onPush).toHaveBeenCalledWith([3]);
    expect(onFix).not.toHaveBeenCalled();
  });

  it('onDidReceiveMessage with an unknown command does not throw', () => {
    const panel = ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
    panel.setContent('https://github.com/owner/repo/pull/1', [], { title: '', assignee: null, filesChangedCount: 0 }, vi.fn(), vi.fn());

    expect(() => capturedMessageHandler!({ command: 'unknownCommand' })).not.toThrow();
  });

  it('postPushProgress sends a pushProgress message with label and percent', () => {
    ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
    ReviewPanel.currentPanel!.postPushProgress('Pushing…', 50);

    expect(fakeWebview.postMessage).toHaveBeenCalledWith({
      command: 'pushProgress',
      label: 'Pushing…',
      percent: 50,
    });
  });

  it('postBanner sends a banner message with message and type', () => {
    ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
    ReviewPanel.currentPanel!.postBanner('Done!', 'info');

    expect(fakeWebview.postMessage).toHaveBeenCalledWith({
      command: 'banner',
      message: 'Done!',
      type: 'info',
    });
  });

  it('postGitStatus sends a gitStatus message with the status object', () => {
    ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
    ReviewPanel.currentPanel!.postGitStatus({ state: 'pushed' });

    expect(fakeWebview.postMessage).toHaveBeenCalledWith({
      command: 'gitStatus',
      status: { state: 'pushed' },
    });
  });

  it('dispose clears currentPanel and disposes the underlying webview panel', () => {
    ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
    expect(ReviewPanel.currentPanel).toBeDefined();

    ReviewPanel.currentPanel!.dispose();

    expect(ReviewPanel.currentPanel).toBeUndefined();
    expect(fakePanel.dispose).toHaveBeenCalledOnce();
  });

  it('panel onDidDispose callback triggers full disposal', () => {
    ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');

    capturedDisposeHandler?.();

    expect(ReviewPanel.currentPanel).toBeUndefined();
  });

  it('dispose iterates and calls dispose() on all registered disposables', () => {
    ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
    // The constructor registers onDidDispose + onDidReceiveMessage → 2 disposables
    const panel = ReviewPanel.currentPanel!;
    panel.dispose();
    // Each disposable registered via the mock should have been disposed
    const allDisposeCalls = [
      ...vi.mocked(fakeWebview.onDidReceiveMessage).mock.results,
      ...vi.mocked(fakePanel.onDidDispose).mock.results,
    ].map((r) => r.value as { dispose: ReturnType<typeof vi.fn> });
    expect(allDisposeCalls.every((d) => d.dispose.mock.calls.length > 0)).toBe(true);
  });

  it('setContent renders reviewer filter row when comments come from multiple distinct reviewers', () => {
    const panel = ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
    const comments = [
      {
        comment: { id: 1, path: 'src/a.ts', line: 5, body: 'Fix a', reviewer: 'copilot[bot]', htmlUrl: 'https://github.com/owner/repo/pull/1#comment-1', diffHunk: '' },
        workPlan: '',
        fileFound: true,
        complexity: 'low' as const,
      },
      {
        comment: { id: 2, path: 'src/b.ts', line: 10, body: 'Fix b', reviewer: 'copilot-pr-reviewer[bot]', htmlUrl: 'https://github.com/owner/repo/pull/1#comment-2', diffHunk: '' },
        workPlan: '',
        fileFound: true,
        complexity: 'medium' as const,
      },
    ];

    panel.setContent(
      'https://github.com/owner/repo/pull/1',
      comments,
      { title: 'My PR', assignee: null, filesChangedCount: 2 },
      vi.fn(),
      vi.fn(),
    );

    expect(fakeWebview.html).toContain('reviewer-filter-row');
    expect(fakeWebview.html).toContain('reviewer-cb');
    expect(fakeWebview.html).toContain('copilot[bot]');
    expect(fakeWebview.html).toContain('copilot-pr-reviewer[bot]');
  });

  it('showLoading uses the active text editor viewColumn when one is open', () => {
    (vscode.window as any).activeTextEditor = { viewColumn: 2 };
    try {
      ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        2,
        expect.anything()
      );
    } finally {
      (vscode.window as any).activeTextEditor = undefined;
    }
  });

  it('onDidReceiveMessage passes an empty array to fixWithCopilotChat when selectedIds is omitted', () => {
    const onFix = vi.fn();
    const panel = ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
    panel.setContent('https://github.com/owner/repo/pull/1', [], { title: '', assignee: null, filesChangedCount: 0 }, onFix, vi.fn());

    capturedMessageHandler!({ command: 'fixWithCopilotChat' }); // no selectedIds → ?? [] kicks in

    expect(onFix).toHaveBeenCalledWith([]);
  });

  it('onDidReceiveMessage passes an empty array to stageCommitAndPush when selectedIds is omitted', () => {
    const onPush = vi.fn();
    const panel = ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
    panel.setContent('https://github.com/owner/repo/pull/1', [], { title: '', assignee: null, filesChangedCount: 0 }, vi.fn(), onPush);

    capturedMessageHandler!({ command: 'stageCommitAndPush' }); // no selectedIds → ?? [] kicks in

    expect(onPush).toHaveBeenCalledWith([]);
  });

  it('setContent uses the full prUrl as repo label when it does not match the GitHub PR pattern', () => {
    const panel = ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
    panel.setContent(
      'https://example.com/not-a-pr',
      [],
      { title: '', assignee: null, filesChangedCount: 0 },
      vi.fn(),
      vi.fn(),
    );
    // repoLabel falls back to the full URL; prNumber is empty
    expect(fakeWebview.html).toContain('https://example.com/not-a-pr');
    expect(fakeWebview.html).not.toContain('#');
  });

  it('setContent shows the "File not found locally" badge when fileFound is false', () => {
    const panel = ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
    panel.setContent(
      'https://github.com/owner/repo/pull/1',
      [{
        comment: { id: 1, path: 'src/gone.ts', line: 5, body: 'Fix this', reviewer: 'copilot[bot]', htmlUrl: 'https://github.com/owner/repo/pull/1#comment-1', diffHunk: '' },
        workPlan: '',
        fileFound: false,
        complexity: 'low' as const,
      }],
      { title: '', assignee: null, filesChangedCount: 0 },
      vi.fn(),
      vi.fn(),
    );
    expect(fakeWebview.html).toContain('File not found locally');
  });

  it('setContent shows the scope-check badge and HIGH complexity for a comment with warnings and high complexity', () => {
    const panel = ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
    panel.setContent(
      'https://github.com/owner/repo/pull/1',
      [{
        comment: { id: 1, path: 'src/foo.ts', line: 5, body: 'Watch out', reviewer: 'copilot[bot]', htmlUrl: 'https://github.com/owner/repo/pull/1#comment-1', diffHunk: '' },
        workPlan: '',
        fileFound: true,
        complexity: 'high' as const,
        warnings: ['This change has broad scope'],
      }],
      { title: '', assignee: null, filesChangedCount: 0 },
      vi.fn(),
      vi.fn(),
    );
    expect(fakeWebview.html).toContain('⚠ Scope check');
    expect(fakeWebview.html).toContain('HIGH');
    expect(fakeWebview.html).toContain('This change has broad scope'); // warningTitle in title attribute
  });

  it('setContent omits the GitHub link when htmlUrl is invalid and defaults complexity to LOW when complexity is undefined', () => {
    const panel = ReviewPanel.showLoading(fakeContext as any, 'https://github.com/owner/repo/pull/1');
    panel.setContent(
      'https://github.com/owner/repo/pull/1',
      [{
        comment: { id: 1, path: 'src/foo.ts', line: 5, body: 'Fix this', reviewer: 'copilot[bot]', htmlUrl: '', diffHunk: '' },
        workPlan: '',
        fileFound: true,
        complexity: undefined, // triggers complexity ?? 'low' fallback
      }],
      { title: '', assignee: null, filesChangedCount: 0 },
      vi.fn(),
      vi.fn(),
    );
    expect(fakeWebview.html).toContain('complexity-low'); // ?? 'low' fallback
    expect(fakeWebview.html).not.toContain('View on GitHub'); // linkHtml is '' when safeGithubUrl returns null
  });
});
