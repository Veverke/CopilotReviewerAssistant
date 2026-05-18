import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/test/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Only measure coverage for the production source modules.
      include: ['src/**/*.ts'],
      exclude: [
        // Test files themselves
        'src/test/**',
        // VS Code extension entry-point: the activate() function is pure
        // VS Code orchestration glue (command registrations, progress UI,
        // auth retry logic). It is tested end-to-end by the integration
        // suite (@vscode/test-electron) and cannot be meaningfully unit-tested
        // without replicating the entire VS Code ExtensionContext contract.
        'src/extension.ts',
        // Interface/type-only files — no executable statements to measure.
        'src/fixApplier.ts',
        'src/workPlanGenerator.ts',
      ],
      reporter: ['text', 'lcov', 'html'],
      // CI enforces these thresholds; the build fails if any drops below 90%.
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});

