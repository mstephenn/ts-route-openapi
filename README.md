# ts-route-openapi

Generate an OpenAPI 3.0.3 spec from a TypeScript route→controller codebase by
statically analyzing the source with [ts-morph](https://ts-morph.com/) — no
runtime instrumentation, decorators, or annotations required.

## Install

```sh
npm install ts-route-openapi
```

## Usage

```sh
npx ts-route-openapi [tsconfig] -o openapi.json -f json --title "My API" --api-version 1.0.0
```

| Flag                    | Default          | Description                                  |
| ----------------------- | ---------------- | --------------------------------------------- |
| `[tsconfig]` (positional) | `tsconfig.json`  | Path to the project's `tsconfig.json`         |
| `-o, --out <file>`      | `openapi.json`   | Output file path                              |
| `-f, --format <fmt>`    | `json`           | Output format: `json` or `yaml`               |
| `--title <title>`       | `API`            | Spec `info.title`                             |
| `--api-version <version>` | `1.0.0`        | Spec `info.version`                           |

## How routes are discovered

The tool scans the project (as configured by the given `tsconfig.json`) for
route bindings, resolves each bound handler method, and extracts its
parameter and return types to build one OpenAPI operation per route.

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

## Limitations (MVP scope)

- **Single response**: only a `200` response is emitted; no error responses,
  no auth, no other status codes.
- **Type aliases are inlined, not hoisted**: only `interface`/`class`
  declarations from project source files are hoisted into
  `components.schemas`; type aliases and library/`node_modules` types
  (e.g. `Date`, which maps to `{ type: string, format: date-time }`) are
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
