# ts-route-openapi

[![npm version](https://img.shields.io/npm/v/ts-route-openapi.svg)](https://www.npmjs.com/package/ts-route-openapi)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Generate an **OpenAPI 3.0.3** spec from a TypeScript route→controller codebase by
statically analyzing the source with [ts-morph](https://ts-morph.com/) — **no
runtime instrumentation, decorators, JSDoc, or annotations required**.

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
```

| Flag                      | Default         | Description                           |
| ------------------------- | --------------- | ------------------------------------- |
| `[tsconfig]` (positional) | `tsconfig.json` | Path to the project's `tsconfig.json` |
| `-o, --out <file>`        | `openapi.json`  | Output file path                      |
| `-f, --format <fmt>`      | `json`          | Output format: `json` or `yaml`       |
| `--title <title>`         | `API`           | Spec `info.title`                     |
| `--api-version <version>` | `1.0.0`         | Spec `info.version`                   |

## Programmatic usage

```ts
import { generate } from 'ts-route-openapi';

const doc = generate('path/to/tsconfig.json', { title: 'My API', version: '1.0.0' });
```

## How it works

The tool loads your project via its `tsconfig.json` and walks the source for
**route registration call-sites** — any call of the shape
`something.<verb>('/path', Handler.method)` where `<verb>` is one of
`get`, `post`, `put`, `patch`, `delete` and the first argument is a string
literal. It follows the handler reference to the controller method, then uses
the **TypeScript type checker** to extract parameter and return types. The
route registrations in your bootstrap are the single source of truth — nothing
to keep in sync.

### Parameter classification convention

For each handler method parameter, in declaration order:

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
- String-literal unions (`'a' | 'b'`) map to `enum`.
- `Date` maps to `{ type: string, format: date-time }`.
- Named `interface`/`class` types declared in your project are hoisted into
  `components.schemas` and referenced via `$ref`.

## Examples

Runnable **Express**, **Fastify**, and framework-agnostic examples — each with
its generated `openapi.yaml` committed — live in [`examples/`](./examples).
They demonstrate the typed-controller + adapter pattern the tool is designed
for.

## Limitations (MVP scope)

- **Idiomatic `(req, res)` handlers are not supported**: handlers must be
  plain typed methods (`getById(id: string): Order`). Framework
  request/response objects carry no extractable route types — register typed
  controllers through a thin adapter instead (see [`examples/`](./examples)).

- **Single response**: only a `200` response is emitted; no error responses,
  no auth, no other status codes.
- **Type aliases are inlined, not hoisted**: only `interface`/`class`
  declarations from project source files are hoisted into
  `components.schemas`; type aliases and library/`node_modules` types are
  always inlined.
- **Component name collisions are last-write-wins**: if two distinct types in
  the project share a name, whichever is hoisted last silently overwrites the
  earlier component in `components.schemas`. There is no collision detection.
- **Multi-type unions are unsupported**: only string-literal unions (mapped
  to an `enum`) and "optional" unions (`T | undefined`/`null`, including the
  `boolean` special case) are handled. General unions of multiple distinct
  types (e.g. `string | number`) are not mapped to `oneOf` and will not
  produce a meaningful schema.
- **Callable types** (functions, methods) map to an empty schema (`{}`)
  rather than being described.

## License

[MIT](./LICENSE)
