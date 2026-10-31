# @lp-labs/scenes

A small, independent frontend framework for browser applications, server rendering and hydration. **Zero runtime dependencies. No React/Vue/Angular peer, virtual DOM, JSX transform or required template compiler.**

Scenes teaches one rule: **cells hold values, getters describe change, scenes own lifetimes.** A scene runs its setup once per appearance. Only the getters that read changed cells update; a scene is not repeatedly called like a render loop.

This is an early framework release, not a feature-for-feature replacement for established frameworks or their ecosystems. Read [limitations](#limitations) before choosing it for a production application. The implementation is independently authored; similarities in general reactive programming concepts are not a claim of unprecedented invention.

## Contents

- [Installation](#installation)
- [Five-minute introduction](#five-minute-introduction)
- [State and derived values](#state-and-derived-values)
- [Scenes, lifecycle and context](#scenes-lifecycle-and-context)
- [HTML, events and customization](#html-events-and-customization)
- [Conditional views and keyed collections](#conditional-views-and-keyed-collections)
- [Routing](#routing)
- [Forms](#forms)
- [Async resources](#async-resources)
- [Server rendering and hydration](#server-rendering-and-hydration)
- [Complete universal application](#complete-universal-application)
- [API reference](#api-reference)
- [Performance and errors](#performance-and-errors)
- [Compatibility and limitations](#limitations)

## Installation

```sh
npm install @lp-labs/scenes
```

In an existing browser application, import the package through your bundler's standard npm resolution. TypeScript declarations are included; TypeScript is optional for consumers. No framework plugins are required.

```js
import { cell, h, scene, mount } from '@lp-labs/scenes';
```

Node supports both ESM and CommonJS:

```js
const { h, renderToString } = require('@lp-labs/scenes');
console.log(renderToString(h('p', null, 'Hello')));
```

Use one module format and one installed copy per application. The ESM and CommonJS builds have separate reactive runtimes; do not pass cells/scenes between them.

For browsers without a bundler, serve the package's **entire `dist/esm` directory** as static modules and map the package name with an import map:

```html
<script type="importmap">
  {"imports":{"@lp-labs/scenes":"/vendor/scenes/index.js"}}
</script>
<div id="app"></div>
<script type="module" src="/app.js"></script>
```

Keep the sibling module files together. Do not serve the CommonJS build to browsers. The complete example below shows a consumer-owned static module server; no CDN is required.

## Five-minute introduction

Place `<div id="app"></div>` in your HTML, then load this JavaScript as a module through your bundler or import map:

```js
import { cell, h, scene, mount } from '@lp-labs/scenes';

const Counter = (start = 0) => scene(() => {
  const count = cell(start);
  return h('section', { class: 'counter' },
    h('h1', null, 'A scene, not a render loop'),
    h('p', null, 'Count: ', () => count.get()),
    h('button', {
      type: 'button',
      on: { click: () => count.update((value) => value + 1) },
    }, 'Increment'),
  );
});

const app = mount(Counter(0), document.querySelector('#app'));
// Later, when this application is permanently removed:
// app.unmount();
```

Learn these distinctions:

| Expression | Meaning |
| --- | --- |
| `cell(0)` | Mutable state with `get`, `set` and `update` |
| `count.get()` | Read the value now; outside a tracked getter this is a snapshot |
| `() => count.get()` | A tracked view or attribute binding |
| `scene(() => ...)` | An owned setup boundary with automatic cleanup |
| `h('div', props, ...children)` | An HTML description, created without accessing the DOM |

`h('p', null, count.get())` deliberately renders a snapshot. Use a getter for live output. Components are ordinary functions returning `View`; wrap stateful component setup in `scene`.

## State and derived values

```js
import { cell, derive, effect, batch, untrack, createScope } from '@lp-labs/scenes';

const scope = createScope(() => {
  const price = cell(10);
  const quantity = cell(2);
  const total = derive(() => price.get() * quantity.get());
  effect(() => { console.log('Total:', total.get()); });

  batch(() => {
    price.set(12);
    quantity.update((value) => value + 1);
  });
  console.log(untrack(total.get)); // 36, without collecting a dependency
});
scope.dispose();
```

- `cell<T>(initial)` compares writes with `Object.is`. Replace objects and arrays rather than mutating them in place. There is no deep proxying.
- `update(updater)` receives an untracked current value. It is not a dependency-producing read.
- `derive(compute)` eagerly computes once, tracks dynamic dependencies and returns `{ get, dispose }`. It has no setter. Keep computations pure.
- `effect(callback)` runs immediately and synchronously after dependency changes. Return a cleanup function or `undefined`; returning any other value throws.
- Every effect run cleans its previous owned effects and cleanup handlers before collecting new dependencies.
- `batch(fn)` delays reactive work until the outermost synchronous batch ends. It does not roll back writes. Derived reads inside the batch can still hold their pre-flush values; read them after it ends.
- Computations settle before ordinary effects in the flush queue. There is no concurrent or frame-based scheduler.
- `untrack(fn)` executes without collecting dependencies.
- `createScope(fn)` returns `{ value, dispose }`, useful outside a mounted application.

Effects and derived values created inside a scene/scope are disposed automatically. Outside one, retain and invoke the returned disposer. Disposed derived values retain their last result and no longer recompute.

Tracking is synchronous. Reads after `await`, in timers, and in event handlers do not subscribe the original effect. Do not make an effect callback `async`; launch an async operation explicitly and handle its rejection.

## Scenes, lifecycle and context

```js
import { scene, h, onCleanup, context, provide, inject } from '@lp-labs/scenes';

const Theme = context('light');
const Badge = () => scene(() => h('span', { class: `theme-${inject(Theme)}` }, 'Ready'));
const Page = () => scene(() => {
  provide(Theme, 'dark');
  onCleanup(() => { console.log('Page removed'); });
  return h('main', null,
    Badge(),
    h('input', {
      'aria-label': 'Search',
      use(element) {
        element.focus();
        const timer = setInterval(() => { console.log('Still mounted'); }, 5000);
        return () => clearInterval(timer);
      },
    }),
  );
});
```

- `scene(setup)` creates a lazy view boundary. Setup runs once when mounted/hydrated, not when the descriptor is constructed.
- `onCleanup(fn)` requires a live scene, effect or explicit scope. Cleanup is idempotently owned, runs in reverse registration order and is not dependency-tracked.
- `use(element)` is an element action: it runs after the enclosing DOM insertion/hydration transaction, never during server rendering. Return cleanup for observers, widgets or listeners. Focus/measurement require the app container to be connected.
- `context(defaultValue)` creates a typed token. `provide(token, value)` sets it in the current scope; `inject(token)` walks parents or returns the default.
- For reactive context, provide a cell and read it from a getter. Context values themselves are not reactive.
- Lifecycle ownership is synchronous. If you create an effect later in a timer, keep its disposer; it does not automatically inherit the earlier scene.
- Server setup and ordinary effects run during SSR and are immediately cleaned up. Keep DOM-only work in `use`, and never start persistent external side effects during rendering.

Scenes do not have hook-position rules. Descriptors may be reused, but each mounted occurrence gets a new owner. To isolate state per component instance, allocate it inside its scene setup, not at module scope.

## HTML, events and customization

`h(tag, propsOrNull, ...children)` accepts lowercase HTML/custom-element names and produces a `View`. Children may be text, numbers, arrays, scenes, lists or getter functions. `null`, `undefined`, booleans and empty strings render nothing.

```js
h('button', {
  id: 'save',
  className: () => saving.get() ? 'button busy' : 'button',
  disabled: saving.get,
  'aria-busy': saving.get,
  'data-purpose': 'save',
  style: () => ({ backgroundColor: '#2456d6', padding: '0.5rem 1rem', '--scale': 1 }),
  on: {
    click(event) { event.preventDefault(); save(); },
    keydown(event) { console.log(event.key); },
  },
}, 'Save');
```

In TypeScript, event handlers are contextually typed as `Event`; narrow to `KeyboardEvent`, `MouseEvent`, etc. before using subtype-specific members. Attribute names are open-ended for custom elements and `data-*`/`aria-*`; unsupported runtime values throw instead of being silently coerced.

### Attribute rules

- Attribute values are `string | number | boolean | null | undefined`, or getters returning them. Null/undefined remove the attribute.
- `className` aliases `class`; `htmlFor` aliases `for`. Supplying both aliases throws.
- Known HTML boolean attributes such as `disabled`, `checked`, `selected`, `required` and `hidden` require booleans. False removes them. ARIA/data booleans become the strings `"true"` / `"false"`.
- `value`, `checked` and `selected` also synchronize their DOM properties. Input values are strings; this is not a generic custom-element property binding mechanism.
- `style` is an object or getter returning one. Camel case becomes kebab case; CSS custom properties work. Numbers are written literally: **units are not appended**. Use `'12px'`, not `12`, for lengths.
- Events use `on: { click, input, ... }`, with direct native listeners and normal bubbling. There is no synthetic event layer. For capture/passive/once options, use an element action and native `addEventListener`.
- `use` and `on` are reserved props, not HTML attributes. Event listener maps/actions are fixed for the element's lifetime; read cells inside handlers for current state.
- No built-in CSS, theme or global style reset is injected. Use CSS classes, custom properties, stylesheet files or an external CSS tool of your choice.
- Attribute/text escaping is not URL or CSS sanitization. Validate untrusted navigation URLs, image URLs and style values yourself. An event map, view getter and scene setup are application code, not safe containers for untrusted code.

There is deliberately no `innerHTML`, `outerHTML`, `textContent` or `srcdoc` prop and no string-valued `onclick` support. Use text children, not HTML strings. The current supported HTML subset excludes raw-text/RCDATA tags (`script`, `style`, `textarea`, `title`) and SVG/MathML roots. Put scripts/styles/title in your host document; see limitations.

## Conditional views and keyed collections

```js
import { cell, h, when, each } from '@lp-labs/scenes';

const visible = cell(true);
const rows = cell([{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Lin' }]);
const view = h('section', null,
  when(visible.get, () => h('p', null, 'Visible'), () => h('p', null, 'Hidden')),
  h('ul', null, each(rows.get, (row) => row.id, (row, index) =>
    h('li', { 'data-id': () => row.get().id },
      () => `${index.get() + 1}. ${row.get().name}`,
    ),
  )),
);
rows.set([{ id: 'b', name: 'Lin updated' }, { id: 'a', name: 'Ada' }]);
```

`when(test, yes, no?)` evaluates the selected factory reactively. Default `no` renders nothing. Replacing a branch disposes its scenes and effects.

`each(itemsGetter, key, render)` requires an array and a unique string or finite-number key per row. The row factory receives **read-only cells** for item and index, not snapshots. Its setup runs once per key. Use getters to observe later item/index changes.

Retained keys preserve row element identity and owned state; removed keys clean up. Item changes reuse the row's cells. An unchanged order does not move row ranges. Changed order moves ranges as needed, but browser focus/selection during a move is not guaranteed. Keys must describe entity identity: avoid array indices for reorderable lists.

Duplicate/invalid keys throw before modifying rows. Other render errors are not transactional. Ordinary dynamic view functions replace their entire output on reevaluation; they are not keyed diffing boundaries. Prefer `each` for stable collection identity.

## Routing

```js
import { createRouter, h } from '@lp-labs/scenes';

const router = createRouter('/projects/7?tab=overview');
const view = h('main', null,
  router.link('/projects/7', { class: 'nav-link' }, 'Project'),
  router.outlet([
    { path: '/', view: () => h('h1', null, 'Home') },
    { path: '/projects/:id', view: ({ params, query }) =>
      h('p', null, `Project ${params.id}; tab ${query.get('tab') ?? 'overview'}`) },
    { path: '/files/*', view: ({ params }) => h('p', null, params['*']) },
  ], () => h('h1', null, 'Not found')),
);
// After mounting or hydrating with matching initial state:
const disconnect = router.connect(window);
router.navigate('/projects/8', { replace: true });
// Call disconnect() when permanently leaving this application.
```

- Construction is memory-only and safe on the server. Initial path defaults to `/`.
- `path` is read-only reactive state containing pathname, query and fragment.
- `navigate` accepts only absolute local paths starting with one `/`, not external URLs, whitespace or backslashes. It writes history only while connected.
- `connect(window)` synchronizes the current browser URL and listens to `popstate`. A second simultaneous connection throws. Its returned cleanup is idempotent and is automatically owned if called inside a scene/action.
- Match order is declaration order, first match wins. Literal paths are case-sensitive; trailing slashes are significant. `:name` matches one segment; terminal `*` captures the remaining path. Parameter values are URI-decoded; malformed encoding throws `URIError`.
- `matchRoute(pattern, path)` exposes the same matcher without a router. A match contains `params`, a fresh `URLSearchParams` named `query`, `hash` (including `#`) and pathname `path`; no match returns `null`.
- `outlet` remounts its selected view when the full path changes, including queries/fragments. Put shared layout state outside the outlet.
- `link` creates an ordinary accessible anchor. It intercepts unmodified left clicks unless prevented, targeted elsewhere or marked for download. Supplied `on.click` runs first and may cancel navigation.
- No route nesting DSL, guards, scroll restoration or lazy code splitting is implied. Compose outlets and native `import()` explicitly. Route changes driven by someone else's `pushState` or a bare hash link do not automatically synchronize; navigate through the router.

For SSR, instantiate a new router for every request. Pass its exact initial path to the client and connect **after** hydration.

## Forms

```js
import { createForm, h, cell } from '@lp-labs/scenes';

const message = cell('');
const form = createForm({ email: '', consent: false }, (values) => ({
  email: values.email.includes('@') ? [] : ['Enter an email address.'],
  consent: values.consent ? [] : ['Consent is required.'],
}));
const view = h('form', {
  on: {
    submit(event) {
      event.preventDefault();
      void form.submit(async (values) => {
        const response = await fetch('/subscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(values),
        });
        if (!response.ok) throw new Error(`Subscription failed: ${response.status}`);
      }).then((valid) => {
        if (valid) { form.reset(); message.set('Subscribed'); }
      }).catch((error) => message.set(String(error)));
    },
  },
},
  h('label', { for: 'email' }, 'Email'),
  h('input', { ...form.input('email'), id: 'email', type: 'email' }),
  h('label', null, h('input', form.input('consent')), 'I consent'),
  h('p', { role: 'alert' }, () => (form.errors.get().email ?? []).join(' ')),
  h('button', { type: 'submit', disabled: form.submitting.get }, 'Subscribe'),
  h('p', { role: 'status' }, message.get),
);
```

`createForm(initial, validator?)` supports a flat record of string/boolean fields. Inferred initial `false` becomes mutable `boolean`, not the literal type `false`. Initial defaults are copied. The validator is synchronous and defaults to no errors.

- `fields.name`: a typed mutable cell. `values()` returns a fresh record snapshot.
- `errors.get()`: field names mapped to string arrays. Empty/missing arrays mean valid. Unknown fields or non-array/non-string messages throw.
- `touched.get()`: optional boolean flags by field. `touch(name)` sets one.
- `validate()` stores all errors and returns a boolean.
- `input(name)` returns props for an **input element**: `value`/`input` for strings or checkbox `checked`/`change` for booleans, plus `name` and blur handling. Blur marks touched and validates the whole form.
- `submit(handler)` touches all fields, validates and returns `Promise<boolean>`. Invalid input returns false without calling the handler. Valid submission sets `submitting` until the handler settles. Errors propagate, and concurrent submissions throw.
- `reset(values?)` restores supplied values or copied initial defaults and clears errors/touched. Field names and types must match. Reset during submission throws; reset in the `.then` after completion, not inside the handler.
- Merging `on` props replaces that map; explicitly compose handlers if extending an input binding.

Native browser constraint validation still applies. Use `novalidate: true` on the form if your application wants only its custom validator. Numeric parsing, nested fields, file uploads, select/radio groups and asynchronous/server validation are application-level code, not implicit form features.

## Async resources

```js
import { createResource, cell, effect, h, when } from '@lp-labs/scenes';

const userId = cell('1');
const users = createResource(async (id, signal) => {
  const response = await fetch(`/api/users/${encodeURIComponent(id)}`, { signal });
  if (!response.ok) throw new Error(`User request failed: ${response.status}`);
  return response.json();
});
// Create this effect inside a scene/scope to own it automatically.
const stop = effect(() => {
  void users.load(userId.get()).catch((error) => {
    if (error?.name !== 'AbortError') console.error(error);
  });
});
const view = when(
  () => users.state.get().status === 'error',
  () => h('p', { role: 'alert' }, 'Could not load user.'),
  () => h('p', null, () => {
    const state = users.state.get();
    return state.status === 'ready' ? state.data.name : 'Loading...';
  }),
);
// Outside a scene, later call both stop() and users.dispose().
```

`createResource(loader, { initialData? })` creates no network activity until `load(key)`. State is a discriminated `ResourceState<T>`:

| Status | Fields |
| --- | --- |
| `idle` | `data: T \| undefined` |
| `pending` | previous `data: T \| undefined` |
| `ready` | `data: T` |
| `error` | previous `data: T \| undefined`, `error: unknown` |

`load` aborts the previous request, enters pending, and resolves with the loader result or rejects with its error. Only the newest request updates state, even if an old loader ignores abort. Old promises still resolve/reject normally; they do not get replaced by artificial successes. **Always handle rejections.**

`cancel()` invalidates the request and aborts its signal; state returns to ready if previous data is defined, otherwise idle. `dispose()` also prevents future loads and is automatically registered in a live scope. JavaScript loaders must honor the signal to stop actual work. There is no implicit cache, retry, deduplication, polling or automatic suspense.

For SSR, await `load` before `renderToString`, or pass server-loaded `initialData`. Serialize only safe application data and initialize the client with the same data. The renderer is synchronous and does not await resources.

## Server rendering and hydration

```js
import { h, scene, cell, renderToString, hydrate } from '@lp-labs/scenes';

function createCounter(initial) {
  return scene(() => {
    const count = cell(initial);
    return h('button', { on: { click: () => count.update((n) => n + 1) } },
      'Count: ', () => count.get());
  });
}
// Server:
const html = renderToString(createCounter(0));
// Put html inside the app container in the response.
// Browser, using the same initial value:
// const app = hydrate(createCounter(0), document.querySelector('#app'));
```

`renderToString(view)` emits an HTML fragment including comment boundaries, escapes text/attribute contents, and disposes all render-owned scopes before returning. It emits no document wrapper, CSS, executable scripts or automatic state blob. It does not read browser globals. Create per-request state; do not share mutable module-level cells between users.

`hydrate(view, element)` consumes the existing server DOM, validates node types/tags, text, attributes, children and boundaries, and attaches reactive bindings/events/actions. Matching elements are reused; initial adjacent text nodes may be split because HTML parsers merge them. Later reactive text output is replaced inside its bounded region.

Important requirements:

1. Use identical initial state, route, key order and view structure on server and client. Do not render time/random/locale-dependent values without passing the server result to the client.
2. Keep the `<!--s-->` / `<!--/s-->` comments. HTML minifiers/edge optimizers must not strip them.
3. Keep your HTML valid: write `<tbody>` explicitly for tables and avoid invalid nesting that browsers repair.
4. Hydrate only the container's fragment, not the entire document. No `document`, `window` or DOM-dependent code in shared setup.
5. Attribute-controlled inputs are synchronized to initial state on hydration; pre-hydration user edits are not replayed or preserved.
6. Escape `<`, `>` and `&` in serialized state embedded in a script element. Never interpolate unchecked JSON or user HTML into the host response.

On mismatch, hydration throws. There is **no silent client-render fallback**. Cleanup is attempted, but mismatch handling is not transactional and may leave altered DOM; report the error and explicitly choose to `mount` a fresh application if recovery is appropriate. `mount` clears its container first; never use it to attach to HTML you intend to preserve.

`mount` / `hydrate` return an `App` with idempotent `unmount()`. Unmount disposes owned behavior and removes its root range; do not mutate/remove framework boundary comments yourself. Multiple independent app containers are supported.

## Complete universal application

This three-file npm consumer example uses native browser modules and Node's HTTP server: **no bundler or additional package is needed**. It renders a counter on the server and hydrates it with a working click handler. Use Node 20+ for this example.

Create a consumer directory with a `package.json` containing `"type": "module"`, install Scenes, and create these three files.

**app.js**

```js
import { h, scene, cell } from '@lp-labs/scenes';

export function createApp(seed) {
  return scene(() => {
    const count = cell(seed.count);
    return h('main', null,
      h('h1', null, 'My first Scenes application'),
      h('button', { on: { click: () => count.update((n) => n + 1) } },
        'Count: ', () => count.get()),
    );
  });
}
```

**client.js**

```js
import { hydrate } from '@lp-labs/scenes';
import { createApp } from './app.js';

const seed = JSON.parse(document.querySelector('#seed').textContent);
hydrate(createApp(seed), document.querySelector('#app'));
```

**server.mjs**

```js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { renderToString } from '@lp-labs/scenes';
import { createApp } from './app.js';

const require = createRequire(import.meta.url);
const esm = join(dirname(require.resolve('@lp-labs/scenes/package.json')), 'dist', 'esm');
const allowed = new Set(['index.js', 'reactive.js', 'view.js', 'router.js', 'resource.js', 'form.js']);

createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    let file;
    if (path === '/app.js' || path === '/client.js') {
      file = new URL(`.${path}`, import.meta.url);
    } else if (path.startsWith('/vendor/') && allowed.has(path.slice(8))) {
      file = join(esm, path.slice(8));
    } else if (path !== '/') {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    if (file) {
      const source = await readFile(file);
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end(source);
      return;
    }
    const seed = { count: 0 };
    const state = JSON.stringify(seed)
      .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
    const body = renderToString(createApp(seed));
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>My Scenes app</title>
<script type="importmap">{"imports":{"@lp-labs/scenes":"/vendor/index.js"}}</script>
</head><body><div id="app">${body}</div>
<script id="seed" type="application/json">${state}</script>
<script type="module" src="/client.js"></script></body></html>`);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) response.writeHead(500);
    response.end('Application failed');
  }
}).listen(3000, '127.0.0.1', () => console.log('Open http://127.0.0.1:3000'));
```

Run your consumer application with `node server.mjs` and open `http://127.0.0.1:3000`. Deploy behind a properly configured HTTPS server; this intentionally small example is not an authentication, caching, CSP or production static-file server implementation.

To extend it, add the routing/form/list examples above to `createApp`, keep all initial values deterministic, and connect your router after hydration. The repository also contains a larger counter/task-list/router universal example; the full self-contained npm example above does not require repository access.

## API reference

All runtime APIs are named exports from `@lp-labs/scenes`; there is no default export or global singleton application.

| Export | Signature / result |
| --- | --- |
| `cell` | `<T>(initial: T): Cell<T>` |
| `derive` | `<T>(compute: () => T): Readable<T> & { dispose(): void }` |
| `effect` | `(callback: () => void \| Cleanup): Cleanup` |
| `batch` | `<T>(fn: () => T): T` |
| `untrack` | `<T>(fn: () => T): T` |
| `createScope` | `<T>(fn: () => T): { value: T; dispose(): void }` |
| `onCleanup` | `(cleanup: Cleanup): void` |
| `context` | `<T>(defaultValue: T): Context<T>` |
| `provide` | `<T>(token: Context<T>, value: T): void` |
| `inject` | `<T>(token: Context<T>): T` |
| `h` | `(tag: string, props?: Props \| null, ...children: View[]): View` |
| `scene` | `(setup: () => View): View` |
| `when` | `(test: () => unknown, yes: () => View, no?: () => View): View` |
| `each` | `<T>(items: () => readonly T[], key: (item: T) => string \| number, render: (item: Readable<T>, index: Readable<number>) => View): View` |
| `mount` | `(view: View, container: Element): App` |
| `hydrate` | `(view: View, container: Element): App` |
| `renderToString` | `(view: View): string` |
| `createRouter` | `(initialPath?: string): Router` |
| `matchRoute` | `(pattern: string, path: string): RouteMatch \| null` |
| `createForm` | `<T extends FormValues>(initial: T, validator?): Form<FormShape<T>>` |
| `createResource` | `<K, T>(loader: (key: K, signal: AbortSignal) => Promise<T>, options?: { initialData?: T }): Resource<K, T>` |

Type-only exports: `Cell`, `Readable`, `Cleanup`, `Context`, `View`, `Props`, `Attribute`, `Binding`, `Style`, `App`, `Router`, `Route`, `RouteMatch`, `Form`, `FormValues`, `FormErrors`, `FormShape`, `Resource`, `ResourceState`.

`Readable<T>` exposes `get()`. `Cell<T>` adds `set(value)` and `update(updater)`. `Cleanup` is `() => void`. `Binding<T>` is `T | (() => T)`. `Attribute` is the supported primitive attribute union. `Props` contains open HTML attributes plus typed `on`, `style` and `use`. `Style` maps property names to strings/numbers/null/undefined. `FormShape<T>` widens field literals to string/boolean. `Context<T>` carries a unique symbol and default value; treat tokens as immutable.

## Performance and errors

- Reactive reads use direct subscriptions; writes do not traverse an entire application tree.
- Props and text have individual effects. Keep structural getters narrow: a changed dynamic view recreates its output, while a changed attribute does not recreate its element.
- `each` maintains a key map; unchanged order avoids DOM moves. There is no list virtualization. Paginate/virtualize large collections at the application level.
- Batch related synchronous state writes. Do not wrap network waits in `batch`.
- Stop unused scopes/effects/resources and disconnect manually connected routers.
- SSR is synchronous string rendering, not streaming. Hydration checks the complete initial tree, not partial islands selected automatically.
- No benchmark parity claim is made. Automated DOM tests include a 1,000-row list with zero child-list mutations for an unchanged order; that is a behavioral check, not a real-browser speed guarantee.

Invalid usage throws `TypeError` or `Error`; malformed URL parameter decoding can throw `URIError`. Hydration errors start with `Hydration mismatch:`. An effect recursively updating its running dependencies throws, and a flush exceeding 10,000 reaction executions throws a cycle/limit error. Avoid legitimate batches exceeding this guard.

Cleanup continues through registered handlers even when some throw, then reports an `AggregateError`. Other queued reactions are processed when a reaction throws, then the update error is rethrown (multiple failures use `AggregateError`). A failing update is **not rolled back**. Resource and submit promises reject explicitly. Native event-handler exceptions follow browser event error reporting; there is no global error-swallowing boundary.

Report errors through your application's error UI/monitoring. Recover from a broken render by disposing the application and explicitly mounting a known-safe fallback. Server handlers must catch rendering errors and return an appropriate failure response.

## Limitations

Runtime targets: modern browsers with ES modules, `Map`, `Set`, `AbortController` and modern DOM APIs; server runtime Node 18+. The universal server example targets Node 20+. There is no legacy-browser polyfill layer.

This release includes reactive cells/computations/effects, scopes/context, composable HTML views, native events/actions, conditionals, keyed lists, browser/memory routing, flat forms, explicit async resources, synchronous SSR, strict hydration, ESM/CommonJS and declarations.

It does **not** include:

- Angular/React/Vue API or ecosystem compatibility, JSX, templates, decorators or a compiler.
- Raw HTML injection, raw-text/RCDATA view tags, SVG/MathML rendering, generic DOM-property binding or shadow-root hydration.
- Streaming SSR, suspense, partial/resumable hydration, event replay or automatic server/client code separation.
- A CLI/scaffolder, development server, HMR plugin, devtools, production bundler, test runner or deployment service.
- Built-in i18n, animation/transition engines, portals, virtual scrolling, async error boundaries, route guards or authentication.
- Deep reactive proxies, complex/nested form schemas or an HTTP/cache client.

Use native DOM/browser APIs in element actions for integrations; you own their cleanup and SSR fallback. Do not insert unmanaged children into framework-controlled regions, or hydrate third-party DOM that does not match the scene description. Raw HTML fragments, JSON, CSS, URLs and third-party widgets are separate trust boundaries.

No claim of production hardening, comprehensive accessibility certification, universal browser coverage or legal originality certification is made. The project does not intentionally incorporate source from another frontend framework and has no runtime dependency on one.

## License

[MIT](./LICENSE).

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
