# Synthetic route source organization

**Date:** 2026-07-12
**Status:** Decided

## Context

Two route sources aren't discovered from call-site registrations
(`app.get('/path', handler)`) — NestJS decorators (`nest-scanner.ts`) and tRPC
procedures (`trpc-scanner.ts` / `trpc-extractor.ts` / `trpc-routes.ts`). Both
ultimately produce `{ route: ResolvedRoute, types: RouteTypes }` pairs for
`buildOpenApi`, but structure their pipelines differently: Nest keeps
discovery and extraction in one file; tRPC splits scanning, `.input()`/
`.output()`/return-type extraction, and route mapping into three.

## Decision

Don't force either into the other's shape:

- **One file** when discovery and `RouteTypes` extraction are simple enough
  to read together in a single pass. Nest's decorator-based discovery and its
  parameter/response classification are each a few lines; splitting them
  wouldn't make either easier to follow or test in isolation.
- **Split into focused modules** when the pipeline has genuinely separable,
  independently-testable stages. tRPC's procedure discovery (router/nesting
  resolution), `.input()`/`.output()`/resolver-return-type extraction, and
  path/verb mapping are each complex enough to warrant their own regression
  tests, and did in fact ship with separate test files per stage.

A future synthetic route source (GraphQL resolvers, gRPC service methods,
etc.) should make the same call based on its own extraction complexity, not
copy whichever of these two happens to be more recent.

## What is shared

Both sources build a `ResolvedRoute` with the same placeholder shape:
`middlewareExpressions: []` always, since middleware is a call-site-
registration concept these sources don't have. That's factored into
`src/synthetic-route.ts`'s `syntheticRoute()` helper — the one genuine
invariant across sources, independent of how each source is organized
internally.

Path-joining (base path + a decorator/procedure path, normalized to one
leading slash with no doubled/trailing slashes) is shared via
`src/route-paths.ts`'s `joinPaths()`.
