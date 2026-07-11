import { watch, type FSWatcher } from 'node:fs';
import type { SourceFile } from 'ts-morph';
import { loadProject } from './project-loader.js';

export interface WatchSession {
  close(): void;
}

export interface WatchRunnerDeps {
  watchFile(path: string, listener: () => void): { close(): void };
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
  onError(error: unknown): void;
}

export interface WatchOptions {
  debounceMs?: number;
  deps?: Partial<WatchRunnerDeps>;
  installSigintHandler?: boolean;
}

const DEFAULT_DEBOUNCE_MS = 150;

export function watchTsconfigSources(
  tsconfigPath: string,
  regenerate: () => void,
  options: WatchOptions = {},
): WatchSession {
  const project = loadProject(tsconfigPath);
  const files = project
    .getSourceFiles()
    .filter(watchableSourceFile)
    .map((sourceFile) => sourceFile.getFilePath());

  return createWatchSession(files, regenerate, options);
}

export function createWatchSession(
  files: string[],
  regenerate: () => void,
  options: WatchOptions = {},
): WatchSession {
  const deps = defaultDeps(options.deps);
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let timer: unknown;
  let closed = false;

  const run = (): void => {
    if (closed) return;
    try {
      regenerate();
    } catch (error) {
      deps.onError(error);
    }
  };

  const schedule = (): void => {
    if (closed) return;
    if (timer) deps.clearTimer(timer);
    timer = deps.setTimer(() => {
      timer = undefined;
      run();
    }, debounceMs);
  };

  run();
  const watchers = [...new Set(files)].map((file) => deps.watchFile(file, schedule));

  const session: WatchSession = {
    close(): void {
      if (closed) return;
      closed = true;
      if (timer) deps.clearTimer(timer);
      for (const watcher of watchers) watcher.close();
    },
  };

  if (options.installSigintHandler ?? true) {
    process.once('SIGINT', () => {
      session.close();
      process.exit(0);
    });
  }

  return session;
}

function watchableSourceFile(sourceFile: SourceFile): boolean {
  return !sourceFile.isInNodeModules() && !sourceFile.isDeclarationFile();
}

function defaultDeps(overrides: Partial<WatchRunnerDeps> | undefined): WatchRunnerDeps {
  return {
    watchFile(path, listener): FSWatcher {
      return watch(path, { persistent: true }, listener);
    },
    setTimer(callback, ms): NodeJS.Timeout {
      return setTimeout(callback, ms);
    },
    clearTimer(timer): void {
      clearTimeout(timer as NodeJS.Timeout);
    },
    onError(error): void {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to regenerate OpenAPI spec: ${message}`);
    },
    ...overrides,
  };
}
