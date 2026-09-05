import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve @avs/* workspace packages to their TS source rather than dist/,
// so `vitest run` never depends on a prior `npm run build` having happened.
const pkg = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: {
      '@avs/shared': pkg('shared'),
      '@avs/ui': pkg('ui'),
      '@avs/project-core': pkg('project-core'),
      '@avs/ai-core': pkg('ai-core'),
      '@avs/prompt-engine': pkg('prompt-engine'),
      '@avs/model-adapters': pkg('model-adapters'),
      '@avs/storage-adapters': pkg('storage-adapters'),
    },
  },
  test: {
    include: ['{apps,packages}/*/src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    environmentMatchGlobs: [['apps/web/**', 'jsdom']],
    setupFiles: ['./apps/web/src/test-setup.ts'],
    passWithNoTests: false,
  },
});
