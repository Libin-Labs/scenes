import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { renderToString } from '@lp-labs/scenes';
import { createApplication } from './app.js';

const require = createRequire(import.meta.url);
const distribution = join(dirname(require.resolve('@lp-labs/scenes/package.json')), 'dist', 'esm');
const modules = new Set([
  'index.js',
  'reactive.js',
  'view.js',
  'router.js',
  'resource.js',
  'form.js',
]);

export function createDemoServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (
        url.pathname === '/app.js' ||
        url.pathname === '/client.js' ||
        url.pathname.startsWith('/@scenes/')
      ) {
        const name = url.pathname.slice('/@scenes/'.length);
        const path =
          url.pathname.startsWith('/@scenes/') && modules.has(name)
            ? join(distribution, name)
            : url.pathname === '/app.js' || url.pathname === '/client.js'
              ? fileURLToPath(new URL(`.${url.pathname}`, import.meta.url))
              : null;
        if (!path) {
          response.writeHead(404);
          response.end('Not found');
          return;
        }
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        response.end(await readFile(path));
        return;
      }
      const seed = { count: 0, path: url.pathname + url.search + url.hash };
      const { view } = createApplication(seed);
      const state = JSON.stringify(seed)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026');
      const html = renderToString(view);
      response.writeHead(url.pathname === '/' || url.pathname === '/about' ? 200 : 404, {
        'content-type': 'text/html; charset=utf-8',
      });
      response.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Scenes example</title>
<style>body{font:18px system-ui;max-width:760px;margin:3rem auto;padding:0 1rem}
button,input{font:inherit;margin:.5rem;padding:.4rem}li{margin:.5rem 0}nav{margin-bottom:2rem}</style>
<script type="importmap">{"imports":{"@lp-labs/scenes":"/@scenes/index.js"}}</script>
</head><body><div id="app">${html}</div>
<script id="seed" type="application/json">${state}</script>
<script type="module" src="/client.js"></script></body></html>`);
    } catch (error) {
      console.error(error);
      if (!response.headersSent) response.writeHead(500);
      response.end('Rendering failed');
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createDemoServer();
  server.listen(Number(process.env.PORT ?? 4380), '127.0.0.1', () => {
    console.log(`Scenes example: http://127.0.0.1:${server.address().port}`);
  });
}
