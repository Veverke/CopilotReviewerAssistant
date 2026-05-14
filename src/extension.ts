// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { getGitHubToken, storePat, clearPat, signInWithBrowser, refreshSession, hasPat, setAuthOutputChannel } from './auth';
import { pickFromOpenPrs } from './prInput';
import { fetchCopilotComments, fetchCurrentUser, fetchHasCopilotReview, fetchOpenPullRequests, fetchPrDetails, postReplyComment, resolveReviewThread } from './githubApi';
import type { PrDetails, PrFilterMode } from './githubApi';
import { ReviewPanel } from './reviewPanel';
import { DoneFixResult } from './fixApplier';
import { stageFiles, commitChanges, pushChanges, getAllRemoteOwnerRepos } from './gitHelper';
import { warnIfBranchMismatch } from './workspaceValidator';
import type { AnnotatedComment, ComplexityScore } from './workPlanGenerator';

function isAccessError(message: string): boolean {
	return /repository not found|access denied|authentication failed/i.test(message);
}

async function promptForAlternateAuth(secrets: vscode.SecretStorage, errorMessage: string): Promise<string | undefined> {
	const action = await vscode.window.showErrorMessage(
		`${errorMessage}\n\nThis repository may belong to a different GitHub account. Sign in with that account to continue.`,
		'Sign in with Browser',
		'Enter PAT',
	);

	if (action === 'Sign in with Browser') {
		try {
			return await signInWithBrowser(secrets);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			// Silently ignore explicit cancellations (user dismissed the picker or the VS Code consent dialog)
			if (!msg.toLowerCase().includes('cancelled')) {
				vscode.window.showErrorMessage(`GitHub browser sign-in failed: ${msg}`);
			}
			return undefined;
		}
	}

	if (action === 'Enter PAT') {
		const pat = await vscode.window.showInputBox({
			title: 'GitHub Personal Access Token',
			prompt: 'Paste your GitHub PAT (requires repo scope for private repos). It will be stored securely.',
			password: true,
			ignorefocusOut: true,
		} as vscode.InputBoxOptions);
		if (!pat?.trim()) {
			return undefined;
		}
		await storePat(secrets, pat.trim());
		return pat.trim();
	}

	return undefined;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	const outputChannel = vscode.window.createOutputChannel('Copilot Reviewer Assistant');
	context.subscriptions.push(outputChannel);
	setAuthOutputChannel(outputChannel);

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const clearPatCommand = vscode.commands.registerCommand('copilotReviewer.clearPat', async () => {
		await clearPat(context.secrets);
		vscode.window.showInformationMessage('Stored GitHub authentication credentials have been cleared. The default VS Code account will be used on the next run.');
	});
	context.subscriptions.push(clearPatCommand);

	const disposable = vscode.commands.registerCommand('copilotReviewer.openPanel', async () => {
		outputChannel.appendLine('[auth] Command invoked — calling getGitHubToken');
		let token: string;
		try {
			token = await getGitHubToken(context.secrets);
			outputChannel.appendLine('[auth] getGitHubToken succeeded');
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'An unknown error occurred during authentication.';
			outputChannel.appendLine(`[auth] getGitHubToken threw: ${message}`);
			vscode.window.showErrorMessage(message);
			return;
		}

		const allRepos = await getAllRemoteOwnerRepos();
		if (allRepos.length === 0) {
			vscode.window.showErrorMessage(
				'Could not detect a GitHub repository from this workspace. ' +
				'Ensure the folder is a git repository with a GitHub remote named "origin".',
			);
			return;
		}

		// All PR fetching happens inside a progress notification so the user sees activity.
		let openPrs: import('./githubApi').OpenPr[] = [];
		let currentUser: string | null = null;
		const additionalBotLogins: readonly string[] = vscode.workspace
			.getConfiguration('copilotReviewer')
			.get<string[]>('additionalBotLogins') ?? [];
		const prFilterMode: PrFilterMode = vscode.workspace
			.getConfiguration('copilotReviewer')
			.get<PrFilterMode>('prFilter') ?? 'assigned';

		async function fetchPrsForAllRepos(tok: string, user: string | undefined): Promise<import('./githubApi').OpenPr[]> {
			const settled = await Promise.allSettled(
				allRepos.map(({ owner, repo }) => fetchOpenPullRequests(tok, owner, repo, user, prFilterMode))
			);
			const prs: import('./githubApi').OpenPr[] = [];
			let firstAccessError: string | undefined;
			for (const r of settled) {
				if (r.status === 'fulfilled') {
					prs.push(...r.value);
				} else {
					const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
					if (isAccessError(msg) && !firstAccessError) { firstAccessError = msg; }
				}
			}
			if (firstAccessError && prs.length === 0) { throw new Error(firstAccessError); }
			return prs;
		}

		async function filterByOpenReviews(tok: string, prs: import('./githubApi').OpenPr[]): Promise<import('./githubApi').OpenPr[]> {
			const checks = await Promise.allSettled(
				prs.map((pr) => fetchHasCopilotReview(tok, pr.owner, pr.repo, pr.pullNumber, additionalBotLogins))
			);
			return prs.filter((_, i) => checks[i].status === 'fulfilled' && (checks[i] as PromiseFulfilledResult<boolean>).value);
		}

		try {
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Copilot Reviewer', cancellable: false },
				async (progress) => {
					progress.report({ message: 'Authenticating…' });
					currentUser = await fetchCurrentUser(token);
					outputChannel.appendLine(`[auth] fetchCurrentUser => ${currentUser ?? '(null)'}`);

					const MAX_ATTEMPTS = 3;
					for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
						progress.report({ message: attempt === 1 ? 'Fetching open PRs…' : `Fetching open PRs… (attempt ${attempt}/${MAX_ATTEMPTS})` });
						outputChannel.appendLine(`[auth] Fetching PRs with initial token (attempt ${attempt}/${MAX_ATTEMPTS})`);
						openPrs = await fetchPrsForAllRepos(token, currentUser ?? undefined);
						if (openPrs.length > 0) { break; }
						if (attempt < MAX_ATTEMPTS) {
							outputChannel.appendLine(`[auth] PR fetch returned 0 — waiting 2s before retry`);
							await new Promise<void>((resolve) => setTimeout(resolve, 2000));
						}
					}

					progress.report({ message: 'Checking for open reviews…' });
					openPrs = await filterByOpenReviews(token, openPrs);
					outputChannel.appendLine(`[auth] PR fetch succeeded — ${openPrs.length} PR(s) with open reviews`);
				}
			);
		} catch (err: unknown) {
			const errMsg = err instanceof Error ? err.message : '';
			outputChannel.appendLine(`[auth] PR fetch threw: ${errMsg}`);
			if (isAccessError(errMsg)) {
				// Only try refreshSession for OAuth sessions — a stored PAT won't
				// gain new scopes from forcing a fresh session (different account or
				// insufficient PAT). forceNewSession always shows a VS Code notification
				// so skip it when we know a PAT is in play.
				const usingPat = await hasPat(context.secrets);
				outputChannel.appendLine(`[auth] isAccessError=true, usingPat=${usingPat}`);
				let refreshed: string | undefined;
				if (!usingPat) {
					// OAuth session may lack repo scope — silently force a fresh one.
					outputChannel.appendLine('[auth] Calling refreshSession (forceNewSession)');
					refreshed = await refreshSession(context.secrets);
					outputChannel.appendLine(`[auth] refreshSession => ${refreshed ? 'token obtained' : 'dismissed/null'}`);
				}
				if (refreshed) {
					token = refreshed;
					const newUser = await fetchCurrentUser(token);
					outputChannel.appendLine(`[auth] Post-refresh user => ${newUser ?? '(null)'}`);
					try {
						openPrs = await fetchPrsForAllRepos(token, newUser ?? undefined);
						openPrs = await filterByOpenReviews(token, openPrs);
						outputChannel.appendLine(`[auth] Post-refresh PR fetch => ${openPrs.length} PR(s)`);
					} catch (retryErr: unknown) {
						outputChannel.appendLine(`[auth] Post-refresh PR fetch threw: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`);
						openPrs = [];
					}
				} else {
					// PAT-based auth, or refresh dismissed — escalate to the full alternate-auth dialog.
					outputChannel.appendLine('[auth] Escalating to promptForAlternateAuth');
					const newPat = await promptForAlternateAuth(context.secrets, errMsg);
					if (newPat) {
						outputChannel.appendLine('[auth] promptForAlternateAuth returned a token — retrying PR fetch');
						token = newPat;
						const newUser = await fetchCurrentUser(token);
						try {
							openPrs = await fetchPrsForAllRepos(token, newUser ?? undefined);
							openPrs = await filterByOpenReviews(token, openPrs);
							outputChannel.appendLine(`[auth] Post-alternate PR fetch => ${openPrs.length} PR(s)`);
						} catch (retryErr: unknown) {
							outputChannel.appendLine(`[auth] Post-alternate PR fetch threw: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`);
							openPrs = [];
						}
					} else {
						outputChannel.appendLine('[auth] promptForAlternateAuth dismissed — falling through to manual URL entry');
					}
					// whether PAT was entered or not, fall through to manual URL entry
				}
			} else {
				outputChannel.appendLine('[auth] Non-access error — falling through silently');
			}
			// non-access errors also fall through silently
		}

		const prCoordinates = await pickFromOpenPrs(openPrs);
		if (!prCoordinates) {
			return;
		}

		const rawUrl = `https://github.com/${prCoordinates.owner}/${prCoordinates.repo}/pull/${prCoordinates.pullNumber}`;

		// Open the panel immediately with a loading skeleton
		const panel = ReviewPanel.showLoading(context, rawUrl);

		let fetchResult: { comments: import('./githubApi').ReviewComment[]; outdatedCount: number } | undefined;
		let prDetails: PrDetails | undefined;

		async function loadPrData(tok: string, coords: import('./prInput').PrCoordinates): Promise<void> {
			// ── Phase 1: network only — spinner ends as soon as data arrives ──
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Window, title: 'Fetching PR data…', cancellable: false },
				async () => {
					panel.postLoadingProgress(1, 10, 'Fetching PR metadata…');

					// Start PR metadata fetch immediately — independent of comments
					const prDetailsPromise = fetchPrDetails(tok, coords.owner, coords.repo, coords.pullNumber)
						.then((details) => {
							// Fire branch-mismatch warning as soon as details arrive — non-blocking
							warnIfBranchMismatch(details.headBranch, coords.repo).catch(() => {});
							return details;
						});

					panel.postLoadingProgress(2, 10, 'Fetching review comments…');
					try {
						outputChannel.show(true);
						fetchResult = await fetchCopilotComments(tok, coords.owner, coords.repo, coords.pullNumber, outputChannel, additionalBotLogins);
					} catch (err: unknown) {
						const errMsg = err instanceof Error ? err.message : '';
						if (errMsg.includes('authentication failed')) {
							try {
								tok = await getGitHubToken(context.secrets);
							} catch {
								throw err;
							}
							fetchResult = await fetchCopilotComments(tok, coords.owner, coords.repo, coords.pullNumber, outputChannel, additionalBotLogins);
						} else {
							throw err;
						}
					}

					panel.postLoadingProgress(8, 10, 'Loading PR details…');
					prDetails = await prDetailsPromise;
					panel.postLoadingProgress(10, 10, 'Rendering…');
				}
			);

		}

		try {
			await loadPrData(token, prCoordinates);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'An unknown error occurred while loading PR data.';
			if (isAccessError(message)) {
				const newPat = await promptForAlternateAuth(context.secrets, message);
				if (!newPat) {
					panel.showError(message);
					return;
				}
				try {
					token = newPat;
					await loadPrData(token, prCoordinates);
				} catch (retryErr: unknown) {
					const retryMsg = retryErr instanceof Error ? retryErr.message : 'An unknown error occurred while loading PR data.';
					panel.showError(retryMsg);
					vscode.window.showErrorMessage(retryMsg);
					return;
				}
			} else {
				panel.showError(message);
				vscode.window.showErrorMessage(message);
				return;
			}
		}

		// Stage + commit + push
		async function commitAndPush(doneResults: DoneFixResult[]): Promise<void> {
			const { owner, repo, pullNumber } = prCoordinates!;
			const uniquePaths = [...new Set(doneResults.map((r) => r.commentPath))];

			// Prompt for optional commit message prefix (e.g. [XLR-1234]) before doing any git work.
			const commitPrefix = await vscode.window.showInputBox({
				title: 'Commit message prefix (optional)',
				prompt: 'Enter text to prepend to the commit message if your repo enforces a policy (e.g. [XLR-1234]). Leave empty to skip.',
				placeHolder: '[XLR-1234]',
				ignoreFocusOut: true,
			});
			// undefined means the user pressed Escape — cancel the push.
			if (commitPrefix === undefined) {
				outputChannel.appendLine('[push] Commit prefix prompt cancelled — aborting.');
				return;
			}

			outputChannel.show(true);
			outputChannel.appendLine(`[push] commitAndPush called — ${doneResults.length} result(s), ${uniquePaths.length} unique path(s)`);
			outputChannel.appendLine(`[push] paths: ${uniquePaths.join(', ')}`);
			if (commitPrefix) { outputChannel.appendLine(`[push] commit prefix: ${commitPrefix}`); }

			panel.postGitStatus({ state: 'pushing' });
			panel.postPushProgress('Staging files…', 10);

			try {
				const issues = doneResults.map((r) => {
					const comment = rawComments.find((c) => c.id === r.commentId);
					const snippet = comment ? comment.body.split('\n')[0].trim() : '';
					return `[${r.commentPath}:${r.startLine}] ${snippet}`;
				});
				outputChannel.appendLine('[push] Calling stageFiles…');
				await stageFiles(uniquePaths, owner, repo, outputChannel);
				outputChannel.appendLine('[push] stageFiles succeeded. Calling commitChanges…');
				panel.postPushProgress('Committing…', 30);
				await commitChanges(uniquePaths, doneResults.length, owner, repo, issues, commitPrefix.trim());
				outputChannel.appendLine('[push] commitChanges succeeded.');
			} catch (err: unknown) {
				const reason = err instanceof Error ? err.message : String(err);
				outputChannel.appendLine(`[push] Stage/commit failed: ${reason}`);
				if (reason === 'Git repository not found') {
					panel.postGitStatus({ state: 'no-repo' });
				} else {
					panel.postGitStatus({ state: 'push-failed', reason });
				}
				return;
			}

			let pushSucceeded = true;
			try {
				outputChannel.appendLine('[push] Calling pushChanges…');
				panel.postPushProgress('Pushing to remote…', 55);
				await pushChanges(owner, repo);
				outputChannel.appendLine('[push] pushChanges succeeded.');
			} catch (err: unknown) {
				pushSucceeded = false;
				const reason = err instanceof Error ? err.message : String(err);
				outputChannel.appendLine(`[push] pushChanges failed: ${reason}`);
				panel.postGitStatus({
					state: 'push-failed',
					reason: `Commit created locally but push failed: ${reason}. Please push manually.`,
				});
			}

			const resolveTotal = doneResults.length;
			for (let resolveIdx = 0; resolveIdx < doneResults.length; resolveIdx++) {
				const result = doneResults[resolveIdx];
				panel.postPushProgress(
					`Resolving review thread ${resolveIdx + 1} / ${resolveTotal}…`,
					60 + Math.round(((resolveIdx + 1) / resolveTotal) * 35)
				);
				const body = buildReplyBody(result.commentPath, result.startLine, result.endLine);
				try {
					await postReplyComment(token, owner, repo, pullNumber, result.commentId, body);
				} catch (err: unknown) {
					outputChannel.appendLine(`[push] Failed to post reply for comment ${result.commentId}: ${err instanceof Error ? err.message : String(err)}`);
				}
				try {
					await resolveReviewThread(token, owner, repo, pullNumber, result.commentId);
				} catch (err: unknown) {
					outputChannel.appendLine(`[push] Failed to resolve thread for comment ${result.commentId}: ${err instanceof Error ? err.message : String(err)}`);
				}
			}

			if (pushSucceeded) {
				outputChannel.appendLine('[push] All done — notifying UI.');
				panel.postGitStatus({ state: 'pushed' });
				vscode.window.showInformationMessage('Changes committed and pushed successfully.');
			}
		}

		const rawComments = fetchResult!.comments;
		const annotatedComments: AnnotatedComment[] = rawComments.map((c) => ({
			comment: c,
			workPlan: '',
			complexity: classifyComplexity(c),
			severity: c.severity,
		}));
		const allDoneResults: DoneFixResult[] = rawComments.map((c) => ({
			commentId: c.id,
			commentPath: c.path,
			startLine: c.line,
			endLine: c.line,
		}));

		panel.setContent(rawUrl, annotatedComments, prDetails!, (selectedIds: number[]) => {
			// onFixWithCopilotChat — build prompt for selected comments only
			const selectedComments = selectedIds.length > 0
				? rawComments.filter((c) => selectedIds.includes(c.id))
				: rawComments;
			const prompt = buildCopilotChatPrompt(selectedComments);
			void vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt });
		}, (selectedIds: number[]) => {
			// onStageCommitAndPush — confirm then commit + push selected results
			void (async () => {
				const selectedResults = selectedIds.length > 0
					? allDoneResults.filter((r) => selectedIds.includes(r.commentId))
					: allDoneResults;
				outputChannel.appendLine(`[push] Confirmation dialog shown for ${selectedResults.length} result(s)`);
				const answer = await vscode.window.showWarningMessage(
					'Have you built the project and run the unit tests?',
					{ modal: true },
					'Yes, push now',
				);
				if (answer !== 'Yes, push now') {
					outputChannel.appendLine('[push] User cancelled confirmation — resetting button');
					panel.postGitStatus({ state: 'ready' });
					return;
				}
				outputChannel.appendLine('[push] User confirmed — calling commitAndPush');
				await commitAndPush(selectedResults);
			})();
		}, outputChannel);

		const { outdatedCount } = fetchResult!;
		if (outdatedCount > 0) {
			panel.postBanner(`${outdatedCount} outdated comment(s) were excluded.`, 'warning');
		}
		if (prDetails!.state !== 'unknown' && prDetails!.state !== 'open') {
			const label = prDetails!.merged ? 'merged' : prDetails!.state;
			panel.postBanner(`Note: this PR is ${label}. Fixes will still be applied locally.`, 'info');
		}
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}

