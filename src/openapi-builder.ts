import { STATUS_CODES } from 'node:http';
import { createSchemaMapper } from './schema-mapper.js';
import { jsDocText } from './jsdoc.js';
import type { GeneratorConfig, SecurityRequirement } from './config.js';
import type { ParamType, ResolvedRoute, RouteTypes } from './types.js';

export interface RouteInput {
  route: ResolvedRoute;
  types: RouteTypes;
}

export interface ApiInfo {
  title: string;
  version: string;
}

export interface BuildOptions {
  descriptions?: boolean;
  config?: GeneratorConfig;
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
  options: BuildOptions = {},
): Json {
  const paths: Record<string, Json> = {};
  const schemaMapper = createSchemaMapper({ descriptions: options.descriptions });

  for (const { route, types } of inputs) {
    const operation: Json = {};
    if (options.descriptions) {
      const docs = jsDocText(route.method);
      if (docs.summary) operation.summary = docs.summary;
      if (docs.description) operation.description = docs.description;
      if (docs.deprecated) operation.deprecated = true;
    }
    const security = operationSecurity(route, options.config);
    if (security) operation.security = security;
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
  const components: Json = {};
  if (Object.keys(schemaMapper.components).length > 0) {
    components.schemas = schemaMapper.components;
  }
  if (options.config?.securitySchemes) {
    components.securitySchemes = options.config.securitySchemes;
  }
  if (Object.keys(components).length > 0) {
    doc.components = components;
  }
  return doc;
}

function operationSecurity(
  route: ResolvedRoute,
  config: GeneratorConfig | undefined,
): SecurityRequirement[] | undefined {
  if (!config) return undefined;
  if (isPublicRoute(route, config.publicDecorator)) return [];

  const override = config.securityOverrides?.find((entry) => {
    const methodMatches = !entry.method || entry.method.toLowerCase() === route.verb;
    return methodMatches && globMatches(entry.path, route.path);
  });
  if (override) return override.security;

  return config.security;
}

function isPublicRoute(route: ResolvedRoute, decoratorName = 'Public'): boolean {
  return hasDecorator(route.method, decoratorName) || hasDecorator(route.method.getParent(), decoratorName);
}

function hasDecorator(node: unknown, decoratorName: string): boolean {
  const decorators = (node as { getDecorators?: () => Array<{ getName(): string }> } | undefined)?.getDecorators?.();
  return decorators?.some((decorator) => decorator.getName() === decoratorName) ?? false;
}

function globMatches(pattern: string, value: string): boolean {
  const regex = pattern
    .split('**')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
    .join('.*');
  return new RegExp(`^${regex}$`).test(value);
}
