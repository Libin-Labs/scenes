import { Owner, batch, cell, currentOwner, effect, onCleanup, owned, untrack } from './reactive.js';
import type { Cleanup, Readable } from './reactive.js';

export type Binding<T> = T | (() => T);
export type Attribute = string | number | boolean | null | undefined;
export type Style = Readonly<Record<string, string | number | null | undefined>>;
export interface Props {
  [attribute: string]: unknown;
  on?: Readonly<Record<string, (event: Event) => void>>;
  style?: Binding<Style>;
  use?: (element: HTMLElement) => void | Cleanup;
}
interface ElementView {
  kind: 'element';
  tag: string;
  props: Props;
  children: View[];
}
interface SceneView {
  kind: 'scene';
  setup: () => View;
}
interface ListView {
  kind: 'list';
  items: () => readonly unknown[];
  key: (item: unknown) => string | number;
  render: (item: Readable<unknown>, index: Readable<number>) => View;
}
export type View =
  | string
  | number
  | boolean
  | null
  | undefined
  | ElementView
  | SceneView
  | ListView
  | readonly View[]
  | (() => View);

const voidTags = new Set(
  'area base br col embed hr img input link meta param source track wbr'.split(' '),
);
const forbiddenTags = new Set(['script', 'style', 'textarea', 'title', 'svg', 'math']);
const reserved = new Set(['on', 'use', 'style']);
const booleanAttrs = new Set(
  'allowfullscreen async autofocus autoplay checked controls default defer disabled formnovalidate hidden inert ismap itemscope loop multiple muted nomodule novalidate open playsinline readonly required reversed selected'.split(
    ' ',
  ),
);
const read = <T>(value: Binding<T>): T =>
  typeof value === 'function' ? (value as () => T)() : value;
let actions: (() => void)[] | undefined;
function domTransaction<T>(fn: () => T): T {
  if (actions) return fn();
  const queue: (() => void)[] = [];
  actions = queue;
  let value: T;
  try {
    value = fn();
  } finally {
    actions = undefined;
  }
  for (const action of queue) action();
  return value;
}

