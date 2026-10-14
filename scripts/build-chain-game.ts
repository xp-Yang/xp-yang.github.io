import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demoRoot = join(siteRoot, 'demos/chain-game');
const outputRoot = join(siteRoot, 'public/games/chain-game');
const publicBase = '/games/chain-game/';

await build({
  root: demoRoot,
  configFile: join(demoRoot, 'vite.config.ts'),
  build: { outDir: outputRoot, emptyOutDir: true },
});

async function listFiles(directory: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory())
      files.push(...(await listFiles(join(directory, entry.name), `${name}/`)));
    else files.push(name);
  }
  return files.sort();
}

const files = await listFiles(outputRoot);
const cachedFiles = files.filter((file) => file !== 'sw.js');
const workerTemplate = await readFile(join(outputRoot, 'sw.js'), 'utf8');
const hash = createHash('sha256').update(workerTemplate);
for (const file of cachedFiles)
  hash.update(file).update(await readFile(join(outputRoot, file)));
const version = hash.digest('hex').slice(0, 16);
const worker = workerTemplate
  .replace('__CHAIN_CACHE_VERSION__', version)
  .replace(
    '__CHAIN_CACHE_FILES__',
    JSON.stringify(cachedFiles.map((file) => publicBase + file)),
  );
await writeFile(join(outputRoot, 'sw.js'), worker);
await writeFile(
  join(outputRoot, 'asset-manifest.json'),
  JSON.stringify({ version, files }, null, 2) + '\n',
);
console.log(
  `Packaged Chain Game with ${cachedFiles.length} offline assets (${version}).`,
);
