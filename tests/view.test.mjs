import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  h,
  scene,
  when,
  each,
  cell,
  effect,
  derive,
  onCleanup,
  context,
  provide,
  inject,
  mount,
  hydrate,
  renderToString,
} from '../dist/esm/index.js';

function dom(html = '') {
  const window = new JSDOM(`<div id="app">${html}</div>`, { url: 'https://example.test/' }).window;
  return { window, root: window.document.querySelector('#app') };
}
test('mount updates attributes, text, styles and events without replacing static elements', () => {
  const n = cell(0),
    disabled = cell(false);
  const { root, window } = dom();
  let actions = 0,
    cleanups = 0;
  const app = mount(
    h(
      'button',
      {
        className: () => `n-${n.get()}`,
        disabled: disabled.get,
        style: () => ({ color: n.get() ? 'red' : 'blue', '--count': n.get() }),
        on: { click: () => n.update((v) => v + 1) },
        use: () => {
          actions++;
          return () => cleanups++;
        },
      },
      'Count ',
      () => n.get(),
    ),
    root,
  );
  const button = root.querySelector('button');
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(button.textContent, 'Count 1');
  assert.equal(root.querySelector('button'), button);
  assert.equal(button.className, 'n-1');
  assert.equal(button.style.color, 'red');
  disabled.set(true);
  assert.equal(button.disabled, true);
  disabled.set(false);
  assert.equal(button.hasAttribute('disabled'), false);
  assert.equal(actions, 1);
  app.unmount();
  app.unmount();
  assert.equal(root.childNodes.length, 0);
  button.dispatchEvent(new window.MouseEvent('click'));
  assert.equal(n.get(), 1);
  assert.equal(cleanups, 1);
  window.close();
});
test('dynamic scene replacement cleans owned computations and handles empty/array output', () => {
  const show = cell(true),
    n = cell(0);
  const { root, window } = dom();
  let cleanup = 0,
    runs = 0;
  const app = mount(
    when(show.get, () =>
      scene(() => {
        effect(() => {
          n.get();
          runs++;
        });
        onCleanup(() => cleanup++);
        return [h('i', null, 'a'), h('i', null, 'b')];
      }),
    ),
    root,
  );
  assert.equal(root.querySelectorAll('i').length, 2);
  show.set(false);
  n.set(1);
  assert.equal(root.querySelectorAll('i').length, 0);
  assert.equal(runs, 1);
  assert.equal(cleanup, 1);
  show.set(true);
  app.unmount();
  assert.equal(cleanup, 2);
  window.close();
});
test('keyed lists preserve row elements on reorder and update item/index cells', () => {
  const rows = cell([
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ]);
  const { root, window } = dom();
  let cleanups = 0;
  const app = mount(
    h(
      'ul',
      null,
      each(
        rows.get,
        (row) => row.id,
        (item, index) => {
          onCleanup(() => cleanups++);
          return h(
            'li',
            { 'data-id': () => item.get().id },
            () => `${index.get()}:${item.get().label}`,
          );
        },
      ),
    ),
    root,
  );
  const a = root.querySelector('[data-id=a]'),
    b = root.querySelector('[data-id=b]');
  rows.set([
    { id: 'b', label: 'Bee' },
    { id: 'a', label: 'Ay' },
    { id: 'c', label: 'C' },
  ]);
  assert.deepEqual(
    [...root.querySelectorAll('li')].map((n) => n.textContent),
    ['0:Bee', '1:Ay', '2:C'],
  );
  assert.equal(root.querySelectorAll('li')[0], b);
  assert.equal(root.querySelectorAll('li')[1], a);
  rows.set([{ id: 'a', label: 'A' }]);
  assert.equal(cleanups, 2);
  app.unmount();
  assert.equal(cleanups, 3);
  window.close();
});
test('duplicate keys fail explicitly before changing rows', () => {
  const rows = cell([1, 2]);
  const { root, window } = dom();
  const app = mount(
    each(
      rows.get,
      (n) => n,
      (item) => h('b', null, item.get()),
    ),
    root,
  );
  assert.throws(() => rows.set([1, 1]), /Duplicate/);
  assert.equal(root.textContent, '12');
  rows.set([2]);
  assert.equal(root.textContent, '2');
  app.unmount();
  window.close();
});
test('SSR escapes untrusted text and attributes and releases effects', () => {
  const n = cell(1);
  let runs = 0,
    cleaned = 0;
  const html = renderToString(
    scene(() => {
      effect(() => {
        n.get();
        runs++;
      });
      onCleanup(() => cleaned++);
      return h('p', { title: '"<>&', hidden: false, 'aria-hidden': false }, '<img onerror=x>', () =>
        n.get(),
      );
    }),
  );
  assert.ok(html.includes('title="&quot;&lt;&gt;&amp;"'));
  assert.ok(html.includes('aria-hidden="false"'));
  assert.ok(html.includes('&lt;img onerror=x&gt;'));
  assert.equal(cleaned, 1);
  n.set(2);
  assert.equal(runs, 1);
});
test('SSR and hydration reuse elements and attach live events/computations', () => {
  const n = cell(1),
    rows = cell(['a', 'b']);
  const view = scene(() => {
    const double = derive(() => n.get() * 2);
    return h(
      'section',
      null,
      h('button', { on: { click: () => n.update((v) => v + 1) } }, 'Value:', () => double.get()),
      each(
        rows.get,
        (row) => row,
        (row, index) => h('i', null, () => row.get() + index.get()),
      ),
      when(
        () => n.get() > 1,
        () => h('strong', null, 'yes'),
      ),
    );
  });
  const { root, window } = dom(renderToString(view));
  const section = root.querySelector('section'),
    button = root.querySelector('button'),
    a = root.querySelector('i');
  const app = hydrate(view, root);
  assert.equal(root.querySelector('section'), section);
  button.dispatchEvent(new window.MouseEvent('click'));
  assert.equal(button.textContent, 'Value:4');
  assert.equal(root.querySelector('strong').textContent, 'yes');
  rows.set(['b', 'a', 'c']);
  assert.equal(root.querySelectorAll('i')[1], a);
  assert.equal(root.querySelectorAll('i')[1].textContent, 'a1');
  app.unmount();
  n.set(4);
  assert.equal(root.childNodes.length, 0);
  window.close();
});
test('hydrate consumes adjacent parser-merged text, voids and empty dynamic regions', () => {
  const n = cell('');
  const view = h('div', null, 'a', 'b', 0, h('br'), () => n.get(), false, null);
  const { root, window } = dom(renderToString(view));
  const app = hydrate(view, root);
  assert.equal(root.textContent, 'ab0');
  n.set('hello');
  assert.equal(root.textContent, 'ab0hello');
  n.set('');
  assert.equal(root.textContent, 'ab0');
  app.unmount();
  window.close();
});
test('hydrate reports mismatched tags, attributes, text, children and markers', () => {
  for (const html of [
    '<!--s--><b></b><!--/s-->',
    '<!--s--><p id="bad">ok</p><!--/s-->',
    '<!--s--><p id="good">bad</p><!--/s-->',
    '<!--s--><p id="good">ok<i></i></p><!--/s-->',
    '<p id="good">ok</p>',
  ]) {
    const { root, window } = dom(html);
    assert.throws(() => hydrate(h('p', { id: 'good' }, 'ok'), root), /Hydration mismatch/);
    window.close();
  }
});
test('context remains isolated across dynamic siblings in SSR and hydration', () => {
  const token = context('default');
  const view = h(
    'div',
    null,
    () => {
      provide(token, 'inside');
      return h('b', null, inject(token));
    },
    scene(() => h('i', null, inject(token))),
  );
  const { root, window } = dom(renderToString(view));
  const app = hydrate(view, root);
  assert.equal(root.textContent, 'insidedefault');
  app.unmount();
  window.close();
});
test('invalid/raw HTML APIs and invalid attributes/styles throw', () => {
  assert.throws(() => h('script'), /Unsupported/);
  assert.throws(() => h('input', null, 'child'), /children/);
  for (const props of [
    { onclick: 'alert(1)' },
    { innerHTML: '<b>' },
    { title: {} },
    { disabled: 'true' },
    { class: 'a', className: 'b' },
    { style: { 'bad prop': 'x' } },
  ]) {
    assert.throws(() => renderToString(h('div', props)), TypeError);
  }
});
test('nested top-level regions and lists stay attached after fragment insertion', () => {
  const n = cell(0),
    rows = cell([1, 2]);
  const { root, window } = dom();
  const app = mount(
    () => [
      () => () => n.get(),
      each(
        rows.get,
        (n) => n,
        (item) => () => item.get(),
      ),
    ],
    root,
  );
  n.set(3);
  rows.set([2, 3]);
  assert.equal(root.textContent, '323');
  app.unmount();
  window.close();
});
test('replacing a region removes rows added after initial rendering', () => {
  for (const hydrating of [false, true]) {
    const show = cell(true),
      rows = cell([1]);
    const view = h(
      'div',
      null,
      when(show.get, () =>
        each(
          rows.get,
          (n) => n,
          (item) => h('b', null, () => item.get()),
        ),
      ),
      h('i', null, 'outside'),
    );
    const { root, window } = dom(hydrating ? renderToString(view) : '');
    const app = hydrating ? hydrate(view, root) : mount(view, root);
    rows.set([1, 2, 3]);
    assert.equal(root.querySelectorAll('b').length, 3);
    show.set(false);
    assert.equal(root.querySelectorAll('b').length, 0);
    assert.equal(root.textContent, 'outside');
    app.unmount();
    window.close();
  }
});
test('element actions run after connection, skip SSR and clean up once', () => {
  const visible = cell(false);
  const { root, window } = dom();
  let actions = 0,
    cleanups = 0;
  const view = when(visible.get, () =>
    h('input', {
      use(element) {
        assert.equal(element.isConnected, true);
        actions++;
        element.focus();
        return () => cleanups++;
      },
    }),
  );
  renderToString(view);
  assert.equal(actions, 0);
  const app = mount(view, root);
  visible.set(true);
  assert.equal(actions, 1);
  assert.equal(window.document.activeElement, root.querySelector('input'));
  visible.set(false);
  assert.equal(cleanups, 1);
  app.unmount();
  window.close();
});
test('failed list initialization cleans earlier successful row scopes', () => {
  const { root, window } = dom();
  let cleaned = 0;
  assert.throws(
    () =>
      mount(
        each(
          () => [1, 2],
          (n) => n,
          (item) => {
            onCleanup(() => cleaned++);
            if (item.get() === 2) throw new Error('row failed');
            return 'first';
          },
        ),
        root,
      ),
    /row failed/,
  );
  assert.equal(cleaned, 2);
  assert.equal(root.childNodes.length, 0);
  window.close();
});
test('unchanged keyed order performs zero child-list mutations for 1000 rows', () => {
  const initial = Array.from({ length: 1000 }, (_, id) => ({ id, text: String(id) }));
  const rows = cell(initial);
  const { root, window } = dom();
  const app = mount(
    h(
      'ul',
      null,
      each(
        rows.get,
        (row) => row.id,
        (row) => h('li', null, () => row.get().text),
      ),
    ),
    root,
  );
  const elements = [...root.querySelectorAll('li')];
  const observer = new window.MutationObserver(() => {});
  observer.observe(root, { childList: true, subtree: true });
  rows.set([...initial]);
  assert.equal(observer.takeRecords().length, 0);
  rows.set([...initial].reverse());
  assert.equal(root.querySelectorAll('li')[999], elements[0]);
  observer.disconnect();
  app.unmount();
  window.close();
});
test('CommonJS and ESM runtime exports match; import/SSR do not need browser globals', () => {
  const cjs = createRequire(import.meta.url)('../dist/cjs/index.js');
  assert.equal(cjs.renderToString(cjs.h('p', null, 'hello')), '<!--s--><p>hello</p><!--/s-->');
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    for (const name of ['window', 'document', 'navigator']) {
      Object.defineProperty(globalThis, name, { get() { throw new Error('browser global'); } });
    }
    const api = await import(${JSON.stringify(new URL('../dist/esm/index.js', import.meta.url).href)});
    console.log(JSON.stringify(Object.keys(api).sort()));
    console.log(api.renderToString(api.h('p', null, 'server')));
  `,
    ],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n');
  assert.deepEqual(JSON.parse(output[0]), Object.keys(cjs).sort());
  assert.equal(output[1], '<!--s--><p>server</p><!--/s-->');
});
