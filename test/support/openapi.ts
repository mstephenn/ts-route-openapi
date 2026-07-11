import type { OpenApiDocument, OperationObject } from '../../src/openapi-types.js';
import type { HttpVerb } from '../../src/types.js';

/** The `properties` of an object-shaped SchemaObject (`schema-mapper` keeps schema shapes untyped). */
export function schemaProperties(schema: unknown): Record<string, unknown> {
  return (schema as { properties: Record<string, unknown> }).properties;
}

/** The operation for `verb` at `path`, throwing a clear error if the document has none. */
export function getOperation(doc: OpenApiDocument, path: string, verb: HttpVerb): OperationObject {
  const operation = doc.paths[path]?.[verb];
  if (!operation) throw new Error(`No ${verb.toUpperCase()} operation registered for ${path}`);
  return operation;
}
