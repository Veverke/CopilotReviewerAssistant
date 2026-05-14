import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { PrMetadata, reviewerDisplayName } from './githubApi';
import { AnnotatedComment } from './workPlanGenerator';
import { DoneFixResult } from './fixApplier';
import { GitStatus } from './gitHelper';

export class ReviewPanel {
  public static currentPanel: ReviewPanel | undefined;
  private static readonly viewType = 'copilotReviewerPanel';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _mediaUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _outputChannel: vscode.OutputChannel | undefined;

  private _onFixWithCopilotChat: ((selectedIds: number[]) => void) | undefined;
  private _onStageCommitAndPush: ((selectedIds: number[]) => void) | undefined;
  private _prMeta: PrMetadata = { title: '', assignee: null, filesChangedCount: 0 };

  public static showLoading(context: vscode.ExtensionContext, prUrl: string): ReviewPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ReviewPanel.currentPanel) {
      ReviewPanel.currentPanel._panel.reveal(column);
      ReviewPanel.currentPanel._onFixWithCopilotChat = undefined;
      ReviewPanel.currentPanel._onStageCommitAndPush = undefined;
      ReviewPanel.currentPanel._panel.webview.html =
        ReviewPanel.currentPanel._getLoadingHtml(ReviewPanel.currentPanel._panel.webview, prUrl);
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

    ReviewPanel.currentPanel = new ReviewPanel(panel, mediaUri, prUrl);
    return ReviewPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    mediaUri: vscode.Uri,
    prUrl: string,
  ) {
    this._panel = panel;
    this._mediaUri = mediaUri;

    this._panel.webview.html = this._getLoadingHtml(this._panel.webview, prUrl);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message: { command: string; selectedIds?: number[] }) => {
        if (message.command === 'fixWithCopilotChat') {
          this._onFixWithCopilotChat?.(message.selectedIds ?? []);
        } else if (message.command === 'stageCommitAndPush') {
          this._onStageCommitAndPush?.(message.selectedIds ?? []);
        }
      },
      null,
      this._disposables
    );
  }

  public setContent(
    prUrl: string,
    comments: AnnotatedComment[],
    prMeta: PrMetadata,
    onFixWithCopilotChat: (selectedIds: number[]) => void,
    onStageCommitAndPush: (selectedIds: number[]) => void,
    outputChannel?: vscode.OutputChannel
  ): void {
    this._prMeta = prMeta;
    this._onFixWithCopilotChat = onFixWithCopilotChat;
    this._onStageCommitAndPush = onStageCommitAndPush;
    this._outputChannel = outputChannel;
    this._update(prUrl, comments);
  }

  public showError(message: string): void {
    this._panel.webview.html = this._getErrorHtml(this._panel.webview, message);
  }

  public postLoadingProgress(completed: number, total: number, label?: string): void {
    this._panel.webview.postMessage({ type: 'loadingProgress', completed, total, label });
  }

  private _update(prUrl: string, comments: AnnotatedComment[]): void {
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, prUrl, comments, this._prMeta);
  }

  private _getLoadingHtml(webview: vscode.Webview, prUrl: string): string {
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._mediaUri, 'panel.css'));
    const nonce = crypto.randomBytes(16).toString('hex');
    const urlMatch = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    const repoLabel = urlMatch ? `${urlMatch[1]}/${urlMatch[2]}` : prUrl;
    const prNumber = urlMatch ? `#${urlMatch[3]}` : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${cssUri}" rel="stylesheet" />
  <title>Copilot Reviewer Assistant</title>
