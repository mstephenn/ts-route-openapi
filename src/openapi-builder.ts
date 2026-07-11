import { mapType } from './schema-mapper.js';
import type { ResolvedRoute, RouteTypes } from './types.js';

export interface RouteInput {
  route: ResolvedRoute;
  types: RouteTypes;
}

export interface ApiInfo {
  title: string;
  version: string;
}

type Json = Record<string, unknown>;

/** Convert `/orgs/:id/users` to the OpenAPI `/orgs/{id}/users` template form. */
function templatePath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

export function buildOpenApi(
  inputs: RouteInput[],
  info: ApiInfo = { title: 'API', version: '1.0.0' },
): Json {
  const paths: Record<string, Json> = {};
  const components: Record<string, Json> = {};

  const mergeComponents = (extra: Record<string, Json>): void => {
    Object.assign(components, extra);
  };

  for (const { route, types } of inputs) {
    const operation: Json = {};
    const parameters: Json[] = [];

    // A param without static type information documents as a string.
    const paramSchema = (p: { type?: Parameters<typeof mapType>[0] }): Json => {
      if (!p.type) return { type: 'string' };
      const { schema, components: c } = mapType(p.type);
      mergeComponents(c);
      return schema;
    };

    for (const p of types.pathParams) {
      parameters.push({ name: p.name, in: 'path', required: true, schema: paramSchema(p) });
    }
    for (const q of types.query) {
      parameters.push({ name: q.name, in: 'query', required: false, schema: paramSchema(q) });
    }
    if (parameters.length > 0) operation.parameters = parameters;

    if (types.body) {
      const { schema, components: c } = mapType(types.body);
      mergeComponents(c);
      operation.requestBody = { content: { 'application/json': { schema } } };
    }

    const responses: Json = {};
    if (types.response) {
      const { schema, components: c } = mapType(types.response);
      mergeComponents(c);
      responses['200'] = { description: 'OK', content: { 'application/json': { schema } } };
    } else {
      responses['200'] = { description: 'OK' };
    }
    operation.responses = responses;

    const oaPath = templatePath(route.path);
    paths[oaPath] ??= {};
    (paths[oaPath] as Json)[route.verb] = operation;
  }

  const doc: Json = { openapi: '3.0.3', info, paths };
  if (Object.keys(components).length > 0) doc.components = { schemas: components };
  return doc;
}
