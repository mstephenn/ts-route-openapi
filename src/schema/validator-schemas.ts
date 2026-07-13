import { Node, SyntaxKind, type Expression, type Node as MorphNode } from 'ts-morph';
import {
  methodCallInfo,
  resolveIdentifierInitializer,
  createWarnOnce,
  type ParamType,
  type Schema,
} from '../shared/index.js';

export interface ValidatorSchemas {
  bodySchema?: Schema;
  query?: ParamType[];
  pathParams?: ParamType[];
  headers?: ParamType[];
  cookies?: ParamType[];
}

interface ZodResult {
  schema: Schema;
  optional: boolean;
}

const warnOnce = createWarnOnce();

export function extractValidatorSchemas(expressions: MorphNode[]): ValidatorSchemas {
  const result: ValidatorSchemas = {};

  for (const expression of expressions) {
    if (!Node.isExpression(expression)) continue;

    const hono = honoValidatorSchema(expression);
    if (hono) mergeValidatorSchemas(result, hono);

    const fastify = fastifyRouteOptionSchemas(expression);
    if (fastify) mergeValidatorSchemas(result, fastify);

    const generic = genericMiddlewareValidatorSchema(expression);
    if (generic) mergeValidatorSchemas(result, generic);
  }

  return result;
}

function mergeValidatorSchemas(target: ValidatorSchemas, source: ValidatorSchemas): void {
  target.bodySchema = source.bodySchema ?? target.bodySchema;
  target.query = source.query ?? target.query;
  target.pathParams = source.pathParams ?? target.pathParams;
  target.headers = source.headers ?? target.headers;
  target.cookies = source.cookies ?? target.cookies;
}

function honoValidatorSchema(expression: Expression): ValidatorSchemas | undefined {
  if (!Node.isCallExpression(expression)) return undefined;
  const callee = expression.getExpression();
  const name = Node.isIdentifier(callee) ? callee.getText() : undefined;
  if (name !== 'zValidator') return undefined;

  const [targetArg, schemaArg] = expression.getArguments();
  if (!Node.isStringLiteral(targetArg) || !schemaArg || !Node.isExpression(schemaArg)) return undefined;
  const schema = zodSchema(schemaArg).schema;
  const target = targetArg.getLiteralValue();

  if (target === 'json') return { bodySchema: schema };
  if (target === 'query') return { query: schemaToParams(schema) };
  if (target === 'param') return { pathParams: schemaToParams(schema) };
  if (target === 'header') return { headers: schemaToParams(schema) };
  if (target === 'cookie') return { cookies: schemaToParams(schema) };
  return undefined;
}

function fastifyRouteOptionSchemas(expression: Expression): ValidatorSchemas | undefined {
  if (!Node.isObjectLiteralExpression(expression)) return undefined;
  const schemaExpression = propertyExpression(expression, 'schema');
  if (!schemaExpression || !Node.isObjectLiteralExpression(schemaExpression)) return undefined;

  const result: ValidatorSchemas = {};
  const body = propertyExpression(schemaExpression, 'body');
  const query = propertyExpression(schemaExpression, 'querystring') ?? propertyExpression(schemaExpression, 'query');
  const params = propertyExpression(schemaExpression, 'params');
  const headers = propertyExpression(schemaExpression, 'headers');
  const cookies = propertyExpression(schemaExpression, 'cookies');

  if (body) result.bodySchema = schemaExpressionToOpenApi(body);
  if (query) result.query = schemaToParams(schemaExpressionToOpenApi(query));
  if (params) result.pathParams = schemaToParams(schemaExpressionToOpenApi(params));
  if (headers) result.headers = schemaToParams(schemaExpressionToOpenApi(headers));
  if (cookies) result.cookies = schemaToParams(schemaExpressionToOpenApi(cookies));

  return result;
}

function genericMiddlewareValidatorSchema(expression: Expression): ValidatorSchemas | undefined {
  if (!Node.isCallExpression(expression)) return undefined;
  const [first, second] = expression.getArguments();
  const target = validatorTarget(expression.getExpression().getText(), first);
  const schemaArg = second && Node.isStringLiteral(first) ? second : first;
  if (!target || !schemaArg || !Node.isExpression(schemaArg)) return undefined;

  const schema = schemaExpressionToOpenApi(schemaArg);
  if (target === 'body') return { bodySchema: schema };
  if (target === 'query') return { query: schemaToParams(schema) };
  if (target === 'params') return { pathParams: schemaToParams(schema) };
  if (target === 'headers') return { headers: schemaToParams(schema) };
  if (target === 'cookies') return { cookies: schemaToParams(schema) };
  return undefined;
}