</head>
<body>
  <div class="pr-header">
    <h1>Copilot Reviewer Assistant</h1>
    <div class="pr-header-meta">
      <span class="pr-meta-item"><span class="pr-meta-key">Repo:</span> ${escapeHtml(repoLabel)} ${escapeHtml(prNumber)}</span>
      <span class="pr-meta-item"><span class="pr-meta-key">URL:</span> <a class="pr-url-link" href="${safeGithubUrl(prUrl)}" target="_blank">${escapeHtml(prUrl)}</a></span>
    </div>
  </div>
  <div class="loading-state">
    <div class="loading-spinner" role="status" aria-label="Loading PR data"></div>
    <div class="loading-message">Fetching PR data&hellip;</div>
    <div class="loading-progress-track"><div class="loading-progress-fill" id="loading-progress-fill"></div></div>
    <div class="loading-progress-label" id="loading-progress-label">Connecting&hellip;</div>
  </div>
  <script nonce="${nonce}">
    window.addEventListener('message', function(e) {
      var msg = e.data;
      if (!msg || msg.type !== 'loadingProgress') { return; }
      var pct = msg.total > 0 ? Math.round((msg.completed / msg.total) * 100) : 0;
      var fill = document.getElementById('loading-progress-fill');
      var lbl = document.getElementById('loading-progress-label');
      if (fill) { fill.style.width = pct + '%'; }
      if (lbl && msg.label) { lbl.textContent = msg.label; }
    });
  </script>
