# ts-route-openapi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone CLI that generates an OpenAPI 3.x spec from a TypeScript route→controller codebase using the TS type checker (ts-morph), with no JSDoc and no type-duplicating decorators.

**Architecture:** A pipeline of small, independently-testable units — `project-loader → route-scanner → handler-resolver → type-extractor → schema-mapper → openapi-builder` — glued by a `generate()` orchestrator and a thin `cli`. Routes are discovered from registration call-sites (`app.get('/users/:id', UsersController.getById)`); types come from the checker.

**Tech Stack:** TypeScript (ESM, NodeNext), ts-morph, cac (CLI), yaml, vitest.

## Global Constraints

- Package is ESM: `"type": "module"`; all relative imports use the `.js` extension.
- Node target ES2022, `module`/`moduleResolution` = `NodeNext`, `strict: true`.
- Output document is OpenAPI `3.0.3`.
- MVP scope only: no auth/security schemes, no response codes beyond `200`, no JSDoc descriptions, no watch mode.
- Param-classification convention (fixed for MVP): path params match `:token` names in the route path; the first remaining object-typed param is the request body; remaining params are query params; the method return type (unwrapping `Promise<T>`) is the `200` response.
- Every unit test uses an in-memory ts-morph `Project` except the project-loader test (which reads a real tsconfig) and the final golden-file test.

---

