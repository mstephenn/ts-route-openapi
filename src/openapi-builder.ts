import { STATUS_CODES } from 'node:http';
import { createSchemaMapper } from './schema-mapper.js';
import type { ParamType, ResolvedRoute, RouteTypes } from './types.js';

export interface RouteInput {
  route: ResolvedRoute;
  types: RouteTypes;
}

export interface ApiInfo {
  title: string;
  version: string;
}

type Json = Record<string, unknown>;

/** Statuses that must not carry a response body per HTTP semantics. */
const BODILESS_STATUSES = new Set([204, 205, 304]);

/** Convert `/orgs/:id/users` to the OpenAPI `/orgs/{id}/users` template form. */
function templatePath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

export function buildOpenApi(
  inputs: RouteInput[],
  info: ApiInfo = { title: 'API', version: '1.0.0' },
): Json {
  const paths: Record<string, Json> = {};
  const schemaMapper = createSchemaMapper();

  for (const { route, types } of inputs) {
    const operation: Json = {};
    const parameters: Json[] = [];

    // A param without static type information documents as a string.
    const paramSchema = (p: ParamType): Json => {
      if (p.schema) return p.schema;
      if (!p.type) return { type: 'string' };
      return schemaMapper.mapType(p.type);
    };

    for (const p of types.pathParams) {
      parameters.push({ name: p.name, in: 'path', required: true, schema: paramSchema(p) });
    }
    for (const q of types.query) {
      parameters.push({ name: q.name, in: 'query', required: false, schema: paramSchema(q) });
    }
    if (parameters.length > 0) operation.parameters = parameters;

    if (types.bodySchema || types.body) {
      const schema = types.bodySchema ?? schemaMapper.mapType(types.body!);
      operation.requestBody = { content: { 'application/json': { schema } } };
    }

    const responses: Json = {};
    const entries = types.responses ?? [{ status: 200, type: types.response }];
    for (const entry of entries) {
      const response: Json = { description: STATUS_CODES[entry.status] ?? 'Response' };
      if (entry.type && !BODILESS_STATUSES.has(entry.status)) {
        const schema = schemaMapper.mapType(entry.type);
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
  if (Object.keys(schemaMapper.components).length > 0) {
    doc.components = { schemas: schemaMapper.components };
  }
  return doc;
}
