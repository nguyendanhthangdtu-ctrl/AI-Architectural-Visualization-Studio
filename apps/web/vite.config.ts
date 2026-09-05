import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Resolve @avs/* workspace packages to their TS source rather than dist/,
// mirroring the repo-root vitest.config.ts so `vite dev`/`vite build` never
// depend on the library packages having been tsc-built first.
const pkg = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@avs/shared': pkg('shared'),
      '@avs/ui': pkg('ui'),
      '@avs/project-core': pkg('project-core'),
      '@avs/ai-core': pkg('ai-core'),
      '@avs/prompt-engine': pkg('prompt-engine'),
    },
  },
  build: {
    outDir: 'dist',
  },
});
