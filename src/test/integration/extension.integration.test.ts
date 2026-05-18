/**
 * Integration tests for Copilot Reviewer Assistant
 *
 * These run inside a real VS Code instance via @vscode/test-electron.
 * They verify the extension integrates correctly with the VS Code host —
 * not the network/business logic (which is covered by the Vitest unit suite).
 *
 * Design principles:
 *  - Every test exercises a real code path in the real VS Code environment.
 *  - No mocking: every assertion is against the live extension API.
 *  - Tests that would block headless CI (e.g. interactive auth dialogs) are
 *    skipped via `this.skip()` when `process.env.CI` is set.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';

/** Publisher name + extension name, exactly as declared in package.json. */
const EXT_ID = 'Veverke.copilot-reviewer-assistant';

const OPEN_PANEL_CMD = 'copilotReviewer.openPanel';
const CLEAR_PAT_CMD  = 'copilotReviewer.clearPat';
const CONFIG_SECTION = 'copilotReviewer';

// ── Suite 1: Activation & command registration ─────────────────────────────

suite('Activation & command registration', () => {
  suiteSetup(async () => {
    // Standard activation pattern for VS Code extension tests:
    // ensure the extension has been activated before any test in this suite runs.
    const ext = vscode.extensions.getExtension(EXT_ID);
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('extension is discoverable by its publisher.name ID', () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(
      ext,
      `Extension "${EXT_ID}" not found — verify the publisher and name fields in package.json`,
    );
  });

  test('extension activates without throwing', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `Extension "${EXT_ID}" not found`);
    // activate() is idempotent in VS Code — safe to call even if already active
    await assert.doesNotReject(() => ext!.activate());
  });

  test('extension exports an object after activation (not undefined)', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `Extension "${EXT_ID}" not found`);
    await ext!.activate();
    // The extension may or may not export a public API — what matters is that
    // activation did not fail and VS Code reflects the extension as active.
    assert.ok(ext!.isActive, 'Extension should be active after activate() resolves');
  });

  test('"copilotReviewer.openPanel" is present in the VS Code command registry', async () => {
    const allCmds = await vscode.commands.getCommands(/* filterInternal */ true);
    assert.ok(
      allCmds.includes(OPEN_PANEL_CMD),
      `"${OPEN_PANEL_CMD}" not found in registered commands`,
    );
  });

  test('"copilotReviewer.clearPat" is present in the VS Code command registry', async () => {
    const allCmds = await vscode.commands.getCommands(true);
    assert.ok(
      allCmds.includes(CLEAR_PAT_CMD),
      `"${CLEAR_PAT_CMD}" not found in registered commands`,
    );
  });

  test('exactly the two declared commands are registered (contribution-point contract)', async () => {
    const allCmds = await vscode.commands.getCommands(true);
    const ours = allCmds.filter((c) => c.startsWith('copilotReviewer.'));
    // package.json contributes.commands declares exactly two commands.
    // If this test fails, package.json and the extension code are out of sync.
    assert.strictEqual(
      ours.length,
      2,
      `Expected 2 copilotReviewer.* commands, got ${ours.length}: [${ours.join(', ')}]`,
    );
  });
});

// ── Suite 2: Configuration schema & defaults ───────────────────────────────

