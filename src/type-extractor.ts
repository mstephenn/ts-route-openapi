import type { ParamType, ResolvedRoute, RouteTypes } from './types.js';

/** Collect `:token` names from a route path. */
function pathTokens(path: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of path.matchAll(/:([A-Za-z0-9_]+)/g)) tokens.add(match[1]);
  return tokens;
}

/**
 * Classify a resolved route's parameters using the MVP convention:
 * - path params: param name matches a `:token` in the path
 * - body: first remaining object-typed (non-array) param
 * - query: everything else
 * - response: return type, unwrapping Promise<T>
 */
export function extractTypes(route: ResolvedRoute): RouteTypes {
  const tokens = pathTokens(route.path);
  const pathParams: ParamType[] = [];
  const query: ParamType[] = [];
  let body: RouteTypes['body'];

  for (const param of route.method.getParameters()) {
    const name = param.getName();
    const type = param.getType();

    if (tokens.has(name)) {
      pathParams.push({ name, type });
    } else if (!body && type.isObject() && !type.isArray()) {
      body = type;
    } else {
      query.push({ name, type });
    }
  }

  let response = route.method.getReturnType();
  if (response.getSymbol()?.getName() === 'Promise') {
    const args = response.getTypeArguments();
    if (args.length === 1) response = args[0];
  }

  return { pathParams, query, body, response };
}
