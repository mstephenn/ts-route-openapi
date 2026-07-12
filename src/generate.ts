import { loadProject } from './project-loader.js';
import { scanRoutes, resolveHandler, scanNestRoutes } from './routes/index.js';
import { extractTypes } from './schema/index.js';
import { scanTrpcRoutes, type TrpcRouteOptions } from './trpc/index.js';
import {
  buildOpenApi,
  type ApiInfo,
  type BuildOptions,
  type RouteInput,
  type OpenApiDocument,
} from './openapi/index.js';
import { loadConfig, type GeneratorConfig } from './config.js';

export interface GenerateOptions extends Omit<BuildOptions, 'config'> {
  config?: GeneratorConfig;
  trpc?: TrpcRouteOptions;
}

/** Full pipeline: load a project, discover routes (call-sites + NestJS decorators + tRPC routers), build the doc. */
export function generate(
  tsconfigPath: string,
  info?: ApiInfo,
  options: GenerateOptions = {},
): OpenApiDocument {
  const project = loadProject(tsconfigPath);
  const inputs: RouteInput[] = [];

  for (const binding of scanRoutes(project)) {
    const route = resolveHandler(binding);
    if (!route) continue;
    inputs.push({ route, types: extractTypes(route) });
  }

  inputs.push(...scanNestRoutes(project));
  inputs.push(...scanTrpcRoutes(project, options.trpc));

  return buildOpenApi(inputs, info, {
    ...options,
    config: options.config ?? loadConfig(tsconfigPath),
  });
}
