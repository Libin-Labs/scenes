import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { hydrate, renderToString } from '../dist/esm/index.js';
import { createApplication } from '../examples/universal/app.js';
import { createDemoServer } from '../examples/universal/server.mjs';

test('universal example hydrates, submits tasks and navigates without a reload', async () => {
  const { view, router } = createApplication({ path: '/', count: 0 });
  const window = new JSDOM(`<div id="app">${renderToString(view)}</div>`, {
    url: 'https://example.test/',
  }).window;
  const root = window.document.querySelector('#app');
  const button = root.querySelector('button');
  const app = hydrate(view, root);
  const disconnect = router.connect(window);
  assert.equal(root.querySelector('button'), button);
  button.click();
  assert.equal(button.textContent, 'Count: 1');
  const input = root.querySelector('input');
  input.value = 'Ship an app';
  input.dispatchEvent(new window.Event('input'));
  root.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(root.querySelectorAll('li').length, 2);
  assert.equal(input.value, '');
  const about = root.querySelector('a[href="/about"]');
  about.dispatchEvent(new window.MouseEvent('click', { button: 0, cancelable: true }));
  assert.equal(window.location.pathname, '/about');
  assert.ok(root.textContent.includes('Owned lifetimes'));
  disconnect();
  app.unmount();
  window.close();
});
test('universal HTTP server serves SSR pages and only allowlisted modules', async () => {
  const server = createDemoServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes('Count: <!--s-->0<!--/s-->'));
    assert.ok(html.includes('type="importmap"'));
    assert.equal((await fetch(`${base}/about`)).status, 200);
    assert.equal((await fetch(`${base}/missing`)).status, 404);
    assert.equal((await fetch(`${base}/@scenes/index.js`)).status, 200);
    assert.equal((await fetch(`${base}/@scenes/secret.js`)).status, 404);
    assert.equal((await fetch(`${base}/client.js`)).status, 200);
    const hostile = await (await fetch(`${base}/?x=%3C/script%3E`)).text();
    assert.ok(!hostile.includes('"path":"/?x=</script>'));
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
