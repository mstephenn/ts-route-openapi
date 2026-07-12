import { expect, test, vi } from 'vitest';
import { buildOpenApi } from '../src/openapi/index.js';
import { extractTypes } from '../src/schema/index.js';
import { scanNestRoutes } from '../src/routes/index.js';
import type { ResolvedRoute } from '../src/shared/index.js';
import { createProjectWithSource, scanResolvedRoutes } from './support/project.js';
import { typesOfDeclarationsIn } from './support/types.js';
import { getOperation, schemaProperties } from './support/openapi.js';

function inputsFrom(code: string) {
  return scanResolvedRoutes(createProjectWithSource(code)).map((route) => ({
    route,
    types: extractTypes(route),
  }));
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
  );

  expect(doc.openapi).toBe('3.0.3');
  expect(doc.info).toEqual({ title: 'Test API', version: '2.0.0' });

  const op = getOperation(doc, '/orgs/{id}/users', 'post');
  expect(op.parameters).toContainEqual({
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string' },
  });
  expect(op.requestBody!.content['application/json'].schema).toEqual({
    $ref: '#/components/schemas/CreateInput',
  });
  expect(op.responses['200'].content!['application/json'].schema).toEqual({
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
  });
  expect(doc.components!.schemas!.CreateInput).toBeDefined();
});

test('adds handler JSDoc summary, description and deprecation when descriptions are enabled', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      /**
       * List users.
       * Returns users visible to the caller.
       * @deprecated Use searchUsers.
       */
      function listUsers(): { id: string }[] {
        return [];
      }
      declare const app: any;
      app.get('/users', listUsers);
    `),
    undefined,
    { descriptions: true },
  );

  const op = getOperation(doc, '/users', 'get');
  expect(op.summary).toBe('List users.');
  expect(op.description).toBe('Returns users visible to the caller.');
  expect(op.deprecated).toBe(true);
});

test('leaves documented routes unchanged when descriptions are disabled', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      interface CreateInput {
        /** User name. */
        name: string
      }
      /** Create a user. */
      function create(input: CreateInput): { ok: boolean } {
        return { ok: true };
      }
      declare const app: any;
      app.post('/users', create);
    `),
  );

  const op = getOperation(doc, '/users', 'post');
  expect(op.summary).toBeUndefined();
  expect(op.deprecated).toBeUndefined();
  expect(schemaProperties(doc.components!.schemas!.CreateInput).name).toEqual({ type: 'string' });
});

