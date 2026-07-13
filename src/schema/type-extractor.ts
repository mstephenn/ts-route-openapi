import type { ParameterDeclaration } from 'ts-morph';
import { tryFrameworkExtractors, tokenParams, pathTokens, withThrownStatuses } from '../routes/index.js';
import type { ParamType, ResolvedRoute, RouteTypes } from '../shared/index.js';
import { extractValidatorSchemas } from './validator-schemas.js';

/**
 * Extract a route's request/response types from its handler signature.
 *
 * Order of precedence:
 * 1. A known framework's extractor (Express/Fastify/Hono/Koa) recognizes the
 *    handler's parameter types and reads the framework generics.
 * 2. An unknown framework-like handler (first parameter's type declared in
 *    node_modules) falls back to path-token string params.
 * 3. Plain typed handlers use the classification convention:
 *    - path params: param name matches a `:token` in the path
 *    - body: first remaining object-typed (non-array) param
 *    - query: everything else
 *    - response: return type, unwrapping Promise<T>
 */
export function extractTypes(route: ResolvedRoute): RouteTypes {
  const params = route.method.getParameters();
  const validators = extractValidatorSchemas(route.middlewareExpressions);
  const finalize = (types: RouteTypes) => finalizeTypes(types, route, validators);

  const framework = tryFrameworkExtractors(route, params);
  if (framework) return finalize(framework);

  if (isFrameworkLike(params[0])) {
    return finalize({ pathParams: tokenParams(route), query: [] });
  }

  const tokens = pathTokens(route.path);
  const tokenSet = new Set(tokens);
  const pathParams: ParamType[] = [];
  const query: ParamType[] = [];
  let body: RouteTypes['body'];

  for (const param of params) {
    const name = param.getName();
    const type = param.getType();

    if (tokenSet.has(name)) {
      pathParams.push({ name, type });
    } else if (!body && type.isObject() && !type.isArray()) {
      body = type;
    } else {
      query.push({ name, type });
    }
  }

  // Tokens with no matching parameter still exist in the URL — document them
  // as string path params rather than dropping them.
  for (const name of tokens) {
    if (!pathParams.some((p) => p.name === name)) pathParams.push({ name });
  }

  let response = route.method.getReturnType();
  if (response.getSymbol()?.getName() === 'Promise') {
    const args = response.getTypeArguments();
    if (args.length === 1) response = args[0];
  }

  return finalize({ pathParams, query, body, response });
}

function finalizeTypes(
  types: RouteTypes,
  route: ResolvedRoute,
  validators: ReturnType<typeof extractValidatorSchemas>,
): RouteTypes {
  const thrownResponses = withThrownStatuses(types, route.method);
  const responses = validators.responses
    ? mergeResponses(thrownResponses ?? implicitResponses(types), validators.responses)
    : thrownResponses;
  return {
    ...types,
    pathParams: validators.pathParams ?? types.pathParams,
    query: validators.query ?? types.query,
    headers: validators.headers ?? types.headers,
    cookies: validators.cookies ?? types.cookies,
    bodySchema: validators.bodySchema ?? types.bodySchema,
    responses,
  };
}

function implicitResponses(types: RouteTypes): NonNullable<RouteTypes['responses']> {
  return types.responses ?? [{ status: 200, type: types.response }];
}

function mergeResponses(
  base: NonNullable<RouteTypes['responses']>,
  additions: NonNullable<RouteTypes['responses']>,
): NonNullable<RouteTypes['responses']> | undefined {
  if (additions.length === 0) return base.length > 0 ? base : undefined;
  const merged = new Map(base.map((entry) => [entry.status, entry]));
  for (const addition of additions) {
    const existing = merged.get(addition.status);
    if (!existing || (!existing.schema && !existing.type)) merged.set(addition.status, addition);
  }
  return [...merged.values()].sort((a, b) => a.status - b.status);
}

/** True when the parameter's type is declared outside the project (a framework object). */
function isFrameworkLike(param: ParameterDeclaration | undefined): boolean {
  if (!param) return false;
  const type = param.getType();
  const symbol = type.getAliasSymbol() ?? type.getSymbol();
  const declaration = symbol?.getDeclarations()[0];
  return declaration?.getSourceFile().isInNodeModules() ?? false;
}
