import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { AnnotatedComment, ComparisonResult } from './workPlanGenerator';
import { PrMetadata } from './githubApi';
import { FixStatus, DoneFixResult } from './fixApplier';
import { GitStatus } from './gitHelper';

export interface ImportedWorkPlanItem {
  id: number;
  workPlan: string;
  complexity: string;
}

export class ReviewPanel {
  public static currentPanel: ReviewPanel | undefined;
  private static readonly viewType = 'copilotReviewerPanel';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _mediaUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _outputChannel: vscode.OutputChannel | undefined;

  private _onApplyFixes: ((selectedIds: number[]) => void) | undefined;
  private _onStageCommitAndPush: ((doneResults: DoneFixResult[]) => void) | undefined;
  private _onRetryFix: ((id: number) => void) | undefined;
  private _onRetryBuild: (() => void) | undefined;
  private _onRegenerateWorkPlan: ((id: number) => void) | undefined;
  private _onImportWorkPlans: ((items: ImportedWorkPlanItem[]) => void) | undefined;
  private _onCompareWorkPlans: (() => void) | undefined;
  private _doneResults: DoneFixResult[] = [];
  private _prMeta: PrMetadata = { title: '', assignee: null, filesChangedCount: 0 };

  public static showLoading(context: vscode.ExtensionContext, prUrl: string): ReviewPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ReviewPanel.currentPanel) {
      ReviewPanel.currentPanel._panel.reveal(column);
      ReviewPanel.currentPanel._onApplyFixes = undefined;
      ReviewPanel.currentPanel._onStageCommitAndPush = undefined;
      ReviewPanel.currentPanel._onRetryFix = undefined;
      ReviewPanel.currentPanel._onRetryBuild = undefined;
      ReviewPanel.currentPanel._doneResults = [];
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

    ReviewPanel.currentPanel = new ReviewPanel(
      panel, mediaUri, prUrl, null,
      { title: '', assignee: null, filesChangedCount: 0 },
      undefined, undefined, undefined, undefined
    );
    return ReviewPanel.currentPanel;
  }

  public static createOrShow(
    context: vscode.ExtensionContext,
    prUrl: string,
    comments: AnnotatedComment[],
    prMeta: PrMetadata,
    onApplyFixes: (selectedIds: number[]) => void,
    onStageCommitAndPush: (doneResults: DoneFixResult[]) => void,
    onRetryFix: (id: number) => void,
    onRetryBuild: () => void
  ): ReviewPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ReviewPanel.currentPanel) {
      ReviewPanel.currentPanel._panel.reveal(column);
      ReviewPanel.currentPanel._prMeta = prMeta;
      ReviewPanel.currentPanel._update(prUrl, comments);
      ReviewPanel.currentPanel._onApplyFixes = onApplyFixes;
      ReviewPanel.currentPanel._onStageCommitAndPush = onStageCommitAndPush;
      ReviewPanel.currentPanel._onRetryFix = onRetryFix;
      ReviewPanel.currentPanel._onRetryBuild = onRetryBuild;
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

    ReviewPanel.currentPanel = new ReviewPanel(panel, mediaUri, prUrl, comments, prMeta, onApplyFixes, onStageCommitAndPush, onRetryFix, onRetryBuild);
    return ReviewPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    mediaUri: vscode.Uri,
    prUrl: string,
    comments: AnnotatedComment[] | null,
    prMeta: PrMetadata,
    onApplyFixes: ((selectedIds: number[]) => void) | undefined,
    onStageCommitAndPush: ((doneResults: DoneFixResult[]) => void) | undefined,
    onRetryFix: ((id: number) => void) | undefined,
    onRetryBuild: (() => void) | undefined
  ) {
    this._panel = panel;
    this._mediaUri = mediaUri;
    this._onApplyFixes = onApplyFixes;
    this._onStageCommitAndPush = onStageCommitAndPush;
    this._onRetryFix = onRetryFix;
    this._onRetryBuild = onRetryBuild;
    this._prMeta = prMeta;

    if (comments === null) {
      this._panel.webview.html = this._getLoadingHtml(this._panel.webview, prUrl);
    } else {
      this._update(prUrl, comments);
    }

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message: { command: string; selectedIds?: number[]; id?: number; chatType?: string; number?: number; text?: string; content?: string }) => {
        if (message.command === 'applyFixes' && message.selectedIds) {
          this._onApplyFixes?.(message.selectedIds);
        } else if (message.command === 'stageCommitAndPush') {
          this._onStageCommitAndPush?.(this._doneResults);
        } else if (message.command === 'retryFix' && message.id !== undefined) {
          this._onRetryFix?.(message.id);
        } else if (message.command === 'retryBuild') {
          this._onRetryBuild?.();
        } else if (message.command === 'exportReviews' && message.content) {
          void (async () => {
            const uri = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file('review-export.json'),
              filters: { 'JSON': ['json'] },
              title: 'Export Review Items',
            });
            if (!uri) { return; }
            await vscode.workspace.fs.writeFile(uri, Buffer.from(message.content as string, 'utf-8'));
            vscode.window.showInformationMessage('Review items exported successfully.');
          })();
        } else if (message.command === 'regenerateWorkPlan' && message.id !== undefined) {
          this._onRegenerateWorkPlan?.(message.id);
        } else if (message.command === 'importWorkPlans') {
          void (async () => {
            const uris = await vscode.window.showOpenDialog({
              filters: { 'JSON': ['json'] },
              canSelectMany: false,
              title: 'Import Work Plans',
            });
            if (!uris || uris.length === 0) { return; }
            let data: { reviews?: unknown[] };
            try {
              const bytes = await vscode.workspace.fs.readFile(uris[0]);
              data = JSON.parse(Buffer.from(bytes).toString('utf-8'));
            } catch {
              vscode.window.showErrorMessage('Could not read or parse the selected file. Ensure it is a valid review export JSON.');
              return;
            }
            if (!Array.isArray(data?.reviews)) {
              vscode.window.showErrorMessage('The selected file does not contain a "reviews" array.');
              return;
            }
            const imported: ImportedWorkPlanItem[] = [];
            for (const raw of data.reviews) {
              const item = raw as Record<string, unknown>;
              if (typeof item.id !== 'number') { continue; }
              const steps = Array.isArray(item.workPlan) ? (item.workPlan as string[]) : [];
              const workPlan = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
              const workPlanHtml = workPlanArrayToHtml(steps);
              const complexity = typeof item.complexity === 'string' ? item.complexity : 'low';
              imported.push({ id: item.id, workPlan, complexity });
              void this._panel.webview.postMessage({
                command: 'applyImportedWorkPlan',
                id: item.id,
                workPlan,
                workPlanHtml,
                complexity,
              });
            }
            this._onImportWorkPlans?.(imported);
          })();
        } else if (message.command === 'compareWorkPlans') {
          this._onCompareWorkPlans?.();
        } else if (message.command === 'openChat' && message.text) {
          this._outputChannel?.appendLine(`[openChat] type=${message.chatType} #${message.number} text-start="${message.text.slice(0, 80)}"`);
          const prompt = message.chatType === 'comment'
            ? `You left the following review comment:\n${message.text}\n\nI want to further discuss it.\n`
            : `For review comment #${message.number ?? ''} you came up with the following work plan:\n${message.text}\n\nI want to further discuss it.\n`;
          void (async () => {
            // Always write to clipboard so user has it regardless
            try { await vscode.env.clipboard.writeText(prompt); } catch { /* ignore */ }

            // Try to open chat with prompt pre-filled (isPartialQuery = fill input but don't send)
            let prefilled = false;
            try {
              await vscode.commands.executeCommand('workbench.action.chat.open', {
                query: prompt,
                isPartialQuery: true,
              });
              prefilled = true;
              this._outputChannel?.appendLine('[openChat] Chat opened with pre-filled prompt.');
            } catch (err1: unknown) {
              this._outputChannel?.appendLine(`[openChat] pre-fill failed: ${err1 instanceof Error ? err1.message : String(err1)} — falling back to open + clipboard`);
              try {
                await vscode.commands.executeCommand('workbench.action.chat.open');
              } catch {
                try {
                  await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
                } catch { /* ignore */ }
              }
            }

            if (!prefilled) {
              vscode.window.showInformationMessage(
                'Prompt copied to clipboard \u2014 paste it into Copilot Chat (Ctrl+V / Cmd+V).',
                { modal: false }
              );
            }
          })();
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
    modelName: string | undefined,
    onApplyFixes: (selectedIds: number[]) => void,
    onStageCommitAndPush: (doneResults: DoneFixResult[]) => void,
    onRetryFix: (id: number) => void,
    onRetryBuild: () => void,
    onRegenerateWorkPlan: (id: number) => void,
    onImportWorkPlans: (items: ImportedWorkPlanItem[]) => void,
    onCompareWorkPlans: () => void,
    outputChannel?: vscode.OutputChannel
  ): void {
    this._prMeta = prMeta;
    this._onApplyFixes = onApplyFixes;
    this._onStageCommitAndPush = onStageCommitAndPush;
    this._onRetryFix = onRetryFix;
    this._onRetryBuild = onRetryBuild;
    this._onRegenerateWorkPlan = onRegenerateWorkPlan;
    this._onImportWorkPlans = onImportWorkPlans;
    this._onCompareWorkPlans = onCompareWorkPlans;
    this._outputChannel = outputChannel;
    this._doneResults = [];
    this._update(prUrl, comments, modelName);
  }

  public showError(message: string): void {
    this._panel.webview.html = this._getErrorHtml(this._panel.webview, message);
  }

  public postLoadingProgress(completed: number, total: number): void {
    this._panel.webview.postMessage({ type: 'loadingProgress', completed, total });
  }

  private _update(prUrl: string, comments: AnnotatedComment[], modelName?: string): void {
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, prUrl, comments, this._prMeta, modelName);
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
    <div class="loading-message" id="loading-message">Fetching PR data&hellip;</div>
    <div class="loading-progress-track" id="loading-progress-track" style="display:none">
      <div class="loading-progress-fill" id="loading-progress-fill"></div>
    </div>
    <div class="loading-progress-label" id="loading-progress-label"></div>
  </div>
  <script nonce="${nonce}">
    window.addEventListener('message', function(event) {
      var msg = event.data;
      if (msg.type !== 'loadingProgress') { return; }
      var track = document.getElementById('loading-progress-track');
      var fill = document.getElementById('loading-progress-fill');
      var label = document.getElementById('loading-progress-label');
      var msgEl = document.getElementById('loading-message');
      if (!track || !fill || !label || !msgEl) { return; }
      track.style.display = 'block';
      msgEl.textContent = 'Generating work plans\u2026';
      var pct = msg.total > 0 ? Math.round((msg.completed / msg.total) * 100) : 0;
      fill.style.width = pct + '%';
      label.textContent = msg.completed + ' / ' + msg.total + ' reviews processed';
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
    modelName?: string
  ): string {
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._mediaUri, 'panel.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._mediaUri, 'panel.js'));
    const nonce = crypto.randomBytes(16).toString('hex');

    // Parse PR URL for display
    const urlMatch = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    const repoLabel = urlMatch ? `${urlMatch[1]}/${urlMatch[2]}` : prUrl;
    const prNumber = urlMatch ? `#${urlMatch[3]}` : '';

    const sortedComments = comments;

    const cardsHtml = sortedComments.length === 0
      ? `<div class="empty-state">
        <svg class="empty-icon" width="48" height="48" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true">
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm11.354-2.646a.5.5 0 0 0-.708-.708L7 8.293 5.354 6.646a.5.5 0 1 0-.708.708l2 2a.5.5 0 0 0 .708 0l4-4z"/>
        </svg>
        <p>No pending Copilot review recommendations found for this PR.</p>
        <p class="empty-sub">Try a PR that has been reviewed by GitHub Copilot.</p>
      </div>`
      : sortedComments.map(({ comment, workPlan, fileFound, complexity, warnings }, index) => {
        const fileNotFound = fileFound === false;
        const hasWarnings = warnings && warnings.length > 0;
        const warningTitle = hasWarnings ? warnings!.join('\n') : '';
        const linkHref = safeGithubUrl(comment.htmlUrl);
        const linkHtml = linkHref
          ? `<a class="comment-link" href="${linkHref}" target="_blank">View on GitHub ↗</a>`
          : '';
        const complexityLevel = complexity ?? 'low';
        const complexityLabel = complexityLevel === 'low' ? 'LOW' : complexityLevel === 'medium' ? 'MED' : 'HIGH';
        const number = index + 1;
        return `
        <div class="card" data-id="${comment.id}" data-file="${escapeHtml(comment.path)}" data-complexity="${complexityLevel}" data-number="${number}">
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
              ${fileNotFound ? '<span class="badge badge-warning" title="This file does not exist in the current workspace. The fix cannot be applied automatically.">File not found locally</span>' : ''}
              ${hasWarnings ? `<span class="badge badge-warning" title="${escapeHtml(warningTitle)}">⚠ Scope check</span>` : ''}
              ${linkHtml}
            </div>
            <details open>
              <summary>Reviewer comment</summary>
              <div class="details-body discuss-comment" title="Click to discuss this comment in Copilot Chat">
                <button class="copy-btn" data-copy-type="comment" title="Copy comment text" aria-label="Copy comment text">&#128203;</button>
                <div class="comment-body">${escapeHtml(comment.body)}</div>
              </div>
            </details>
            <div class="discuss-workplan work-plan-section" data-raw-workplan="${escapeHtml(workPlan)}" title="Click to discuss this work plan in Copilot Chat">
              <div class="work-plan-label">Work plan <button class="copy-btn" data-copy-type="workplan" title="Copy work plan text" aria-label="Copy work plan text">&#128203;</button><button class="regen-btn" data-id="${comment.id}" title="Regenerate work plan from scratch" aria-label="Regenerate work plan">&#8635;</button></div>
              <div class="work-plan">${workPlanToHtml(workPlan)}</div>
            </div>
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
  <div class="sticky-top">
    <div class="pr-header">
      <h1>Copilot Reviewer Assistant</h1>
      ${prMeta.title ? `<div class="pr-header-title"><span class="pr-meta-key">PR Title:</span> ${escapeHtml(prMeta.title)}</div>` : ''}
      <div class="pr-header-meta">
        <span class="pr-meta-item"><span class="pr-meta-key">Repo:</span> ${escapeHtml(repoLabel)} ${escapeHtml(prNumber)}</span>
        ${prMeta.assignee ? `<span class="pr-meta-item"><span class="pr-meta-key">Assignee:</span> ${escapeHtml(prMeta.assignee)}</span>` : ''}
        ${prMeta.filesChangedCount > 0 ? `<span class="pr-meta-item"><span class="pr-meta-key">Files changed:</span> ${prMeta.filesChangedCount}</span>` : ''}
        ${modelName ? `<span class="pr-meta-item"><span class="pr-meta-key">Model:</span> ${escapeHtml(modelName)}</span>` : ''}
        <span class="pr-meta-item"><span class="pr-meta-key">URL:</span> <a class="pr-url-link" href="${safeGithubUrl(prUrl)}" target="_blank">${escapeHtml(prUrl)}</a></span>
      </div>
      <div class="pr-header-pills">
        <span class="pill pill-total">${comments.length} total</span>
      </div>
    </div>
    <div class="toolbar${comments.length === 0 ? ' hidden' : ''}">
      <label class="select-all-label">
        <input type="checkbox" id="select-all-cb" />
        <span id="select-all-text">Select all</span>
      </label>
      <button id="apply-btn" disabled>Apply Selected Fixes</button>
      <button id="export-btn" class="secondary">Export</button>
      <button id="import-btn" class="secondary">Import</button>
      <button id="compare-btn" class="secondary">Optimize Plans</button>
      <button id="stage-commit-push-btn" class="hidden">Stage, Commit &amp; Push</button>
      <div class="group-sort-row">
        <span class="controls-label">Group by:</span>
        <div class="btn-group">
          <button class="group-btn secondary active" data-group="none">None</button>
          <button class="group-btn secondary" data-group="file">File</button>
          <button class="group-btn secondary" data-group="complexity">Complexity</button>
        </div>
        <button id="expand-collapse-btn" class="secondary hidden">Collapse All</button>
      </div>
    </div>
    <div id="apply-progress" class="apply-progress hidden" role="status" aria-live="polite">
      <div class="apply-progress-text" id="apply-progress-text">
        <span class="apply-progress-spinner" id="apply-progress-spinner" aria-hidden="true"></span>
      </div>
      <div class="apply-progress-bar-track">
        <div class="apply-progress-bar-fill" id="apply-progress-fill"></div>
      </div>
    </div>
    <div id="optimize-progress" class="apply-progress hidden" role="status" aria-live="polite">
      <div class="apply-progress-text" id="optimize-progress-text">
        <span class="apply-progress-spinner" id="optimize-progress-spinner" aria-hidden="true"></span>
      </div>
      <div class="apply-progress-bar-track">
        <div class="apply-progress-bar-fill" id="optimize-progress-fill"></div>
      </div>
    </div>
  </div>
  <div id="banner-area"></div>
  <div id="git-notice" class="git-notice hidden"></div>
  <div class="comment-list" id="comment-list">
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

  public postApplyProgress(current: number, total: number): void {
    void this._panel.webview.postMessage({ command: 'applyProgress', current, total });
  }

  public postBanner(message: string, type: 'info' | 'warning' = 'info'): void {
    void this._panel.webview.postMessage({ command: 'banner', message, type });
  }

  public postGitStatus(status: GitStatus): void {
    void this._panel.webview.postMessage({ command: 'gitStatus', status });
  }

  public postWorkPlanUpdated(id: number, workPlan: string, complexity: string): void {
    void this._panel.webview.postMessage({
      command: 'workPlanUpdated',
      id,
      workPlan,
      workPlanHtml: workPlanToHtml(workPlan),
      complexity,
    });
  }

  public postComparisonResult(id: number, result: ComparisonResult): void {
    void this._panel.webview.postMessage({
      command: 'comparisonResult',
      id,
      modelPlanHtml: workPlanToHtml(result.modelPlan),
      rationale: result.rationale,
      winner: result.winner,
      finalPlanHtml: workPlanToHtml(result.finalPlan),
      finalPlan: result.finalPlan,
      complexity: result.complexity,
    });
  }

  public postOptimizeProgress(current: number, total: number): void {
    void this._panel.webview.postMessage({ command: 'optimizeProgress', current, total });
  }

  public postOptimizeCardStatus(id: number, state: 'optimizing' | 'done' | 'failed'): void {
    void this._panel.webview.postMessage({ command: 'optimizeCardStatus', id, state });
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

/** Converts a string[] of work plan steps into an <ol>. Falls back to <p>. */
export function workPlanArrayToHtml(steps: string[]): string {
  if (steps.length === 0) { return '<p></p>'; }
  if (steps.length === 1 && !/^\d+\./.test(steps[0])) {
    return `<p>${escapeHtml(steps[0])}</p>`;
  }
  const listItems = steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('');
  return `<ol>${listItems}</ol>`;
}
