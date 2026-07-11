import { loadProject } from './project-loader.js';
import { scanRoutes } from './route-scanner.js';
import { resolveHandler } from './handler-resolver.js';
import { extractTypes } from './type-extractor.js';
import { scanNestRoutes } from './nest-scanner.js';
import { buildOpenApi, type ApiInfo, type BuildOptions, type RouteInput } from './openapi-builder.js';
import { loadConfig, type GeneratorConfig } from './config.js';

export interface GenerateOptions extends Omit<BuildOptions, 'config'> {
  config?: GeneratorConfig;
}

/** Full pipeline: load a project, discover routes (call-sites + NestJS decorators), build the doc. */
export function generate(
  tsconfigPath: string,
  info?: ApiInfo,
  options: GenerateOptions = {},
): Record<string, unknown> {
  const project = loadProject(tsconfigPath);
  const inputs: RouteInput[] = [];

  for (const binding of scanRoutes(project)) {
    const route = resolveHandler(binding);
    if (!route) continue;
    inputs.push({ route, types: extractTypes(route) });
  }

  inputs.push(...scanNestRoutes(project));

  return buildOpenApi(inputs, info, {
    ...options,
    config: options.config ?? loadConfig(tsconfigPath),
  });
}
