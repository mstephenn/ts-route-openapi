import { expect, test, vi } from 'vitest';
import { buildOpenApi } from '../src/openapi/index.js';
import { extractTypes } from '../src/schema/index.js';
import { scanNestRoutes } from '../src/routes/index.js';
import type { ResolvedRoute } from '../src/shared/index.js';
import { createProjectWithFiles, createProjectWithSource, scanResolvedRoutes } from './support/project.js';
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

test('infers bearer security from Express-style route middleware names', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      function requireJwtAuth(req: unknown, res: unknown, next: () => void): void { next(); }
      declare const app: any;
      app.get('/admin', requireJwtAuth, () => ({ ok: true }));
    `),
  );

  expect(doc.components!.securitySchemes).toEqual({
    bearerAuth: { type: 'http', scheme: 'bearer' },
  });
  expect(getOperation(doc, '/admin', 'get').security).toEqual([{ bearerAuth: [] }]);
});

test('infers bearer security from passport authenticate strategy middleware', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      declare const passport: { authenticate(strategy: string): unknown };
      declare const app: any;
      app.get('/admin', passport.authenticate('jwt'), () => ({ ok: true }));
    `),
  );

  expect(doc.components!.securitySchemes).toEqual({
    bearerAuth: { type: 'http', scheme: 'bearer' },
  });
  expect(getOperation(doc, '/admin', 'get').security).toEqual([{ bearerAuth: [] }]);
});

test('infers bearer security from Hono middleware names', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      function bearerAuth(c: unknown, next: () => void): void { next(); }
      declare const app: any;
      app.get('/me', bearerAuth, (c: any) => ({ ok: true }));
    `),
  );

  expect(doc.components!.securitySchemes).toEqual({
    bearerAuth: { type: 'http', scheme: 'bearer' },
  });
  expect(getOperation(doc, '/me', 'get').security).toEqual([{ bearerAuth: [] }]);
});

test('infers basic security from Koa router middleware names', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      const basicAuth = (ctx: unknown, next: () => void): void => next();
      declare const router: any;
      router.get('/reports', basicAuth, (ctx: any) => ({ ok: true }));
    `),
  );

  expect(doc.components!.securitySchemes).toEqual({
    basicAuth: { type: 'http', scheme: 'basic' },
  });
  expect(getOperation(doc, '/reports', 'get').security).toEqual([{ basicAuth: [] }]);
});

test('infers API-key security from explicit Fastify route hook factories', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      declare function apiKeyHeader(name: string): unknown;
      declare const app: any;
      app.get('/internal', { preHandler: apiKeyHeader('x-api-key') }, () => ({ ok: true }));
    `),
  );

  expect(doc.components!.securitySchemes).toEqual({
    apiKeyHeader: { type: 'apiKey', in: 'header', name: 'x-api-key' },
  });
  expect(getOperation(doc, '/internal', 'get').security).toEqual([{ apiKeyHeader: [] }]);
});

test('infers Nest security from guard decorators', () => {
  const project = createProjectWithSource(
    `
      function Controller(path?: string): ClassDecorator { return () => {}; }
      function Get(path?: string): MethodDecorator { return () => {}; }
      function UseGuards(...guards: unknown[]): MethodDecorator & ClassDecorator { return () => {}; }
      class JwtAuthGuard {}

      @Controller('admin')
      @UseGuards(JwtAuthGuard)
      class AdminController {
        @Get('profile')
        profile(): { ok: boolean } {
          return { ok: true };
        }
      }
    `,
    'nest.ts',
    { compilerOptions: { experimentalDecorators: true } },
  );

  const doc = buildOpenApi(scanNestRoutes(project));

  expect(doc.components!.securitySchemes).toEqual({
    bearerAuth: { type: 'http', scheme: 'bearer' },
  });
  expect(getOperation(doc, '/admin/profile', 'get').security).toEqual([{ bearerAuth: [] }]);
});

test('does not infer security from ambiguous middleware', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      function checkSession(req: unknown, res: unknown, next: () => void): void { next(); }
      function basicInfo(req: unknown, res: unknown, next: () => void): void { next(); }
      declare const app: any;
      app.get('/maybe', checkSession, () => ({ ok: true }));
      app.get('/info', basicInfo, () => ({ ok: true }));
    `),
  );

  expect(doc.components?.securitySchemes).toBeUndefined();
  expect(getOperation(doc, '/maybe', 'get').security).toBeUndefined();
  expect(getOperation(doc, '/info', 'get').security).toBeUndefined();
});