test('adds configured security schemes, defaults and path-glob overrides', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      declare const app: any;
      app.get('/health', () => ({ ok: true }));
      app.get('/users/:id', (id: string) => ({ id }));
    `),
    undefined,
    {
      config: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
        security: [{ bearerAuth: [] }],
        securityOverrides: [{ method: 'GET', path: '/health', security: [] }],
      },
    },
  );

  expect(doc.components!.securitySchemes).toEqual({
    bearerAuth: { type: 'http', scheme: 'bearer' },
  });
  expect(getOperation(doc, '/health', 'get').security).toEqual([]);
  expect(getOperation(doc, '/users/{id}', 'get').security).toEqual([{ bearerAuth: [] }]);
});

test('drops default security for Nest methods with the configured public decorator', () => {
  const project = createProjectWithSource(
    `
      function Controller(path?: string): ClassDecorator { return () => {}; }
      function Get(path?: string): MethodDecorator { return () => {}; }
      function Public(): MethodDecorator { return () => {}; }

      @Controller('status')
      class StatusController {
        @Public()
        @Get('health')
        health(): { ok: boolean } {
          return { ok: true };
        }

        @Public()
        @Get('admin')
        admin(): { ok: boolean } {
          return { ok: true };
        }
      }
    `,
    'nest.ts',
  );

  const doc = buildOpenApi(scanNestRoutes(project), undefined, {
    config: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      security: [{ bearerAuth: [] }],
      securityOverrides: [{ method: 'GET', path: '/status/admin', security: [{ bearerAuth: [] }] }],
      publicDecorator: 'Public',
    },
  });

  expect(getOperation(doc, '/status/health', 'get').security).toEqual([]);
  expect(getOperation(doc, '/status/admin', 'get').security).toEqual([{ bearerAuth: [] }]);
});

test('keeps same-named components distinct across route inputs', () => {
  const [aType, bType] = typesOfDeclarationsIn(
    {
      '/public.ts': `export interface User { a: string }`,
      '/admin.ts': `export interface User { b: number }`,
      '/types.ts': `import type { User as PublicUser } from './public';
     import type { User as AdminUser } from './admin';
     declare const a: PublicUser;
     declare const b: AdminUser;`,
    },
    '/types.ts',
    ['a', 'b'],
  );

  const doc = buildOpenApi([
    {
      route: { verb: 'post', path: '/a' } as unknown as ResolvedRoute,
      types: { pathParams: [], query: [], body: aType, responses: [{ status: 200 }] },
    },
    {
      route: { verb: 'post', path: '/b' } as unknown as ResolvedRoute,
      types: { pathParams: [], query: [], body: bType, responses: [{ status: 200 }] },
    },
  ]);

  expect(getOperation(doc, '/a', 'post').requestBody!.content['application/json'].schema).toEqual({
    $ref: '#/components/schemas/User',
  });
  expect(getOperation(doc, '/b', 'post').requestBody!.content['application/json'].schema).toEqual({
    $ref: '#/components/schemas/User_admin',
  });
  expect(doc.components!.schemas!.User.properties).toEqual({ a: { type: 'string' } });
  expect(doc.components!.schemas!.User_admin.properties).toEqual({ b: { type: 'number' } });
});

test('maps Hono zValidator json and query schemas into the operation', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      declare const app: any;
      declare const z: any;
      declare const zValidator: any;
      const bodySchema = z.object({
        name: z.string(),
        age: z.number().optional(),
        tags: z.array(z.string()),
        status: z.union([z.literal('active'), z.literal('paused')]),
      });
      app.post(
        '/users',
        zValidator('json', bodySchema),
        zValidator('query', z.object({ verbose: z.boolean().optional() })),
        (c: any) => ({ ok: true }),
      );
    `),
  );

  const op = getOperation(doc, '/users', 'post');
  expect(op.requestBody!.content['application/json'].schema).toEqual({
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'number' },
      tags: { type: 'array', items: { type: 'string' } },
      status: { type: 'string', enum: ['active', 'paused'] },
    },
    required: ['name', 'tags', 'status'],
  });
  expect(op.parameters).toContainEqual({
    name: 'verbose',
    in: 'query',
    required: false,
    schema: { type: 'boolean' },
  });
});

test('maps Fastify route schema object literals into body, querystring and params', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      declare const app: any;
      app.post('/orders/:id', {
        schema: {
          params: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
          },
          querystring: {
            type: 'object',
            properties: { limit: { type: 'number' } },
          },
          body: {
            type: 'object',
            properties: { sku: { type: 'string' } },
            required: ['sku'],
          },
        },
      }, () => ({ ok: true }));
    `),
  );

  const op = getOperation(doc, '/orders/{id}', 'post');
  expect(op.parameters).toContainEqual({
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string' },
  });
  expect(op.parameters).toContainEqual({
    name: 'limit',
    in: 'query',
    required: false,
    schema: { type: 'number' },
  });
  expect(op.requestBody!.content['application/json'].schema).toEqual({
    type: 'object',
    properties: { sku: { type: 'string' } },
    required: ['sku'],
  });
});

test('maps Fastify route Zod schemas in route options', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      declare const app: any;
      declare const z: any;
      app.post('/orders', {
        schema: {
          body: z.object({ sku: z.string(), count: z.number().nullable() }),
        },
      }, () => ({ ok: true }));
    `),
  );

  expect(getOperation(doc, '/orders', 'post').requestBody!.content['application/json'].schema).toEqual({
    type: 'object',
    properties: {
      sku: { type: 'string' },
      count: { type: 'number', nullable: true },
    },
    required: ['sku', 'count'],
  });
});

test('unsupported Zod constructs emit an empty schema with a warning', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  const doc = buildOpenApi(
    inputsFrom(`
      declare const app: any;
      declare const z: any;
      declare const zValidator: any;
      app.post('/events', zValidator('json', z.record(z.string())), () => undefined);
    `),
  );

  expect(getOperation(doc, '/events', 'post').requestBody!.content['application/json'].schema).toEqual({});
  expect(warn).toHaveBeenCalledWith(
    'ts-route-openapi: unsupported Zod schema construct; emitted {} for z.record(z.string())',
  );
  warn.mockRestore();
});