function validatorTarget(calleeText: string, firstArg: MorphNode | undefined): 'body' | 'query' | 'params' | 'headers' | 'cookies' | undefined {
  const normalized = calleeText.split('.').at(-1)?.replace(/[^a-z0-9]/gi, '').toLowerCase() ?? '';
  if (!/(validate|validator|schema)/.test(normalized)) return undefined;

  if (firstArg && Node.isStringLiteral(firstArg)) {
    const target = firstArg.getLiteralValue().toLowerCase();
    if (target === 'body' || target === 'json') return 'body';
    if (target === 'query') return 'query';
    if (target === 'param' || target === 'params' || target === 'path') return 'params';
    if (target === 'header' || target === 'headers') return 'headers';
    if (target === 'cookie' || target === 'cookies') return 'cookies';
  }

  if (normalized.includes('body') || normalized.includes('json')) return 'body';
  if (normalized.includes('query')) return 'query';
  if (normalized.includes('param') || normalized.includes('path')) return 'params';
  if (normalized.includes('header')) return 'headers';
  if (normalized.includes('cookie')) return 'cookies';
  return undefined;
}

function schemaExpressionToOpenApi(expression: Expression): Schema {
  if (Node.isCallExpression(expression) || Node.isIdentifier(expression)) {
    return zodSchema(expression).schema;
  }

  const literal = literalValue(expression);
  if (isSchema(literal)) return literal;

  warnUnsupportedZod(expression);
  return {};
}

/** Convert a Zod schema expression (e.g. the argument to tRPC's `.input(...)`/`.output(...)`) to its OpenAPI schema. */
export function schemaFromZodExpression(expression: Expression): Schema {
  return zodSchema(expression).schema;
}

function zodSchema(expression: Expression): ZodResult {
  const resolved = resolveInitializer(expression);
  if (resolved && resolved !== expression) return zodSchema(resolved);

  if (!Node.isCallExpression(expression)) {
    warnUnsupportedZod(expression);
    return { schema: {}, optional: false };
  }

  const info = methodCallInfo(expression);
  if (info) {
    const { method, receiver } = info;
    const args = expression.getArguments();

    if (method === 'optional') {
      const inner = zodSchema(receiver);
      return { schema: inner.schema, optional: true };
    }
    if (method === 'nullable') {
      const inner = zodSchema(receiver);
      return { schema: { ...inner.schema, nullable: true }, optional: inner.optional };
    }
    if (method === 'nullish') {
      const inner = zodSchema(receiver);
      return { schema: { ...inner.schema, nullable: true }, optional: true };
    }

    // `z.<method>(...)` constructs a base schema; anything else is a modifier
    // chained onto a receiver that is itself a (possibly nested) Zod schema.
    if (receiver.getText() === 'z') {
      const base = zodBaseSchema(method, args);
      if (base) return { schema: base, optional: false };
      warnUnsupportedZod(expression);
      return { schema: {}, optional: false };
    }

    const inner = zodSchema(receiver);
    const chained = zodChainedSchema(method, args, inner.schema);
    if (chained) return { schema: chained, optional: inner.optional };
    warnUnsupportedZod(expression);
    return { schema: inner.schema, optional: inner.optional };
  }

  warnUnsupportedZod(expression);
  return { schema: {}, optional: false };
}

function zodBaseSchema(method: string, args: MorphNode[]): Schema | undefined {
  switch (method) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'email':
      return { type: 'string', format: 'email' };
    case 'url':
      return { type: 'string', format: 'uri' };
    case 'uuid':
      return { type: 'string', format: 'uuid' };
    case 'object':
      return zodObject(args[0]);
    case 'array':
      return { type: 'array', items: zodArg(args[0]) };
    case 'enum':
      return zodEnum(args[0]);
    case 'literal':
      return zodLiteral(args[0]);
    case 'union':
      return zodUnion(args[0]);
    default:
      return undefined;
  }
}

