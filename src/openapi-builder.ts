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

const REASON_PHRASES: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
};

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
    const entries = types.responses ?? [{ status: 200, type: types.response }];
    for (const entry of entries) {
      const response: Json = { description: REASON_PHRASES[entry.status] ?? 'Response' };
      if (entry.type) {
        const { schema, components: c } = mapType(entry.type);
        mergeComponents(c);
        response.content = { 'application/json': { schema } };
      }
      responses[String(entry.status)] = response;
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
