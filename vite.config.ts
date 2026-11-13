import { defineConfig } from 'vite';

// A unique id for every build. The game compares it with version.json on the
// server to notice when a newer version has been published.
const buildId = (process.env.GITHUB_SHA ?? '').slice(0, 7) || 'dev-' + Date.now().toString(36);

export default defineConfig({
  base: './', // works at elliotjax.github.io/swords-and-spears/
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [{
    name: 'version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: buildId }) });
    },
  }],
});
