import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	// Only the compiled integration tests run here.
	// Unit tests are executed separately via Vitest (npm run test:unit).
	files: 'out/test/integration/**/*.test.js',
	mocha: {
		timeout: 15000, // VS Code extension activation can take a few seconds
	},
});
