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
  `Verified ${references.size} static entry assets, including the GCode page, cover and worker.`,
);
