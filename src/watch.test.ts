import { expect, test, vi } from 'vitest';
import { createWatchSession, type WatchRunnerDeps } from './watch.js';

function fakeDeps() {
  const listeners: Array<() => void> = [];
  const timers: Array<{ callback: () => void; ms: number }> = [];
  const closed: string[] = [];
  const cleared: unknown[] = [];
  const errors: unknown[] = [];

  const deps: WatchRunnerDeps = {
    watchFile(path, listener) {
      listeners.push(listener);
      return {
        close() {
          closed.push(path);
        },
      };
    },
    setTimer(callback, ms) {
      const timer = { callback, ms };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      cleared.push(timer);
    },
    onError(error) {
      errors.push(error);
    },
  };

  return { deps, listeners, timers, closed, cleared, errors };
}

test('watch session runs once initially and debounces file changes', () => {
  const regen = vi.fn();
  const fake = fakeDeps();

  const session = createWatchSession(['a.ts', 'b.ts', 'a.ts'], regen, {
    deps: fake.deps,
    debounceMs: 25,
    installSigintHandler: false,
  });

  expect(regen).toHaveBeenCalledTimes(1);
  expect(fake.listeners).toHaveLength(2);

  fake.listeners[0]();
  fake.listeners[1]();
  expect(fake.timers).toHaveLength(2);
  expect(fake.cleared).toEqual([fake.timers[0]]);
  expect(fake.timers[1].ms).toBe(25);

  fake.timers[1].callback();
  expect(regen).toHaveBeenCalledTimes(2);

  session.close();
  expect(fake.closed).toEqual(['a.ts', 'b.ts']);
});

test('watch session reports regeneration errors and keeps watching', () => {
  let runs = 0;
  const fake = fakeDeps();
  const regen = vi.fn(() => {
    runs += 1;
    if (runs === 2) throw new Error('bad route');
  });

  createWatchSession(['app.ts'], regen, {
    deps: fake.deps,
    installSigintHandler: false,
  });

  fake.listeners[0]();
  fake.timers[0].callback();
  expect(fake.errors).toHaveLength(1);

  fake.listeners[0]();
  fake.timers[1].callback();
  expect(regen).toHaveBeenCalledTimes(3);
});
