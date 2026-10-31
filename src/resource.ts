import { cell, currentOwner, onCleanup, untrack } from './reactive.js';
import type { Readable } from './reactive.js';

export type ResourceState<T> =
  | { status: 'idle'; data: T | undefined }
  | { status: 'pending'; data: T | undefined }
  | { status: 'ready'; data: T }
  | { status: 'error'; data: T | undefined; error: unknown };
export interface Resource<K, T> {
  readonly state: Readable<ResourceState<T>>;
  load(key: K): Promise<T>;
  cancel(): void;
  dispose(): void;
}
export function createResource<K, T>(
  loader: (key: K, signal: AbortSignal) => Promise<T>,
  options: { initialData?: T } = {},
): Resource<K, T> {
  const state = cell<ResourceState<T>>(
    Object.hasOwn(options, 'initialData')
      ? { status: 'ready', data: options.initialData as T }
      : { status: 'idle', data: undefined },
  );
  let controller: AbortController | undefined;
  let generation = 0;
  let disposed = false;
  const cancel = (): void => {
    generation++;
    controller?.abort();
    controller = undefined;
    const data = untrack(state.get).data;
    state.set(data === undefined ? { status: 'idle', data } : { status: 'ready', data });
  };
  const resource: Resource<K, T> = {
    state: { get: state.get },
    async load(key) {
      if (disposed) throw new Error('Cannot load a disposed resource.');
      controller?.abort();
      const request = new AbortController();
      controller = request;
      const ticket = ++generation;
      state.set({ status: 'pending', data: untrack(state.get).data });
      try {
        const data = await loader(key, request.signal);
        if (ticket === generation && !disposed) state.set({ status: 'ready', data });
        return data;
      } catch (error) {
        if (ticket === generation && !disposed)
          state.set({ status: 'error', data: untrack(state.get).data, error });
        throw error;
      } finally {
        if (ticket === generation) controller = undefined;
      }
    },
    cancel,
    dispose() {
      if (!disposed) {
        disposed = true;
        cancel();
      }
    },
  };
  if (currentOwner()) onCleanup(resource.dispose);
  return resource;
}
