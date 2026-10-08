import { defineConfig } from 'vite';

// The public site (GitHub Pages). Relative base so it works under /underfoot/.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'es2022', sourcemap: true },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
} as any);
