import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  createRouter,
  matchRoute,
  createForm,
  createResource,
  createScope,
  cell,
  effect,
  h,
  mount,
  hydrate,
  renderToString,
} from '../dist/esm/index.js';

test('route matching supports exact, named, wildcard, query/hash and safe parameter records', () => {
  assert.equal(matchRoute('/users', '/users/1'), null);
  assert.equal(matchRoute('/users/:id', '/users'), null);
  const match = matchRoute('/users/:id', '/users/A%20B?tab=info#bio');
  assert.equal(match.params.id, 'A B');
  assert.equal(match.query.get('tab'), 'info');
  assert.equal(match.hash, '#bio');
  assert.equal(matchRoute('/files/*', '/files/a/b').params['*'], 'a/b');
  assert.equal(matchRoute('/:__proto__', '/hello').params['__proto__'], 'hello');
  assert.throws(() => matchRoute('/a/*/b', '/a/c/d'), /wildcard/);
  assert.throws(() => matchRoute('/:id/:id', '/1/2'), /duplicate/);
  assert.throws(() => matchRoute('/a/*/b', '/unmatched'), /wildcard/);
  assert.throws(() => matchRoute('/:id/:id', '/unmatched'), /duplicate/);
  assert.throws(() => matchRoute('/:id', '/%ZZ'), URIError);
});
test('memory routers are isolated across server requests and reject external navigation', () => {
  const a = createRouter('/a'),
    b = createRouter('/b');
  a.navigate('/c?x=1#h');
  assert.equal(a.path.get(), '/c?x=1#h');
  assert.equal(b.path.get(), '/b');
  for (const path of [
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    'relative',
    '/white space',
  ]) {
    assert.throws(() => a.navigate(path), TypeError);
  }
  assert.equal(
    renderToString(a.outlet([{ path: '/c', view: () => h('b', null, 'C') }])),
    '<!--s--><!--s--><b>C</b><!--/s--><!--/s-->',
  );
  assert.ok(renderToString(b.outlet([])).includes('Page not found'));
});
test('browser router connects, handles navigation, popstate and modified clicks, and disconnects', () => {
  const window = new JSDOM('<div id="app"></div>', { url: 'https://example.test/initial' }).window;
  const root = window.document.querySelector('#app');
  const router = createRouter();
  const disconnect = router.connect(window);
  assert.equal(router.path.get(), '/initial');
  assert.throws(() => router.connect(window), /already connected/);
  const app = mount(
    h(
      'div',
      null,
      router.link('/next', {}, 'Next'),
      router.outlet([{ path: '/next', view: () => 'next page' }]),
    ),
    root,
  );
  const link = root.querySelector('a');
  const modified = new window.MouseEvent('click', { button: 0, ctrlKey: true, cancelable: true });
  link.dispatchEvent(modified);
  assert.equal(router.path.get(), '/initial');
  const click = new window.MouseEvent('click', { button: 0, cancelable: true });
  link.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true);
  assert.equal(window.location.pathname, '/next');
  assert.ok(root.textContent.includes('next page'));
  router.navigate('/replaced', { replace: true });
  window.history.replaceState(null, '', '/pop');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  assert.equal(router.path.get(), '/pop');
  disconnect();
  disconnect();
  window.history.replaceState(null, '', '/disconnected');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  assert.equal(router.path.get(), '/pop');
  app.unmount();
  window.close();
});
test('owned router connection is disconnected with its scope', () => {
  const window = new JSDOM('', { url: 'https://example.test/' }).window;
  const router = createRouter();
  const scope = createScope(() => router.connect(window));
  scope.dispose();
  const disconnect = router.connect(window);
  disconnect();
  window.close();
});
test('router links honor reactive target and download attributes at click time', () => {
  const window = new JSDOM('<div id="app"></div>', { url: 'https://example.test/' }).window;
  const root = window.document.querySelector('#app');
  const router = createRouter();
  const target = cell('_self'),
    download = cell(null);
  const app = mount(
    router.link('/next', { target: target.get, download: download.get }, 'Next'),
    root,
  );
  const anchor = root.querySelector('a');
  const click = () => {
    const event = new window.MouseEvent('click', { button: 0, cancelable: true });
    anchor.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(click(), true);
  router.navigate('/');
  target.set('_blank');
  assert.equal(click(), false);
  assert.equal(router.path.get(), '/');
  target.set('_self');
  download.set('file.txt');
  assert.equal(click(), false);
  assert.equal(router.path.get(), '/');
  app.unmount();
  window.close();
});
test('a failed router connection rolls back listeners and allows reconnecting', () => {
  const window = new JSDOM('', { url: 'https://example.test/throw' }).window;
  const router = createRouter('/');
  const stop = effect(() => {
    if (router.path.get() === '/throw') throw new Error('route failed');
  });
  assert.throws(() => router.connect(window), /route failed/);
  stop();
  const disconnect = router.connect(window);
  disconnect();
  window.close();
});
test('forms validate, touch, snapshot values and restore defaults', async () => {
  const initial = { name: '', enabled: false };
  const form = createForm(initial, (values) => (values.name.trim() ? {} : { name: ['Required'] }));
  initial.name = 'external mutation';
  assert.equal(form.validate(), false);
  assert.deepEqual(form.errors.get(), { name: ['Required'] });
  form.touch('name');
  assert.equal(form.touched.get().name, true);
  assert.equal(await form.submit(() => assert.fail('invalid form submitted')), false);
  form.fields.name.set('Ada');
  form.fields.enabled.set(true);
  const snapshot = form.values();
  snapshot.name = 'not shared';
  assert.equal(form.fields.name.get(), 'Ada');
  let submitted;
  assert.equal(
    await form.submit((values) => {
      submitted = values;
    }),
    true,
  );
  assert.deepEqual(submitted, { name: 'Ada', enabled: true });
  form.reset();
  assert.deepEqual(form.values(), { name: '', enabled: false });
  assert.deepEqual(form.errors.get(), {});
  assert.throws(() => form.input('missing'), /Unknown/);
  assert.throws(() => form.reset({ name: 'no boolean' }), /original field/);
  assert.throws(() => createForm({ x: 1 }), /strings or booleans/);
  assert.throws(() => createForm({ x: '' }, () => ({ x: 'wrong' })).validate(), /arrays/);
});
test('form submission prevents concurrency and propagates handler errors', async () => {
  const form = createForm({ name: 'ok' });
  let resolve;
  const pending = form.submit(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  assert.equal(form.submitting.get(), true);
  await assert.rejects(
    form.submit(() => {}),
    /already/,
  );
  assert.throws(() => form.reset(), /submitting/);
  resolve();
  await pending;
  await assert.rejects(
    form.submit(() => {
      throw new Error('server error');
    }),
    /server error/,
  );
  assert.equal(form.submitting.get(), false);
});
test('form input bindings hydrate and synchronize input, checkbox, blur and reset', () => {
  const form = createForm({ name: 'server', enabled: true });
  const view = h('form', null, h('input', form.input('name')), h('input', form.input('enabled')));
  const window = new JSDOM(`<div id="app">${renderToString(view)}</div>`).window;
  const root = window.document.querySelector('#app');
  const app = hydrate(view, root);
  const [text, check] = root.querySelectorAll('input');
  assert.equal(text.value, 'server');
  assert.equal(check.checked, true);
  text.value = 'client';
  text.dispatchEvent(new window.Event('input'));
  check.checked = false;
  check.dispatchEvent(new window.Event('change'));
  text.dispatchEvent(new window.Event('blur'));
  assert.deepEqual(form.values(), { name: 'client', enabled: false });
  assert.equal(form.touched.get().name, true);
  form.reset();
  assert.equal(text.value, 'server');
  assert.equal(check.checked, true);
  app.unmount();
  window.close();
});
test('resources support initial data, success, failure and explicit promise errors', async () => {
  const resource = createResource(
    async (key) => {
      if (key === 'fail') throw new Error('network');
      return key.toUpperCase();
    },
    { initialData: 'SERVER' },
  );
  assert.deepEqual(resource.state.get(), { status: 'ready', data: 'SERVER' });
  const promise = resource.load('hello');
  assert.deepEqual(resource.state.get(), { status: 'pending', data: 'SERVER' });
  assert.equal(await promise, 'HELLO');
  await assert.rejects(resource.load('fail'), /network/);
  assert.equal(resource.state.get().status, 'error');
  assert.equal(resource.state.get().data, 'HELLO');
  resource.cancel();
  assert.equal(resource.state.get().status, 'ready');
  resource.dispose();
  await assert.rejects(resource.load('late'), /disposed/);
});
test('resources cancel previous requests and ignore stale completion even if loader ignores abort', async () => {
  const calls = [];
  const resource = createResource(
    (key, signal) => new Promise((resolve) => calls.push({ key, signal, resolve })),
  );
  const a = resource.load('a'),
    b = resource.load('b');
  assert.equal(calls[0].signal.aborted, true);
  calls[1].resolve('new');
  await b;
  calls[0].resolve('old');
  await a;
  assert.deepEqual(resource.state.get(), { status: 'ready', data: 'new' });
  const c = resource.load('c');
  resource.cancel();
  assert.equal(calls[2].signal.aborted, true);
  calls[2].resolve('ignored');
  await c;
  assert.deepEqual(resource.state.get(), { status: 'ready', data: 'new' });
  resource.dispose();
});
test('resource abort errors propagate and owned resources dispose on unmount', async () => {
  let resource;
  const scope = createScope(() => {
    resource = createResource(
      (key, signal) =>
        new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    );
  });
  const promise = resource.load(1);
  scope.dispose();
  await assert.rejects(promise, /aborted/);
  assert.equal(resource.state.get().status, 'idle');
});
test('loading from a keyed effect does not subscribe the effect to resource status', async () => {
  const key = cell(1);
  let calls = 0;
  const resource = createResource(async (id) => {
    calls++;
    return id;
  });
  const promises = [];
  const stop = effect(() => {
    promises.push(resource.load(key.get()));
  });
  await Promise.all(promises);
  assert.equal(calls, 1);
  key.set(2);
  await Promise.all(promises);
  assert.equal(calls, 2);
  stop();
  resource.dispose();
});
