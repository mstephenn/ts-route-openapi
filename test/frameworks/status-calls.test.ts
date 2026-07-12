import { expect, test } from 'vitest';
import { extractTypes } from '../../src/schema/index.js';
import { createProjectWithSource, scanResolvedRoutes } from '../support/project.js';

function routesFrom(code: string) {
  return scanResolvedRoutes(createProjectWithSource(code, 'app.ts'));
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

test('express: enum/const status arguments resolve via the type checker', () => {
  const [route] = routesFrom(`
    ${EXPRESS_DECLS}
    const NOT_FOUND = 404;
    enum HttpStatus { CREATED = 201 }
    declare const app: any;
    app.post('/things', (req: Request, res: Response<{ ok: boolean }>) => {
      if (Math.random() > 1) return void res.status(NOT_FOUND).end();
      res.status(HttpStatus.CREATED).json({ ok: true });
    });
  `);
  const types = extractTypes(route);

  expect(types.responses?.map((r) => r.status)).toEqual([201, 404]);
});

test('a thrown local exception class with a status property adds a schema-less response', () => {
  const [route] = routesFrom(`
    ${EXPRESS_DECLS}
    interface Order { id: string }
    class NotFoundError extends Error {
      status = 404;
    }
    declare const app: any;
    app.get('/orders/:id', (req: Request<{ id: string }>, res: Response<Order>) => {
      if (Math.random() > 1) throw new NotFoundError();
      res.json({ id: 'x' } as Order);
    });
  `);
  const types = extractTypes(route);

  expect(types.responses?.map((r) => [r.status, r.type?.getText()])).toEqual([
    [200, 'Order'],
    [404, undefined],
  ]);
});

test('a thrown exception class inherits its status from a local base class', () => {
  const [route] = routesFrom(`
    ${EXPRESS_DECLS}
    interface Order { id: string }
    class HttpError extends Error {
      statusCode = 500;
    }
    class ConflictError extends HttpError {
      statusCode = 409;
    }
    declare const app: any;
    app.post('/orders', (req: Request, res: Response<Order>) => {
      if (Math.random() > 1) throw new ConflictError();
      res.json({ id: 'x' } as Order);
    });
  `);
  const types = extractTypes(route);

  expect(types.responses?.map((r) => r.status)).toEqual([200, 409]);
});

test('a file-scoped Express error-handling middleware adds its statuses to every route in the file', () => {
  const [route] = routesFrom(`
    ${EXPRESS_DECLS}
    interface Order { id: string }
    declare const app: any;
    app.use((err: unknown, req: Request, res: Response, next: () => void) => {
      res.status(500).json({ message: 'boom' });
    });
    app.get('/orders/:id', (req: Request<{ id: string }>, res: Response<Order>) => {
      res.json({ id: 'x' } as Order);
    });
  `);
  const types = extractTypes(route);

  expect(types.responses?.map((r) => [r.status, r.type?.getText()])).toEqual([
    [200, 'Order'],
    [500, undefined],
  ]);
});

test('a shadowed param in a nested closure is not misattributed for either express or fastify', () => {
  const [expressRoute] = routesFrom(`
    ${EXPRESS_DECLS}
    declare const app: any;
    app.get('/x', (req: Request, res: Response<{ ok: boolean }>) => {
      [1].forEach((res: any) => res.status(500).json({ boom: true }));
      res.json({ ok: true });
    });
  `);
  const [fastifyRoute] = routesFrom(`
    interface FastifyRequest<RG = unknown> { params: unknown }
    interface FastifyReply { code(n: number): FastifyReply }
    declare const app: any;
    app.get('/x', (req: FastifyRequest, reply: FastifyReply) => {
      [1].forEach((reply: any) => reply.code(500));
    });
  `);

  expect(extractTypes(expressRoute).responses?.map((r) => r.status)).toEqual([200]);
  expect(extractTypes(fastifyRoute).responses).toBeUndefined();
});