</body>
</html>`;
  }

  private _getErrorHtml(webview: vscode.Webview, message: string): string {
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._mediaUri, 'panel.css'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${cssUri}" rel="stylesheet" />
  <title>Copilot Reviewer Assistant</title>
</head>
<body>
  <div class="pr-header">
    <h1>Copilot Reviewer Assistant</h1>
  </div>
  <div class="loading-state">
    <div class="error-message">${escapeHtml(message)}</div>
  </div>
</body>
</html>`;
  }

  private _getHtmlForWebview(
    webview: vscode.Webview,
    prUrl: string,
    comments: AnnotatedComment[],
    prMeta: PrMetadata,
  ): string {
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._mediaUri, 'panel.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._mediaUri, 'panel.js'));
    const nonce = crypto.randomBytes(16).toString('hex');

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
      : comments.map(({ comment, workPlan, fileFound, complexity, severity, warnings }, index) => {
        const fileNotFound = fileFound === false;
        const hasWarnings = warnings && warnings.length > 0;
        const warningTitle = hasWarnings ? warnings!.join('\n') : '';
        const linkHref = safeGithubUrl(comment.htmlUrl);
        const linkHtml = linkHref
          ? `<a class="comment-link" href="${linkHref}" target="_blank">View on GitHub ↗</a>`
          : '';
        const complexityLevel = complexity ?? 'low';
        const complexityLabel = complexityLevel === 'low' ? 'LOW' : complexityLevel === 'medium' ? 'MED' : 'HIGH';
        const severityLevel = severity ?? '';
        const severityLabel = severityLevel === 'critical' ? 'CRIT' : severityLevel === 'high' ? 'HIGH' : severityLevel === 'medium' ? 'MED' : severityLevel === 'low' ? 'LOW' : '';
        const severityChip = severityLabel
          ? `<span class="severity-badge severity-${severityLevel}" title="Severity: ${severityLevel}">${severityLabel}</span>`
          : '';
        const number = index + 1;
        return `
        <div class="card" data-id="${comment.id}" data-reviewer="${escapeHtml(comment.reviewer)}" data-file="${escapeHtml(comment.path)}" data-complexity="${complexityLevel}" data-severity="${severityLevel}" data-number="${number}">
          <input
            type="checkbox"
            class="comment-checkbox"
            data-id="${comment.id}"
            checked
            aria-label="Select fix for ${escapeHtml(comment.path)}"
          />
          <div class="card-body">
            <div class="card-header">
              <span class="card-number">#${number}</span>
              <span class="badge" title="${escapeHtml(comment.path)}">${escapeHtml(comment.path)}</span>
              <span class="line-num">line ${comment.line}</span>
              <span class="complexity-badge complexity-${complexityLevel}" title="Complexity: ${complexityLevel}">${complexityLabel}</span>
              ${severityChip}
              ${fileNotFound ? '<span class="badge badge-warning" title="This file does not exist in the current workspace.">File not found locally</span>' : ''}
              ${hasWarnings ? `<span class="badge badge-warning" title="${escapeHtml(warningTitle)}">⚠ Scope check</span>` : ''}
              ${linkHtml}
            </div>
            <details open>
              <summary>Reviewer comment</summary>
              <div class="details-body">
                <div class="comment-body">${escapeHtml(comment.body)}</div>
              </div>
            </details>
          </div>
        </div>`;
      }).join('\n');

    const uniqueReviewers = [...new Set(comments.map(({ comment }) => comment.reviewer).filter(Boolean))].sort();
    const reviewerFilterHtml = uniqueReviewers.length > 1
      ? `<div class="reviewer-filter-row">
          <span class="controls-label">Filter by reviewer:</span>
          <div class="reviewer-filter-btns">
            ${uniqueReviewers.map((r) =>
              `<label class="reviewer-check-label">
                <input type="checkbox" class="reviewer-cb" data-reviewer="${escapeHtml(r)}" checked />
                <span>${escapeHtml(reviewerDisplayName(r))}</span>
              </label>`
            ).join('')}
          </div>
        </div>`
      : '';

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
  <div class="sticky-top">
    <div class="pr-header">
      <h1>Copilot Reviewer Assistant</h1>
      ${prMeta.title ? `<div class="pr-header-title"><span class="pr-meta-key">PR Title:</span> ${escapeHtml(prMeta.title)}</div>` : ''}
      <div class="pr-header-meta">
        <span class="pr-meta-item"><span class="pr-meta-key">Repo:</span> ${escapeHtml(repoLabel)} ${escapeHtml(prNumber)}</span>
        ${prMeta.assignee ? `<span class="pr-meta-item"><span class="pr-meta-key">Assignee:</span> ${escapeHtml(prMeta.assignee)}</span>` : ''}
        ${prMeta.filesChangedCount > 0 ? `<span class="pr-meta-item"><span class="pr-meta-key">Files changed:</span> ${prMeta.filesChangedCount}</span>` : ''}
        <span class="pr-meta-item"><span class="pr-meta-key">URL:</span> <a class="pr-url-link" href="${safeGithubUrl(prUrl)}" target="_blank">${escapeHtml(prUrl)}</a></span>
      </div>
      <div class="pr-header-pills">
        <span class="pill pill-total" id="pill-checked-count">${comments.length} / ${comments.length} selected</span>
      </div>
    </div>
    <div class="toolbar${comments.length === 0 ? ' hidden' : ''}">
      <label class="select-all-label">
        <input type="checkbox" id="select-all-cb" />
        <span id="select-all-text">Select all</span>
      </label>
      <button id="fix-chat-btn">Apply Fixes</button>
      <button id="stage-commit-push-btn" class="secondary" disabled>Push &amp; Mark Resolved</button>
      <div class="group-sort-row">
        <span class="controls-label">Group by:</span>
        <div class="btn-group">
          <button class="group-btn secondary active" data-group="none">None</button>
          <button class="group-btn secondary" data-group="file">File</button>
          <button class="group-btn secondary" data-group="complexity">Complexity</button>
          <button class="group-btn secondary" data-group="severity">Severity</button>
        </div>
        <button id="expand-collapse-btn" class="secondary hidden">Collapse All</button>
      </div>
      ${reviewerFilterHtml}
    </div>
  </div>
  <div id="banner-area"></div>
  <div id="git-notice" class="git-notice hidden"></div>
  <div id="push-progress" class="apply-progress hidden">
    <div class="apply-progress-text">
      <span class="apply-progress-spinner" id="push-spinner"></span>
      <span id="push-progress-label">Preparing…</span>
    </div>
    <div class="apply-progress-bar-track">
      <div class="apply-progress-bar-fill" id="push-bar-fill"></div>
    </div>
  </div>
  <div class="comment-list" id="comment-list">
    ${cardsHtml}
  </div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  public postPushProgress(label: string, percent: number): void {
    void this._panel.webview.postMessage({ command: 'pushProgress', label, percent });
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

export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
