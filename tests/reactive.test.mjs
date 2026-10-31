import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cell,
  derive,
  effect,
  batch,
  untrack,
  createScope,
  onCleanup,
  context,
  provide,
  inject,
} from '../dist/esm/index.js';

test('cells, equality and eager derived values', () => {
  const value = cell(2);
  let runs = 0;
  const double = derive(() => {
    runs++;
    return value.get() * 2;
  });
  assert.equal(double.get(), 4);
  value.set(2);
  assert.equal(runs, 1);
  value.update((n) => n + 1);
  assert.equal(double.get(), 6);
  double.dispose();
  value.set(4);
  assert.equal(double.get(), 6);
});
test('effects dynamically unsubscribe and clean each previous run', () => {
  const flag = cell(true),
    a = cell(1),
    b = cell(2);
  const values = [],
    cleaned = [];
  const stop = effect(() => {
    const value = flag.get() ? a.get() : b.get();
    values.push(value);
    return () => cleaned.push(value);
  });
  flag.set(false);
  a.set(3);
  b.set(4);
  stop();
  stop();
  b.set(5);
  assert.deepEqual(values, [1, 2, 4]);
  assert.deepEqual(cleaned, [1, 2, 4]);
});
test('nested batches coalesce effects and untrack excludes dependencies', () => {
  const a = cell(0),
    b = cell(0);
  const values = [];
  const stop = effect(() => {
    values.push([a.get(), untrack(b.get)]);
  });
  batch(() => {
    a.set(1);
    batch(() => a.set(2));
    b.set(9);
  });
  b.set(10);
  assert.deepEqual(values, [
    [0, 0],
    [2, 9],
  ]);
  stop();
});
test('owned scopes stop nested effects and clean in reverse order', () => {
  const value = cell(0);
  const log = [];
  const root = createScope(() => {
    onCleanup(() => log.push('first'));
    effect(() => {
      value.get();
      effect(() => {
        log.push('child');
      });
      return () => log.push('run');
    });
    onCleanup(() => log.push('last'));
  });
  value.set(1);
  root.dispose();
  value.set(2);
  assert.deepEqual(log, ['child', 'run', 'child', 'last', 'run', 'first']);
});
test('context inheritance and defaults respect scene ownership', () => {
  const token = context('default');
  assert.equal(inject(token), 'default');
  assert.throws(() => provide(token, 'bad'), /scope/);
  createScope(() => {
    provide(token, 'parent');
    createScope(() => {
      assert.equal(inject(token), 'parent');
      provide(token, 'child');
      assert.equal(inject(token), 'child');
    }).dispose();
    assert.equal(inject(token), 'parent');
  }).dispose();
  assert.throws(() => onCleanup(() => {}), /scope/);
});
test('cleanup continues after errors and failed effects detach', () => {
  const value = cell(0);
  let cleaned = false;
  const scope = createScope(() => {
    onCleanup(() => {
      cleaned = true;
    });
    onCleanup(() => {
      throw new Error('cleanup');
    });
  });
  assert.throws(scope.dispose, AggregateError);
  assert.equal(cleaned, true);
  assert.throws(
    () =>
      effect(() => {
        value.get();
        throw new Error('initial');
      }),
    /initial/,
  );
  assert.doesNotThrow(() => value.set(1));
});
test('update failures surface while other queued effects still run', () => {
  const value = cell(0);
  let observed = 0;
  const bad = effect(() => {
    if (value.get()) throw new Error('update');
  });
  const good = effect(() => {
    observed = value.get();
  });
  assert.throws(() => value.set(1), /update/);
  assert.equal(observed, 1);
  bad();
  good();
});
test('reactive cycles throw rather than silently hanging', () => {
  const value = cell(0);
  assert.throws(
    () =>
      effect(() => {
        value.set(value.get() + 1);
      }),
    /recursively/,
  );
  assert.doesNotThrow(() => value.set(3));
});
test('derived chains settle before effects observing both source and computed values', () => {
  const value = cell(1),
    log = [];
  let double;
  const stop = effect(() => {
    log.push([value.get(), double?.get()]);
  });
  double = derive(() => value.get() * 2);
  const quadruple = derive(() => double.get() * 2);
  const stopChain = effect(() => {
    log.push([value.get(), quadruple.get()]);
  });
  log.length = 0;
  value.set(2);
  assert.deepEqual(log, [
    [2, 4],
    [2, 8],
  ]);
  stop();
  stopChain();
  double.dispose();
  quadruple.dispose();
});
