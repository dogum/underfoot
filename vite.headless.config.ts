import { defineConfig } from 'vite';

// The headless reader for Node (src/headless): one ES module, dist-headless/underfoot.mjs.
// Its decoders (@jsquash/jpeg, fast-png) stay outside the bundle, resolved at run time.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'src/headless/index.ts',
    outDir: 'dist-headless',
    target: 'node20',
    emptyOutDir: true,
    rolldownOptions: { output: { format: 'es', entryFileNames: 'underfoot.mjs' } },
  },
});
