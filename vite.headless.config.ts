import { defineConfig } from 'vite';

// Underfoot for Node (src/headless, src/mcp), into dist-headless/:
//   underfoot.mjs      the headless reader, for scripts and the command line
//   underfoot-mcp.mjs  the MCP server over stdio
// Their dependencies (@jsquash/jpeg, fast-png, the MCP SDK, zod) stay outside the bundle.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: true,
    outDir: 'dist-headless',
    target: 'node20',
    emptyOutDir: true,
    rolldownOptions: {
      input: { underfoot: 'src/headless/index.ts', 'underfoot-mcp': 'src/mcp/main.ts' },
      output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' },
    },
  },
});
