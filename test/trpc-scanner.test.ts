import { expect, test } from 'vitest';
import { scanTrpcRouters } from '../src/trpc-scanner.js';
import { createProjectWithSource } from './support/project.js';

const STUBS = `
  interface ProcedureBuilder {
    input(schema: unknown): ProcedureBuilder;
    query(resolver: (...args: any[]) => unknown): unknown;
    mutation(resolver: (...args: any[]) => unknown): unknown;
  }
  declare const procedure: ProcedureBuilder;
  declare function router<T>(procedures: T): T;
`;

test('discovers procedures from a flat router', () => {
  const project = createProjectWithSource(`
    ${STUBS}
    const appRouter = router({
      getUser: procedure.query(() => ({ id: '1' })),
      createUser: procedure.mutation(() => ({ id: '1' })),
    });
  `);

  const procedures = scanTrpcRouters(project);

  expect(procedures.map((p) => [p.path, p.kind])).toEqual([
    ['getUser', 'query'],
    ['createUser', 'mutation'],
  ]);
});

test('flattens a nested router referenced by identifier into dotted paths', () => {
  const project = createProjectWithSource(`
    ${STUBS}
    const userRouter = router({
      getById: procedure.input({}).query(() => ({ id: '1' })),
      create: procedure.mutation(() => ({ id: '1' })),
    });
    const appRouter = router({
      users: userRouter,
    });
  `);

  const procedures = scanTrpcRouters(project);

  expect(procedures.map((p) => [p.path, p.kind])).toEqual([
    ['users.getById', 'query'],
    ['users.create', 'mutation'],
  ]);
});

test('flattens an inline nested router', () => {
  const project = createProjectWithSource(`
    ${STUBS}
    const appRouter = router({
      users: router({
        getById: procedure.query(() => ({ id: '1' })),
      }),
      health: procedure.query(() => ({ ok: true })),
    });
  `);

  const procedures = scanTrpcRouters(project);

  expect(procedures.map((p) => [p.path, p.kind])).toEqual([
    ['users.getById', 'query'],
    ['health', 'query'],
  ]);
});

test('records the resolver function node for each procedure', () => {
  const project = createProjectWithSource(`
    ${STUBS}
    const appRouter = router({
      getUser: procedure.query(() => ({ id: '1' })),
    });
  `);

  const [procedure] = scanTrpcRouters(project);

  expect(procedure.resolver.getText()).toBe("() => ({ id: '1' })");
});
