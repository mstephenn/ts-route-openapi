import type { SecurityRequirement } from '../config.js';
import type { HttpVerb } from '../shared/index.js';

export interface ApiInfo {
  title: string;
  version: string;
}

/** An OpenAPI Schema Object — deliberately kept loose; schema-mapper owns its own shape. */
export type SchemaObject = Record<string, unknown>;

export interface ParameterObject {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  schema: SchemaObject;
}

export interface MediaTypeObject {
  schema: SchemaObject;
}

export interface RequestBodyObject {
  content: { 'application/json': MediaTypeObject };
}

export interface ResponseObject {
  description: string;
  content?: { 'application/json': MediaTypeObject };
}

export interface OperationObject {
  summary?: string;
  description?: string;
  deprecated?: boolean;
  security?: SecurityRequirement[];
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses: Record<string, ResponseObject>;
}

export type PathItemObject = Partial<Record<HttpVerb, OperationObject>>;

export interface ComponentsObject {
  schemas?: Record<string, SchemaObject>;
  securitySchemes?: Record<string, Record<string, unknown>>;
}

export interface OpenApiDocument {
  openapi: '3.0.3';
  info: ApiInfo;
  paths: Record<string, PathItemObject>;
  components?: ComponentsObject;
}
