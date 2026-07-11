import { expect, test } from 'vitest';
import { buildOpenApi } from '../src/openapi-builder.js';
import { scanTrpcRoutes } from '../src/trpc-routes.js';
import { getOperation } from './support/openapi.js';
import { createProjectWithSource } from './support/project.js';

const STUBS = `
  declare const z: any;
  interface ProcedureBuilder {
    input(schema: unknown): ProcedureBuilder;
    output(schema: unknown): ProcedureBuilder;
    query(resolver: (...args: any[]) => unknown): unknown;
    mutation(resolver: (...args: any[]) => unknown): unknown;
  }
  declare const procedure: ProcedureBuilder;
  declare function router<T>(procedures: T): T;
`;

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
