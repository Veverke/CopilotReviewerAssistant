/**
 * Manual mock for the 'vscode' module.
 * Used by Vitest unit tests via `vi.mock('vscode')`.
 * Each test file that needs this mock must call `vi.mock('vscode')` at the top level.
 */
import { vi } from 'vitest';

export const authentication = {
  getSession: vi.fn(),
};

export const workspace = {
  findFiles: vi.fn(),
  fs: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
  workspaceFolders: undefined as any,
};

export const extensions = {
  getExtension: vi.fn(),
};

export const lm = {
  selectChatModels: vi.fn(),
};

export const LanguageModelChatMessage = {
  User: vi.fn((content: string) => ({ role: 'user', content })),
};

export const Uri = {
  joinPath: vi.fn((_base: any, ...parts: string[]) => ({
    fsPath: parts.join('/'),
    toString: () => parts.join('/'),
  })),
  file: vi.fn((path: string) => ({ fsPath: path, toString: () => path })),
};

export const window = {
  showInputBox: vi.fn(),
  showErrorMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  })),
  createWebviewPanel: vi.fn(),
  activeTextEditor: undefined as any,
};

export const commands = {
  registerCommand: vi.fn(),
};

export const env = {
  clipboard: {
    readText: vi.fn(),
  },
};

export const ViewColumn = {
  One: 1,
};
