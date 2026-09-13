import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.gcode': 'text/plain; charset=utf-8',
  '.rsc': 'text/x-component',
};

/** Directory indexes match GitHub Pages, including standalone games in public/. */
export function createStaticServer(directory: string) {
  const root = resolve(directory);
  return createServer((request, response) => {
    void (async () => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' });
        response.end();
        return;
      }
      let path: string;
      try {
        path = resolve(
          root,
          '.' +
            decodeURIComponent(
              new URL(request.url ?? '/', 'http://localhost').pathname,
            ),
        );
      } catch {
        response.writeHead(400);
        response.end();
        return;
      }
      if (path !== root && !path.startsWith(root + sep)) {
        response.writeHead(403);
        response.end();
        return;
      }
      let status = 200;
      try {
        if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
        path = await realpath(path);
        const actualRoot = await realpath(root);
        if (!path.startsWith(actualRoot + sep)) {
          response.writeHead(403);
          response.end();
          return;
        }
      } catch {
        path = join(root, '404.html');
        status = 404;
      }
      const bytes = await readFile(path).catch(() => null);
      if (!bytes) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }
      response.writeHead(status, {
        'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
        'Content-Length': bytes.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end('Static preview error');
    });
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const argument = (key: string) => {
    const index = process.argv.indexOf(key);
    return index < 0 ? undefined : process.argv[index + 1];
  };
  const port = Number(argument('--port') ?? process.env.PORT ?? 4173);
  const hostname = argument('--hostname') ?? '127.0.0.1';
  const directory = resolve('dist/client');
  await accessBuild();
  const server = createStaticServer(directory);
  server.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, hostname, () =>
    console.log(`Static preview: http://${hostname}:${port}`),
  );
  async function accessBuild() {
    try {
      await stat(join(directory, 'index.html'));
    } catch {
      throw new Error('Build output is missing. Run npm run build first.');
    }
  }
}