// Complexity classifier using the same regex patterns as classifyIssue() in workPlanGenerator.ts.
// ABSTRACTION issues require multi-layer changes → high.
// REGISTRATION issues touch multiple files → medium.
// ASYNC/IO issues are typically localised → medium.
// UNUSED SYMBOL issues are single-symbol renames/deletions → low.
// Default → low.
export function classifyComplexity(comment: import('./githubApi').ReviewComment): ComplexityScore {
	const text = `${comment.body}\n${comment.diffHunk}`.toLowerCase();
	if (/\blayer\b|\babstraction\b|\bcallback\b|\bsignature\b|\bcoupl/.test(text)) {
		return 'high';
	}
	if (/\bregister\b|\bactivationevents?\b|\bcommand\b|\bdispatch\b|\bhandler\b|\bcontributes\b/.test(text)
		|| /\bawait\b|\basync\b|promise\.all|readfilesync|fs\..*sync\b/.test(text)) {
		return 'medium';
	}
	return 'low';
}

export function buildCopilotChatPrompt(comments: import('./githubApi').ReviewComment[]): string {
	const lines: string[] = [
		'Read the following code review issues raised by a reviewer. Find the optimal solution for each, and implement them all in the workspace.',
		'',
	];
	for (let i = 0; i < comments.length; i++) {
		const c = comments[i];
		lines.push(`## Issue ${i + 1}: ${c.path} (line ${c.line})`);
		lines.push('');
		lines.push('**Reviewer comment:**');
		lines.push(c.body);
		lines.push('');
	}
	return lines.join('\n');
}

export function buildReplyBody(commentPath: string, startLine: number, endLine: number): string {
	return [
		'Fixed by [Copilot Reviewer Assistant VS Code Extension](https://marketplace.visualstudio.com/items?itemName=Veverke.CopilotReviewerAssistant).',
		'Files changed:',
		`  - File: ${commentPath} Lines: [${startLine}-${endLine}]`,
	].join('\n');
}