### Task 1: Project scaffold + `project-loader`

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `src/project-loader.ts`
- Test: `src/project-loader.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadProject(tsconfigPath: string): Project` (ts-morph `Project` with the program + type checker loaded).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ts-route-openapi",
  "version": "0.0.0",
  "type": "module",
  "bin": { "ts-route-openapi": "dist/cli.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "lint": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "cac": "^6.7.14",
    "ts-morph": "^24.0.0",
    "yaml": "^2.5.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: `node_modules/` populated, no errors.

- [ ] **Step 5: Write the failing test**

`src/project-loader.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadProject } from './project-loader.js';

test('loadProject loads source files from a tsconfig', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trotest-'));
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }),
  );
  writeFileSync(join(dir, 'app.ts'), 'export const x: number = 1;\n');

  const project = loadProject(join(dir, 'tsconfig.json'));

  const files = project.getSourceFiles().map((f) => f.getBaseName());
  expect(files).toContain('app.ts');
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/project-loader.test.ts`
Expected: FAIL — cannot find module `./project-loader.js`.

- [ ] **Step 7: Write minimal implementation**

`src/project-loader.ts`:

```ts
import { Project } from 'ts-morph';

/** Load a ts-morph Project (program + type checker) from a tsconfig path. */
export function loadProject(tsconfigPath: string): Project {
  return new Project({ tsConfigFilePath: tsconfigPath });
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/project-loader.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/project-loader.ts src/project-loader.test.ts package-lock.json
git commit -m "feat: scaffold project and add project-loader"
```

---

### Task 2: Shared types + `route-scanner`

**Files:**
- Create: `src/types.ts`
- Create: `src/route-scanner.ts`
- Test: `src/route-scanner.test.ts`

**Interfaces:**
- Consumes: `Project` from Task 1.
- Produces:
  - `type HttpVerb = 'get' | 'post' | 'put' | 'patch' | 'delete'`
  - `interface RouteBinding { verb: HttpVerb; path: string; handlerExpression: Node }`
  - `scanRoutes(project: Project, verbs?: HttpVerb[]): RouteBinding[]`

- [ ] **Step 1: Create shared types**

`src/types.ts`:

```ts
import type { MethodDeclaration, Node, Type } from 'ts-morph';

export type HttpVerb = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** A route registration found in source: verb + path + the handler expression node. */
export interface RouteBinding {
  verb: HttpVerb;
  path: string;
  handlerExpression: Node;
}

/** A binding resolved to the controller method that implements it. */
export interface ResolvedRoute {
  verb: HttpVerb;
  path: string;
  controllerName: string;
  handlerName: string;
  method: MethodDeclaration;
}

export interface ParamType {
  name: string;
  type: Type;
}

/** Types extracted from a resolved route's method signature. */
export interface RouteTypes {
  pathParams: ParamType[];
  query: ParamType[];
  body?: Type;
  response?: Type;
}
```

- [ ] **Step 2: Write the failing test**

`src/route-scanner.test.ts`:

```ts
import { Project } from 'ts-morph';
import { expect, test } from 'vitest';
import { scanRoutes } from './route-scanner.js';

function projectWith(code: string): Project {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('bootstrap.ts', code);
  return project;
}

test('scanRoutes finds verb, path and handler expression', () => {
  const project = projectWith(`
    declare const app: any;
    const UsersController = { getById(id: string) { return id; } };
    app.get('/users/:id', UsersController.getById);
    app.post('/users', UsersController.getById);
  `);

  const bindings = scanRoutes(project);

  expect(bindings.map((b) => [b.verb, b.path])).toEqual([
    ['get', '/users/:id'],
    ['post', '/users'],
  ]);
  expect(bindings[0].handlerExpression.getText()).toBe('UsersController.getById');
});

test('scanRoutes ignores non-route method calls and calls without a string path', () => {
  const project = projectWith(`
    declare const app: any;
    app.listen(3000);
    app.get(someVar, () => {});
  `);
  expect(scanRoutes(project)).toEqual([]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/route-scanner.test.ts`
Expected: FAIL — cannot find module `./route-scanner.js`.

- [ ] **Step 4: Write minimal implementation**

`src/route-scanner.ts`:

```ts
import { Node, type Project } from 'ts-morph';
import type { HttpVerb, RouteBinding } from './types.js';

const DEFAULT_VERBS: HttpVerb[] = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * Find route-registration call-sites (e.g. `app.get('/users/:id', handler)`).
 * A call matches when the callee is a property access whose name is one of
 * `verbs`, its first argument is a string literal, and it has a second argument.
 */
export function scanRoutes(project: Project, verbs: HttpVerb[] = DEFAULT_VERBS): RouteBinding[] {
  const verbSet = new Set<string>(verbs);
  const bindings: RouteBinding[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression();
      if (!Node.isPropertyAccessExpression(callee)) return;
      if (!verbSet.has(callee.getName())) return;

      const args = node.getArguments();
      if (args.length < 2) return;
      const pathArg = args[0];
      if (!Node.isStringLiteral(pathArg)) return;

      bindings.push({
        verb: callee.getName() as HttpVerb,
        path: pathArg.getLiteralValue(),
        handlerExpression: args[1],
      });
    });
  }

  return bindings;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/route-scanner.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/route-scanner.ts src/route-scanner.test.ts
git commit -m "feat: add shared types and route-scanner"
```

---

### Task 3: `handler-resolver`

**Files:**
- Create: `src/handler-resolver.ts`
- Test: `src/handler-resolver.test.ts`

**Interfaces:**
- Consumes: `RouteBinding` (Task 2).
- Produces: `resolveHandler(binding: RouteBinding): ResolvedRoute | null` — returns `null` when the handler expression is not a property access resolving to a method declaration.

- [ ] **Step 1: Write the failing test**

`src/handler-resolver.test.ts`:

```ts
import { Project } from 'ts-morph';
import { expect, test } from 'vitest';
import { resolveHandler } from './handler-resolver.js';
import { scanRoutes } from './route-scanner.js';

function firstBinding(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('bootstrap.ts', code);
  return scanRoutes(project)[0];
}

test('resolveHandler resolves a static controller method', () => {
  const binding = firstBinding(`
    class UsersController {
      static getById(id: string): string { return id; }
    }
    declare const app: any;
    app.get('/users/:id', UsersController.getById);
  `);

  const route = resolveHandler(binding)!;

  expect(route.controllerName).toBe('UsersController');
  expect(route.handlerName).toBe('getById');
  expect(route.method.getName()).toBe('getById');
  expect(route.verb).toBe('get');
  expect(route.path).toBe('/users/:id');
});

test('resolveHandler returns null when handler is not a resolvable method', () => {
  const binding = firstBinding(`
    declare const app: any;
    app.get('/x', () => {});
  `);
  expect(resolveHandler(binding)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/handler-resolver.test.ts`
Expected: FAIL — cannot find module `./handler-resolver.js`.

- [ ] **Step 3: Write minimal implementation**

`src/handler-resolver.ts`:

```ts
import { Node } from 'ts-morph';
import type { ResolvedRoute, RouteBinding } from './types.js';

/**
 * Resolve a binding's handler expression (e.g. `UsersController.getById`) to the
 * controller method declaration it references. Returns null when the expression
 * is not a property access resolving to a method.
 */
export function resolveHandler(binding: RouteBinding): ResolvedRoute | null {
  const expr = binding.handlerExpression;
  if (!Node.isPropertyAccessExpression(expr)) return null;

  const handlerName = expr.getName();
  const controllerName = expr.getExpression().getText();

  const symbol = expr.getNameNode().getSymbol();
  const declaration = symbol?.getDeclarations()[0];
  if (!declaration || !Node.isMethodDeclaration(declaration)) return null;

  return {
    verb: binding.verb,
    path: binding.path,
    controllerName,
    handlerName,
    method: declaration,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/handler-resolver.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/handler-resolver.ts src/handler-resolver.test.ts
git commit -m "feat: add handler-resolver"
```

---

### Task 4: `type-extractor`

**Files:**
- Create: `src/type-extractor.ts`
- Test: `src/type-extractor.test.ts`

**Interfaces:**
- Consumes: `ResolvedRoute` (Task 3).
- Produces: `extractTypes(route: ResolvedRoute): RouteTypes` applying the param-classification convention from Global Constraints.

- [ ] **Step 1: Write the failing test**

`src/type-extractor.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/type-extractor.test.ts`
Expected: FAIL — cannot find module `./type-extractor.js`.

- [ ] **Step 3: Write minimal implementation**

`src/type-extractor.ts`:

```ts
import type { ParamType, ResolvedRoute, RouteTypes } from './types.js';

/** Collect `:token` names from a route path. */
function pathTokens(path: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of path.matchAll(/:([A-Za-z0-9_]+)/g)) tokens.add(match[1]);
  return tokens;
}

/**
 * Classify a resolved route's parameters using the MVP convention:
 * - path params: param name matches a `:token` in the path
 * - body: first remaining object-typed (non-array) param
 * - query: everything else
 * - response: return type, unwrapping Promise<T>
 */
export function extractTypes(route: ResolvedRoute): RouteTypes {
  const tokens = pathTokens(route.path);
  const pathParams: ParamType[] = [];
  const query: ParamType[] = [];
  let body: RouteTypes['body'];

  for (const param of route.method.getParameters()) {
    const name = param.getName();
    const type = param.getType();

    if (tokens.has(name)) {
      pathParams.push({ name, type });
    } else if (!body && type.isObject() && !type.isArray()) {
      body = type;
    } else {
      query.push({ name, type });
    }
  }

  let response = route.method.getReturnType();
  if (response.getSymbol()?.getName() === 'Promise') {
    const args = response.getTypeArguments();
    if (args.length === 1) response = args[0];
  }

  return { pathParams, query, body, response };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/type-extractor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/type-extractor.ts src/type-extractor.test.ts
git commit -m "feat: add type-extractor with param-classification convention"
```

---

### Task 5: `schema-mapper`

**Files:**
- Create: `src/schema-mapper.ts`
- Test: `src/schema-mapper.test.ts`

**Interfaces:**
- Consumes: ts-morph `Type` (produced inside `RouteTypes`).
- Produces:
  - `interface SchemaResult { schema: Record<string, unknown>; components: Record<string, Record<string, unknown>> }`
  - `mapType(type: Type): SchemaResult` — converts a TS type to an OpenAPI schema, hoisting named object types into `components` and referencing them via `$ref`.

- [ ] **Step 1: Write the failing test**

`src/schema-mapper.test.ts`:

```ts
import { Project, type Type } from 'ts-morph';
import { expect, test } from 'vitest';
import { mapType } from './schema-mapper.js';

/** Build a Type from the annotation of `declare const value: <annotation>`. */
function typeOf(annotation: string): Type {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile('t.ts', `declare const value: ${annotation};`);
  return sf.getVariableDeclarationOrThrow('value').getType();
}

test('maps primitives and arrays', () => {
  expect(mapType(typeOf('string')).schema).toEqual({ type: 'string' });
  expect(mapType(typeOf('number')).schema).toEqual({ type: 'number' });
  expect(mapType(typeOf('boolean[]')).schema).toEqual({
    type: 'array',
    items: { type: 'boolean' },
  });
});

test('maps a string-literal union to an enum', () => {
  expect(mapType(typeOf("'a' | 'b'")).schema).toEqual({
    type: 'string',
    enum: ['a', 'b'],
  });
});

test('inlines anonymous objects with required tracking', () => {
  expect(mapType(typeOf('{ a: string; b?: number }')).schema).toEqual({
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'number' } },
    required: ['a'],
  });
});

test('hoists named interfaces into components and references them', () => {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile(
    't.ts',
    `interface User { id: string } declare const value: User;`,
  );
  const type = sf.getVariableDeclarationOrThrow('value').getType();

  const result = mapType(type);

  expect(result.schema).toEqual({ $ref: '#/components/schemas/User' });
  expect(result.components.User).toEqual({
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/schema-mapper.test.ts`
Expected: FAIL — cannot find module `./schema-mapper.js`.

- [ ] **Step 3: Write minimal implementation**

`src/schema-mapper.ts`:

```ts
import { Node, type Type } from 'ts-morph';

type Schema = Record<string, unknown>;
type Components = Record<string, Schema>;

export interface SchemaResult {
  schema: Schema;
  components: Components;
}

/** Convert a TS type to an OpenAPI schema, hoisting named object types into components. */
export function mapType(type: Type): SchemaResult {
  const components: Components = {};
  const schema = toSchema(type, components, new Set<string>());
  return { schema, components };
}

function toSchema(type: Type, components: Components, seen: Set<string>): Schema {
  if (type.isString()) return { type: 'string' };
  if (type.isNumber()) return { type: 'number' };
  if (type.isBoolean()) return { type: 'boolean' };
  if (type.isStringLiteral()) return { type: 'string', enum: [type.getLiteralValue()] };

  if (type.isArray()) {
    return { type: 'array', items: toSchema(type.getArrayElementTypeOrThrow(), components, seen) };
  }

  if (type.isUnion()) {
    const parts = type.getUnionTypes();
    if (parts.length > 0 && parts.every((p) => p.isStringLiteral())) {
      return { type: 'string', enum: parts.map((p) => p.getLiteralValue() as string) };
    }
    const defined = parts.filter((p) => !p.isUndefined() && !p.isNull());
    if (defined.length === 1) return toSchema(defined[0], components, seen);
  }

  if (type.isObject()) {
    const name = type.getSymbol()?.getName();
    const isNamed = !!name && name !== '__type' && name !== '__object';
    if (isNamed) {
      if (!seen.has(name)) {
        seen.add(name);
        components[name] = objectSchema(type, components, seen);
      }
      return { $ref: `#/components/schemas/${name}` };
    }
    return objectSchema(type, components, seen);
  }

  return {};
}

