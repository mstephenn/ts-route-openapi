// Thin adapter that lets plain typed controller methods serve Fastify routes.
// ts-route-openapi statically reads the `router.get('/path', Controller.method)`
// call-sites this facade exposes, so the registrations below are both the
// runtime wiring AND the documentation source of truth.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';
type Handler = (...args: never[]) => unknown;

/** Parse parameter names from a function's source text. */
function paramNames(fn: Handler): string[] {
  const match = /\(([^)]*)\)/.exec(fn.toString());
  if (!match || !match[1].trim()) return [];
  return match[1].split(',').map((p) => p.split(/[:=]/)[0].trim());
}

/** Coerce a query-string value the same way the doc convention types it. */
function coerce(value: string): string | number | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value !== '' && !Number.isNaN(Number(value)) ? Number(value) : value;
}

export function createTypedRouter(app: FastifyInstance) {
  const register =
    (verb: Verb) =>
    (path: string, handler: Handler): void => {
      app[verb](path, async (req: FastifyRequest, reply: FastifyReply) => {
        const params = (req.params ?? {}) as Record<string, string>;
        const query = (req.query ?? {}) as Record<string, string | undefined>;
        const args = paramNames(handler).map((name) => {
          if (name in params) return params[name];
          if (name in query) return coerce(String(query[name]));
          return req.body as unknown;
        });
        const result = await (handler as (...a: unknown[]) => unknown)(...args);
        if (result === undefined) return reply.status(404).send();
        return reply.send(result);
      });
    };

  return {
    get: register('get'),
    post: register('post'),
    put: register('put'),
    patch: register('patch'),
    delete: register('delete'),
  };
}
