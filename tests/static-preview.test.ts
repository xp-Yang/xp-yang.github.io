import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createStaticServer } from '../scripts/serve-static';

void test('static preview serves nested directory indexes, worker MIME, HEAD and real 404s', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gcode-static-test-'));
  const server = createStaticServer(directory);
  try {
    await mkdir(join(directory, 'games', 'sample'), { recursive: true });
    await writeFile(
      join(directory, 'games', 'sample', 'index.html'),
      '<h1>Game</h1>',
    );
    await writeFile(join(directory, 'worker.js'), 'self.onmessage = () => {};');
    await writeFile(join(directory, '404.html'), '<h1>Missing</h1>');
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const suffix of ['/games/sample', '/games/sample/']) {
      const response = await fetch(base + suffix);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), '<h1>Game</h1>');
    }
    const worker = await fetch(base + '/worker.js');
    assert.match(worker.headers.get('content-type') ?? '', /javascript/);
    const head = await fetch(base + '/worker.js', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal((await fetch(base + '/missing')).status, 404);
    assert.equal((await fetch(base + '/%2e%2e%2foutside')).status, 403);
    assert.equal(
      (await fetch(base + '/worker.js', { method: 'POST' })).status,
      405,
    );
  } finally {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    // This fixture directory is generated locally by mkdtemp, never supplied by a caller.
    await rm(directory, { recursive: true, force: true });
  }
});
