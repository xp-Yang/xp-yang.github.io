import { access, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve('dist/client');
const references = new Set<string>();
async function inspect(directory: string): Promise<void> {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) {
      if (item.name !== 'games') await inspect(path);
    } else if (
      item.name.endsWith('.html') ||
      (item.name.endsWith('.js') && path.includes('_next'))
    ) {
      const text = await readFile(path, 'utf8');
      for (const match of text.matchAll(
        /(?:["'`])(\/_next\/[^"'`<>\s]+\.(?:js|css))(?:["'`])/g,
      ))
        references.add(match[1]);
      if (
        item.name.startsWith('gcode-experience-') &&
        /new URL\([^)]*file:\/\/\/ROOT/.test(text)
      ) {
        throw new Error(
          'GCode worker URL was rewritten to a file URL. Use the Vite ?worker import.',
        );
      }
    }
  }
}
await inspect(root);
if (!references.size)
  throw new Error('Static export contains no client asset references.');
references.add('/works/gcode-preview/index.html');
references.add('/images/gcode-preview.png');
references.add('/works/gravity-lab/index.html');
references.add('/images/gravity-lab.png');
const gravityBase = '/experiments/gravity-lab/';
references.add(gravityBase + 'asset-manifest.json');
const gravityAssets = JSON.parse(
  await readFile(join(root, gravityBase.slice(1), 'asset-manifest.json'), 'utf8'),
) as { files: string[] };
if (
  !gravityAssets.files.includes('index.html') ||
  !gravityAssets.files.some(file => /^assets\/cpu\.worker-[^/]+\.js$/.test(file)) ||
  !gravityAssets.files.some(file => /^assets\/reference\.worker-[^/]+\.js$/.test(file))
) {
  throw new Error('Gravity Lab export is missing its entry page, CPU Worker, or reference Worker.');
}
for (const file of gravityAssets.files) {
  if (file.startsWith('/') || file.split('/').includes('..')) {
    throw new Error('Gravity Lab asset inventory contains an invalid path.');
  }
  references.add(gravityBase + file);
}
const chainBase = '/games/chain-game/';
references.add('/works/chain-game/index.html');
references.add('/images/chain-game.svg');
references.add(chainBase + 'asset-manifest.json');
const chainAssets = JSON.parse(
  await readFile(join(root, chainBase.slice(1), 'asset-manifest.json'), 'utf8'),
) as { version: string; files: string[] };
const requiredChainFiles = ['index.html', 'manifest.webmanifest', 'sw.js', 'icon.svg', 'icon-192.png', 'icon-512.png'];
if (
  !/^[a-f0-9]{16}$/.test(chainAssets.version) ||
  requiredChainFiles.some(file => !chainAssets.files.includes(file)) ||
  !chainAssets.files.some(file => /^assets\/[^/]+\.js$/.test(file)) ||
  !chainAssets.files.some(file => /^assets\/[^/]+\.css$/.test(file))
) {
  throw new Error('Chain Game export is missing its entry, UI assets, or offline support files.');
}
for (const file of chainAssets.files) {
  if (file.startsWith('/') || file.split('/').includes('..')) {
    throw new Error('Chain Game asset inventory contains an invalid path.');
  }
  references.add(chainBase + file);
}
const chainWorker = await readFile(join(root, chainBase.slice(1), 'sw.js'), 'utf8');
if (/__CHAIN_CACHE_/.test(chainWorker)) {
  throw new Error('Chain Game offline cache placeholders were not replaced during packaging.');
}
const chainManifest = JSON.parse(
  await readFile(join(root, chainBase.slice(1), 'manifest.webmanifest'), 'utf8'),
) as { scope: string; start_url: string };
if (chainManifest.scope !== chainBase || chainManifest.start_url !== chainBase) {
  throw new Error('Chain Game PWA must stay inside its own game scope.');
}
const missing: string[] = [];
for (const reference of references) {
  try {
    await access(join(root, reference.slice(1)));
  } catch {
    missing.push(reference);
  }
}
if (missing.length)
  throw new Error(`Static export is missing assets:\n${missing.join('\n')}`);
console.log(
  `Verified ${references.size} static entry assets, including GCode, Gravity Lab, and Chain Game with offline assets.`,
);