/** Apply a chained modifier method (e.g. `.min(1)`, `.trim()`, `.extend({...})`) to an already-resolved schema. */
function zodChainedSchema(method: string, args: MorphNode[], schema: Schema): Schema | undefined {
  switch (method) {
    case 'array':
      return { type: 'array', items: schema };
    case 'min':
      return applyBound(schema, 'min', args[0]);
    case 'max':
      return applyBound(schema, 'max', args[0]);
    case 'length': {
      const n = numericArg(args[0]);
      if (n === undefined) return schema;
      return schema.type === 'array' ? { ...schema, minItems: n, maxItems: n } : { ...schema, minLength: n, maxLength: n };
    }
    case 'int':
      return { ...schema, type: 'integer' };
    case 'positive':
      return { ...schema, minimum: 0, exclusiveMinimum: true };
    case 'nonnegative':
      return { ...schema, minimum: 0 };
    case 'negative':
      return { ...schema, maximum: 0, exclusiveMaximum: true };
    case 'nonpositive':
      return { ...schema, maximum: 0 };
    case 'email':
      return { ...schema, format: 'email' };
    case 'url':
      return { ...schema, format: 'uri' };
    case 'uuid':
      return { ...schema, format: 'uuid' };
    case 'datetime':
      return { ...schema, format: 'date-time' };
    case 'regex': {
      const pattern = regexArg(args[0]);
      return pattern === undefined ? schema : { ...schema, pattern };
    }
    case 'default': {
      const value = args[0] && Node.isExpression(args[0]) ? literalValue(args[0]) : undefined;
      return value === undefined ? schema : { ...schema, default: value };
    }
    case 'describe': {
      const text = args[0] && Node.isStringLiteral(args[0]) ? args[0].getLiteralValue() : undefined;
      return text === undefined ? schema : { ...schema, description: text };
    }
    case 'extend': {
      const extension = args[0] && Node.isObjectLiteralExpression(args[0]) ? zodObject(args[0]) : undefined;
      if (!extension) return schema;
      const properties = isSchema(schema.properties) ? schema.properties : {};
      const extensionProperties = isSchema(extension.properties) ? extension.properties : {};
      const required = Array.isArray(schema.required) ? schema.required : [];
      const extensionRequired = Array.isArray(extension.required) ? extension.required : [];
      return {
        ...schema,
        properties: { ...properties, ...extensionProperties },
        required: [...required, ...extensionRequired],
      };
    }
    case 'and': {
      const other = args[0] && Node.isExpression(args[0]) ? zodSchema(args[0]).schema : undefined;
      return other ? { allOf: [schema, other] } : schema;
    }
    case 'or': {
      const other = args[0] && Node.isExpression(args[0]) ? zodSchema(args[0]).schema : undefined;
      return other ? { oneOf: [schema, other] } : schema;
    }
    case 'trim':
    case 'toLowerCase':
    case 'toUpperCase':
    case 'refine':
    case 'superRefine':
    case 'transform':
    case 'catch':
    case 'pipe':
    case 'brand':
    case 'readonly':
    case 'meta':
      return schema;
    default:
      return undefined;
  }
}

function applyBound(schema: Schema, kind: 'min' | 'max', arg: MorphNode | undefined): Schema {
  const n = numericArg(arg);
  if (n === undefined) return schema;
  if (schema.type === 'array') return { ...schema, [kind === 'min' ? 'minItems' : 'maxItems']: n };
  if (schema.type === 'number' || schema.type === 'integer') {
    return { ...schema, [kind === 'min' ? 'minimum' : 'maximum']: n };
  }
  return { ...schema, [kind === 'min' ? 'minLength' : 'maxLength']: n };
}

function numericArg(arg: MorphNode | undefined): number | undefined {
  if (!arg || !Node.isNumericLiteral(arg)) return undefined;
  return Number(arg.getText());
}

function regexArg(arg: MorphNode | undefined): string | undefined {
  if (!arg || arg.getKind() !== SyntaxKind.RegularExpressionLiteral) return undefined;
  const match = /^\/(.*)\/[a-z]*$/.exec(arg.getText());
  return match?.[1];
}

