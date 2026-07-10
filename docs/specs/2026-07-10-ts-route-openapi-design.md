# ts-route-openapi — Design

**Date:** 2026-07-10
**Status:** Approved (design), pending implementation plan

## Summary

A standalone, framework-agnostic CLI that generates an **OpenAPI spec** (JSON/YAML)
from a TypeScript project laid out as **routes → controllers**, using the
**TypeScript type checker** (via ts-morph) as the source of truth. No JSDoc and no
type-duplicating decorators required.

Routes are discovered from the project's **initialization / registration code**
(e.g. `app.get('/users/:id', UsersController.getById)`): the tool reads the HTTP
verb and path from the registration call, follows the handler reference to the
controller method, then type-checks that method's signature and return type.

## Goals

- Emit a valid OpenAPI 3.x document from real TS source, no annotations beyond
  what's already in the route-registration code.
- Framework-agnostic: recognize registration call-sites by configurable method names.
- Accurate types via the type checker (handles inference and named types).

## Non-goals (MVP)

- Auth / security schemes.
- Response codes beyond `200`.
- Descriptions from JSDoc.
- Watch mode.

All are additive later; none are needed to prove the core.

## Architecture

A pipeline of small, independently-testable units. Each stage has one job and a
plain data interface to the next:

```
tsconfig
  -> project-loader
  -> route-scanner
  -> handler-resolver
  -> type-extractor
  -> schema-mapper
  -> openapi-builder
  -> openapi.json / openapi.yaml
```

## Components

| Unit | Input -> Output | Responsibility |
|------|-----------------|----------------|
| **project-loader** | tsconfig path -> ts-morph `Project` | Load the program + type checker |
| **route-scanner** | `Project` + config -> `RouteBinding[]` `{verb, path, handlerRef}` | Find registration call-sites (configurable method names: `get/post/put/patch/delete`); read verb + path literal + handler expression |
| **handler-resolver** | `RouteBinding` -> resolved method `Declaration` (+ controller name) | Follow the handler symbol to its controller method declaration |
| **type-extractor** | method `Declaration` -> `RouteTypes` `{pathParams, query, body, response}` | Use the type checker on the signature params + return type |
| **schema-mapper** | TS `Type` -> OpenAPI schema | Recursively convert primitives, objects, arrays, unions, optionals; hoist named types into `components.schemas` as `$ref`s |
| **openapi-builder** | routes + schemas -> OpenAPI doc | Assemble `paths`/operations/`components`, serialize JSON or YAML |
| **cli** | argv -> file | Glue + config loading |

Each unit is understandable and testable in isolation; internals can change without
breaking consumers because interfaces are plain data.

## Data flow

1. **project-loader** loads the tsconfig and exposes the type checker.
2. **route-scanner** walks the source for registration calls matching the configured
   method names, producing `RouteBinding[]` with `verb`, `path`, and a reference to
   the handler expression.
3. **handler-resolver** resolves each handler reference (e.g. `UsersController.getById`)
   to its method declaration and owning controller name.
4. **type-extractor** reads the method's parameters and return type via the checker.
5. **schema-mapper** converts each extracted TS type into an OpenAPI schema, hoisting
   named types into reusable `components.schemas`.
6. **openapi-builder** assembles the final document and writes JSON or YAML.

## Param classification convention

The type checker gives parameter and return **types**, but not which param is the
path param vs. body vs. query. MVP uses a documented **convention**:

- **Path params:** method params whose **name matches** a `:token` in the route path
  (`getById(id)` + `/users/:id` -> `id` is a path param).
- **Request body:** the first remaining param whose type is an **object/interface**.
- **Query:** remaining primitive params.
- **Response:** the method's **return type**, unwrapping `Promise<T>`, as the `200` schema.

This is explicitly a convention, not inference from decorators. An escape hatch
(reading a Zod schema, or small `@body`/`@query` hints) may be added later if the
convention proves too blunt — out of scope for MVP.

## Configuration

A small config (file or CLI flags) supplies:

- Path to `tsconfig.json`.
- Registration method names to treat as route bindings (default:
  `get/post/put/patch/delete`).
- Output path + format (`json` | `yaml`).

## Testing

- **Unit test per component** against tiny inline TS fixtures.
- **One golden-file test:** a sample controller + bootstrap -> assert the emitted
  `openapi.json` matches an expected fixture file.

## Open questions / future work

- Response codes beyond 200 and error shapes.
- Optional Zod-schema reading for bodies/queries.
- Descriptions sourced from JSDoc (opt-in).
- Watch mode for local dev.
