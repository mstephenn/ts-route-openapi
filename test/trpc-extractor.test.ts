import { expect, test } from 'vitest';
import { extractTrpcProcedureIO } from '../src/trpc-extractor.js';
import { scanTrpcRouters } from '../src/trpc-scanner.js';
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

function firstProcedure(code: string) {
  const project = createProjectWithSource(code);
  const [procedure] = scanTrpcRouters(project);
  return procedure;
}

test('input-only: .input() maps to a request schema, response falls back to the resolver return type', () => {
  const procedure = firstProcedure(`
    ${STUBS}
    interface User { id: string }
    const appRouter = router({
      getUser: procedure.input(z.object({ id: z.string() })).query((): User => ({ id: '1' })),
    });
  `);

  const io = extractTrpcProcedureIO(procedure);

  expect(io.inputSchema).toEqual({
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  });
  expect(io.outputSchema).toBeUndefined();
  expect(io.responseType?.getText()).toBe('User');
});

test('output-only: .output() documents the response schema without an input schema', () => {
  const procedure = firstProcedure(`
    ${STUBS}
    const appRouter = router({
      getUser: procedure.output(z.object({ id: z.string() })).query(() => ({ id: '1' })),
    });
  `);

  const io = extractTrpcProcedureIO(procedure);

  expect(io.inputSchema).toBeUndefined();
  expect(io.outputSchema).toEqual({
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  });
  expect(io.responseType).toBeUndefined();
});

test('both specified: .output() takes precedence over the inferred return type', () => {
  const procedure = firstProcedure(`
    ${STUBS}
    interface User { id: string; name: string }
    const appRouter = router({
      createUser: procedure
        .input(z.object({ name: z.string() }))
        .output(z.object({ id: z.string() }))
        .mutation((): User => ({ id: '1', name: 'x' })),
    });
  `);

  const io = extractTrpcProcedureIO(procedure);

  expect(io.inputSchema).toEqual({
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  });
  expect(io.outputSchema).toEqual({
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  });
  expect(io.responseType).toBeUndefined();
});

test('resolver return type unwraps a Promise', () => {
  const procedure = firstProcedure(`
    ${STUBS}
    interface User { id: string }
    const appRouter = router({
      getUser: procedure.query(async (): Promise<User> => ({ id: '1' })),
    });
  `);

  const io = extractTrpcProcedureIO(procedure);

  expect(io.responseType?.getText()).toBe('User');
});

test('neither .input() nor .output() present: only the response type is inferred', () => {
  const procedure = firstProcedure(`
    ${STUBS}
    const appRouter = router({
      health: procedure.query(() => ({ ok: true })),
    });
  `);

  const io = extractTrpcProcedureIO(procedure);

  expect(io.inputSchema).toBeUndefined();
  expect(io.outputSchema).toBeUndefined();
  expect(io.responseType?.getText()).toBe('{ ok: boolean; }');
});

test('resolves the response type for a named function reference, not just an inline closure', () => {
  const procedure = firstProcedure(`
    ${STUBS}
    interface User { id: string }
    async function getUserHandler(): Promise<User> {
      return { id: '1' };
    }
    const appRouter = router({
      getUser: procedure.query(getUserHandler),
    });
  `);

  const io = extractTrpcProcedureIO(procedure);

  expect(io.responseType?.getText()).toBe('User');
});
