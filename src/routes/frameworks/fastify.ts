import type { ParameterDeclaration } from 'ts-morph';
import type { ResolvedRoute, RouteTypes } from '../../shared/index.js';
import {
  objectParams,
  tokenParams,
  typeName,
  unwrapPromise,
  usable,
  usableObject,
  usableResponse,
} from './shared.js';
import { fastifyStatusResponses } from './status-calls.js';

/**
 * Fastify: `(req: FastifyRequest<{ Params; Body; Querystring; Reply }>, reply)`.
 * Types come from the route-generic object; the response prefers the handler's
 * return type (Fastify handlers return the payload), then the Reply member.
 */
export function extractFastify(
  route: ResolvedRoute,
  params: ParameterDeclaration[],
): RouteTypes | null {
  const req = params[0];
  if (!req || typeName(req.getType()) !== 'FastifyRequest') return null;

  const generic = usable(req.getType().getTypeArguments()[0]);
  const member = (name: string) => generic?.getProperty(name)?.getTypeAtLocation(req);

  // A handler returning the reply object itself (`return reply.send(x)`, or a
  // helper that does the same) already sent its response elsewhere — the
  // return type is FastifyReply's own shape, not a payload, so it must be
  // ignored rather than turned into a schema.
  const returnType = unwrapPromise(route.method.getReturnType());
  const replyParam = params[1];
  const returnsReply = replyParam && typeName(returnType) === typeName(replyParam.getType());
  const response =
    (returnsReply ? undefined : usableResponse(returnType)) ?? usableResponse(member('Reply'));
  const responses = fastifyStatusResponses(route.method, params[1], response);

  return {
    pathParams: objectParams(member('Params'), req) ?? tokenParams(route),
    query: objectParams(member('Querystring'), req) ?? [],
    body: usableObject(member('Body')),
    response,
    responses: responses.length > 0 ? responses : undefined,
  };
}
