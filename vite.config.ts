import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function offlinePrecache(): Plugin {
  return {
    name: 'offline-precache',
    apply: 'build',
    enforce: 'post',
    async generateBundle(_options, bundle) {
      const template = await readFile(new URL('./src/service-worker.js', import.meta.url), 'utf8');
      const assets = Object.values(bundle).sort((left, right) =>
        left.fileName.localeCompare(right.fileName),
      );
      // Public artwork is copied outside the bundle, so include it explicitly in the offline cache.
      const achievementDirectory = new URL('./public/achievements/', import.meta.url);
      const achievementImages = (await readdir(achievementDirectory, { recursive: true }))
        .filter((fileName) => fileName.endsWith('.webp'))
        .map((fileName) => fileName.replaceAll('\\', '/'))
        .sort();
      const unitDirectory = new URL('./public/units/', import.meta.url);
      const unitImages = (await readdir(unitDirectory))
        .filter((fileName) => fileName.endsWith('.webp'))
        .sort();
      const storyDirectory = new URL('./public/story/', import.meta.url);
      const storyImages = (await readdir(storyDirectory))
        .filter((fileName) => fileName.endsWith('.webp'))
        .sort();
      const hash = createHash('sha256').update(template);
      for (const asset of assets) {
        hash.update(asset.fileName);
        hash.update(asset.type === 'chunk' ? asset.code : asset.source);
      }
      for (const fileName of achievementImages) {
        hash.update(fileName);
        hash.update(await readFile(new URL(fileName, achievementDirectory)));
      }
      for (const fileName of unitImages) {
        hash.update(`units/${fileName}`);
        hash.update(await readFile(new URL(fileName, unitDirectory)));
      }
      for (const fileName of storyImages) {
        hash.update(`story/${fileName}`);
        hash.update(await readFile(new URL(fileName, storyDirectory)));
      }
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template
          .replace('__BUILD_VERSION__', hash.digest('hex').slice(0, 16))
          .replace(
            "['__BUILD_ASSETS__']",
            JSON.stringify([
              ...assets.map((asset) => `/${asset.fileName}`),
              ...achievementImages.map((fileName) => `/achievements/${fileName}`),
              ...unitImages.map((fileName) => `/units/${fileName}`),
              ...storyImages.map((fileName) => `/story/${fileName}`),
            ]),
          ),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), offlinePrecache()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'pixi', test: /node_modules[\\/]pixi\.js[\\/]/, entriesAware: true }],
        },
      },
    },
  },
});
