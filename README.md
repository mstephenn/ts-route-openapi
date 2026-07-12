# ts-route-openapi

[![npm version](https://img.shields.io/npm/v/ts-route-openapi.svg)](https://www.npmjs.com/package/ts-route-openapi)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Generate an **OpenAPI 3.0.3** spec from a TypeScript route→controller codebase by
statically analyzing the source with [ts-morph](https://ts-morph.com/) — **no
runtime instrumentation, decorators, JSDoc, or annotations required**.

![ts-route-openapi preview](https://raw.githubusercontent.com/mstephenn/ts-route-openapi/main/assets/preview.gif)

Your route registrations and TypeScript types *are* the documentation:

```ts
// users.controller.ts
export interface CreateUserInput {
  name: string;
  age?: number;
}

export class UsersController {
  static getById(id: string): { id: string; name: string } { /* ... */ }
  static create(input: CreateUserInput): Promise<{ ok: boolean }> { /* ... */ }
}

// bootstrap.ts
app.get('/users/:id', UsersController.getById);
app.post('/users', UsersController.create);
```

```sh
npx ts-route-openapi tsconfig.json -o openapi.yaml -f yaml
```

```yaml
openapi: 3.0.3
paths:
  /users/{id}:
    get:
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          content:
            application/json:
              schema:
                type: object
                properties: { id: { type: string }, name: { type: string } }
                required: [id, name]
  /users:
    post:
      requestBody:
        content:
          application/json:
            schema: { $ref: "#/components/schemas/CreateUserInput" }
      # ...
components:
  schemas:
    CreateUserInput:
      type: object
      properties: { name: { type: string }, age: { type: number } }
      required: [name]
```

## Install

```sh
npm install --save-dev ts-route-openapi
```

## CLI usage

```sh
npx ts-route-openapi [tsconfig] -o openapi.json -f json --title "My API" --api-version 1.0.0
npx ts-route-openapi [tsconfig] -o openapi.yaml -f yaml --watch
```

| Flag                      | Default         | Description                           |
| ------------------------- | --------------- | ------------------------------------- |
| `[tsconfig]` (positional) | `tsconfig.json` | Path to the project's `tsconfig.json` |
| `-o, --out <file>`        | `openapi.json`  | Output file path                      |
| `-f, --format <fmt>`      | `json`          | Output format: `json` or `yaml`       |
| `--title <title>`         | `API`           | Spec `info.title`                     |
| `--api-version <version>` | `1.0.0`         | Spec `info.version`                   |
| `--descriptions`          | off             | Include JSDoc summaries, descriptions, deprecation, and property descriptions |
| `-w, --watch`             | off             | Regenerate when project source files change |

## Programmatic usage

```ts
import { generate } from 'ts-route-openapi';

const doc = generate(
  'path/to/tsconfig.json',
  { title: 'My API', version: '1.0.0' },
  { descriptions: true },
);
```

## How it works

The tool loads your project via its `tsconfig.json` and discovers routes two
ways:

1. **Registration call-sites** — any call of the shape
   `something.<verb>('/path', handler)` where `<verb>` is one of `get`,
   `post`, `put`, `patch`, `delete` and the first argument is a string
   literal. The handler can be a controller method reference
   (`UsersController.getById`), an inline arrow function, or an identifier
   pointing at a function.
2. **NestJS decorators** — `@Controller('base')` classes with
   `@Get/@Post/@Put/@Patch/@Delete` methods.
3. **tRPC routers** — `router({...})` / `t.router({...})` procedure maps,
   including nested sub-routers. Each `.query()`/`.mutation()` procedure is
   exposed as a synthetic `GET`/`POST <base>/<dotted.path>` route (default
   base `/trpc`, configurable via `generate()`'s `trpc.basePath` option).

It then uses the **TypeScript type checker** on the handler to extract
parameter and return types. Your registrations are the single source of
truth — nothing to keep in sync.

### Framework support

| Framework | Types read from |
| --- | --- |
| **Express** | `Request<Params, ResBody, ReqBody, Query>` and `Response<T>` generics |
| **Fastify** | `FastifyRequest<{ Params; Body; Querystring; Reply }>` route generic + handler return type; route `schema.body` / `schema.querystring` / `schema.params` from Zod or JSON-schema object literals |
| **NestJS** | `@Param('x')/@Query('x')/@Body()` decorated, typed method params + return type |
| **Hono** | `TypedResponse<T>` from `c.json(...)` return types; path params from `:tokens`; `zValidator('json' | 'query', schema)` for Zod request schemas |
| **Koa (+ @koa/router)** | paths and `:token` params only (`ctx` carries no static route types) |
| **tRPC** | `.input(zodSchema)` for the request (query param for queries, body for mutations); `.output(zodSchema)` or the resolver's return type for the response |
| **Anything else** | plain-typed handlers via the classification convention below; unknown framework objects fall back to `:token` string params |

A registered route always makes it into the spec: when no types are
recognizable the tool documents the path and its `:token` params as strings
rather than dropping the route.

### Parameter classification convention (plain typed handlers)

For each handler parameter, in declaration order:

1. **Path params** — any parameter whose name matches a `:token` in the
   route path (e.g. `id` in `/users/:id`) is classified as a path parameter.
2. **Body** — the first remaining parameter that is object-typed (and not an
   array) is classified as the request body.
3. **Query** — every other remaining parameter is classified as a query
   parameter.

### Response

The handler's return type is used as the schema for the `200` response,
unwrapping `Promise<T>` to `T` when present.

### Schema mapping

- Primitives (`string`, `number`, `boolean`), arrays, and nested objects map
  to their OpenAPI equivalents; optional properties (`?`) are omitted from
  `required`.
- String-literal unions (`'a' | 'b'`) map to `enum`; numeric-literal unions
  to a number `enum`; other unions map to `oneOf` (discriminated object
  unions become `oneOf` over `$ref`s). `null`/`undefined` members are
  stripped.
- `Date` maps to `{ type: string, format: date-time }`.
- Named `interface`/`class`/`type` alias declarations from your project are
  hoisted into `components.schemas` and referenced via `$ref` (recursive
  types self-reference); library/`node_modules` types are inlined.
- Zod validator schemas in Hono and Fastify route metadata map common builders
  (`object`, `string`, `number`, `boolean`, `array`, `enum`, `optional`,
  `nullable`, `literal`, and literal unions). Unsupported constructs degrade to
  `{}` with a stderr note.
- When `--descriptions` is enabled, handler JSDoc adds operation
  `summary`/`description`, `@deprecated` marks operations deprecated, and
  property JSDoc becomes schema property `description`.

### Security config

Add `ts-route-openapi.config.json` next to your `tsconfig.json` to emit
OpenAPI security metadata:

```json
{
  "securitySchemes": {
    "bearerAuth": { "type": "http", "scheme": "bearer" },
    "apiKeyAuth": { "type": "apiKey", "in": "header", "name": "x-api-key" }
  },
  "security": [{ "bearerAuth": [] }],
  "securityOverrides": [
    { "method": "GET", "path": "/health", "security": [] },
    { "path": "/public/**", "security": [] }
  ],
  "publicDecorator": "Public"
}
```

`securitySchemes` is copied to `components.securitySchemes`; `security` is
applied to every operation unless a `securityOverrides` entry matches the route
verb and glob path. For NestJS, `@Public()` on a class or method drops the
default security when `publicDecorator` is set.

## Examples

Runnable, idiomatic **Express**, **Fastify**, **NestJS**, **Hono**, **Koa**,
**tRPC**, and framework-free examples — each with its generated
`openapi.yaml` committed — live in [`examples/`](./examples). No adapters or
code changes: install, run the CLI, get the spec.

## Contributing

Planning work lives in the
[`ts-route-openapi Plan`](https://github.com/users/mstephenn/projects/2)
GitHub Project, not long-lived plan documents in the repository. The `main`
branch is protected; send changes through pull requests and keep review threads
resolved before merging.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full workflow.

## Limitations (MVP scope)

- **Status codes are detected, not exhaustive**: `res.status(N)` /
  `reply.code(N)` / `@HttpCode(N)` produce per-status responses, but
  statuses set by middleware, error filters, or thrown exceptions are not
  seen. No auth documentation yet.
- **Callable types** (functions, methods) map to an empty schema (`{}`)
  rather than being described.

## License

[MIT](./LICENSE)
