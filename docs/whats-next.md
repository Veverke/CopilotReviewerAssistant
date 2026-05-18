# Copilot Reviewer Assistant — What's Next

> MVP is published. This document maps the competitive landscape, honestly locates CRA within it, and proposes the highest-value paths forward.

---

## 1. Where CRA Stands Today

CRA occupies a specific, narrow niche that no other published extension fills:

**It is the only VS Code tool that treats GitHub Copilot's bot PR review comments as a first-class work item — fetching them, triaging them with complexity tags, batch-applying fixes via Copilot Chat, and automatically resolving the GitHub threads after a successful push.**

Every other tool reviewed either generates new AI reviews on local diffs (pre-PR), or manages PR metadata without a triage-apply-resolve loop.

---

## 2. Top 10 Competitors (sorted by VS Code Marketplace installs)

| # | Extension | Publisher | Installs | Rating | Primary Scope |
|---|---|---|---|---|---|
| 1 | [GitHub Pull Requests](https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-pull-request-github) | GitHub | 34.5 M | ★4.0 | PR/issue management, inline diff comments for any GitHub PR |
| 2 | [Atlassian: Jira, Rovo Dev, Bitbucket](https://marketplace.visualstudio.com/items?itemName=Atlassian.atlascode) | Atlassian | 3.2 M | ★2.6 | Bitbucket PRs + Jira + Rovo Dev AI agent (Bitbucket repos only) |
| 3 | [Sourcery](https://marketplace.visualstudio.com/items?itemName=sourcery.sourcery) | Sourcery | 1.18 M | ★4.3 | Real-time refactoring suggestions + on-demand reviews + GitHub/GitLab PR reviews |
| 4 | [Bito AI Code Reviews](https://marketplace.visualstudio.com/items?itemName=Bito.Bito) | Bito | 939 K | ★4.2 | Pre-PR, codebase-aware AI review in IDE and in Git CI pipelines |
| 5 | [Qodo: AI Code Review](https://marketplace.visualstudio.com/items?itemName=Codium.codium) | Qodo (ex-Codium) | 869 K | ★4.7 | Local code review + test generation + multi-repo context + custom rules |
| 6 | [WAVE AI Code Review & Analysis](https://marketplace.visualstudio.com/items?itemName=devprod.vulnerability-extension) | Developer Productivity (Microsoft) | 187 K | ★4.0 | ⚠️ **Marked "Internal Use Only"** — requires internal Microsoft auth; not a publicly usable product |
| 7 | [CodeRabbit](https://marketplace.visualstudio.com/items?itemName=CodeRabbit.coderabbit-vscode) | CodeRabbit Inc. | 158 K | ★3.7 | Uncommitted-change review + one-click handoff to AI agents + PR reviews (paid) |
| 8 | [Github Copilot Code Reviewer](https://marketplace.visualstudio.com/items?itemName=JakubKozera.github-copilot-code-reviewer) | Jakub Kozera | 36.2 K | ★5.0 | Copilot Chat slash commands (`/review`, `/branch`, `/commit`) over local git diffs |
| 9 | [CodeScene](https://marketplace.visualstudio.com/items?itemName=CodeScene.codescene-vscode) | CodeScene | 34.7 K | ★5.0 | Code health / hotspot / complexity metrics (not a review-comment tool) |
| 10 | [Codacy](https://marketplace.visualstudio.com/items?itemName=codacy-app.codacy) | Codacy | 27.9 K | ★4.0 | Static analysis + security + code quality gates + CI integration |

> **Note on WAVE**: Its 187 K installs appear to be driven by internal Microsoft employees. It requires internal authentication and is not usable by external developers, so it is excluded from the feature comparison below.

---

## 3. Feature Comparison

The table uses the following key:

- ✅ — Feature is present and publicly documented
- ⚠️ — Partially supported, limited, or requires a paid tier
- ❌ — Feature is absent or not applicable
- ❓ — Not verifiable from public documentation without access to source code or a live account

> **Important caveat**: This table is based on published marketplace descriptions, documentation pages, and changelogs as of May 2026. It has not been verified by installing and running each extension. Where a feature is common (e.g. "free plan available") but details are thin, ❓ is used rather than an assertion.

| Feature | **CRA** | GitHub PR | Atlassian | Sourcery | Bito | Qodo | CodeRabbit | Kozera | CodeScene | Codacy |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Requires GitHub Copilot subscription** | ✅ (required) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (required) | ❌ | ❌ |
| **Fetch & surface existing GitHub PR review comments in VS Code** | ✅ (all reviewers — bot and human) | ✅ (all reviewers, inline diff) | ❌ (Bitbucket only) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Unified card/list view of all pending comments** | ✅ | ❌ (comments scattered in diff) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Complexity tagging per comment (LOW/MED/HIGH)** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Reviewer filter** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Selective per-comment accept/skip before applying** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Batch apply all selected comments to AI agent in one step** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ ("Fix all") | ❌ | ❌ | ❌ |
| **Auto-resolve GitHub review threads after push** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Stage → commit → push in one button** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Commit message prefix input** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Build/test confirmation gate before push** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Pre-commit / local diff review (before PR exists)** | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Real-time inline review as you type** | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Test generation** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Custom review rules / guidelines** | ❌ | ❌ | ❌ | ✅ | ✅ (paid) | ✅ | ✅ | ✅ (custom prompt) | ❌ | ✅ |
| **Security / vulnerability scanning** | ❌ | ❌ | ❌ | ❌ | ⚠️ (basic) | ❌ | ⚠️ (paid) | ❌ | ❌ | ✅ |
| **Code quality / complexity metrics** | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| **GitLab / Bitbucket / Azure DevOps support** | ❌ | ❌ | ✅ (Bitbucket) | ✅ (GitHub/GitLab) | ✅ | ❓ | ✅ (paid) | ❌ | ❓ | ✅ |
| **GitHub Enterprise Server support** | ❓ | ✅ | ❌ | ❓ | ❓ | ❓ | ❓ | ❌ | ❓ | ✅ |
| **Works in Cursor / Windsurf** | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Zero additional account required** | ✅ (reuses VS Code GitHub auth) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Free plan** | ✅ (fully free) | ✅ | ✅ | ⚠️ (OSS only) | ⚠️ (limited) | ✅ | ⚠️ (limited) | ✅ | ⚠️ | ⚠️ |

### What CRA uniquely provides
- The only extension that consumes GitHub PR review comments (from both the Copilot bot and human reviewers) as structured work items — not just shows them, but triages, batch-applies, and resolves them
- All comments are fetched regardless of author; the reviewer-filter dropdown lets you narrow to Copilot, a specific human, or any combination
- Complexity tagging, reviewer filter, per-comment selection, grouped card view
- The full `fetch → select → apply → push → resolve` loop in a single, integrated workflow
- Structured commit message auto-generated from the resolved set: header line + affected files + numbered issue snippets
- Per-thread reply posted on GitHub after push, attributing the fix to CRA
- Zero extra accounts or subscriptions beyond what a Copilot user already has

### What competitors provide that CRA does not
- **Pre-PR / proactive review** — Bito, Qodo, CodeRabbit, Sourcery, Kozera all review local/staged/committed changes before a PR is raised; CRA only activates once Copilot has already reviewed a PR
- **Real-time as-you-type suggestions** — Sourcery, Bito, Qodo embed feedback continuously as code is written
- **Test generation** — Qodo's standout differentiator; CRA applies review fixes but does not yet propose tests (planned — see 4.9)
- **Custom rules enforcement** — Sourcery, Bito, Qodo, CodeRabbit allow teams to embed coding standards into every review; CRA has no concept of org-wide review rules
- **Multi-platform VCS** — Sourcery supports GitHub + GitLab; Bito adds Bitbucket; CodeRabbit adds Azure DevOps; CRA is GitHub-only
- **Security scanning** — Codacy and (to a degree) Bito/CodeRabbit flag vulnerabilities; CRA does no static analysis
- **Works without Copilot** — All competitors except Kozera function without a Copilot subscription

---

## 4. New Feature Paths

These are prioritised from high to low based on user impact vs implementation cost.

---

### 4.1 ~~Surface ALL reviewer comments~~ — Already implemented

`fetchCopilotComments` already fetches **all** PR inline review comments regardless of author (Copilot bot or human). The Copilot-bot filter only gates the PR picker list — a PR must have at least one Copilot review to appear, but once loaded the panel shows every non-reply, non-outdated, non-resolved comment. The reviewer-filter dropdown lets users narrow to a specific reviewer.

**What remains**: The PR picker filter (`fetchHasCopilotReview`) could be made optional — today, a PR that has only human review comments and no Copilot review at all will not appear in the picker. A setting like `copilotReviewer.showPrsWithoutCopilotReview` (default: `false`) would let teams use CRA as a general PR triage tool even when Copilot is not the reviewer.

**Action for the document**: Move this strength to the marketing copy — "Works for Copilot-bot and human reviewer comments alike" — and replace the roadmap item with the picker-filter relaxation above.

---

### 4.2 Status bar badge — open comment count (High impact, Low cost)

**Current gap**: Users have no passive awareness of pending review comments without opening the panel. The panel must be opened manually, which means comments silently accumulate across branches.

**Proposal**: Register a `vscode.StatusBarItem` (alignment: left, priority: 100) on extension activation. The item shows `$(comment-discussion) N review comments` when there are pending comments on the current branch's PR, and is hidden when there are none.

**Refresh triggers** (in order of importance):
1. **Branch change** — listen to the Git extension's `onDidChangeState` event on the active repository.
2. **VS Code window focus** — `vscode.window.onDidChangeWindowState` when `focused` becomes `true`.
3. **After panel closes** — refresh immediately so the badge reflects newly resolved threads.
4. **Periodic background poll** — optional, every 5–10 minutes, throttled to avoid rate-limit pressure.

**Implementation notes**:
- Re-use `getRemoteOwnerRepo` to identify the PR from the current branch, then call the already-existing `fetchCopilotComments` / `fetchHasCopilotReview` chain.
- The badge count should reflect *unresolved* comments only (same filter the panel uses), so it hits zero after a successful Push & Mark Resolved cycle.
- If the branch has no open PR, or if the user is not authenticated yet, hide the item silently — do not show an error badge.
- Clicking the badge should invoke `copilotReviewer.openPanel` directly.
- Total new code: roughly 60–80 lines in `extension.ts` plus one helper. No new API surface needed.

---

### 4.3 Diff preview per comment before applying (High impact, Medium cost)

**Current gap**: CRA sends comments to Copilot Chat without showing the user what change will be made. The user sees the result only after Copilot rewrites the file.

**Proposal**: For comments that include an inline `suggestion` block (GitHub's diff-based suggestion format), render the proposed diff directly on the card. For comments without a suggestion block, this remains a "best-effort" preview that Copilot Chat generates. This reduces surprises and gives users more confidence before clicking Apply.

---

### 4.4 Update the GitHub PR description after push (Medium impact, Low cost)

**What CRA already does**: The commit message is auto-generated with a structured header (`fix: apply N Copilot PR review recommendation(s)`), an affected-files list, and numbered issue snippets taken from the first line of each resolved comment. Each resolved GitHub thread also receives a reply comment from `buildReplyBody` that says "Fixed by Copilot Reviewer Assistant" and cites the file and line range.

**Remaining gap**: The PR *description* on GitHub's PR overview page (the first comment in the PR timeline) is never updated. A reviewer checking the PR summary in the browser sees only the original description and must scroll through resolved threads to understand what was done.

**Proposal**: After a successful push + resolve cycle, offer an optional "Update PR description" step. The extension appends a Markdown section to the PR description — a summary table of resolved threads (comment snippet + file + status). Uses `PATCH /repos/{owner}/{repo}/pulls/{pull_number}` with the existing `body` field appended. The user can preview and edit before confirming.

---

### 4.5 Re-review trigger after push (Medium impact, Low cost)

**Current gap**: After fixes are pushed, the user must manually request a new Copilot review in the GitHub UI.

**Proposal**: After the push + resolve step completes, offer a "Request new Copilot review" button that calls `POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers` with `{ reviewers: ["copilot-pull-request-reviewer[bot]"] }`. This closes the feedback loop without a browser visit.

---

### 4.6 Commit message auto-generation from resolved comments (Medium impact, Low cost)

**Current gap**: The commit message is either empty or a user-typed string. Information about the applied fixes is lost from the git history.

**Proposal**: When the user clicks Push & Mark Resolved, pre-populate the commit message with a concise, AI-generated summary of the selected comments (e.g. "refactor: address Copilot review — null-check in auth middleware, extract constant in payment utils"). The user can edit or replace it before committing.

---

### 4.7 Keyboard navigation in the panel (Medium impact, Low cost)

**Current gap**: The panel is mouse-only. Power users and accessibility-conscious users cannot triage with the keyboard.

**Proposal**: Add keyboard shortcuts within the webview — `↓`/`↑` to move between cards, `Space` to toggle a card's checkbox, `Enter` to open the comment on GitHub, `Ctrl+A`/`Ctrl+Shift+A` to select/deselect all. These can be implemented entirely in `panel.js` with no API surface changes.

---

### 4.8 Per-repo configuration file (Medium impact, Medium cost)

**Current gap**: All settings live in VS Code user settings and apply globally. Teams cannot enforce per-repo defaults (e.g. commit message prefix, which bots to trust).

**Proposal**: Read an optional `.cra.json` from the workspace root. Supported keys mirror the existing VS Code settings (`prFilter`, `additionalBotLogins`, `preFillFromClipboard`). Workspace file values override user settings. Document the schema and add it to `.vscodeignore`.

---

### 4.9 Test generation alongside review fixes (Medium impact, Low-Medium cost)

**The gap**: When Copilot or a human reviewer flags a bug in a function, the natural follow-up is a test that covers that exact case. Today CRA applies the fix but produces no test coverage for it. Qodo owns test generation as a standalone action; no tool ties it directly to the act of resolving a specific review comment.

**Proposal**: Add a "Generate tests" toggle per card (off by default). When enabled for a card, the apply prompt sent to Copilot Chat is augmented with an instruction to also generate or update the relevant test file for the fixed code. The prompt extension would:
- Identify the test file counterpart for the fixed source file (by convention: `*.test.ts`, `*.spec.ts`, `__tests__/`, etc.)
- Include the existing test file content as context if it is found
- Instruct the model to add a focused test case covering the scenario described in the review comment

**Why this is different from Qodo's offering**: Qodo generates tests on demand for any code. CRA's version is scoped to the review comment — the test is motivated by the specific bug or concern the reviewer raised, making it directly traceable to the fix. This is a stronger quality signal.

**Scope concern**: Letting Copilot Chat rewrite both a source file and a test file in one shot increases the risk of a bad output. This should be opt-in and clearly labelled as experimental until confidence in the output quality is established.

---

### 4.10 Multi-PR triage view (Medium impact, High cost)

**Current gap**: CRA shows one PR at a time. Developers working across multiple active PRs must switch between them.

**Proposal**: In the PR picker, add a "Load all" option that loads comments from all matching open PRs into a combined, grouped-by-PR panel. The Push & Mark Resolved button becomes per-PR. This is a larger UI rework but meaningful for developers who review their own PRs across feature branches.

---

### 4.11 Cross-platform expansion — strategic question (Lower priority, High cost + identity decision)

**The architectural question**: CRA is GitHub-only. Other platforms have equivalent AI reviewer bots:

| Platform | AI reviewer bot | Notes |
|---|---|---|
| GitHub | `copilot-pull-request-reviewer[bot]` | CRA's current target |
| GitHub (Enterprise Server) | Same Copilot bot | Same code, different host URL |
| Azure DevOps | GitHub Copilot (via ADO integration) | Copilot is available on ADO — still Copilot |
| GitLab | GitLab Duo Code Review | A different AI product entirely |
| Bitbucket | No first-party AI reviewer bot (as of May 2026) | Third-party CI bots only |

**The naming problem**: The extension is called *Copilot* Reviewer Assistant. "Copilot" here refers specifically to GitHub Copilot. Supporting GitLab Duo or Atlassian Rovo Dev would mean:
1. The name becomes misleading — "Copilot" is a GitHub/Microsoft trademark
2. The extension's identity shifts from "the tool that closes GitHub Copilot's PR review loop" to "a generic AI review triage tool"
3. A rebrand would be needed — e.g. *AI Review Assistant* or *PR Review Closer*

**Recommended boundaries**:

- **In scope, no name change needed**: GitHub.com + GitHub Enterprise Server (same platform, same Copilot bot, just a custom `apiBase`). Azure DevOps with GitHub Copilot enabled is also arguably in scope — it is still Copilot.
- **Out of scope unless rebranded**: GitLab Duo, Atlassian Rovo Dev. These are different products, different APIs, different auth models, and would require a full `ReviewPlatform` abstraction layer.

**Honest assessment**: Going cross-platform is a different product, not an increment. The smarter move is to go deep on the GitHub surface (GitHub Enterprise, all reviewer types, re-review trigger, PR description update) before going wide. If user demand for GitLab support becomes clear from GitHub Discussions, revisit with a rebrand decision in hand.

---

### 4.12 GitHub Enterprise Server support (Lower priority, Medium cost)

**Current gap**: The extension targets `github.com` only. Enterprise customers on GHE have the same Copilot review workflow but cannot use CRA.

**Proposal**: Read the remote URL and if the host is not `github.com`, allow the user to configure a custom `apiBase` URL (e.g. `https://github.mycompany.com/api/v3`). PAT auth already supports this implicitly; the main work is URL construction throughout `githubApi.ts`.

---

### 4.13 Retry / undo last applied batch (Lower priority, Medium cost)

**Current gap**: If Copilot Chat produces a bad fix, the user's only recourse is manual git revert or `Ctrl+Z` in each affected file.

**Proposal**: Before sending the apply prompt, snapshot the current state of all files that will be touched (using the git stash API or a hidden temp directory). Add an "Undo last apply" command that restores the snapshot. Clear the snapshot on the next successful push.

---

## 5. Recommended Roadmap

| Phase | Items | Rationale |
|---|---|---|
| **v1.1 — Quick wins** | Status bar badge (4.2), Keyboard navigation (4.7), Re-review trigger (4.5), Commit message auto-generation (4.6) | Each is low-cost, high-visibility, zero breaking changes |
| **v1.2 — Workflow depth** | Diff preview for suggestion-block comments (4.3), Post-push PR description update (4.4), Per-repo `.cra.json` (4.8) | Reduces friction in the apply step; improves team adoptability |
| **v1.3 — Quality + reach** | Test generation alongside fixes (4.9), PR picker filter relaxation (4.1), GitHub Enterprise support (4.12) | Adds quality signal; broadens to GHE teams; picker relaxation is minor but unlocks all-reviewer-only PRs |
| **v2.0 — Scope decisions** | Multi-PR view (4.10), Cross-platform / rebrand (4.11) | Both require significant investment; validate demand from user feedback before committing |

---

## 6. Publishing Checklist

Before and shortly after the initial marketplace listing, these items add disproportionate visibility:

- [ ] **Open VSX Registry** — Publish to [open-vsx.org](https://open-vsx.org/) for VSCodium and Gitpod users
- [ ] **CHANGELOG.md** — Keep it up to date with every release; marketplace surfaces it prominently
- [ ] **Demo GIF in README** — A 15-second recording of the full workflow is the single highest-conversion element on a marketplace page
- [ ] **`galleryBanner` in package.json** — Sets the marketplace page background colour/theme
- [ ] **Categories** — Ensure `package.json` lists `"Other"` and `"SCM Providers"` for discoverability
- [ ] **Keywords** — Add `"github copilot"`, `"pull request"`, `"code review"`, `"ai review"` to `package.json` keywords
- [ ] **GitHub Discussions / Issues** — Open a `feedback` discussion to collect user requests early; drives prioritisation of the roadmap above
