import { cell, currentOwner, onCleanup } from './reactive.js';
import type { Cleanup, Readable } from './reactive.js';
import { h } from './view.js';
import type { Props, View } from './view.js';

export interface RouteMatch {
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly hash: string;
  readonly path: string;
}
export interface Route {
  path: string;
  view: (match: RouteMatch) => View;
}
export interface Router {
  readonly path: Readable<string>;
  navigate(path: string, options?: { replace?: boolean }): void;
  connect(window: Window): Cleanup;
  outlet(routes: readonly Route[], fallback?: () => View): View;
  link(path: string, props?: Props, ...children: View[]): View;
}
function localPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u0020]/.test(path)) {
    throw new TypeError('Navigation requires an absolute local path, such as /projects?page=2.');
  }
  const parsed = new URL(path, 'http://scenes.invalid');
  return parsed.pathname + parsed.search + parsed.hash;
}
export function matchRoute(pattern: string, path: string): RouteMatch | null {
  if (!pattern.startsWith('/') || pattern.includes('?') || pattern.includes('#')) {
    throw new TypeError('Route patterns must start with / and cannot contain query/hash parts.');
  }
  const url = new URL(localPath(path), 'http://scenes.invalid');
  const parts = pattern.split('/').slice(1);
  const names = new Set<string>();
  for (const [index, part] of parts.entries()) {
    if (part === '*' && index !== parts.length - 1)
      throw new TypeError('A wildcard must be the last route segment.');
    if (part.startsWith(':')) {
      const name = part.slice(1);
      if (!/^[a-zA-Z_]\w*$/.test(name) || names.has(name))
        throw new TypeError('Invalid or duplicate route parameter.');
      names.add(name);
    }
  }
  const actual = url.pathname.split('/').slice(1);
  const params: Record<string, string> = Object.create(null);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part === '*') {
      params['*'] = decodeURIComponent(actual.slice(i).join('/'));
      return { params, query: url.searchParams, hash: url.hash, path: url.pathname };
    }
    if (actual[i] === undefined) return null;
    if (part.startsWith(':')) {
      const name = part.slice(1);
      params[name] = decodeURIComponent(actual[i]!);
    } else if (part !== actual[i]) return null;
  }
  return parts.length === actual.length
    ? { params, query: url.searchParams, hash: url.hash, path: url.pathname }
    : null;
}
export function createRouter(initialPath = '/'): Router {
  const path = cell(localPath(initialPath));
  let browser: Window | undefined;
  const router: Router = {
    path: { get: path.get },
    navigate(next, options = {}) {
      const target = localPath(next);
      if (browser)
        browser.history[options.replace ? 'replaceState' : 'pushState'](null, '', target);
      path.set(target);
    },
    connect(window) {
      if (browser) throw new Error('Router already connected. Disconnect before reconnecting.');
      browser = window;
      const sync = () =>
        path.set(
          localPath(window.location.pathname + window.location.search + window.location.hash),
        );
      window.addEventListener('popstate', sync);
      let stopped = false;
      const disconnect = () => {
        if (stopped) return;
        stopped = true;
        window.removeEventListener('popstate', sync);
        browser = undefined;
      };
      if (currentOwner()) onCleanup(disconnect);
      try {
        sync();
      } catch (error) {
        disconnect();
        throw error;
      }
      return disconnect;
    },
    outlet(routes, fallback = () => h('p', null, 'Page not found')) {
      return () => {
        const value = path.get();
        for (const route of routes) {
          const match = matchRoute(route.path, value);
          if (match) return route.view(match);
        }
        return fallback();
      };
    },
    link(target, props = {}, ...children) {
      const href = localPath(target);
      return h(
        'a',
        {
          ...props,
          href,
          on: {
            ...props.on,
            click(event) {
              props.on?.['click']?.(event);
              const mouse = event as MouseEvent;
              const anchor = event.currentTarget as HTMLAnchorElement | null;
              if (
                event.defaultPrevented ||
                mouse.button !== 0 ||
                mouse.metaKey ||
                mouse.ctrlKey ||
                mouse.shiftKey ||
                mouse.altKey ||
                anchor?.hasAttribute('download') ||
                (anchor?.target && anchor.target.toLowerCase() !== '_self')
              )
                return;
              event.preventDefault();
              router.navigate(href);
            },
          },
        },
        ...children,
      );
    },
  };
  return router;
}