test('configured security takes precedence over inferred middleware security', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      function requireJwtAuth(req: unknown, res: unknown, next: () => void): void { next(); }
      declare const app: any;
      app.get('/admin', requireJwtAuth, () => ({ ok: true }));
    `),
    undefined,
    {
      config: {
        securitySchemes: { configuredAuth: { type: 'http', scheme: 'bearer' } },
        security: [{ configuredAuth: [] }],
      },
    },
  );

  expect(doc.components!.securitySchemes).toEqual({
    bearerAuth: { type: 'http', scheme: 'bearer' },
    configuredAuth: { type: 'http', scheme: 'bearer' },
  });
  expect(getOperation(doc, '/admin', 'get').security).toEqual([{ configuredAuth: [] }]);
});

test('route-level inferred security does not leak to sibling routes', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      function requireJwtAuth(req: unknown, res: unknown, next: () => void): void { next(); }
      declare const app: any;
      app.get('/admin', requireJwtAuth, () => ({ ok: true }));
      app.get('/public', () => ({ ok: true }));
    `),
  );

  expect(getOperation(doc, '/admin', 'get').security).toEqual([{ bearerAuth: [] }]);
  expect(getOperation(doc, '/public', 'get').security).toBeUndefined();
});

test('infers security inherited from same-receiver app middleware with a literal prefix', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      function requireJwtAuth(req: unknown, res: unknown, next: () => void): void { next(); }
      declare const app: any;
      app.use('/admin', requireJwtAuth);
      app.get('/admin/users', () => ({ ok: true }));
      app.get('/health', () => ({ ok: true }));
    `),
  );

  expect(getOperation(doc, '/admin/users', 'get').security).toEqual([{ bearerAuth: [] }]);
  expect(getOperation(doc, '/health', 'get').security).toBeUndefined();
});

test('infers security inherited from a mounted router with a literal mount path', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      function requireJwtAuth(req: unknown, res: unknown, next: () => void): void { next(); }
      declare const app: any;
      declare const router: any;
      app.use('/admin', requireJwtAuth, router);
      router.get('/users', () => ({ ok: true }));
    `),
  );

  expect(getOperation(doc, '/admin/users', 'get').security).toEqual([{ bearerAuth: [] }]);
});

test('infers security inherited from Fastify hooks on the same receiver', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      function requireJwtAuth(req: unknown, reply: unknown, done: () => void): void { done(); }
      declare const app: any;
      app.addHook('preHandler', requireJwtAuth);
      app.get('/admin', () => ({ ok: true }));
    `),
  );

  expect(getOperation(doc, '/admin', 'get').security).toEqual([{ bearerAuth: [] }]);
});

test('does not infer inherited security from dynamic middleware scope', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      function requireJwtAuth(req: unknown, res: unknown, next: () => void): void { next(); }
      declare const app: any;
      declare function getApp(): any;
      const adminPath = '/admin';
      app.use(adminPath, requireJwtAuth);
      app.get('/admin/users', () => ({ ok: true }));
      getApp().use('/admin', requireJwtAuth);
      getApp().get('/admin/settings', () => ({ ok: true }));
    `),
  );

  expect(getOperation(doc, '/admin/users', 'get').security).toBeUndefined();
  expect(getOperation(doc, '/admin/settings', 'get').security).toBeUndefined();
});

