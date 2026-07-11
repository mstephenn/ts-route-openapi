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
  const schema = toSchema(type, components, new Set<string>(), new Set<number>());
  return { schema, components };
}

/** Identity of a type for cycle detection while inlining (compiler-internal id). */
function typeId(type: Type): number {
  return (type.compilerType as unknown as { id?: number }).id ?? -1;
}

/** True when the symbol is declared entirely in project source (not node_modules). */
function symbolFromProjectSource(symbol: ReturnType<Type['getSymbol']>): boolean {
  const declarations = symbol?.getDeclarations() ?? [];
  return (
    declarations.length > 0 && declarations.every((d) => !d.getSourceFile().isInNodeModules())
  );
}

function toSchema(type: Type, components: Components, seen: Set<string>, inlining: Set<number>): Schema {
  if (type.isString()) return { type: 'string' };
  if (type.isNumber()) return { type: 'number' };
  if (type.isBoolean()) return { type: 'boolean' };
  if (type.isStringLiteral()) return { type: 'string', enum: [type.getLiteralValue()] };

  if (type.isArray()) {
    return {
      type: 'array',
      items: toSchema(type.getArrayElementTypeOrThrow(), components, seen, inlining),
    };
  }

  if (type.isUnion()) {
    const parts = type.getUnionTypes();
    if (parts.length > 0 && parts.every((p) => p.isStringLiteral())) {
      return { type: 'string', enum: parts.map((p) => p.getLiteralValue() as string) };
    }
    const defined = parts.filter((p) => !p.isUndefined() && !p.isNull());
    if (defined.length === 1) return toSchema(defined[0], components, seen, inlining);
    // `boolean` collapses to the union `true | false` (plus `undefined` when
    // optional); recombine those literal members into a single boolean schema.
    if (defined.length > 0 && defined.every((p) => p.isBooleanLiteral() || p.isBoolean())) {
      return { type: 'boolean' };
    }
  }

  if (type.isObject()) {
    const symbol = type.getSymbol();
    const name = symbol?.getName();
    const isFromProjectSource = symbolFromProjectSource(symbol);

    if (name === 'Date' && !isFromProjectSource) {
      return { type: 'string', format: 'date-time' };
    }

    // Callable types (functions, arrow types, etc.) have no meaningful OpenAPI
    // representation; skip them rather than hoisting their method signatures.
    if (type.getCallSignatures().length > 0) return {};

    // Hoist under a project-source name: the alias name (`type User = {...}`)
    // wins over the structural symbol name (interface/class).
    const aliasSymbol = type.getAliasSymbol();
    const aliasName =
      aliasSymbol && symbolFromProjectSource(aliasSymbol) ? aliasSymbol.getName() : undefined;
    const symbolName =
      name && name !== '__type' && name !== '__object' && isFromProjectSource ? name : undefined;
    const hoistName = aliasName ?? symbolName;

    if (hoistName) {
      if (!seen.has(hoistName)) {
        seen.add(hoistName);
        components[hoistName] = objectSchema(type, components, seen, inlining);
      }
      return { $ref: `#/components/schemas/${hoistName}` };
    }

    // Inlined (non-hoisted) objects can be self-referential — e.g. recursive
    // type aliases or library types like express's Request. Truncate cycles
    // to an empty schema instead of recursing forever.
    const id = typeId(type);
    if (inlining.has(id)) return {};
    inlining.add(id);
    const schema = objectSchema(type, components, seen, inlining);
    inlining.delete(id);
    return schema;
  }

  return {};
}

function objectSchema(
  type: Type,
  components: Components,
  seen: Set<string>,
  inlining: Set<number>,
): Schema {
  const properties: Record<string, Schema> = {};
  const required: string[] = [];

  for (const prop of type.getProperties()) {
    const declaration = prop.getDeclarations()[0];
    if (!declaration) continue;
    const propType = prop.getTypeAtLocation(declaration);
    properties[prop.getName()] = toSchema(propType, components, seen, inlining);
    const optional = Node.isPropertySignature(declaration) && declaration.hasQuestionToken();
    if (!optional) required.push(prop.getName());
  }

  const schema: Schema = { type: 'object', properties };
  if (required.length > 0) schema.required = required;
  return schema;
}
