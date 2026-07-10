import { Project } from 'ts-morph';
import { expect, test } from 'vitest';
import { resolveHandler } from './handler-resolver.js';
import { scanRoutes } from './route-scanner.js';
import { extractTypes } from './type-extractor.js';

function route(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('bootstrap.ts', code);
  return resolveHandler(scanRoutes(project)[0])!;
}

test('classifies path params, body, query and unwraps Promise response', () => {
  const types = extractTypes(
    route(`
      interface CreateInput { name: string }
      class C {
        static create(id: string, input: CreateInput, verbose: boolean): Promise<{ ok: boolean }> {
          return Promise.resolve({ ok: true });
        }
      }
      declare const app: any;
      app.post('/orgs/:id/users', C.create);
    `),
  );

  expect(types.pathParams.map((p) => p.name)).toEqual(['id']);
  expect(types.pathParams[0].type.getText()).toBe('string');
  expect(types.body?.getText()).toBe('CreateInput');
  expect(types.query.map((q) => q.name)).toEqual(['verbose']);
  expect(types.response?.getText()).toBe('{ ok: boolean; }');
});
