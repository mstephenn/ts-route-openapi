import type { ParameterDeclaration } from 'ts-morph';
import type { ResolvedRoute, RouteTypes } from '../../shared/index.js';
import { objectParams, tokenParams, typeName, usableObject, usableResponse } from './shared.js';
import { expressStatusResponses } from './status-calls.js';

/**
 * Express: `(req: Request<Params, ResBody, ReqBody, Query>, res: Response<ResBody>)`.
 * Types come from the Request/Response generic arguments; a plain `Request`
 * falls back to path-token string params (ParamsDictionary is index-signed).
 */
export function extractExpress(
  route: ResolvedRoute,
  params: ParameterDeclaration[],
): RouteTypes | null {
  const req = params[0];
  if (!req || typeName(req.getType()) !== 'Request') return null;

  const args = req.getType().getTypeArguments();
  const res = params[1];
  const resArg =
    res && typeName(res.getType()) === 'Response'
      ? res.getType().getTypeArguments()[0]
      : undefined;

  const response = usableResponse(resArg) ?? usableResponse(args[1]);
  const responses = res ? expressStatusResponses(route.method, res, response) : [];

  return {
    pathParams: objectParams(args[0], req) ?? tokenParams(route),
    query: objectParams(args[3], req) ?? [],
    body: usableObject(args[2]),
    response,
    responses: responses.length > 0 ? responses : undefined,
  };
}
