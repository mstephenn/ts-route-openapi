import { Project } from 'ts-morph';
import { expect, test } from 'vitest';
import { resolveHandler } from '../handler-resolver.js';
import { scanRoutes } from '../route-scanner.js';
import { extractTypes } from '../type-extractor.js';

function routesFrom(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('app.ts', code);
  return scanRoutes(project).map((b) => resolveHandler(b)!);
}

const EXPRESS_DECLS = `
  interface Request<P = unknown, ResBody = unknown, ReqBody = unknown, Query = unknown> { params: P; body: ReqBody }
  interface Response<T = unknown> { status(n: number): Response<T>; json(b: T): void; end(): void }
`;

test('express: res.status chains produce one response per status', () => {
  const [route] = routesFrom(`
    ${EXPRESS_DECLS}
    interface Order { id: string }
    declare const app: any;
    app.get('/orders/:id', (req: Request<{ id: string }>, res: Response<Order>) => {
      if (Math.random() > 1) return void res.status(404).end();
      res.json({ id: 'x' } as Order);
    });
  `);
  const types = extractTypes(route);

  expect(types.responses?.map((r) => [r.status, r.type?.getText()])).toEqual([
    [200, 'Order'],
    [404, undefined],
  ]);
});

test('express: res.status(201).json documents 201 with the payload type', () => {
  const [route] = routesFrom(`
    ${EXPRESS_DECLS}
    interface Order { id: string }
    declare const app: any;
    app.post('/orders', (req: Request, res: Response<Order>) => {
      res.status(201).json({ id: 'x' } as Order);
    });
  `);
  const types = extractTypes(route);

  expect(types.responses?.map((r) => [r.status, r.type?.getText()])).toEqual([[201, 'Order']]);
});

test('express: handlers without res calls keep the single implicit 200', () => {
  const [route] = routesFrom(`
    ${EXPRESS_DECLS}
    declare const app: any;
    app.get('/health', (req: Request, res: Response<{ ok: boolean }>) => {});
  `);
  const types = extractTypes(route);

  expect(types.responses).toBeUndefined();
  expect(types.response?.getText()).toBe('{ ok: boolean; }');
});

test('fastify: reply.code(404) adds a schema-less 404 and keeps the payload on 200', () => {
  const [route] = routesFrom(`
    interface FastifyRequest<RG = unknown> { params: unknown }
    interface FastifyReply { code(n: number): FastifyReply }
    interface Order { id: string }
    declare const app: any;
    app.get('/orders/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<Order> => {
      if (Math.random() > 1) reply.code(404);
      return { id: 'x' };
    });
  `);
  const types = extractTypes(route);

  expect(types.responses?.map((r) => [r.status, r.type?.getText()])).toEqual([
    [200, 'Order'],
    [404, undefined],
  ]);
});

test('fastify: a 2xx reply.code claims the payload type', () => {
  const [route] = routesFrom(`
    interface FastifyRequest<RG = unknown> { params: unknown }
    interface FastifyReply { code(n: number): FastifyReply }
    interface Order { id: string }
    declare const app: any;
    app.post('/orders', async (req: FastifyRequest<{ Body: { name: string } }>, reply: FastifyReply): Promise<Order> => {
      reply.code(201);
      return { id: 'x' };
    });
  `);
  const types = extractTypes(route);

  expect(types.responses?.map((r) => [r.status, r.type?.getText()])).toEqual([[201, 'Order']]);
});