test('Nest public decorators remove inferred class-level guard security', () => {
  const project = createProjectWithSource(
    `
      function Controller(path?: string): ClassDecorator { return () => {}; }
      function Get(path?: string): MethodDecorator { return () => {}; }
      function Public(): MethodDecorator { return () => {}; }
      function UseGuards(...guards: unknown[]): MethodDecorator & ClassDecorator { return () => {}; }
      class JwtAuthGuard {}

      @Controller('admin')
      @UseGuards(JwtAuthGuard)
      class AdminController {
        @Get('profile')
        profile(): { ok: boolean } {
          return { ok: true };
        }

        @Public()
        @Get('health')
        health(): { ok: boolean } {
          return { ok: true };
        }
      }
    `,
    'nest.ts',
    { compilerOptions: { experimentalDecorators: true } },
  );

  const doc = buildOpenApi(scanNestRoutes(project), undefined, {
    config: { publicDecorator: 'Public' },
  });

  expect(getOperation(doc, '/admin/profile', 'get').security).toEqual([{ bearerAuth: [] }]);
  expect(getOperation(doc, '/admin/health', 'get').security).toEqual([]);
});

test('maps generic validator middleware schemas into body, query, headers and cookies', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      declare const app: any;
      declare const z: any;
      declare function validateBody(schema: unknown): unknown;
      declare function validateQuery(schema: unknown): unknown;
      declare function validateHeaders(schema: unknown): unknown;
      declare function validateCookies(schema: unknown): unknown;
      app.post(
        '/sessions',
        validateBody(z.object({ email: z.string().email() })),
        validateQuery(z.object({ redirect: z.string().optional() })),
        validateHeaders(z.object({ 'x-client-id': z.string() })),
        validateCookies(z.object({ session_id: z.string() })),
        () => ({ ok: true }),
      );
    `),
  );

  const op = getOperation(doc, '/sessions', 'post');
  expect(op.requestBody!.content['application/json'].schema).toEqual({
    type: 'object',
    properties: { email: { type: 'string', format: 'email' } },
    required: ['email'],
  });
  expect(op.parameters).toContainEqual({
    name: 'redirect',
    in: 'query',
    required: false,
    schema: { type: 'string' },
  });
  expect(op.parameters).toContainEqual({
    name: 'x-client-id',
    in: 'header',
    required: false,
    schema: { type: 'string' },
  });
  expect(op.parameters).toContainEqual({
    name: 'session_id',
    in: 'cookie',
    required: false,
    schema: { type: 'string' },
  });
});

test('maps generic validator middleware path params and imported schemas', () => {
  const doc = buildOpenApi(
    inputsFromFiles({
      'schemas.ts': `
        declare const z: any;
        export const paramsSchema = z.object({ orgId: z.string().uuid() });
      `,
      'app.ts': `
        import { paramsSchema } from './schemas.js';
        declare const app: any;
        declare function validateParams(schema: unknown): unknown;
        app.get('/orgs/:orgId', validateParams(paramsSchema), () => ({ ok: true }));
      `,
    }),
  );

  expect(getOperation(doc, '/orgs/{orgId}', 'get').parameters).toContainEqual({
    name: 'orgId',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  });
});

test('maps JSON-schema object literals from generic validator middleware', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      declare const app: any;
      declare function validate(target: string, schema: unknown): unknown;
      app.post('/events', validate('body', {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      }), () => ({ ok: true }));
    `),
  );

  expect(getOperation(doc, '/events', 'post').requestBody!.content['application/json'].schema).toEqual({
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  });
});

