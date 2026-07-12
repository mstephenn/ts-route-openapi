import type { ParameterDeclaration } from 'ts-morph';
import type { ResolvedRoute, RouteTypes } from '../../shared/index.js';
import { fromPackage, typeName, tokenParams } from './shared.js';

const CONTEXT_NAMES = new Set(['Context', 'ParameterizedContext', 'RouterContext', 'ExtendableContext']);
const PACKAGES = ['koa', 'koa-router', 'koa__router'];

/**
 * Koa (+ @koa/router): `(ctx) => ...`. Koa's Context carries no static
 * route-specific types, so only path tokens are documentable.
 */
export function extractKoa(
  route: ResolvedRoute,
  params: ParameterDeclaration[],
): RouteTypes | null {
  const ctx = params[0];
  if (!ctx) return null;
  const type = ctx.getType();
  const name = typeName(type);
  if (!name || !CONTEXT_NAMES.has(name)) return null;
  if (!PACKAGES.some((pkg) => fromPackage(type, pkg))) return null;

  return { pathParams: tokenParams(route), query: [] };
}
