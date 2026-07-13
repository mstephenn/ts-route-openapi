import { expect, test, vi } from 'vitest';
import { scanTrpcRouters } from '../src/trpc/index.js';
import { resolveProcedureMiddleware } from '../src/trpc/trpc-middleware.js';
import { createProjectWithSource } from './support/project.js';
import { TRPC_STUBS as STUBS } from './support/trpc.js';

test('collects a single .use() middleware directly on the base procedure', () => {
  const project = createProjectWithSource(`
    ${STUBS}
    const appRouter = router({
      getUser: procedure.use(function authMw() {}).query(() => ({ id: '1' })),
    });
  `);

  const [getUser] = scanTrpcRouters(project);
  const middleware = resolveProcedureMiddleware(getUser.call);

  expect(middleware.map((node) => node.getText())).toEqual(['function authMw() {}']);
});

test('walks through an Identifier receiver naming a base procedure variable', () => {
  const project = createProjectWithSource(`
    ${STUBS}
    const authedProcedure = procedure.use(function authMw() {});
    const appRouter = router({
      getUser: authedProcedure.query(() => ({ id: '1' })),
    });
  `);

  const [getUser] = scanTrpcRouters(project);
  const middleware = resolveProcedureMiddleware(getUser.call);

  expect(middleware.map((node) => node.getText())).toEqual(['function authMw() {}']);
});

test('walks through a factory call whose body is a single returned expression', () => {
  const project = createProjectWithSource(`
    ${STUBS}
    function createScopedProcedure(label: string) {
      return procedure.use(function scopedMw() {});
    }
    const appRouter = router({
      getUser: createScopedProcedure('label').use(function outerMw() {}).query(() => ({ id: '1' })),
    });
  `);

  const [getUser] = scanTrpcRouters(project);
  const middleware = resolveProcedureMiddleware(getUser.call);

  expect(middleware.map((node) => node.getText())).toEqual(['function outerMw() {}', 'function scopedMw() {}']);
});

test('collects middleware across three levels: base procedure, factory wrapper, and variable', () => {
  const project = createProjectWithSource(`
    ${STUBS}
    function createAdminProcedure(label: string) {
      return procedure.use(function baseMw() {});
    }
    const tagProcedure = createAdminProcedure('tags').use(function factoryMw() {});
    const appRouter = router({
      list: tagProcedure.query(() => ({ tags: [] })),
    });
  `);

  const [list] = scanTrpcRouters(project);
  const middleware = resolveProcedureMiddleware(list.call);

  expect(middleware.map((node) => node.getText())).toEqual(['function factoryMw() {}', 'function baseMw() {}']);
});

test('stops silently at a bare procedure builder with no middleware', () => {
  const project = createProjectWithSource(`
    ${STUBS}
    const appRouter = router({
      getUser: procedure.query(() => ({ id: '1' })),
    });
  `);

  const [getUser] = scanTrpcRouters(project);

  expect(resolveProcedureMiddleware(getUser.call)).toEqual([]);
});

test('warns and stops at a factory whose body is not a single returned expression', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  const project = createProjectWithSource(`
    ${STUBS}
    function createConditionalProcedure(label: string) {
      if (label === 'x') {
        return procedure.use(function branchMw() {});
      }
      return procedure;
    }
    const appRouter = router({
      getUser: createConditionalProcedure('x').use(function outerMw() {}).query(() => ({ id: '1' })),
    });
  `);

  const [getUser] = scanTrpcRouters(project);
  const middleware = resolveProcedureMiddleware(getUser.call);

  expect(middleware.map((node) => node.getText())).toEqual(['function outerMw() {}']);
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('ts-route-openapi: skipped middleware inference for'),
  );
  warn.mockRestore();
});
