import { defineConfig } from 'vite';

// `--mode artifact`: build para publicar como Artifact. Three.js se carga desde CDN (importmap en publish/),
// el código propio queda sin minificar y con nombres de archivo fijos.
export default defineConfig(({ mode }) =>
  mode === 'artifact'
    ? {
        base: './',
        build: {
          outDir: 'dist-artifact',
          emptyOutDir: true,
          minify: false,
          cssCodeSplit: false,
          rollupOptions: {
            external: ['three'],
            output: { entryFileNames: 'assets/game.js', assetFileNames: 'assets/game[extname]' },
          },
        },
      }
    : {},
);