export function h(tag: string, props: Props | null = null, ...children: View[]): View {
  if (!/^[a-z][a-z0-9-]*$/.test(tag) || forbiddenTags.has(tag)) {
    throw new TypeError(
      `Unsupported HTML tag: ${tag}. See the supported HTML subset in the documentation.`,
    );
  }
  if (voidTags.has(tag) && children.length) throw new TypeError(`${tag} cannot have children.`);
  return { kind: 'element', tag, props: props ?? {}, children };
}
export function scene(setup: () => View): View {
  return { kind: 'scene', setup };
}
export function when(test: () => unknown, yes: () => View, no: () => View = () => null): View {
  return () => (test() ? yes() : no());
}
export function each<T>(
  items: () => readonly T[],
  key: (item: T) => string | number,
  render: (item: Readable<T>, index: Readable<number>) => View,
): View {
  return {
    kind: 'list',
    items,
    key: (item) => key(item as T),
    render: (item, index) => render(item as Readable<T>, index),
  };
}
function attrName(name: string): string {
  if (name === 'className') return 'class';
  if (name === 'htmlFor') return 'for';
  if (
    !/^[a-zA-Z_][\w.:-]*$/.test(name) ||
    /^on/i.test(name) ||
    ['innerhtml', 'outerhtml', 'textcontent', 'srcdoc'].includes(name.toLowerCase())
  ) {
    throw new TypeError(`Unsupported attribute: ${name}. Use on for event handlers.`);
  }
  return name.toLowerCase();
}
function attrValue(name: string, value: unknown): string | null {
  if (value == null || (value === false && booleanAttrs.has(name))) return null;
  if (booleanAttrs.has(name)) {
    if (typeof value !== 'boolean') throw new TypeError(`${name} requires a boolean.`);
    return value ? '' : null;
  }
  if (!['string', 'number', 'boolean'].includes(typeof value)) {
    throw new TypeError(`Attribute ${name} requires a primitive value or getter.`);
  }
  return String(value);
}
function styleText(style: Style): string {
  if (!style || typeof style !== 'object' || Array.isArray(style))
    throw new TypeError('style requires an object.');
  return Object.entries(style)
    .filter(([, value]) => value != null)
    .map(([name, value]) => {
      if (
        !/^(--[\w-]+|[a-zA-Z][\w-]*)$/.test(name) ||
        !['string', 'number'].includes(typeof value)
      ) {
        throw new TypeError('Invalid style property or value.');
      }
      const css = name.startsWith('--')
        ? name
        : name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      return `${css}:${value};`;
    })
    .join('');
}
function attributes(props: Props): [string, () => string | null][] {
  const result: [string, () => string | null][] = [];
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(props)) {
    if (reserved.has(name)) continue;
    const normalized = attrName(name);
    if (seen.has(normalized)) throw new TypeError(`Duplicate attribute: ${normalized}.`);
    seen.add(normalized);
    result.push([normalized, () => attrValue(normalized, read(value))]);
  }
  if (props.style !== undefined) result.push(['style', () => styleText(read(props.style!))]);
  return result;
}
function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );
}
function keys(view: ListView): { item: unknown; key: string | number; index: number }[] {
  const items = view.items();
  if (!Array.isArray(items)) throw new TypeError('each requires an array.');
  const seen = new Set<string | number>();
  return items.map((item, index) => {
    const key = view.key(item);
    if (
      (typeof key !== 'string' && typeof key !== 'number') ||
      (typeof key === 'number' && !Number.isFinite(key))
    )
      throw new TypeError('List keys must be strings or finite numbers.');
    if (seen.has(key)) throw new Error(`Duplicate list key: ${key}.`);
    seen.add(key);
    return { item, key, index };
  });
}
function serialize(view: View): string {
  if (view == null || typeof view === 'boolean') return '';
  if (typeof view === 'string' || typeof view === 'number')
    return view === '' ? '' : escape(String(view));
  if (typeof view === 'function') {
    const owner = new Owner(currentOwner());
    try {
      return owned(owner, () => `<!--s-->${serialize(view())}<!--/s-->`);
    } finally {
      owner.dispose();
    }
  }
  if (Array.isArray(view)) return view.map(serialize).join('');
  if (!('kind' in view)) throw new TypeError('Invalid view.');
  if (view.kind === 'scene') {
    const owner = new Owner(currentOwner());
    try {
      return owned(owner, () => `<!--s-->${serialize(view.setup())}<!--/s-->`);
    } finally {
      owner.dispose();
    }
  }
  if (view.kind === 'list')
    return `<!--s-->${keys(view)
      .map(
        ({ item, index }) =>
          `<!--s-->${serialize(scene(() => view.render({ get: () => item }, { get: () => index })))}<!--/s-->`,
      )
      .join('')}<!--/s-->`;
  const attrs = attributes(view.props)
    .map(([name, get]) => {
      const value = get();
      return value === null ? '' : ` ${name}="${escape(value)}"`;
    })
    .join('');
  return `<${view.tag}${attrs}>${voidTags.has(view.tag) ? '' : `${view.children.map(serialize).join('')}</${view.tag}>`}`;
}
export function renderToString(view: View): string {
  const owner = new Owner(undefined);
  try {
    return untrack(() => owned(owner, () => `<!--s-->${serialize(view)}<!--/s-->`));
  } finally {
    owner.dispose();
  }
}

