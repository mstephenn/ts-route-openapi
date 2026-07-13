import { expect, test, vi } from 'vitest';
import { buildOpenApi } from '../src/openapi/index.js';
import { scanTrpcRoutes } from '../src/trpc/index.js';
import { getOperation } from './support/openapi.js';
import { createProjectWithSource } from './support/project.js';
import { TRPC_STUBS as STUBS } from './support/trpc.js';

test('maps a small tRPC router end-to-end to the expected OpenAPI paths', () => {
  const project = createProjectWithSource(`
    ${STUBS}
    interface User { id: string; name: string }
    const appRouter = router({
      users: router({
        getById: procedure.input(z.object({ id: z.string() })).query((): User => ({ id: '1', name: 'x' })),
        create: procedure
          .input(z.object({ name: z.string() }))
          .output(z.object({ id: z.string() }))
          .mutation((): User => ({ id: '1', name: 'x' })),
      }),
    });
  `);

  const doc = buildOpenApi(scanTrpcRoutes(project));

  const getById = getOperation(doc, '/trpc/users.getById', 'get');
  expect(getById.parameters).toContainEqual({
    name: 'input',
    in: 'query',
    required: false,
    schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  });
  expect(getById.responses['200'].content!['application/json'].schema).toEqual({
    $ref: '#/components/schemas/User',
  });

  const create = getOperation(doc, '/trpc/users.create', 'post');
  expect(create.requestBody!.content['application/json'].schema).toEqual({
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  });
  expect(create.responses['200'].content!['application/json'].schema).toEqual({
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  });
});

test('defaults to the /trpc base path and supports a configurable base path', () => {
  const project = createProjectWithSource(`
    ${STUBS}
    const appRouter = router({
      health: procedure.query(() => ({ ok: true })),
    });
  `);

  const defaultDoc = buildOpenApi(scanTrpcRoutes(project));
  expect(defaultDoc.paths['/trpc/health']).toBeDefined();

  const customDoc = buildOpenApi(scanTrpcRoutes(project, { basePath: '/api/rpc' }));
  expect(customDoc.paths['/api/rpc/health']).toBeDefined();
  expect(customDoc.paths['/trpc/health']).toBeUndefined();
});

test('normalizes a trailing slash on a configured base path', () => {
  const project = createProjectWithSource(`
    ${STUBS}
    const appRouter = router({
      health: procedure.query(() => ({ ok: true })),
    });
  `);

  const doc = buildOpenApi(scanTrpcRoutes(project, { basePath: '/api/rpc/' }));

  expect(doc.paths['/api/rpc/health']).toBeDefined();
  expect(Object.keys(doc.paths)).not.toContain('/api/rpc//health');
});

test('normalizes a missing leading slash on a configured base path', () => {
  const project = createProjectWithSource(`
    ${STUBS}
    const appRouter = router({
      health: procedure.query(() => ({ ok: true })),
    });
  `);

  const doc = buildOpenApi(scanTrpcRoutes(project, { basePath: 'api/rpc' }));

  expect(doc.paths['/api/rpc/health']).toBeDefined();
});

test('folds statuses thrown by middleware across a multi-level procedure chain into the response list', () => {
  const project = createProjectWithSource(`
    ${STUBS}
    function createAdminProcedure(label: string) {
      return procedure.use(({ ctx, next }: any) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        return next();
      });
    }
    const tagProcedure = createAdminProcedure('tags').use(({ ctx, next }: any) => {
      if (!ctx.site) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
      return next();
    });
    const appRouter = router({
      list: tagProcedure.use(({ ctx, next }: any) => {
        if (!ctx.tag) throw new TRPCError({ code: 'NOT_FOUND' });
        return next();
      }).query(() => ({ tags: [] })),
    });
  `);

  const doc = buildOpenApi(scanTrpcRoutes(project));
  const responses = getOperation(doc, '/trpc/list', 'get').responses;

  expect(Object.keys(responses).sort()).toEqual(['200', '401', '404', '412']);
});

test('maps TRPCError codes to their HTTP status, omitting unmapped codes', () => {
  const project = createProjectWithSource(`
    ${STUBS}
    const appRouter = router({
      get: procedure.use(({ next }: any) => {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }).query(() => ({ ok: true })),
      create: procedure.use(({ next }: any) => {
        throw new TRPCError({ code: 'PRECONDITION_FAILED' });
      }).mutation(() => ({ ok: true })),
      weird: procedure.use(({ next }: any) => {
        throw new TRPCError({ code: 'SOMETHING_MADE_UP' });
      }).query(() => ({ ok: true })),
    });
  `);

  const doc = buildOpenApi(scanTrpcRoutes(project));

  expect(Object.keys(getOperation(doc, '/trpc/get', 'get').responses).sort()).toEqual(['200', '401']);
  expect(Object.keys(getOperation(doc, '/trpc/create', 'post').responses).sort()).toEqual(['200', '412']);
  expect(Object.keys(getOperation(doc, '/trpc/weird', 'get').responses).sort()).toEqual(['200']);
});

test('a non-single-return middleware factory stops the walk without throwing and warns', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  const project = createProjectWithSource(`
    ${STUBS}
    function createConditionalProcedure(label: string) {
      if (label === 'x') {
        return procedure.use(({ next }: any) => {
          throw new TRPCError({ code: 'FORBIDDEN' });
        });
      }
      return procedure;
    }
    const appRouter = router({
      get: createConditionalProcedure('x').use(({ next }: any) => {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }).query(() => ({ ok: true })),
    });
  `);

  const doc = buildOpenApi(scanTrpcRoutes(project));

  expect(Object.keys(getOperation(doc, '/trpc/get', 'get').responses).sort()).toEqual(['200', '401']);
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('ts-route-openapi: skipped middleware inference for'),
  );
  warn.mockRestore();
});
