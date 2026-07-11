import { Project } from 'ts-morph';
import { expect, test } from 'vitest';
import { resolveHandler } from '../handler-resolver.js';
import { scanRoutes } from '../route-scanner.js';
import { extractTypes } from '../type-extractor.js';

function routesFrom(files: Record<string, string>) {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [path, code] of Object.entries(files)) project.createSourceFile(path, code);
  return scanRoutes(project).map((b) => resolveHandler(b)!);
}

test('express: extracts Params/ReqBody/Query/Response generics from controller methods', () => {
  const [route] = routesFrom({
    'app.ts': `
      interface Request<P = unknown, ResBody = unknown, ReqBody = unknown, Query = unknown> { params: P; body: ReqBody }
      interface Response<T = unknown> { json(b: T): void }
      interface CreateInput { name: string }
      class C {
        static create(req: Request<{ id: string }, unknown, CreateInput, { verbose: boolean }>, res: Response<{ ok: boolean }>): void {}
      }
      declare const app: any;
      app.post('/orgs/:id/users', C.create);
    `,
  });
  const types = extractTypes(route);

  expect(types.pathParams.map((p) => [p.name, p.type?.getText()])).toEqual([['id', 'string']]);
  expect(types.body?.getText()).toBe('CreateInput');
  expect(types.query.map((q) => [q.name, q.type?.getText()])).toEqual([['verbose', 'boolean']]);
  expect(types.response?.getText()).toBe('{ ok: boolean; }');
});

test('express: plain Request falls back to path-token string params', () => {
  const [route] = routesFrom({
    'app.ts': `
      interface Request<P = unknown> { params: P }
      declare const app: any;
      app.get('/users/:userId/posts/:postId', (req: Request) => {});
    `,
  });
  const types = extractTypes(route);

  expect(types.pathParams.map((p) => [p.name, p.type])).toEqual([
    ['userId', undefined],
    ['postId', undefined],
  ]);
  expect(types.body).toBeUndefined();
});

test('fastify: extracts the route generic and the handler return type', () => {
  const [route] = routesFrom({
    'app.ts': `
      interface FastifyRequest<RG = unknown> { params: unknown }
      declare const app: any;
      app.post('/orders', (req: FastifyRequest<{ Params: { id: string }; Body: { name: string }; Querystring: { limit: number } }>): Promise<{ done: boolean }> => {
        return Promise.resolve({ done: true });
      });
    `,
  });
  const types = extractTypes(route);

  expect(types.pathParams.map((p) => p.name)).toEqual(['id']);
  expect(types.body?.getText()).toBe('{ name: string; }');
  expect(types.query.map((q) => q.name)).toEqual(['limit']);
  expect(types.response?.getText()).toBe('{ done: boolean; }');
});

test('hono: reads TypedResponse<T> from the handler return type, tokens from the path', () => {
  const [route] = routesFrom({
    '/node_modules/hono/index.d.ts': `
      export interface Context { req: unknown }
      export interface TypedResponse<T> { data: T }
    `,
    '/app.ts': `
      import type { Context, TypedResponse } from 'hono';
      declare const app: any;
      app.get('/items/:id', (c: Context): TypedResponse<{ price: number }> => {
        return { data: { price: 1 } };
      });
    `,
  });
  const types = extractTypes(route);

  expect(types.pathParams.map((p) => [p.name, p.type])).toEqual([['id', undefined]]);
  expect(types.response?.getText()).toContain('price');
});

test('koa: context handlers document path tokens only', () => {
  const [route] = routesFrom({
    '/node_modules/koa/index.d.ts': `export interface Context { body: unknown }`,
    '/app.ts': `
      import type { Context } from 'koa';
      declare const router: any;
      router.get('/pets/:petId', (ctx: Context) => {});
    `,
  });
  const types = extractTypes(route);

  expect(types.pathParams.map((p) => p.name)).toEqual(['petId']);
  expect(types.body).toBeUndefined();
  expect(types.response).toBeUndefined();
});

test('unknown node_modules handler types fall back to token params, not the body convention', () => {
  const [route] = routesFrom({
    '/node_modules/somelib/index.d.ts': `export interface Ctx { x: number }`,
    '/app.ts': `
      import type { Ctx } from 'somelib';
      declare const app: any;
      app.get('/things/:thingId', (ctx: Ctx) => {});
    `,
  });
  const types = extractTypes(route);

  expect(types.pathParams.map((p) => p.name)).toEqual(['thingId']);
  expect(types.body).toBeUndefined();
});

test('inline arrow handlers and named function handlers resolve', () => {
  const routes = routesFrom({
    'app.ts': `
      declare const app: any;
      const byName = (id: string): { ok: boolean } => ({ ok: true });
      app.get('/a/:id', (id: string): { v: number } => ({ v: 1 }));
      app.get('/b/:id', byName);
    `,
  });

  expect(routes).toHaveLength(2);
  expect(extractTypes(routes[0]).response?.getText()).toBe('{ v: number; }');
  expect(extractTypes(routes[1]).pathParams.map((p) => p.name)).toEqual(['id']);
});
