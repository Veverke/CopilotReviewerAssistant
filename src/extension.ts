// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { getGitHubToken } from './auth';
import { pickFromOpenPrs } from './prInput';
import { fetchCopilotComments, fetchOpenPullRequests, fetchPrDetails, postReplyComment, resolveReviewThread } from './githubApi';
import type { PrDetails } from './githubApi';
import { generateAllWorkPlans } from './workPlanGenerator';
import { ReviewPanel } from './reviewPanel';
import { applyFix, resolveWorkspaceFile, DoneFixResult } from './fixApplier';
import { stageFiles, commitChanges, pushChanges, getRemoteOwnerRepo, buildProject, detectBuildCommand } from './gitHelper';

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

		const repoCoords = await getRemoteOwnerRepo();
		if (!repoCoords) {
			vscode.window.showErrorMessage(
				'Could not detect a GitHub repository from this workspace. ' +
				'Ensure the folder is a git repository with a GitHub remote named "origin".',
			);
			return;
		}

		let openPrs: import('./githubApi').OpenPr[] = [];
		try {
			openPrs = await fetchOpenPullRequests(token, repoCoords.owner, repoCoords.repo);
		} catch {
			openPrs = [];
		}

		const prCoordinates = await pickFromOpenPrs(openPrs, repoCoords.owner, repoCoords.repo);
		if (!prCoordinates) {
			return;
		}

		const rawUrl = `https://github.com/${prCoordinates.owner}/${prCoordinates.repo}/pull/${prCoordinates.pullNumber}`;

		// Open the panel immediately with a loading skeleton
		const panel = ReviewPanel.showLoading(context, rawUrl);

		let fetchResult: { comments: import('./githubApi').ReviewComment[]; outdatedCount: number } | undefined;
		let annotated: import('./workPlanGenerator').AnnotatedComment[] | undefined;
		let prDetails: PrDetails | undefined;

		try {
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Window, title: 'Fetching PR data…', cancellable: false },
				async () => {
					const additionalBotLogins: readonly string[] = vscode.workspace
						.getConfiguration('copilotReviewer')
						.get<string[]>('additionalBotLogins') ?? [];
					try {
						outputChannel.show(true);
						fetchResult = await fetchCopilotComments(token, prCoordinates.owner, prCoordinates.repo, prCoordinates.pullNumber, outputChannel, additionalBotLogins);
					} catch (err: unknown) {
						const errMsg = err instanceof Error ? err.message : '';
						if (errMsg.includes('authentication failed')) {
							try {
								token = await getGitHubToken();
							} catch {
								throw err;
							}
							fetchResult = await fetchCopilotComments(token, prCoordinates.owner, prCoordinates.repo, prCoordinates.pullNumber, outputChannel, additionalBotLogins);
						} else {
							throw err;
						}
					}

					const { comments } = fetchResult!;

					[annotated, prDetails] = await Promise.all([
						generateAllWorkPlans(comments),
						fetchPrDetails(token, prCoordinates.owner, prCoordinates.repo, prCoordinates.pullNumber),
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

		// Stores doneResults so the retry-build callback can re-use them
		let pendingDoneResults: DoneFixResult[] | undefined;

		// Stage + commit + push (called after a successful build)
		async function commitAndPush(doneResults: DoneFixResult[]): Promise<void> {
			const { owner, repo, pullNumber } = prCoordinates!;
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
		}

		// Build then commit: run build first; on failure expose retry button; on success commit
		async function buildThenCommit(doneResults: DoneFixResult[]): Promise<void> {
			pendingDoneResults = doneResults;
			const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			const detectedCmd = rootPath ? detectBuildCommand(rootPath) : undefined;
			panel.postGitStatus({ state: 'building', command: detectedCmd ?? undefined });
			const buildResult = await buildProject();
			if (!buildResult.ok) {
				outputChannel.appendLine(`[build] ${buildResult.details}`);
				panel.postGitStatus({ state: 'build-failed', reason: buildResult.reason, details: buildResult.details });
				return;
			}
			if (buildResult.skipped && buildResult.reason) {
				panel.postBanner(`Build check skipped: ${buildResult.reason}`, 'warning');
			}
			panel.postGitStatus({ state: 'build-succeeded' });
			await commitAndPush(doneResults);
		}

		panel.setContent(rawUrl, annotated!, prDetails!, (selectedIds) => {
			const selected = annotated!.filter((a) => selectedIds.includes(a.comment.id));
			void (async () => {
				const total = selected.length;
				let settled = 0;
				panel.postApplyProgress(settled, total);

				// Apply fixes sequentially — the VS Code LM API processes one request
				// at a time; parallel calls cause all-but-one to hit the timeout.
				// A short settling delay between requests lets the LM API fully
				// close the previous stream before the next one begins.
				for (let i = 0; i < selected.length; i++) {
					if (i > 0) {
						await new Promise<void>((resolve) => setTimeout(resolve, 5000));
					}
					await applyFix(selected[i], (status) => {
						panel.postFixStatus(status);
						if (status.state === 'done' || status.state === 'failed') {
							settled++;
							panel.postApplyProgress(settled, total);
						}
					});
				}
			})();
		}, (doneResults) => {
			void buildThenCommit(doneResults);
		}, (id) => {
			const item = annotated!.find((a) => a.comment.id === id);
			if (item) {
				panel.postApplyProgress(0, 1);
				void applyFix(item, (status) => {
					panel.postFixStatus(status);
					if (status.state === 'done' || status.state === 'failed') {
						panel.postApplyProgress(1, 1);
					}
				});
			}
		}, () => {
			// onRetryBuild — re-run build, then proceed if it passes
			void (async () => {
				const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
				const detectedCmd = rootPath ? detectBuildCommand(rootPath) : undefined;
				panel.postGitStatus({ state: 'building', command: detectedCmd ?? undefined });
				const buildResult = await buildProject();
				if (!buildResult.ok) {
					outputChannel.appendLine(`[build] ${buildResult.details}`);
					panel.postGitStatus({ state: 'build-failed', reason: buildResult.reason, details: buildResult.details });
					return;
				}
				panel.postGitStatus({ state: 'build-succeeded' });
				await commitAndPush(pendingDoneResults!);
			})();
		});

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

export function buildReplyBody(commentPath: string, startLine: number, endLine: number): string {
	return [
		'Fixed by [Copilot Reviewer Assistant VS Code Extension](https://marketplace.visualstudio.com/items?itemName=Veverke.CopilotReviewerAssistant).',
		'Files changed:',
		`  - File: ${commentPath} Lines: [${startLine}-${endLine}]`,
	].join('\n');
}
