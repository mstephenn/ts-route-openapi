# Cross-file Express error-middleware status detection

## Problem

`expressErrorMiddlewareStatuses` (src/routes/frameworks/thrown-status.ts) only
looks for `app.use((err, req, res, next) => ...)` calls in the same source
file as the route it's contributing statuses to
(`route.method.getSourceFile()`, used at src/routes/frameworks/express.ts:28).
In real projects, routes are often registered in one file and error-handling
middleware is registered in another (e.g. a shared `bootstrap.ts`). Today
those statuses are silently missed. This is documented as a known limitation
in README.md.

## Goal

Detect error-handling middleware registered on the same `app`/router
*instance* anywhere in the project, not just in the same file, and fold its
statuses into the routes that instance serves — without cross-contaminating
routes that belong to a different, unrelated app instance in the same
project.

## Approach

Match by ts-morph symbol identity of the receiver expression (the `app` in
`app.get(...)` / `app.use(...)`), reusing the existing symbol-comparison
pattern already used by `refersToParam` (src/routes/frameworks/status-calls.ts:15-17).

### Data flow

- `RouteBinding` (src/shared/types.ts:14-19) gains a `receiver: Expression`
  field, populated from `methodCallInfo`'s already-parsed `receiver`
  (src/shared/ast-helpers.ts:10-15), which `route-scanner.ts` currently
  discards.
- `ResolvedRoute` (src/shared/types.ts:29-36) gains the same `receiver` field,
  threaded through `handler-resolver.ts` alongside the existing route
  fields.

### Matching logic

New helper, e.g. `sameAppInstance(a: Expression, b: Expression): boolean`
(colocated with `refersToParam` in status-calls.ts, or in thrown-status.ts):

- Both `a` and `b` must be `Node.isIdentifier`.
- Resolve each via `getSymbol()?.getDeclarations()[0]`.
- Return `true` iff both resolve to a declaration and the declarations are
  the same node.
- Any failure to resolve (non-identifier receiver, no symbol, no
  declaration) returns `false` — this only gates the *cross-file* match; it
  never suppresses the existing same-file behavior (see below).

### `expressErrorMiddlewareStatuses` changes

- Signature changes from `(sourceFile: SourceFile)` to accept the route (or
  at least its `method` and `receiver`).
- Scans `.use(...)` calls across every file in the project
  (`route.method.getSourceFile().getProject().getSourceFiles()`) instead of
  just the route's own file.
- Keeps a `.use()` call's 4-arg-handler statuses when either:
  - it's in the same file as the route (unconditional, preserves current
    behavior exactly — no regression risk from symbol-resolution edge
    cases), OR
  - `sameAppInstance(call receiver, route receiver)` is true.
- Call site update: src/routes/frameworks/express.ts:28 passes the route (or
  its receiver) instead of just the source file.

## Explicit scope boundaries

- **Express only.** Fastify/Koa/NestJS status detection is unaffected.
- **No import/re-export graph walk.** Relies entirely on ts-morph's checker
  via `getSymbol()`/`getDeclarations()` — the same mechanism
  `resolveIdentifierDeclaration` already uses elsewhere in the codebase. No
  bespoke tracing of import chains beyond what the checker resolves natively.
- **No ordering semantics.** Like the current same-file behavior, a matching
  `.use()` anywhere contributes its statuses regardless of whether it's
  registered before or after the route in the app's actual runtime
  middleware order. This is a known simplification carried forward
  unchanged, not a new one.
- **Router-mounted sub-apps out of scope.** `app.use('/prefix', router)`
  followed by `router.get(...)` involves two distinct symbols (`app` vs
  `router`) and this fix does not connect them. The README limitation should
  be updated to note this remaining gap rather than claim full coverage.

## Testing

- New fixture: two-file Express example — one file registers routes on
  `app`, a separate file (importing the same `app`) registers
  `app.use((err, req, res, next) => ...)`. Assert the routes' responses
  include the middleware's statuses.
- Negative case: two unrelated `app` instances in the same project (e.g. two
  independent Express apps/files) — assert no cross-contamination between
  them.
- All existing same-file middleware tests must keep passing unchanged.

## Out of scope for this change

- The second README limitation (overloaded call signatures only describing
  the first overload) is a separate, independently-scoped fix and is not
  part of this spec.
