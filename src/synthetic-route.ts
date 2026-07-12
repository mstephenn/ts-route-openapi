import type { ResolvedRoute } from './types.js';

/**
 * Build a `ResolvedRoute` for a synthetic (non-call-site) route source — a
 * NestJS decorator, a tRPC procedure, or any future source that isn't an
 * `app.get(...)`-style registration. `middlewareExpressions` is always `[]`:
 * middleware is a call-site-registration concept these sources don't have.
 *
 * Module organization: a synthetic route source is one file (`nest-scanner.ts`)
 * when discovery and `RouteTypes` extraction are simple enough to read
 * together in one pass; it's split into focused modules (`trpc-scanner.ts` ->
 * `trpc-extractor.ts` -> `trpc-routes.ts`) when the extraction pipeline has
 * genuinely separable, independently-testable stages (tRPC's procedure
 * discovery, `.input()`/`.output()`/return-type extraction, and route mapping
 * each have their own regression tests). Don't force a source into extra
 * files it doesn't need, and don't force one into a single file once its
 * stages have outgrown that.
 */
export function syntheticRoute(fields: Omit<ResolvedRoute, 'middlewareExpressions'>): ResolvedRoute {
  return { ...fields, middlewareExpressions: [] };
}
