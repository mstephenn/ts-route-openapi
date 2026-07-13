import { Node, type Project } from 'ts-morph';
import type { RouteInput } from '../openapi/index.js';
import { mergeResponses, thrownStatusResponses } from '../routes/frameworks/thrown-status.js';
import { joinPaths, syntheticRoute } from '../routes/index.js';
import { extractTrpcProcedureIO } from './trpc-extractor.js';
import { resolveProcedureMiddleware } from './trpc-middleware.js';
import { scanTrpcRouters, type TrpcProcedure } from './trpc-scanner.js';
import type { RouteHandler, RouteTypes } from '../shared/index.js';

/** Statuses thrown by any `.use(fn)` middleware feeding into a procedure's builder chain. */
function middlewareStatuses(procedure: TrpcProcedure): ReturnType<typeof thrownStatusResponses> {
  return resolveProcedureMiddleware(procedure.call).flatMap((fn) => {
    const handler =
      Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || Node.isFunctionDeclaration(fn) ? fn : undefined;
    return handler ? thrownStatusResponses(handler) : [];
  });
}

export interface TrpcRouteOptions {
  /** Prefix every procedure path with this base path. @default '/trpc' */
  basePath?: string;
}

/** `route`/`types` for one procedure: queries -> GET, mutations -> POST, under `basePath/<dotted.path>`. */
function trpcRouteInput(procedure: TrpcProcedure, basePath: string): RouteInput {
  const io = extractTrpcProcedureIO(procedure);
  // resolverFn may be absent (e.g. an unresolvable resolver reference) — fall back to
  // the raw resolver node; downstream consumers of `method` (jsDocText/hasDecorator)
  // duck-type rather than assume a real function-like declaration.
  const method = (io.resolverFn ?? procedure.resolver) as unknown as RouteHandler;

  const route = syntheticRoute({
    verb: procedure.kind === 'mutation' ? 'post' : 'get',
    path: joinPaths(basePath, procedure.path),
    controllerName: '(trpc)',
    handlerName: procedure.path,
    method,
  });

  const thrown = middlewareStatuses(procedure);
  const baseResponses = io.outputSchema ? [{ status: 200, schema: io.outputSchema }] : undefined;
  const responses =
    thrown.length > 0 ? mergeResponses(baseResponses ?? [{ status: 200, type: io.responseType }], thrown) : baseResponses;

  const types: RouteTypes = {
    pathParams: [],
    query: io.inputSchema && procedure.kind === 'query' ? [{ name: 'input', schema: io.inputSchema }] : [],
    bodySchema: procedure.kind === 'mutation' ? io.inputSchema : undefined,
    response: io.responseType,
    responses,
  };

  return { route, types };
}

/** Discover tRPC procedures in `project` and map each to a synthetic OpenAPI route input. */
export function scanTrpcRoutes(project: Project, options: TrpcRouteOptions = {}): RouteInput[] {
  const basePath = options.basePath ?? '/trpc';
  return scanTrpcRouters(project).map((procedure) => trpcRouteInput(procedure, basePath));
}
