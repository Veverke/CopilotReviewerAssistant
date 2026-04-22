// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { getGitHubToken } from './auth';
import { promptForPrUrl, parsePrUrl } from './prInput';
import { fetchCopilotComments, fetchPrState, fetchPrMetadata, postReplyComment, resolveReviewThread } from './githubApi';
import type { PrMetadata } from './githubApi';
import { generateAllWorkPlans } from './workPlanGenerator';
import { ReviewPanel } from './reviewPanel';
import { applyFix, resolveWorkspaceFile } from './fixApplier';
import { stageFiles, commitChanges, pushChanges } from './gitHelper';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	const outputChannel = vscode.window.createOutputChannel('Copilot Reviewer Assistant');
	context.subscriptions.push(outputChannel);

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('copilotReviewer.openPanel', async () => {
		let token: string;
		try {
			token = await getGitHubToken();
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'An unknown error occurred during authentication.';
			vscode.window.showErrorMessage(message);
			return;
		}

		const rawUrl = await promptForPrUrl();
		if (rawUrl === undefined) {
			return;
		}

		let prCoordinates;
		try {
			prCoordinates = parsePrUrl(rawUrl);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'An unknown error occurred while parsing the PR URL.';
			vscode.window.showErrorMessage(message);
			return;
		}

		// Open the panel immediately with a loading skeleton
		const panel = ReviewPanel.showLoading(context, rawUrl);

		let fetchResult: { comments: import('./githubApi').ReviewComment[]; outdatedCount: number } | undefined;
		let annotated: import('./workPlanGenerator').AnnotatedComment[] | undefined;
		let prStateResult: { state: string; merged: boolean } | undefined;
		let prMeta: PrMetadata | undefined;

		try {
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Window, title: 'Fetching PR data…', cancellable: false },
				async () => {
					try {
						outputChannel.show(true);
						fetchResult = await fetchCopilotComments(token, prCoordinates.owner, prCoordinates.repo, prCoordinates.pullNumber, outputChannel);
					} catch (err: unknown) {
						const errMsg = err instanceof Error ? err.message : '';
						if (errMsg.includes('authentication failed')) {
							try {
								token = await getGitHubToken();
							} catch {
								throw err;
							}
							fetchResult = await fetchCopilotComments(token, prCoordinates.owner, prCoordinates.repo, prCoordinates.pullNumber, outputChannel);
						} else {
							throw err;
						}
					}

					const { comments } = fetchResult!;

					[annotated, prStateResult, prMeta] = await Promise.all([
						generateAllWorkPlans(comments),
						fetchPrState(token, prCoordinates.owner, prCoordinates.repo, prCoordinates.pullNumber),
						fetchPrMetadata(token, prCoordinates.owner, prCoordinates.repo, prCoordinates.pullNumber),
					]);

					// Pre-flight: check which files are present in the workspace
					for (const item of annotated) {
						const uri = await resolveWorkspaceFile(item.comment.path);
						item.fileFound = uri !== undefined;
					}
				}
			);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'An unknown error occurred while loading PR data.';
			panel.showError(message);
			vscode.window.showErrorMessage(message);
			return;
		}

		panel.setContent(rawUrl, annotated!, prMeta!, (selectedIds) => {
			const selected = annotated!.filter((a) => selectedIds.includes(a.comment.id));
			void (async () => {
				for (const item of selected) {
					await applyFix(item, (status) => {
						panel.postFixStatus(status);
					});
				}
			})();
		}, (doneResults) => {
			void (async () => {
				const { owner, repo, pullNumber } = prCoordinates;
				const uniquePaths = [...new Set(doneResults.map((r) => r.commentPath))];

				panel.postGitStatus({ state: 'pushing' });

				try {
					await stageFiles(uniquePaths);
					await commitChanges(uniquePaths, doneResults.length);
				} catch (err: unknown) {
					const reason = err instanceof Error ? err.message : String(err);
					if (reason === 'Git repository not found') {
						panel.postGitStatus({ state: 'no-repo' });
					} else {
						panel.postGitStatus({ state: 'push-failed', reason });
					}
					return;
				}

				let pushSucceeded = true;
				try {
					await pushChanges();
				} catch (err: unknown) {
					pushSucceeded = false;
					const reason = err instanceof Error ? err.message : String(err);
					panel.postGitStatus({
						state: 'push-failed',
						reason: `Commit created locally but push failed: ${reason}. Please push manually.`,
					});
				}

				for (const result of doneResults) {
					const body = buildReplyBody(result.commentPath, result.startLine, result.endLine);
					try {
						await postReplyComment(token, owner, repo, pullNumber, result.commentId, body);
					} catch (err: unknown) {
						outputChannel.appendLine(`[gitIntegration] Failed to post reply for comment ${result.commentId}: ${err instanceof Error ? err.message : String(err)}`);
					}
					try {
						await resolveReviewThread(token, owner, repo, pullNumber, result.commentId);
					} catch (err: unknown) {
						outputChannel.appendLine(`[gitIntegration] Failed to resolve thread for comment ${result.commentId}: ${err instanceof Error ? err.message : String(err)}`);
					}
				}

				if (pushSucceeded) {
					panel.postGitStatus({ state: 'pushed' });
					vscode.window.showInformationMessage('Changes committed and pushed successfully.');
				}
			})();
		}, (id) => {
			const item = annotated!.find((a) => a.comment.id === id);
			if (item) {
				void applyFix(item, (status) => {
					panel.postFixStatus(status);
				});
			}
		});

		const { outdatedCount } = fetchResult!;
		if (outdatedCount > 0) {
			panel.postBanner(`${outdatedCount} outdated comment(s) were excluded.`, 'warning');
		}
		if (prStateResult!.state !== 'unknown' && prStateResult!.state !== 'open') {
			const label = prStateResult!.merged ? 'merged' : prStateResult!.state;
			panel.postBanner(`Note: this PR is ${label}. Fixes will still be applied locally.`, 'info');
		}
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}

export function buildReplyBody(commentPath: string, startLine: number, endLine: number): string {
	return [
		'Fixed by [Copilot Reviewer Assistant VS Code Extension](https://marketplace.visualstudio.com/items?itemName=Veverke.CopilotReviewerAssistant).',
		'Files changed:',
		`  - File: ${commentPath} Lines: [${startLine}-${endLine}]`,
	].join('\n');
}
