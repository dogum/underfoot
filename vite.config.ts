import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// The public site (GitHub Pages). Relative base so it works under /underfoot/.
export default defineConfig({
  base: './',
  /* the community weights at a stable address, for copies of the app to fetch (app/weights) */
  plugins: [
    {
      name: 'weights-json',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'weights.json',
          source: readFileSync('model/weights.json', 'utf8'),
        });
      },
    },
  ],
  build: { outDir: 'dist', target: 'es2022', sourcemap: true },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
} as any);