interface Cursor {
  node: ChildNode | null;
}
function mismatch(message: string): never {
  throw new Error(`Hydration mismatch: ${message}`);
}
function claim(cursor: Cursor, test: (node: ChildNode) => boolean, expected: string): ChildNode {
  const node = cursor.node;
  if (!node || !test(node)) return mismatch(expected);
  cursor.node = node.nextSibling;
  return node;
}
function comment(parent: Node, before: Node | null, label: string, cursor?: Cursor): Comment {
  if (cursor)
    return claim(
      cursor,
      (node) => node.nodeType === 8 && node.nodeValue === label,
      `expected <!--${label}-->`,
    ) as Comment;
  const node = parent.ownerDocument!.createComment(label);
  parent.insertBefore(node, before);
  return node;
}
function removeRange(start: Node, end: Node): void {
  let node: Node | null = start;
  while (node) {
    const next: Node | null = node.nextSibling;
    node.parentNode?.removeChild(node);
    if (node === end) break;
    node = next;
  }
}
function region(
  parent: Node,
  before: Node | null,
  run: (end: Comment | null, cursor: Cursor | undefined, start: Comment) => void,
  cursor?: Cursor,
): { start: Comment; end: Comment } {
  const start = comment(parent, before, 's', cursor);
  let end: Comment;
  if (cursor) {
    run(null, cursor, start);
    end = comment(parent, before, '/s', cursor);
  } else {
    end = comment(parent, before, '/s');
    run(end, undefined, start);
  }
  return { start, end };
}
function render(view: View, parent: Node, before: Node | null, cursor?: Cursor): void {
  if (view == null || typeof view === 'boolean' || view === '') return;
  if (typeof view === 'string' || typeof view === 'number') {
    const text = String(view);
    if (cursor) {
      // HTML parsers merge adjacent text nodes; consume only this view's prefix.
      const node = cursor.node;
      if (!node || node.nodeType !== 3 || !node.nodeValue?.startsWith(text))
        mismatch(`expected text ${JSON.stringify(text)}`);
      if (node.nodeValue!.length > text.length) (node as Text).splitText(text.length);
      cursor.node = node.nextSibling;
    } else parent.insertBefore(parent.ownerDocument!.createTextNode(text), before);
    return;
  }
  if (Array.isArray(view)) {
    for (const child of view) render(child, parent, before, cursor);
    return;
  }
  if (typeof view === 'function') {
    let first = true;
    let end: Comment | null = null;
    const range = region(
      parent,
      before,
      (boundary, initialCursor, start) => {
        end = boundary;
        effect(() =>
          domTransaction(() => {
            const output = view();
            const fragment = parent.ownerDocument!.createDocumentFragment();
            if (first && initialCursor) render(output, parent, before, initialCursor);
            else {
              untrack(() => render(output, fragment, null));
              (end?.parentNode ?? parent).insertBefore(fragment, end);
            }
            first = false;
            onCleanup(() => {
              if (!end) return;
              let node: ChildNode | null = start.nextSibling;
              while (node && node !== end) {
                const next: ChildNode | null = node.nextSibling;
                node.parentNode?.removeChild(node);
                node = next;
              }
            });
          }),
        );
      },
      cursor,
    );
    end = range.end;
    return;
  }
  if (!('kind' in view)) throw new TypeError('Invalid view.');
  if (view.kind === 'scene') {
    const owner = new Owner(currentOwner());
    onCleanup(() => owner.dispose());
    owned(owner, () =>
      region(
        parent,
        before,
        (end, inner) => untrack(() => render(view.setup(), parent, end ?? before, inner)),
        cursor,
      ),
    );
    return;
  }
  if (view.kind === 'list') {
    renderList(view, parent, before, cursor);
    return;
  }
  const element = cursor
    ? (claim(
        cursor,
        (node) => node.nodeType === 1 && (node as Element).localName === view.tag,
        `expected <${view.tag}>`,
      ) as HTMLElement)
    : parent.ownerDocument!.createElement(view.tag);
  const attrs = attributes(view.props);
  if (cursor) {
    const expected = attrs
      .map(([name, get]) => [name, untrack(get)] as const)
      .filter(([, value]) => value !== null);
    if (
      element.attributes.length !== expected.length ||
      expected.some(([name, value]) => element.getAttribute(name) !== value)
    )
      mismatch(`attributes on <${view.tag}>`);
  }
  for (const [name, get] of attrs)
    effect(() => {
      const value = get();
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
      if (name === 'value' && 'value' in element && element.value !== (value ?? ''))
        element.value = value ?? '';
      if ((name === 'checked' || name === 'selected') && name in element) {
        Reflect.set(element, name, value !== null);
      }
    });
  for (const [name, handler] of Object.entries(view.props.on ?? {})) {
    if (typeof handler !== 'function') throw new TypeError(`Event ${name} requires a function.`);
    element.addEventListener(name, handler);
    onCleanup(() => element.removeEventListener(name, handler));
  }
  const childCursor = cursor ? { node: element.firstChild } : undefined;
  for (const child of view.children) render(child, element, null, childCursor);
  if (childCursor?.node) mismatch(`unexpected children in <${view.tag}>`);
  if (!cursor) parent.insertBefore(element, before);
  if (view.props.use) {
    const scope = currentOwner();
    if (!scope || !actions) throw new Error('Element actions require a DOM render scope.');
    actions.push(() => {
      if (scope.disposed) return;
      owned(scope, () => {
        const cleanup = untrack(() => view.props.use!(element));
        if (cleanup !== undefined) {
          if (typeof cleanup !== 'function')
            throw new TypeError('An element action must return a cleanup function or undefined.');
          onCleanup(cleanup);
        }
      });
    });
  }
}
function renderList(view: ListView, parent: Node, before: Node | null, cursor?: Cursor): void {
  const owner = currentOwner();
  const entries = new Map<
    string | number,
    {
      item: ReturnType<typeof cell<unknown>>;
      index: ReturnType<typeof cell<number>>;
      scope: Owner;
      start: Comment;
      end: Comment;
    }
  >();
  onCleanup(() => {
    const errors: unknown[] = [];
    for (const entry of entries.values()) {
      try {
        entry.scope.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    entries.clear();
    if (errors.length) throw new AggregateError(errors, 'List cleanup failed.');
  });
  let boundary: Comment | null = null;
  let first = true;
  const range = region(
    parent,
    before,
    (end, initialCursor) => {
      boundary = end;
      effect(() =>
        domTransaction(() => {
          const next = keys(view);
          untrack(() =>
            batch(() => {
              const target = boundary?.parentNode ?? parent;
              const retained = new Set(next.map((row) => row.key));
              for (const [key, entry] of entries)
                if (!retained.has(key)) {
                  entry.scope.dispose();
                  removeRange(entry.start, entry.end);
                  entries.delete(key);
                }
              for (const row of next) {
                let entry = entries.get(row.key);
                if (!entry) {
                  const scope = new Owner(owner);
                  const item = cell(row.item);
                  const index = cell(row.index);
                  try {
                    const innerCursor = first ? initialCursor : undefined;
                    const host = innerCursor
                      ? target
                      : target.ownerDocument!.createDocumentFragment();
                    const range = owned(scope, () =>
                      region(
                        host,
                        innerCursor ? before : null,
                        (end, inner) =>
                          render(
                            scene(() => view.render(item, index)),
                            host,
                            end ?? before,
                            inner,
                          ),
                        innerCursor,
                      ),
                    );
                    if (!innerCursor) target.insertBefore(host, boundary);
                    entry = { item, index, scope, ...range };
                    entries.set(row.key, entry);
                  } catch (error) {
                    scope.dispose();
                    throw error;
                  }
                } else {
                  entry.item.set(row.item);
                  entry.index.set(row.index);
                }
              }
              if (!first || !initialCursor) {
                let anchor: Node | null = boundary;
                for (const row of [...next].reverse()) {
                  const entry = entries.get(row.key)!;
                  if (entry.end.nextSibling === anchor) {
                    anchor = entry.start;
                    continue;
                  }
                  const fragment = parent.ownerDocument!.createDocumentFragment();
                  let node: Node | null = entry.start;
                  while (node) {
                    const nextNode: Node | null = node.nextSibling;
                    fragment.appendChild(node);
                    if (node === entry.end) break;
                    node = nextNode;
                  }
                  target.insertBefore(fragment, anchor);
                  anchor = entry.start;
                }
              }
              first = false;
            }),
          );
        }),
      );
    },
    cursor,
  );
  boundary = range.end;
}
export interface App {
  unmount(): void;
}
function attach(view: View, container: Element, hydrating: boolean): App {
  const owner = new Owner(undefined);
  const cursor = hydrating ? { node: container.firstChild } : undefined;
  if (!hydrating) container.replaceChildren();
  try {
    const range = domTransaction(() => {
      const result = owned(owner, () =>
        region(container, null, (end, inner) => render(view, container, end, inner), cursor),
      );
      if (cursor?.node) mismatch('unexpected root nodes');
      return result;
    });
    return {
      unmount() {
        try {
          owner.dispose();
        } finally {
          removeRange(range.start, range.end);
        }
      },
    };
  } catch (error) {
    owner.dispose();
    if (!hydrating) container.replaceChildren();
    throw error;
  }
}
export function mount(view: View, container: Element): App {
  return attach(view, container, false);
}
export function hydrate(view: View, container: Element): App {
  return attach(view, container, true);
}
