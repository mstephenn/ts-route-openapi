import { Node, SyntaxKind, type Expression, type Node as MorphNode } from 'ts-morph';
import { methodCallInfo, resolveIdentifierInitializer } from './ast-calls.js';
import type { ParamType, Schema } from './types.js';
import { createWarnOnce } from './warn-once.js';

export interface ValidatorSchemas {
  bodySchema?: Schema;
  query?: ParamType[];
  pathParams?: ParamType[];
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
  }

  return result;
}

function mergeValidatorSchemas(target: ValidatorSchemas, source: ValidatorSchemas): void {
  target.bodySchema = source.bodySchema ?? target.bodySchema;
  target.query = source.query ?? target.query;
  target.pathParams = source.pathParams ?? target.pathParams;
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

  if (body) result.bodySchema = schemaExpressionToOpenApi(body);
  if (query) result.query = schemaToParams(schemaExpressionToOpenApi(query));
  if (params) result.pathParams = schemaToParams(schemaExpressionToOpenApi(params));

  return result;
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

    if (method === 'optional') {
      const inner = zodSchema(receiver);
      return { schema: inner.schema, optional: true };
    }
    if (method === 'nullable') {
      const inner = zodSchema(receiver);
      return { schema: { ...inner.schema, nullable: true }, optional: inner.optional };
    }
    if (method === 'array' && receiver.getText() !== 'z') {
      const inner = zodSchema(receiver);
      return { schema: { type: 'array', items: inner.schema }, optional: false };
    }

    const namespace = receiver.getText();
    const args = expression.getArguments();
    if (namespace !== 'z') {
      warnUnsupportedZod(expression);
      return { schema: {}, optional: false };
    }

    if (method === 'string') return { schema: { type: 'string' }, optional: false };
    if (method === 'number') return { schema: { type: 'number' }, optional: false };
    if (method === 'boolean') return { schema: { type: 'boolean' }, optional: false };
    if (method === 'object') return { schema: zodObject(args[0]), optional: false };
    if (method === 'array') return { schema: { type: 'array', items: zodArg(args[0]) }, optional: false };
    if (method === 'enum') return { schema: zodEnum(args[0]), optional: false };
    if (method === 'literal') return { schema: zodLiteral(args[0]), optional: false };
    if (method === 'union') return { schema: zodUnion(args[0]), optional: false };
  }

  warnUnsupportedZod(expression);
  return { schema: {}, optional: false };
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
  if (!arg || !Node.isArrayLiteralExpression(arg)) {
    warnUnsupportedZod(arg);
    return {};
  }
  return {
    type: 'string',
    enum: arg.getElements().filter(Node.isStringLiteral).map((entry) => entry.getLiteralValue()),
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
