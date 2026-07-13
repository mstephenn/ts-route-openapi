# Cross-file Express Error-Middleware Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect Express error-handling middleware (`app.use((err, req, res, next) => ...)`) registered on the same `app`/router instance anywhere in the project — not just in the route's own file — and fold its statuses into that route's responses.

**Architecture:** Thread the route registration's receiver expression (e.g. the `app` in `app.get(...)`) through `RouteBinding` → `ResolvedRoute`. Add a `sameAppInstance` symbol-identity check (same pattern as the existing `refersToParam` helper). Widen `expressErrorMiddlewareStatuses` to scan every file in the ts-morph project, keeping a `.use()` call's statuses when it's in the same file as the route (unconditional, unchanged from today) OR its receiver resolves to the same symbol as the route's receiver.

**Tech Stack:** TypeScript, ts-morph, vitest.

## Global Constraints

- Express only — this plan does not touch Fastify/Koa/NestJS status detection.
- No import/re-export graph walking beyond what ts-morph's checker (`getSymbol()`/`getDeclarations()`) resolves natively.
- No ordering semantics — a matching `.use()` anywhere contributes its statuses regardless of registration order (same simplification as today's same-file behavior, just widened in scope).
- Router-mounted sub-apps (`app.use('/prefix', router)` then `router.get(...)`) stay out of scope — `router` and `app` are different symbols and this plan does not connect them.

---

### Task 1: Thread the route's receiver expression through `RouteBinding` and `ResolvedRoute`

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/routes/route-scanner.ts`
- Modify: `src/routes/handler-resolver.ts`
- Test: `test/route-scanner.test.ts`

**Interfaces:**
- Consumes: `MethodCall` (`src/shared/ast-helpers.ts`) — already has `receiver: Expression`.
- Produces: `RouteBinding.receiver: Expression` and `ResolvedRoute.receiver: Expression`, consumed by Task 3.

- [ ] **Step 1: Write the failing test**

Add to `test/route-scanner.test.ts`:

```ts
test('scanRoutes captures the receiver expression the route is registered on', () => {
  const project = createProjectWithSource(`
    declare const app: any;
    app.get('/users/:id', () => {});
  `);
  const [binding] = scanRoutes(project);

  expect(binding.receiver.getText()).toBe('app');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/route-scanner.test.ts`
Expected: FAIL — `binding.receiver` is `undefined`, so `.getText()` throws `Cannot read properties of undefined (reading 'getText')`.

- [ ] **Step 3: Add `receiver` to `RouteBinding` and `ResolvedRoute`**

In `src/shared/types.ts`, add `Expression` to the `ts-morph` type import (line 1-8) and add the field to both interfaces:

```ts
import type {
  ArrowFunction,
  Expression,
  FunctionDeclaration,
  FunctionExpression,
  MethodDeclaration,
  Node,
  Type,
} from 'ts-morph';
```

```ts
export interface RouteBinding {
  verb: HttpVerb;
  path: string;
  handlerExpression: Node;
  middlewareExpressions: Node[];
  receiver: Expression;
}
```

```ts
export interface ResolvedRoute {
  verb: HttpVerb;
  path: string;
  controllerName: string;
  handlerName: string;
  method: RouteHandler;
  middlewareExpressions: Node[];
  receiver: Expression;
}
```

- [ ] **Step 4: Populate `receiver` in `scanRoutes`**

In `src/routes/route-scanner.ts`, capture `receiver` from the loop destructure (line 17) and include it in the pushed binding (lines 25-30):

```ts
    for (const { node, method, receiver } of methodCallsIn(sourceFile, verbSet)) {
      const args = node.getArguments();
      if (args.length < 2) continue;
      const pathArg = args[0];
      if (!Node.isStringLiteral(pathArg)) continue;
      const handlerIndex = lastHandlerIndex(args);
      if (handlerIndex < 1) continue;

      bindings.push({
        verb: method as HttpVerb,
        path: pathArg.getLiteralValue(),
        handlerExpression: args[handlerIndex],
        middlewareExpressions: args.slice(1, handlerIndex),
        receiver,
      });
    }
```

- [ ] **Step 5: Propagate `receiver` in `resolveHandler`**

In `src/routes/handler-resolver.ts`, add `receiver` to the `base` object (lines 13-17):

```ts
  const base = {
    verb: binding.verb,
    path: binding.path,
    middlewareExpressions: binding.middlewareExpressions,
    receiver: binding.receiver,
  };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/route-scanner.test.ts`
Expected: PASS

- [ ] **Step 7: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: All existing tests still PASS (adding a required field to an interface used only internally does not change any existing behavior).

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/routes/route-scanner.ts src/routes/handler-resolver.ts test/route-scanner.test.ts
git commit -m "feat: thread route receiver expression through RouteBinding/ResolvedRoute"
```

---

### Task 2: Add a `sameAppInstance` symbol-identity helper

**Files:**
- Modify: `src/routes/frameworks/status-calls.ts`
- Test: `test/frameworks/status-calls.test.ts`

**Interfaces:**
- Consumes: nothing new (uses `Node`/`Expression` from `ts-morph`, already imported in `status-calls.ts`).
- Produces: `export function sameAppInstance(a: Node, b: Node): boolean`, consumed by Task 3.

- [ ] **Step 1: Write the failing test**

Add to `test/frameworks/status-calls.test.ts` (add `createProjectWithFiles` to the existing import from `../support/project.js`, and import `methodCallsIn` and `sameAppInstance`):

```ts
import { methodCallsIn } from '../../src/shared/index.js';
import { sameAppInstance } from '../../src/routes/frameworks/status-calls.js';
import { createProjectWithFiles, createProjectWithSource, scanResolvedRoutes } from '../support/project.js';
```

```ts
test('sameAppInstance matches an app identifier to itself across files via import, not to an unrelated identifier', () => {
  const project = createProjectWithFiles({
    'app.ts': `export declare const app: any;`,
    'routes.ts': `
      import { app } from './app.js';
      app.get('/x', () => {});
    `,
    'error-handler.ts': `
      import { app } from './app.js';
      app.use((err: any, req: any, res: any, next: any) => {});
    `,
    'other.ts': `
      declare const other: any;
      other.use((err: any, req: any, res: any, next: any) => {});
    `,
  });

  const routeCall = methodCallsIn(project.getSourceFileOrThrow('routes.ts'), new Set(['get']))[0];
  const errorCall = methodCallsIn(project.getSourceFileOrThrow('error-handler.ts'), new Set(['use']))[0];
  const otherCall = methodCallsIn(project.getSourceFileOrThrow('other.ts'), new Set(['use']))[0];

  expect(sameAppInstance(routeCall.receiver, errorCall.receiver)).toBe(true);
  expect(sameAppInstance(routeCall.receiver, otherCall.receiver)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/frameworks/status-calls.test.ts`
Expected: FAIL — `sameAppInstance` doesn't exist yet (import error / undefined is not a function).

- [ ] **Step 3: Implement `sameAppInstance`**

In `src/routes/frameworks/status-calls.ts`, add after `refersToParam` (after line 18):

```ts
/** True when both expressions are identifiers resolving to the same declaration — e.g. the same `app` variable, even across an import. */
export function sameAppInstance(a: Node, b: Node): boolean {
  if (!Node.isIdentifier(a) || !Node.isIdentifier(b)) return false;
  const declA = a.getSymbol()?.getDeclarations()[0];
  const declB = b.getSymbol()?.getDeclarations()[0];
  return declA !== undefined && declA === declB;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/frameworks/status-calls.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/frameworks/status-calls.ts test/frameworks/status-calls.test.ts
git commit -m "feat: add sameAppInstance helper for cross-file receiver matching"
```

---

### Task 3: Scan the whole project for matching-instance error middleware

**Files:**
- Modify: `src/routes/frameworks/thrown-status.ts`
- Modify: `src/routes/frameworks/express.ts`
- Test: `test/frameworks/status-calls.test.ts`

**Interfaces:**
- Consumes: `sameAppInstance` (Task 2), `ResolvedRoute.receiver` (Task 1).
- Produces: `expressErrorMiddlewareStatuses(route: ResolvedRoute): ResponseType[]` (signature change from `(sourceFile: SourceFile)`).

- [ ] **Step 1: Write the failing tests**

Add to `test/frameworks/status-calls.test.ts`:

```ts
test('a cross-file Express error-handling middleware on the same app instance adds its statuses too', () => {
  const project = createProjectWithFiles({
    'app.ts': `export declare const app: any;`,
    'routes.ts': `
      ${EXPRESS_DECLS}
      import { app } from './app.js';
      interface Order { id: string }
      app.get('/orders/:id', (req: Request<{ id: string }>, res: Response<Order>) => {
        res.json({ id: 'x' } as Order);
      });
    `,
    'error-handler.ts': `
      ${EXPRESS_DECLS}
      import { app } from './app.js';
      app.use((err: unknown, req: Request, res: Response, next: () => void) => {
        res.status(500).json({ message: 'boom' });
      });
    `,
  });
  const [route] = scanResolvedRoutes(project);
  const types = extractTypes(route);

  expect(types.responses?.map((r) => [r.status, r.type?.getText()])).toEqual([
    [200, 'Order'],
    [500, undefined],
  ]);
});

test('error middleware on an unrelated app instance in another file is not applied', () => {
  const project = createProjectWithFiles({
    'app-a.ts': `export declare const appA: any;`,
    'app-b.ts': `export declare const appB: any;`,
    'routes.ts': `
      ${EXPRESS_DECLS}
      import { appA } from './app-a.js';
      interface Order { id: string }
      appA.get('/orders/:id', (req: Request<{ id: string }>, res: Response<Order>) => {
        res.json({ id: 'x' } as Order);
      });
    `,
    'error-handler.ts': `
      ${EXPRESS_DECLS}
      import { appB } from './app-b.js';
      appB.use((err: unknown, req: Request, res: Response, next: () => void) => {
        res.status(500).json({ message: 'boom' });
      });
    `,
  });
  const [route] = scanResolvedRoutes(project);
  const types = extractTypes(route);

  expect(types.responses).toBeUndefined();
  expect(types.response?.getText()).toBe('Order');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/frameworks/status-calls.test.ts`
Expected: The cross-file test FAILs (middleware in a different file is not detected — `types.responses` only has `[200, 'Order']`, missing `500`). The negative test passes already (nothing to regress), which is fine — it documents the boundary and will keep passing after the fix.

- [ ] **Step 3: Widen `expressErrorMiddlewareStatuses` to scan the whole project**

In `src/routes/frameworks/thrown-status.ts`:

Update the imports (lines 1-8): `SourceFile` from `ts-morph` is no longer needed (it was only used by this function's old signature) and `ResolvedRoute` is added from `../../shared/index.js`:

```ts
import { Node, SyntaxKind, type ClassDeclaration } from 'ts-morph';
import {
  methodCallInfo,
  resolveIdentifierDeclaration,
  type ResolvedRoute,
  type ResponseType,
  type RouteHandler,
} from '../../shared/index.js';
import { expressStatusResponses, literalStatus, sameAppInstance } from './status-calls.js';
```

Replace `expressErrorMiddlewareStatuses` (current lines 83-102) with:

```ts
/**
 * Statuses set by an Express error-handling middleware — `app.use((err, req, res, next) => ...)` —
 * applied to a route when the middleware is in the route's own file (unconditionally) or is
 * registered on the same app/router instance (by symbol identity) anywhere else in the project.
 */
export function expressErrorMiddlewareStatuses(route: ResolvedRoute): ResponseType[] {
  const statuses = new Set<number>();
  const routeFile = route.method.getSourceFile();

  for (const sourceFile of routeFile.getProject().getSourceFiles()) {
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const info = methodCallInfo(call);
      if (!info || info.method !== 'use') continue;
      const handler = asErrorHandler(info.node.getArguments()[0]);
      const resParam = handler?.getParameters()[2];
      if (!handler || !resParam) continue;

      const sameFile = sourceFile === routeFile;
      if (!sameFile && !sameAppInstance(info.receiver, route.receiver)) continue;

      for (const { status } of expressStatusResponses(handler, resParam, undefined)) {
        if (status !== 200) statuses.add(status);
      }
    }
  }

  return [...statuses].sort((a, b) => a - b).map((status) => ({ status }));
}
```

- [ ] **Step 4: Update the call site**

In `src/routes/frameworks/express.ts`, change line 28 from:

```ts
  const middlewareStatuses = res ? expressErrorMiddlewareStatuses(route.method.getSourceFile()) : [];
```

to:

```ts
  const middlewareStatuses = res ? expressErrorMiddlewareStatuses(route) : [];
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/frameworks/status-calls.test.ts`
Expected: PASS, including the pre-existing same-file middleware test (line 151) and both new tests.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/routes/frameworks/thrown-status.ts src/routes/frameworks/express.ts test/frameworks/status-calls.test.ts
git commit -m "feat: detect Express error middleware across files on the same app instance"
```

---

### Task 4: Update the README limitation

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Narrow the documented limitation**

In `README.md`, replace the first bullet under `## Limitations` (current lines 227-236):

```markdown
- **Status codes are detected, not exhaustive**: `res.status(N)` /
  `reply.code(N)` / `@HttpCode(N)` produce per-status responses. `throw new
  X(...)` is also detected when `X` is a NestJS built-in `HttpException`
  subclass (by name), a generic `HttpException(_, status)`, or a local
  class whose own or inherited `status`/`statusCode` property is a numeric
  literal. Express's `app.use((err, req, res, next) => ...)` error-handling
  middleware contributes its `res.status(N)` calls to every route in the
  same file. Statuses set any other way — resolved dynamically, thrown
  from a re-exported third-party exception class, or set by middleware
  registered in a different file than the routes it guards — are not seen.
```

with:

```markdown
- **Status codes are detected, not exhaustive**: `res.status(N)` /
  `reply.code(N)` / `@HttpCode(N)` produce per-status responses. `throw new
  X(...)` is also detected when `X` is a NestJS built-in `HttpException`
  subclass (by name), a generic `HttpException(_, status)`, or a local
  class whose own or inherited `status`/`statusCode` property is a numeric
  literal. Express's `app.use((err, req, res, next) => ...)` error-handling
  middleware contributes its `res.status(N)` calls to every route
  registered on the same `app`/router instance, whether or not the
  middleware lives in the same file. Statuses set any other way — resolved
  dynamically, thrown from a re-exported third-party exception class, or
  set by middleware on a router mounted into the app (`app.use('/prefix',
  router)`) rather than the app instance itself — are not seen.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: narrow the error-middleware README limitation to router-mounted sub-apps"
```

## Self-Review Notes

- **Spec coverage:** data flow (Task 1), matching logic (Task 2), `expressErrorMiddlewareStatuses`/call-site changes (Task 3), positive + negative cross-file tests (Task 3), README scope update (Task 4). All spec sections have a corresponding task.
- **Placeholders:** none — every step has literal code/commands.
- **Type consistency:** `receiver: Expression` is identical across `RouteBinding`, `ResolvedRoute`, and the `sameAppInstance(a: Node, b: Node)` signature (its params are typed as the wider `Node` since `methodCallInfo`'s `MethodCall.receiver` is an `Expression`, which is a `Node`); `expressErrorMiddlewareStatuses` consistently takes `ResolvedRoute` in Task 3 and is called with `route` (already a `ResolvedRoute`) in `express.ts`.
