import type { ParameterDeclaration } from 'ts-morph';
import type { ResolvedRoute, RouteTypes } from '../../shared/index.js';
import { fromPackage, tokenParams, typeName, unwrapPromise, usableResponse } from './shared.js';

/**
 * Hono: `(c: Context) => c.json(payload)`. The response payload rides in the
 * `TypedResponse<T>` the handler returns; params come from path tokens
 * (Hono types them from the path string literal, which is not recoverable
 * through a plain parameter type).
 */
export function extractHono(
  route: ResolvedRoute,
  params: ParameterDeclaration[],
): RouteTypes | null {
  const c = params[0];
  if (!c) return null;
  const type = c.getType();
  if (typeName(type) !== 'Context' || !fromPackage(type, 'hono')) return null;

  const returned = unwrapPromise(route.method.getReturnType());
  const candidates = returned.isIntersection() ? returned.getIntersectionTypes() : [returned];
  let response;
  for (const candidate of candidates) {
    if (typeName(candidate) === 'TypedResponse') {
      // Hono carries the payload in alias type arguments (TypedResponse<T, Status, Format>).
      const args = [...candidate.getAliasTypeArguments(), ...candidate.getTypeArguments()];
      response = usableResponse(args[0]);
      break;
    }
  }

  return { pathParams: tokenParams(route), query: [], response };
}