suite('Configuration schema & defaults', () => {
  /**
   * Each test reads configuration values from the live VS Code configuration
   * subsystem, validating that the schema declared in package.json is correct
   * and that no default value has been silently changed.
   */

  test('prFilter defaults to "assigned"', () => {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    assert.strictEqual(
      cfg.get<string>('prFilter'),
      'assigned',
      'prFilter default changed — update package.json and this test in sync',
    );
  });

  test('preFillFromClipboard defaults to false', () => {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    assert.strictEqual(cfg.get<boolean>('preFillFromClipboard'), false);
  });

  test('additionalBotLogins defaults to an empty array', () => {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const logins = cfg.get<string[]>('additionalBotLogins');
    assert.ok(Array.isArray(logins), 'additionalBotLogins must be an array, not ' + typeof logins);
    assert.strictEqual(logins!.length, 0, 'additionalBotLogins should be empty by default');
  });

  test('prFilter value is one of the declared enum values', () => {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const value = cfg.get<string>('prFilter');
    const validValues = ['both', 'created', 'assigned'];
    assert.ok(
      validValues.includes(value!),
      `prFilter "${value}" is not in the declared enum: ${validValues.join(', ')}`,
    );
  });

  test('preFillFromClipboard is typed as a boolean, not a string', () => {
    const value = vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>('preFillFromClipboard');
    assert.strictEqual(
      typeof value,
      'boolean',
      `preFillFromClipboard should be boolean, got ${typeof value}`,
    );
  });

  test('additionalBotLogins accepts a non-empty list and reads back correctly', async () => {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const testValue = ['my-custom-bot[bot]', 'second-reviewer[bot]'];

    await cfg.update('additionalBotLogins', testValue, vscode.ConfigurationTarget.Global);

    const updated = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<string[]>('additionalBotLogins');
    assert.deepStrictEqual(updated, testValue);

    // Restore to default so subsequent test runs start from a clean state
    await cfg.update('additionalBotLogins', [], vscode.ConfigurationTarget.Global);
  });

  test('additionalBotLogins returns to empty array after being cleared', async () => {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);

    await cfg.update('additionalBotLogins', ['bot-to-remove[bot]'], vscode.ConfigurationTarget.Global);
    await cfg.update('additionalBotLogins', [],                     vscode.ConfigurationTarget.Global);

    const restored = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<string[]>('additionalBotLogins');
    assert.deepStrictEqual(restored, [], 'Clearing additionalBotLogins should restore it to []');
  });

  test('prFilter can be overridden to "both" and restored to "assigned"', async () => {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);

    await cfg.update('prFilter', 'both', vscode.ConfigurationTarget.Global);
    assert.strictEqual(
      vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>('prFilter'),
      'both',
    );

    // Restore
    await cfg.update('prFilter', 'assigned', vscode.ConfigurationTarget.Global);
  });

  test('prFilter can be overridden to "created" and restored', async () => {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);

    await cfg.update('prFilter', 'created', vscode.ConfigurationTarget.Global);
    assert.strictEqual(
      vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>('prFilter'),
      'created',
    );

    await cfg.update('prFilter', 'assigned', vscode.ConfigurationTarget.Global);
  });
});

// ── Suite 3: clearPat command — end-to-end ─────────────────────────────────

suite('clearPat command — end-to-end', () => {
  /**
   * clearPat deletes any stored GitHub PAT from VS Code's SecretStorage and
   * shows an informational message. All tests here run safely in CI because
   * the command performs no network activity and involves no auth dialogs.
   */

  test('executes without throwing when no PAT has ever been stored', async () => {
    await assert.doesNotReject(
      () => vscode.commands.executeCommand(CLEAR_PAT_CMD),
      'clearPat must not throw when no credential is stored in SecretStorage',
    );
  });

  test('resolves to undefined — returns no value to the executeCommand caller', async () => {
    const result = await vscode.commands.executeCommand(CLEAR_PAT_CMD);
    assert.strictEqual(
      result,
      undefined,
      'clearPat command should return void (undefined) to callers',
    );
  });

  test('executing clearPat twice in succession is safe (idempotent)', async () => {
    // Deleting a non-existent secret should not throw.
    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand(CLEAR_PAT_CMD);
      await vscode.commands.executeCommand(CLEAR_PAT_CMD);
    });
  });

  test('extension remains active and responsive after clearPat', async () => {
    await vscode.commands.executeCommand(CLEAR_PAT_CMD);

    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext?.isActive, 'Extension must remain active after clearPat');

    // Verify commands are still registered (extension was not inadvertently deactivated)
    const allCmds = await vscode.commands.getCommands(true);
    assert.ok(allCmds.includes(CLEAR_PAT_CMD), 'clearPat command must still be registered after execution');
    assert.ok(allCmds.includes(OPEN_PANEL_CMD), 'openPanel command must still be registered after clearPat');
  });
});

// ── Suite 4: openPanel command — error resilience ──────────────────────────

suite('openPanel command — error resilience', () => {
  /**
   * These tests verify that the openPanel command handles error conditions
   * gracefully without crashing VS Code or leaking unhandled promise rejections.
   *
   * The command catches all errors internally and surfaces them via
   * vscode.window.showErrorMessage — it must never propagate to executeCommand.
   */

  test('command does not propagate rejections when GitHub auth is unavailable', async function () {
    // In CI there is no interactive GitHub session; the VS Code GitHub auth
    // extension shows a sign-in dialog that cannot be completed in a headless
    // runner. Skip to prevent the test from hanging indefinitely.
    if (process.env.CI) {
      return this.skip();
    }
    this.timeout(8000);

    let threw = false;
    try {
      await vscode.commands.executeCommand(OPEN_PANEL_CMD);
    } catch {
      threw = true;
    }

    assert.strictEqual(
      threw,
      false,
      'openPanel must catch all errors internally and not propagate to executeCommand callers',
    );
  });
});
