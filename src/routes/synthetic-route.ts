import type { ResolvedRoute } from '../shared/index.js';

/**
 * Build a `ResolvedRoute` for a synthetic (non-call-site) route source — a
 * NestJS decorator, a tRPC procedure, or any future source that isn't an
 * `app.get(...)`-style registration. `middlewareExpressions` is always `[]`:
 * middleware is a call-site-registration concept these sources don't have.
 *
 * See `docs/specs/2026-07-12-synthetic-route-source-organization.md` for the
 * decision on how a synthetic source's files should be organized.
 */
export function syntheticRoute(fields: Omit<ResolvedRoute, 'middlewareExpressions'>): ResolvedRoute {
  return { ...fields, middlewareExpressions: [] };
}
