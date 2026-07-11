import { Project } from 'ts-morph';
import { expect, test } from 'vitest';
import { buildOpenApi } from './openapi-builder.js';
import { resolveHandler } from './handler-resolver.js';
import { scanRoutes } from './route-scanner.js';
import { extractTypes } from './type-extractor.js';

function inputsFrom(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('bootstrap.ts', code);
  return scanRoutes(project).map((b) => {
    const route = resolveHandler(b)!;
    return { route, types: extractTypes(route) };
  });
}

test('builds an OpenAPI doc with templated path, params, body and response', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      interface CreateInput { name: string }
      class C {
        static create(id: string, input: CreateInput): Promise<{ ok: boolean }> {
          return Promise.resolve({ ok: true });
        }
      }
      declare const app: any;
      app.post('/orgs/:id/users', C.create);
    `),
    { title: 'Test API', version: '2.0.0' },
  ) as any;

  expect(doc.openapi).toBe('3.0.3');
  expect(doc.info).toEqual({ title: 'Test API', version: '2.0.0' });

  const op = doc.paths['/orgs/{id}/users'].post;
  expect(op.parameters).toContainEqual({
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string' },
  });
  expect(op.requestBody.content['application/json'].schema).toEqual({
    $ref: '#/components/schemas/CreateInput',
  });
  expect(op.responses['200'].content['application/json'].schema).toEqual({
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
  });
  expect(doc.components.schemas.CreateInput).toBeDefined();
});

test('keeps same-named components distinct across route inputs', () => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('/public.ts', `export interface User { a: string }`);
  project.createSourceFile('/admin.ts', `export interface User { b: number }`);
  const sf = project.createSourceFile(
    '/types.ts',
    `import type { User as PublicUser } from './public';
     import type { User as AdminUser } from './admin';
     declare const a: PublicUser;
     declare const b: AdminUser;`,
  );
  const aType = sf.getVariableDeclarationOrThrow('a').getType();
  const bType = sf.getVariableDeclarationOrThrow('b').getType();

  const doc = buildOpenApi([
    {
      route: { verb: 'post', path: '/a' } as any,
      types: { pathParams: [], query: [], body: aType, responses: [{ status: 200 }] },
    },
    {
      route: { verb: 'post', path: '/b' } as any,
      types: { pathParams: [], query: [], body: bType, responses: [{ status: 200 }] },
    },
  ]) as any;

  expect(doc.paths['/a'].post.requestBody.content['application/json'].schema).toEqual({
    $ref: '#/components/schemas/User',
  });
  expect(doc.paths['/b'].post.requestBody.content['application/json'].schema).toEqual({
    $ref: '#/components/schemas/User_admin',
  });
  expect(doc.components.schemas.User.properties).toEqual({ a: { type: 'string' } });
  expect(doc.components.schemas.User_admin.properties).toEqual({ b: { type: 'number' } });
});
