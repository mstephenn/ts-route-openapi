import type { Project } from 'ts-morph';
import type { RouteInput } from './openapi-builder.js';
import { extractTrpcProcedureIO, resolverFunction } from './trpc-extractor.js';
import { scanTrpcRouters, type TrpcProcedure } from './trpc-scanner.js';
import type { ResolvedRoute, RouteHandler, RouteTypes } from './types.js';

export interface TrpcRouteOptions {
  /** Prefix every procedure path with this base path. @default '/trpc' */
  basePath?: string;
}

/** `route`/`types` for one procedure: queries -> GET, mutations -> POST, under `basePath/<dotted.path>`. */
function trpcRouteInput(procedure: TrpcProcedure, basePath: string): RouteInput {
  const io = extractTrpcProcedureIO(procedure);
  const method = (resolverFunction(procedure.resolver) ?? procedure.resolver) as RouteHandler;

  const route: ResolvedRoute = {
    verb: procedure.kind === 'mutation' ? 'post' : 'get',
    path: `${basePath}/${procedure.path}`,
    controllerName: '(trpc)',
    handlerName: procedure.path,
    method,
    middlewareExpressions: [],
  };

  const types: RouteTypes = {
    pathParams: [],
    query: io.inputSchema && procedure.kind === 'query' ? [{ name: 'input', schema: io.inputSchema }] : [],
    bodySchema: procedure.kind === 'mutation' ? io.inputSchema : undefined,
    response: io.outputSchema ? undefined : io.responseType,
    responses: io.outputSchema ? [{ status: 200, schema: io.outputSchema }] : undefined,
  };

  return { route, types };
}

/** Discover tRPC procedures in `project` and map each to a synthetic OpenAPI route input. */
export function scanTrpcRoutes(project: Project, options: TrpcRouteOptions = {}): RouteInput[] {
  const basePath = options.basePath ?? '/trpc';
  return scanTrpcRouters(project).map((procedure) => trpcRouteInput(procedure, basePath));
}
