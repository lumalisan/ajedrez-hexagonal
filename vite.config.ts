import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
      const hash = createHash('sha256').update(template);
      for (const asset of assets) {
        hash.update(asset.fileName);
        hash.update(asset.type === 'chunk' ? asset.code : asset.source);
      }
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template
          .replace('__BUILD_VERSION__', hash.digest('hex').slice(0, 16))
          .replace(
            "['__BUILD_ASSETS__']",
            JSON.stringify(assets.map((asset) => `/${asset.fileName}`)),
          ),
      });
    },
  };
}

export default defineConfig({ plugins: [react(), tailwindcss(), offlinePrecache()] });