function objectSchema(type: Type, components: Components, seen: Set<string>): Schema {
  const properties: Record<string, Schema> = {};
  const required: string[] = [];

  for (const prop of type.getProperties()) {
    const declaration = prop.getDeclarations()[0];
    if (!declaration) continue;
    const propType = prop.getTypeAtLocation(declaration);
    properties[prop.getName()] = toSchema(propType, components, seen);
    const optional = Node.isPropertySignature(declaration) && declaration.hasQuestionToken();
    if (!optional) required.push(prop.getName());
  }

  const schema: Schema = { type: 'object', properties };
  if (required.length > 0) schema.required = required;
  return schema;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/schema-mapper.test.ts`
Expected: PASS (all four tests).

- [ ] **Step 5: Commit**

```bash
git add src/schema-mapper.ts src/schema-mapper.test.ts
git commit -m "feat: add schema-mapper (TS type to OpenAPI schema)"
```

---

### Task 6: `openapi-builder`

**Files:**
- Create: `src/openapi-builder.ts`
- Test: `src/openapi-builder.test.ts`

**Interfaces:**
- Consumes: `ResolvedRoute` (Task 3), `RouteTypes` (Task 4), `mapType` (Task 5).
- Produces:
  - `interface RouteInput { route: ResolvedRoute; types: RouteTypes }`
  - `interface ApiInfo { title: string; version: string }`
  - `buildOpenApi(inputs: RouteInput[], info?: ApiInfo): Record<string, unknown>` — assembles the OpenAPI 3.0.3 document. Path templates convert `:id` → `{id}`.

- [ ] **Step 1: Write the failing test**

`src/openapi-builder.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/openapi-builder.test.ts`
Expected: FAIL — cannot find module `./openapi-builder.js`.

- [ ] **Step 3: Write minimal implementation**

`src/openapi-builder.ts`:

```ts
import { mapType } from './schema-mapper.js';
import type { ResolvedRoute, RouteTypes } from './types.js';

export interface RouteInput {
  route: ResolvedRoute;
  types: RouteTypes;
}

export interface ApiInfo {
  title: string;
  version: string;
}

type Json = Record<string, unknown>;

/** Convert `/orgs/:id/users` to the OpenAPI `/orgs/{id}/users` template form. */
function templatePath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

export function buildOpenApi(
  inputs: RouteInput[],
  info: ApiInfo = { title: 'API', version: '1.0.0' },
): Json {
  const paths: Record<string, Json> = {};
  const components: Record<string, Json> = {};

  const mergeComponents = (extra: Record<string, Json>): void => {
    Object.assign(components, extra);
  };

  for (const { route, types } of inputs) {
    const operation: Json = {};
    const parameters: Json[] = [];

    for (const p of types.pathParams) {
      const { schema, components: c } = mapType(p.type);
      mergeComponents(c);
      parameters.push({ name: p.name, in: 'path', required: true, schema });
    }
    for (const q of types.query) {
      const { schema, components: c } = mapType(q.type);
      mergeComponents(c);
      parameters.push({ name: q.name, in: 'query', required: false, schema });
    }
    if (parameters.length > 0) operation.parameters = parameters;

    if (types.body) {
      const { schema, components: c } = mapType(types.body);
      mergeComponents(c);
      operation.requestBody = { content: { 'application/json': { schema } } };
    }

    const responses: Json = {};
    if (types.response) {
      const { schema, components: c } = mapType(types.response);
      mergeComponents(c);
      responses['200'] = { description: 'OK', content: { 'application/json': { schema } } };
    } else {
      responses['200'] = { description: 'OK' };
    }
    operation.responses = responses;

    const oaPath = templatePath(route.path);
    paths[oaPath] ??= {};
    (paths[oaPath] as Json)[route.verb] = operation;
  }

  const doc: Json = { openapi: '3.0.3', info, paths };
  if (Object.keys(components).length > 0) doc.components = { schemas: components };
  return doc;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/openapi-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/openapi-builder.ts src/openapi-builder.test.ts
git commit -m "feat: add openapi-builder"
```

---

### Task 7: `generate` orchestrator + `cli` + golden-file end-to-end test

**Files:**
- Create: `src/generate.ts`
- Create: `src/cli.ts`
- Create fixtures: `src/__fixtures__/sample/tsconfig.json`, `src/__fixtures__/sample/users.controller.ts`, `src/__fixtures__/sample/bootstrap.ts`, `src/__fixtures__/sample/expected-openapi.json`
- Test: `src/generate.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `generate(tsconfigPath: string, info?: ApiInfo): Record<string, unknown>` — full pipeline: load → scan → resolve → extract → build.
  - `cli` binary (`ts-route-openapi [tsconfig] -o out -f json|yaml`).

- [ ] **Step 1: Create the fixture controller**

`src/__fixtures__/sample/users.controller.ts`:

```ts
export interface CreateUserInput {
  name: string;
  age?: number;
}

export class UsersController {
  static getById(id: string): { id: string; name: string } {
    return { id, name: 'x' };
  }

  static create(input: CreateUserInput): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }
}
```

- [ ] **Step 2: Create the fixture bootstrap**

`src/__fixtures__/sample/bootstrap.ts`:

```ts
import { UsersController } from './users.controller.js';

declare const app: {
  get(path: string, handler: unknown): void;
  post(path: string, handler: unknown): void;
};

app.get('/users/:id', UsersController.getById);
app.post('/users', UsersController.create);
```

- [ ] **Step 3: Create the fixture tsconfig**

`src/__fixtures__/sample/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true
  },
  "include": ["*.ts"]
}
```

- [ ] **Step 4: Write the failing test (against expected fixture)**

`src/generate.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import { generate } from './generate.js';

const here = dirname(fileURLToPath(import.meta.url));
const sampleDir = join(here, '__fixtures__', 'sample');

test('generate produces the expected OpenAPI document for the sample project', () => {
  const doc = generate(join(sampleDir, 'tsconfig.json'), { title: 'Sample', version: '1.0.0' });
  const expected = JSON.parse(readFileSync(join(sampleDir, 'expected-openapi.json'), 'utf8'));
  expect(doc).toEqual(expected);
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run src/generate.test.ts`
Expected: FAIL — cannot find module `./generate.js`.

- [ ] **Step 6: Write the orchestrator**

`src/generate.ts`:

```ts
import { loadProject } from './project-loader.js';
import { scanRoutes } from './route-scanner.js';
import { resolveHandler } from './handler-resolver.js';
import { extractTypes } from './type-extractor.js';
import { buildOpenApi, type ApiInfo, type RouteInput } from './openapi-builder.js';

/** Full pipeline: load a project, discover routes, and build the OpenAPI doc. */
export function generate(tsconfigPath: string, info?: ApiInfo): Record<string, unknown> {
  const project = loadProject(tsconfigPath);
  const inputs: RouteInput[] = [];

  for (const binding of scanRoutes(project)) {
    const route = resolveHandler(binding);
    if (!route) continue;
    inputs.push({ route, types: extractTypes(route) });
  }

  return buildOpenApi(inputs, info);
}
```

- [ ] **Step 7: Generate the expected fixture, then verify it by inspection**

Run this one-off to produce the expected file, then open it and confirm it matches the sample (two paths, `CreateUserInput` in components, `{id}` templating):

```bash
npx tsx -e "import {generate} from './src/generate.ts'; import {writeFileSync} from 'node:fs'; writeFileSync('src/__fixtures__/sample/expected-openapi.json', JSON.stringify(generate('src/__fixtures__/sample/tsconfig.json', {title:'Sample', version:'1.0.0'}), null, 2) + '\n');"
```

Confirm `src/__fixtures__/sample/expected-openapi.json` contains: `paths['/users/{id}'].get`, `paths['/users'].post`, `requestBody` referencing `#/components/schemas/CreateUserInput`, and `components.schemas.CreateUserInput` with `required: ['name']`. If anything is wrong, the bug is upstream — fix the component, not the fixture.

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/generate.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the CLI**

`src/cli.ts`:

```ts
#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { cac } from 'cac';
import { stringify } from 'yaml';
import { generate } from './generate.js';

const cli = cac('ts-route-openapi');

cli
  .command('[tsconfig]', 'Generate an OpenAPI spec from a TS route→controller project')
  .option('-o, --out <file>', 'Output file path', { default: 'openapi.json' })
  .option('-f, --format <fmt>', 'Output format: json | yaml', { default: 'json' })
  .option('--title <title>', 'API title', { default: 'API' })
  .option('--api-version <version>', 'API version', { default: '1.0.0' })
  .action((tsconfig: string | undefined, options: { out: string; format: string; title: string; apiVersion: string }) => {
    const doc = generate(tsconfig ?? 'tsconfig.json', {
      title: options.title,
      version: options.apiVersion,
    });
    const serialized = options.format === 'yaml' ? stringify(doc) : `${JSON.stringify(doc, null, 2)}\n`;
    writeFileSync(options.out, serialized);
    console.log(`Wrote ${options.out}`);
  });

cli.help();
cli.parse();
```

- [ ] **Step 10: Smoke-test the CLI end-to-end**

Run: `npx tsx src/cli.ts src/__fixtures__/sample/tsconfig.json -o /tmp/out.json`
Expected: prints `Wrote /tmp/out.json`; the file is a valid OpenAPI doc with two paths.

Run: `npx tsx src/cli.ts src/__fixtures__/sample/tsconfig.json -o /tmp/out.yaml -f yaml`
Expected: prints `Wrote /tmp/out.yaml`; the file is valid YAML.

- [ ] **Step 11: Full build + test gate**

Run: `npm run build && npm test`
Expected: `tsc` compiles with no errors; all vitest suites pass.

- [ ] **Step 12: Commit**

```bash
git add src/generate.ts src/generate.test.ts src/cli.ts src/__fixtures__
git commit -m "feat: add generate orchestrator, cli, and golden-file e2e test"
```

---

## Spec Coverage Self-Review

- **project-loader / route-scanner / handler-resolver / type-extractor / schema-mapper / openapi-builder** — Tasks 1–6, each with unit tests.
- **Discovery from initialization code** — route-scanner (Task 2) reads registration call-sites; handler-resolver (Task 3) follows the handler reference. Covered.
- **Type checker as source of truth** — type-extractor (Task 4) + schema-mapper (Task 5). Covered.
- **Param-classification convention** — Task 4, matching Global Constraints verbatim. Covered.
- **OpenAPI JSON/YAML output** — openapi-builder (Task 6) builds the doc; cli (Task 7) serializes both formats. Covered.
- **Named-type hoisting into components** — Task 5 `$ref` behavior, asserted in Task 6 and Task 7. Covered.
- **Config (tsconfig path, verbs, out/format)** — tsconfig + out/format via CLI (Task 7); verbs via `scanRoutes` optional arg (Task 2). Covered.
- **Golden-file test** — Task 7. Covered.
- **Out-of-scope items** (auth, non-200 codes, JSDoc, watch) — intentionally excluded, matching the spec's non-goals.