test('route-level middleware request schemas override inherited middleware schemas', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      declare const app: any;
      declare const z: any;
      declare function validateQuery(schema: unknown): unknown;
      app.use(validateQuery(z.object({ inherited: z.string() })));
      app.get('/search', validateQuery(z.object({ local: z.number() })), () => ({ ok: true }));
    `),
  );

  expect(getOperation(doc, '/search', 'get').parameters).toContainEqual({
    name: 'local',
    in: 'query',
    required: false,
    schema: { type: 'number' },
  });
  expect(getOperation(doc, '/search', 'get').parameters).not.toContainEqual({
    name: 'inherited',
    in: 'query',
    required: false,
    schema: { type: 'string' },
  });
});

test('maps Nest decorator validator schemas into request metadata', () => {
  const project = createProjectWithSource(
    `
      function Controller(path?: string): ClassDecorator { return () => {}; }
      function Post(path?: string): MethodDecorator { return () => {}; }
      function UsePipes(...pipes: unknown[]): MethodDecorator & ClassDecorator { return () => {}; }
      declare const z: any;
      declare function validateBody(schema: unknown): unknown;

      @Controller('users')
      class UsersController {
        @UsePipes(validateBody(z.object({ name: z.string() })))
        @Post()
        create(): { ok: boolean } {
          return { ok: true };
        }
      }
    `,
    'nest.ts',
    { compilerOptions: { experimentalDecorators: true } },
  );

  expect(getOperation(buildOpenApi(scanNestRoutes(project)), '/users', 'post').requestBody!.content['application/json'].schema).toEqual({
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  });
});

test('does not map dynamic validator middleware schemas', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      declare const app: any;
      declare const schema: unknown;
      declare function validateBody(schema: unknown): unknown;
      declare function unrelated(target: string, schema: unknown): unknown;
      app.post('/dynamic', validateBody(schema), () => ({ ok: true }));
      app.post('/unrelated', unrelated('body', { type: 'string' }), () => ({ ok: true }));
    `),
  );

  expect(getOperation(doc, '/dynamic', 'post').requestBody!.content['application/json'].schema).toEqual({});
  expect(getOperation(doc, '/unrelated', 'post').requestBody).toBeUndefined();
});

test('maps generic middleware response schemas into operation responses', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      declare const app: any;
      declare const z: any;
      declare function errorResponseSchema(status: number, schema?: unknown): unknown;
      app.get(
        '/admin',
        errorResponseSchema(401, z.object({ message: z.string() })),
        () => ({ ok: true }),
      );
    `),
  );

  expect(getOperation(doc, '/admin', 'get').responses['401'].content!['application/json'].schema).toEqual({
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
  });
});

test('keeps status-only middleware responses schema-less', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      declare const app: any;
      declare function errorResponseSchema(status: number): unknown;
      app.get('/admin', errorResponseSchema(403), () => ({ ok: true }));
    `),
  );

  expect(getOperation(doc, '/admin', 'get').responses['403'].content).toBeUndefined();
});