function zodObject(arg: MorphNode | undefined): Schema {
  if (!arg || !Node.isObjectLiteralExpression(arg)) {
    warnUnsupportedZod(arg);
    return {};
  }

  const properties: Record<string, Schema> = {};
  const required: string[] = [];

  for (const property of arg.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    const name = propertyName(property.getNameNode());
    const initializer = property.getInitializer();
    if (!name || !initializer || !Node.isExpression(initializer)) continue;
    const parsed = zodSchema(initializer);
    properties[name] = parsed.schema;
    if (!parsed.optional) required.push(name);
  }

  const schema: Schema = { type: 'object', properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

function zodArg(arg: MorphNode | undefined): Schema {
  if (!arg || !Node.isExpression(arg)) {
    warnUnsupportedZod(arg);
    return {};
  }
  return zodSchema(arg).schema;
}

function zodEnum(arg: MorphNode | undefined): Schema {
  const resolved = (arg && Node.isExpression(arg) ? resolveInitializer(arg) : undefined) ?? arg;
  const array = resolved && Node.isAsExpression(resolved) ? resolved.getExpression() : resolved;
  if (!array || !Node.isArrayLiteralExpression(array)) {
    warnUnsupportedZod(arg);
    return {};
  }
  return {
    type: 'string',
    enum: array.getElements().filter(Node.isStringLiteral).map((entry) => entry.getLiteralValue()),
  };
}

function zodLiteral(arg: MorphNode | undefined): Schema {
  if (!arg) {
    warnUnsupportedZod(arg);
    return {};
  }
  if (Node.isStringLiteral(arg)) return { type: 'string', enum: [arg.getLiteralValue()] };
  if (Node.isNumericLiteral(arg)) return { type: 'number', enum: [Number(arg.getText())] };
  if (arg.getKind() === SyntaxKind.TrueKeyword || arg.getKind() === SyntaxKind.FalseKeyword) {
    return { type: 'boolean', enum: [arg.getKind() === SyntaxKind.TrueKeyword] };
  }
  warnUnsupportedZod(arg);
  return {};
}

function zodUnion(arg: MorphNode | undefined): Schema {
  if (!arg || !Node.isArrayLiteralExpression(arg)) {
    warnUnsupportedZod(arg);
    return {};
  }

  const schemas = arg.getElements().map((entry) => (Node.isExpression(entry) ? zodSchema(entry).schema : {}));
  const literalValues = schemas.flatMap((schema) => (Array.isArray(schema.enum) ? schema.enum : []));
  const literalTypes = new Set(schemas.map((schema) => schema.type));
  if (literalValues.length === schemas.length && literalTypes.size === 1) {
    return { type: schemas[0]?.type, enum: literalValues };
  }
  return { oneOf: schemas };
}

function schemaToParams(schema: Schema): ParamType[] {
  const properties = isSchema(schema.properties) ? schema.properties : {};

  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    schema: isSchema(propertySchema) ? propertySchema : {},
  }));
}

function propertyExpression(object: MorphNode, name: string): Expression | undefined {
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  const property = object.getProperty(name);
  if (!property || !Node.isPropertyAssignment(property)) return undefined;
  const initializer = property.getInitializer();
  return initializer && Node.isExpression(initializer) ? initializer : undefined;
}

function propertyName(node: MorphNode): string | undefined {
  if (Node.isIdentifier(node) || Node.isStringLiteral(node) || Node.isNumericLiteral(node)) {
    return Node.isStringLiteral(node) ? node.getLiteralValue() : node.getText();
  }
  return undefined;
}

function resolveInitializer(expression: Expression): Expression | undefined {
  const initializer = resolveIdentifierInitializer(expression);
  return initializer && Node.isExpression(initializer) ? initializer : undefined;
}

function literalValue(node: MorphNode): unknown {
  if (Node.isObjectLiteralExpression(node)) {
    const object: Record<string, unknown> = {};
    for (const property of node.getProperties()) {
      if (!Node.isPropertyAssignment(property)) continue;
      const name = propertyName(property.getNameNode());
      if (!name) continue;
      object[name] = literalValue(property.getInitializerOrThrow());
    }
    return object;
  }
  if (Node.isArrayLiteralExpression(node)) return node.getElements().map(literalValue);
  if (Node.isStringLiteral(node)) return node.getLiteralValue();
  if (Node.isNumericLiteral(node)) return Number(node.getText());
  if (node.getKind() === SyntaxKind.TrueKeyword) return true;
  if (node.getKind() === SyntaxKind.FalseKeyword) return false;
  if (node.getKind() === SyntaxKind.NullKeyword) return null;
  return undefined;
}

function isSchema(value: unknown): value is Schema {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function warnUnsupportedZod(node: MorphNode | undefined): void {
  const text = node?.getText().slice(0, 80) ?? '(missing schema)';
  warnOnce(text, `ts-route-openapi: unsupported Zod schema construct; emitted {} for ${text}`);
}
