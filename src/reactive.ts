export type Cleanup = () => void;
export interface Readable<T> {
  get(): T;
}
export interface Cell<T> extends Readable<T> {
  set(value: T): void;
  update(updater: (value: T) => T): void;
}

export class Owner {
  cleanups = new Set<Cleanup>();
  contexts = new Map<symbol, unknown>();
  disposed = false;
  constructor(readonly parent: Owner | undefined) {}
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    for (const cleanup of [...this.cleanups].reverse()) {
      try {
        untrack(cleanup);
      } catch (error) {
        errors.push(error);
      }
    }
    this.cleanups.clear();
    if (errors.length) throw new AggregateError(errors, 'Scene cleanup failed.');
  }
}

let owner: Owner | undefined;
let active: Reaction | undefined;
let depth = 0;
let flushing = false;
const pending = new Set<Reaction>();
const computations = new Set<Reaction>();

export function currentOwner(): Owner | undefined {
  return owner;
}
export function owned<T>(next: Owner | undefined, fn: () => T): T {
  const previous = owner;
  owner = next;
  try {
    return fn();
  } finally {
    owner = previous;
  }
}
export function untrack<T>(fn: () => T): T {
  const previous = active;
  active = undefined;
  try {
    return fn();
  } finally {
    active = previous;
  }
}
export function onCleanup(cleanup: Cleanup): void {
  if (!owner || owner.disposed) throw new Error('onCleanup requires a live scene or effect scope.');
  owner.cleanups.add(cleanup);
}
export function createScope<T>(fn: () => T): { value: T; dispose: Cleanup } {
  const parent = owner;
  const next = new Owner(parent);
  const dispose = () => {
    parent?.cleanups.delete(dispose);
    next.dispose();
  };
  parent?.cleanups.add(dispose);
  try {
    return { value: owned(next, fn), dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

interface Source {
  subscribers: Set<Reaction>;
}
class Reaction {
  sources = new Set<Source>();
  scope: Owner | undefined;
  stopped = false;
  running = false;
  constructor(
    readonly fn: () => void | Cleanup,
    readonly parent: Owner | undefined,
    readonly computed = false,
  ) {}
  stop = (): void => {
    if (this.stopped) return;
    this.stopped = true;
    pending.delete(this);
    computations.delete(this);
    this.parent?.cleanups.delete(this.stop);
    this.detach();
    this.scope?.dispose();
  };
  detach(): void {
    for (const source of this.sources) source.subscribers.delete(this);
    this.sources.clear();
  }
  run(): void {
    if (this.stopped) return;
    if (this.running) throw new Error('An effect cannot recursively update its own dependencies.');
    this.running = true;
    const previous = active;
    try {
      this.detach();
      untrack(() => this.scope?.dispose());
      this.scope = new Owner(this.parent);
      active = this;
      const cleanup = owned(this.scope, this.fn);
      if (cleanup !== undefined) {
        if (typeof cleanup !== 'function')
          throw new TypeError('An effect must return a cleanup function or undefined.');
        this.scope.cleanups.add(cleanup);
      }
    } finally {
      active = previous;
      this.running = false;
    }
  }
}
function flush(): void {
  if (depth || flushing) return;
  flushing = true;
  const errors: unknown[] = [];
  let count = 0;
  try {
    while (pending.size || computations.size) {
      if (++count > 10000) {
        pending.clear();
        computations.clear();
        errors.push(new Error('Reactive update limit exceeded; check for a cycle.'));
        break;
      }
      const queue = computations.size ? computations : pending;
      const reaction = queue.values().next().value;
      if (!reaction) break;
      queue.delete(reaction);
      try {
        reaction.run();
      } catch (error) {
        errors.push(error);
      }
    }
  } finally {
    flushing = false;
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, 'Reactive updates failed.');
}
export function batch<T>(fn: () => T): T {
  depth++;
  try {
    return fn();
  } finally {
    depth--;
    flush();
  }
}
export function cell<T>(initial: T): Cell<T> {
  let value = initial;
  const source: Source = { subscribers: new Set() };
  const get = (): T => {
    if (active) {
      source.subscribers.add(active);
      active.sources.add(source);
    }
    return value;
  };
  const set = (next: T): void => {
    if (Object.is(value, next)) return;
    value = next;
    for (const reaction of source.subscribers)
      (reaction.computed ? computations : pending).add(reaction);
    flush();
  };
  return { get, set, update: (updater) => set(updater(untrack(get))) };
}
function startEffect(fn: () => void | Cleanup, computed = false): Cleanup {
  if (owner?.disposed) throw new Error('Cannot create an effect in a disposed scene.');
  const reaction = new Reaction(fn, owner, computed);
  owner?.cleanups.add(reaction.stop);
  try {
    reaction.run();
  } catch (error) {
    reaction.stop();
    throw error;
  }
  return reaction.stop;
}
export function effect(fn: () => void | Cleanup): Cleanup {
  return startEffect(fn);
}
export function derive<T>(compute: () => T): Readable<T> & { dispose: Cleanup } {
  const output = cell<T | undefined>(undefined);
  const dispose = startEffect(() => output.set(compute()), true);
  return { get: () => output.get() as T, dispose };
}
export interface Context<T> {
  readonly key: symbol;
  readonly defaultValue: T;
}
export function context<T>(defaultValue: T): Context<T> {
  return { key: Symbol('scene-context'), defaultValue };
}
export function provide<T>(token: Context<T>, value: T): void {
  if (!owner || owner.disposed) throw new Error('provide requires a live scene scope.');
  owner.contexts.set(token.key, value);
}
export function inject<T>(token: Context<T>): T {
  for (let cursor = owner; cursor; cursor = cursor.parent) {
    if (cursor.contexts.has(token.key)) return cursor.contexts.get(token.key) as T;
  }
  return token.defaultValue;
}