test('handler response schemas win when middleware declares the same status', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      declare const app: any;
      declare const z: any;
      declare function responseSchema(status: number, schema: unknown): unknown;
      app.get('/ok', responseSchema(200, z.object({ middleware: z.string() })), () => ({ handler: true }));
    `),
  );

  expect(getOperation(doc, '/ok', 'get').responses['200'].content!['application/json'].schema).toEqual({
    type: 'object',
    properties: { handler: { type: 'boolean' } },
    required: ['handler'],
  });
});

test('maps Nest decorator response schemas into operation responses', () => {
  const project = createProjectWithSource(
    `
      function Controller(path?: string): ClassDecorator { return () => {}; }
      function Get(path?: string): MethodDecorator { return () => {}; }
      function UseFilters(...filters: unknown[]): MethodDecorator & ClassDecorator { return () => {}; }
      declare const z: any;
      declare function errorResponseSchema(status: number, schema: unknown): unknown;

      @Controller('admin')
      class AdminController {
        @UseFilters(errorResponseSchema(401, z.object({ message: z.string() })))
        @Get()
        profile(): { ok: boolean } {
          return { ok: true };
        }
      }
    `,
    'nest.ts',
    { compilerOptions: { experimentalDecorators: true } },
  );

  expect(getOperation(buildOpenApi(scanNestRoutes(project)), '/admin', 'get').responses['401'].content!['application/json'].schema).toEqual({
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
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

function inputsFromFiles(files: Record<string, string>) {
  return scanResolvedRoutes(createProjectWithFiles(files)).map((route) => ({
    route,
    types: extractTypes(route),
  }));
}

test('resolves a Zod schema imported from another module, not just locally declared', () => {
  const doc = buildOpenApi(
    inputsFromFiles({
      'schemas.ts': `
        declare const z: any;
        export const createUserInput = z.object({ name: z.string(), age: z.number().optional() });
      `,
      'app.ts': `
        import { createUserInput } from './schemas.js';
        declare const app: any;
        declare const zValidator: any;
        app.post('/users', zValidator('json', createUserInput), () => undefined);
      `,
    }),
  );

  expect(getOperation(doc, '/users', 'post').requestBody!.content['application/json'].schema).toEqual({
    type: 'object',
    properties: { name: { type: 'string' }, age: { type: 'number' } },
    required: ['name'],
  });
});

test('chained Zod modifiers (min/max/regex/email/default/trim) refine the base schema instead of discarding it', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      declare const app: any;
      declare const z: any;
      declare const zValidator: any;
      const input = z.object({
        name: z.string().trim().min(1).max(60),
        email: z.string().email(),
        age: z.number().int().nonnegative(),
        slug: z.string().regex(/^[a-z0-9-]+$/),
        role: z.string().default('member'),
      });
      app.post('/things', zValidator('json', input), () => undefined);
    `),
  );

  expect(getOperation(doc, '/things', 'post').requestBody!.content['application/json'].schema).toEqual({
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 60 },
      email: { type: 'string', format: 'email' },
      age: { type: 'integer', minimum: 0 },
      slug: { type: 'string', pattern: '^[a-z0-9-]+$' },
      role: { type: 'string', default: 'member' },
    },
    required: ['name', 'email', 'age', 'slug', 'role'],
  });
});

test('.extend() merges properties onto the base object schema', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      declare const app: any;
      declare const z: any;
      declare const zValidator: any;
      const base = z.object({ name: z.string() });
      const input = base.extend({ id: z.string() });
      app.post('/things', zValidator('json', input), () => undefined);
    `),
  );

  expect(getOperation(doc, '/things', 'post').requestBody!.content['application/json'].schema).toEqual({
    type: 'object',
    properties: { name: { type: 'string' }, id: { type: 'string' } },
    required: ['name', 'id'],
  });
});

test('.refine()/.transform() pass the base schema through unchanged instead of discarding it', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      declare const app: any;
      declare const z: any;
      declare const zValidator: any;
      const input = z.object({ password: z.string().min(8).refine(() => true, 'weak') });
      app.post('/things', zValidator('json', input), () => undefined);
    `),
  );

  expect(getOperation(doc, '/things', 'post').requestBody!.content['application/json'].schema).toEqual({
    type: 'object',
    properties: { password: { type: 'string', minLength: 8 } },
    required: ['password'],
  });
});

test('z.enum() resolves an array referenced by identifier, including "as const" arrays', () => {
  const doc = buildOpenApi(
    inputsFrom(`
      declare const app: any;
      declare const z: any;
      declare const zValidator: any;
      const ROLES = ['admin', 'member'] as const;
      const input = z.object({ role: z.enum(ROLES) });
      app.post('/things', zValidator('json', input), () => undefined);
    `),
  );

  expect(getOperation(doc, '/things', 'post').requestBody!.content['application/json'].schema).toEqual({
    type: 'object',
    properties: { role: { type: 'string', enum: ['admin', 'member'] } },
    required: ['role'],
  });
});
