import { defineConfig, type Plugin, type Rolldown } from 'vite';

// The offline build: one self-contained underfoot.html that runs from disk.
// The bundle is a single ES module and one stylesheet; this plugin moves both
// into the page so there is nothing else to load (file:// can't load modules).
function inlineIntoHtml(): Plugin {
  return {
    name: 'inline-into-html',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const page = Object.values(bundle).find(
        (f): f is Rolldown.OutputAsset => f.type === 'asset' && f.fileName.endsWith('.html'),
      );
      if (!page) return;
      let html = String(page.source);
      for (const [name, file] of Object.entries(bundle)) {
        const ref = new RegExp(`(src|href)="[^"]*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
        if (file.type === 'chunk' && file.isEntry) {
          const code = file.code.replace(/<\/script/gi, '<\\/script');
          html = html.replace(
            new RegExp(`<script[^>]*${ref.source}[^>]*></script>`),
            () => `<script type="module">${code}</script>`,
          );
          delete bundle[name];
        } else if (file.type === 'asset' && name.endsWith('.css')) {
          html = html.replace(
            new RegExp(`<link[^>]*${ref.source}[^>]*>`),
            () => `<style>${String(file.source)}</style>`,
          );
          delete bundle[name];
        }
      }
      page.source = html;
      page.fileName = 'underfoot.html';
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [inlineIntoHtml()],
  publicDir: false, // the offline file carries nothing but itself
  build: {
    outDir: 'dist-single',
    target: 'es2022',
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
