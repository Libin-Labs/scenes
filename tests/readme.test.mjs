import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { hydrate, renderToString } from '../dist/esm/index.js';

test('npm README universal example has valid modules and a working hydrated counter', async () => {
  const readme = (await readFile(new URL('../README.md', import.meta.url), 'utf8')).replace(
    /\r\n/g,
    '\n',
  );
  const section = readme.split('## Complete universal application')[1].split('## API reference')[0];
  const directory = await mkdtemp(join(tmpdir(), 'scenes-readme-'));
  try {
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    for (const name of ['app.js', 'client.js', 'server.mjs']) {
      const source = section.split(`**${name}**`)[1].split('```js\n')[1].split('\n```')[0];
      assert.ok(source.includes('@lp-labs/scenes'));
      const file = join(directory, name);
      await writeFile(
        file,
        source.replaceAll(
          "'@lp-labs/scenes'",
          JSON.stringify(new URL('../dist/esm/index.js', import.meta.url).href),
        ),
      );
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    }
    const { createApp } = await import(pathToFileURL(join(directory, 'app.js')).href);
    const view = createApp({ count: 3 });
    const window = new JSDOM(`<div id="app">${renderToString(view)}</div>`).window;
    try {
      const root = window.document.querySelector('#app');
      const button = root.querySelector('button');
      const app = hydrate(view, root);
      button.click();
      assert.equal(button.textContent, 'Count: 4');
      assert.equal(root.querySelector('button'), button);
      app.unmount();
    } finally {
      window.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
