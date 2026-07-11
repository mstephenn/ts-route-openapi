import { expect, test } from 'vitest';
import { extractTypes } from '../src/type-extractor.js';
import { createProjectWithSource, scanResolvedRoutes } from './support/project.js';

function route(code: string) {
  return scanResolvedRoutes(createProjectWithSource(code))[0];
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
  expect(types.pathParams[0].type?.getText()).toBe('string');
  expect(types.body?.getText()).toBe('CreateInput');
  expect(types.query.map((q) => q.name)).toEqual(['verbose']);
  expect(types.response?.getText()).toBe('{ ok: boolean; }');
});
