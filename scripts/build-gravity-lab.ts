import { readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demoRoot = join(siteRoot, 'demos/gravity-lab');
const outputRoot = join(siteRoot, 'public/experiments/gravity-lab');

// Package the independent app using the site's already-installed Vite/Three.js.
// Only this generated directory is replaced; the demo's own dist stays separate.
await build({
  root: demoRoot,
  configFile: join(demoRoot, 'vite.config.js'),
  publicDir: false,
  build: { outDir: outputRoot, emptyOutDir: true },
});

async function listFiles(directory: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) {
      files.push(...await listFiles(join(directory, entry.name), name + '/'));
    } else {
      files.push(name);
    }
  }
  return files.sort();
}

// Keep the emitted Worker and hashed resources in the deploy asset inventory.
await writeFile(
  join(outputRoot, 'asset-manifest.json'),
  JSON.stringify({ files: await listFiles(outputRoot) }, null, 2) + '\n',
);
