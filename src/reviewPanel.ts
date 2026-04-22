import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { AnnotatedComment } from './workPlanGenerator';
import { FixStatus, DoneFixResult } from './fixApplier';
import { GitStatus } from './gitHelper';

export class ReviewPanel {
  public static currentPanel: ReviewPanel | undefined;
  private static readonly viewType = 'copilotReviewerPanel';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _mediaUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  private _onApplyFixes: ((selectedIds: number[]) => void) | undefined;
  private _onStageCommitAndPush: ((doneResults: DoneFixResult[]) => void) | undefined;
  private _onRetryFix: ((id: number) => void) | undefined;
  private _doneResults: DoneFixResult[] = [];

  public static createOrShow(
    context: vscode.ExtensionContext,
    prUrl: string,
    comments: AnnotatedComment[],
    onApplyFixes: (selectedIds: number[]) => void,
    onStageCommitAndPush: (doneResults: DoneFixResult[]) => void,
    onRetryFix: (id: number) => void
  ): ReviewPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ReviewPanel.currentPanel) {
      ReviewPanel.currentPanel._panel.reveal(column);
      ReviewPanel.currentPanel._update(prUrl, comments);
      ReviewPanel.currentPanel._onApplyFixes = onApplyFixes;
      ReviewPanel.currentPanel._onStageCommitAndPush = onStageCommitAndPush;
      ReviewPanel.currentPanel._onRetryFix = onRetryFix;
      ReviewPanel.currentPanel._doneResults = [];
      return ReviewPanel.currentPanel;
    }

    const mediaUri = vscode.Uri.joinPath(context.extensionUri, 'media');

    const panel = vscode.window.createWebviewPanel(
      ReviewPanel.viewType,
      'Copilot Reviewer Assistant',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [mediaUri],
        retainContextWhenHidden: true,
      }
    );

    ReviewPanel.currentPanel = new ReviewPanel(panel, mediaUri, prUrl, comments, onApplyFixes, onStageCommitAndPush, onRetryFix);
    return ReviewPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    mediaUri: vscode.Uri,
    prUrl: string,
    comments: AnnotatedComment[],
    onApplyFixes: (selectedIds: number[]) => void,
    onStageCommitAndPush: (doneResults: DoneFixResult[]) => void,
    onRetryFix: (id: number) => void
  ) {
    this._panel = panel;
    this._mediaUri = mediaUri;
    this._onApplyFixes = onApplyFixes;
    this._onStageCommitAndPush = onStageCommitAndPush;
    this._onRetryFix = onRetryFix;

    this._update(prUrl, comments);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message: { command: string; selectedIds?: number[]; id?: number }) => {
        if (message.command === 'applyFixes' && message.selectedIds) {
          this._onApplyFixes?.(message.selectedIds);
        } else if (message.command === 'stageCommitAndPush') {
          this._onStageCommitAndPush?.(this._doneResults);
        } else if (message.command === 'retryFix' && message.id !== undefined) {
          this._onRetryFix?.(message.id);
        }
      },
      null,
      this._disposables
    );
  }

  private _update(prUrl: string, comments: AnnotatedComment[]): void {
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, prUrl, comments);
  }

  private _getHtmlForWebview(
    webview: vscode.Webview,
    prUrl: string,
    comments: AnnotatedComment[]
  ): string {
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._mediaUri, 'panel.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._mediaUri, 'panel.js'));
    const nonce = crypto.randomBytes(16).toString('hex');

    // Parse PR URL for display
    const urlMatch = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    const repoLabel = urlMatch ? `${urlMatch[1]}/${urlMatch[2]}` : prUrl;
    const prNumber = urlMatch ? `#${urlMatch[3]}` : '';

    const cardsHtml = comments.length === 0
      ? `<div class="empty-state">
        <svg class="empty-icon" width="48" height="48" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true">
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm11.354-2.646a.5.5 0 0 0-.708-.708L7 8.293 5.354 6.646a.5.5 0 1 0-.708.708l2 2a.5.5 0 0 0 .708 0l4-4z"/>
        </svg>
        <p>No pending Copilot review recommendations found for this PR.</p>
        <p class="empty-sub">Try a PR that has been reviewed by GitHub Copilot.</p>
      </div>`
      : comments.map(({ comment, workPlan, fileFound }) => {
        const fileNotFound = fileFound === false;
        const linkHref = safeGithubUrl(comment.htmlUrl);
        const linkHtml = linkHref
          ? `<a class="comment-link" href="${linkHref}" target="_blank">View on GitHub ↗</a>`
          : '';
        return `
        <div class="card">
          <input
            type="checkbox"
            class="comment-checkbox"
            data-id="${comment.id}"
            ${fileNotFound ? '' : 'checked'}
            aria-label="Select fix for ${escapeHtml(comment.path)}"
          />
          <div class="card-body">
            <div class="card-header">
              <span class="badge" title="${escapeHtml(comment.path)}">${escapeHtml(comment.path)}</span>
              <span class="line-num">line ${comment.line}</span>
              ${fileNotFound ? '<span class="badge badge-warning">File not in workspace</span>' : ''}
              ${linkHtml}
            </div>
            <details>
              <summary>Reviewer comment</summary>
              <div class="details-body">
                <div class="comment-body">${escapeHtml(comment.body)}</div>
              </div>
            </details>
            <div class="work-plan-label">Work plan</div>
            <div class="work-plan">${workPlanToHtml(workPlan)}</div>
          </div>
        </div>`;
      }).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${cssUri}" rel="stylesheet" />
  <title>Copilot Reviewer Assistant</title>
</head>
<body>
  <h1>Copilot Reviewer Assistant</h1>
  <p class="pr-meta">${escapeHtml(repoLabel)} ${escapeHtml(prNumber)} &mdash; ${comments.length} recommendation${comments.length === 1 ? '' : 's'}</p>
  <div id="banner-area"></div>
  <div class="toolbar${comments.length === 0 ? ' hidden' : ''}">
    <label class="select-all-label">
      <input type="checkbox" id="select-all-cb" />
      <span id="select-all-text">Select all</span>
    </label>
    <button id="apply-btn" disabled>Apply Selected Fixes</button>
    <button id="stage-commit-push-btn" class="hidden">Stage, Commit &amp; Push</button>
  </div>
  <div class="progress-bar-track" id="progress-track" aria-hidden="true">
    <div class="progress-bar-fill" id="progress-fill"></div>
  </div>
  <div id="git-notice" class="git-notice hidden"></div>
  <div class="comment-list">
    ${cardsHtml}
  </div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  public postFixStatus(status: FixStatus): void {
    if (status.state === 'done') {
      this._doneResults.push({
        commentId: status.id,
        commentPath: status.filePath,
        startLine: status.startLine,
        endLine: status.endLine,
      });
    }
    void this._panel.webview.postMessage({ command: 'fixStatus', status });
  }

  public postBanner(message: string, type: 'info' | 'warning' = 'info'): void {
    void this._panel.webview.postMessage({ command: 'banner', message, type });
  }

  public postGitStatus(status: GitStatus): void {
    void this._panel.webview.postMessage({ command: 'gitStatus', status });
  }

  public dispose(): void {
    ReviewPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Converts a numbered-list work plan into an HTML <ol>. Falls back to <p>. */
export function workPlanToHtml(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const items = lines
    .filter((l) => /^\d+\.\s+/.test(l))
    .map((l) => l.replace(/^\d+\.\s+/, ''));

  if (items.length > 0) {
    const listItems = items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    return `<ol>${listItems}</ol>`;
  }

  return `<p>${escapeHtml(text)}</p>`;
}

/** Returns the URL only if it is a safe GitHub HTTPS URL, otherwise null. */
export function safeGithubUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && parsed.hostname === 'github.com') {
      return escapeHtml(url);
    }
  } catch {
    // invalid URL
  }
  return null;
}
