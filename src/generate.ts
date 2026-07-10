import { loadProject } from './project-loader.js';
import { scanRoutes } from './route-scanner.js';
import { resolveHandler } from './handler-resolver.js';
import { extractTypes } from './type-extractor.js';
import { buildOpenApi, type ApiInfo, type RouteInput } from './openapi-builder.js';

/** Full pipeline: load a project, discover routes, and build the OpenAPI doc. */
export function generate(tsconfigPath: string, info?: ApiInfo): Record<string, unknown> {
  const project = loadProject(tsconfigPath);
  const inputs: RouteInput[] = [];

  for (const binding of scanRoutes(project)) {
    const route = resolveHandler(binding);
    if (!route) continue;
    inputs.push({ route, types: extractTypes(route) });
  }

  return buildOpenApi(inputs, info);
}
