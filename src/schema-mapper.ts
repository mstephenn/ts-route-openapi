import { Node, type Type } from 'ts-morph';

type Schema = Record<string, unknown>;
type Components = Record<string, Schema>;

export interface SchemaResult {
  schema: Schema;
  components: Components;
}

/** Convert a TS type to an OpenAPI schema, hoisting named object types into components. */
export function mapType(type: Type): SchemaResult {
  const components: Components = {};
  const schema = toSchema(type, components, new Set<string>());
  return { schema, components };
}

function toSchema(type: Type, components: Components, seen: Set<string>): Schema {
  if (type.isString()) return { type: 'string' };
  if (type.isNumber()) return { type: 'number' };
  if (type.isBoolean()) return { type: 'boolean' };
  if (type.isStringLiteral()) return { type: 'string', enum: [type.getLiteralValue()] };

  if (type.isArray()) {
    return { type: 'array', items: toSchema(type.getArrayElementTypeOrThrow(), components, seen) };
  }

  if (type.isUnion()) {
    const parts = type.getUnionTypes();
    if (parts.length > 0 && parts.every((p) => p.isStringLiteral())) {
      return { type: 'string', enum: parts.map((p) => p.getLiteralValue() as string) };
    }
    const defined = parts.filter((p) => !p.isUndefined() && !p.isNull());
    if (defined.length === 1) return toSchema(defined[0], components, seen);
    // `boolean` collapses to the union `true | false` (plus `undefined` when
    // optional); recombine those literal members into a single boolean schema.
    if (defined.length > 0 && defined.every((p) => p.isBooleanLiteral() || p.isBoolean())) {
      return { type: 'boolean' };
    }
  }

  if (type.isObject()) {
    const symbol = type.getSymbol();
    const name = symbol?.getName();
    const declarations = symbol?.getDeclarations() ?? [];
    const isFromProjectSource = declarations.length > 0 && declarations.every((d) => !d.getSourceFile().isInNodeModules());

    if (name === 'Date' && !isFromProjectSource) {
      return { type: 'string', format: 'date-time' };
    }

    // Callable types (functions, arrow types, etc.) have no meaningful OpenAPI
    // representation; skip them rather than hoisting their method signatures.
    if (type.getCallSignatures().length > 0) return {};

    const isNamed = !!name && name !== '__type' && name !== '__object';
    if (isNamed && isFromProjectSource) {
      if (!seen.has(name)) {
        seen.add(name);
        components[name] = objectSchema(type, components, seen);
      }
      return { $ref: `#/components/schemas/${name}` };
    }
    return objectSchema(type, components, seen);
  }

  return {};
}

function objectSchema(type: Type, components: Components, seen: Set<string>): Schema {
  const properties: Record<string, Schema> = {};
  const required: string[] = [];

  for (const prop of type.getProperties()) {
    const declaration = prop.getDeclarations()[0];
    if (!declaration) continue;
    const propType = prop.getTypeAtLocation(declaration);
    properties[prop.getName()] = toSchema(propType, components, seen);
    const optional = Node.isPropertySignature(declaration) && declaration.hasQuestionToken();
    if (!optional) required.push(prop.getName());
  }

  const schema: Schema = { type: 'object', properties };
  if (required.length > 0) schema.required = required;
  return schema;
}
