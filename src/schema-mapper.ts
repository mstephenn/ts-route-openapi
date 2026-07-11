import { Node, type Type } from 'ts-morph';

type Schema = Record<string, unknown>;
type Components = Record<string, Schema>;

export interface SchemaResult {
  schema: Schema;
  components: Components;
}

export interface SchemaMapper {
  components: Components;
  mapType(type: Type): Schema;
}

/** Convert a TS type to an OpenAPI schema, hoisting named object types into components. */
export function mapType(type: Type): SchemaResult {
  const mapper = createSchemaMapper();
  const schema = mapper.mapType(type);
  return { schema, components: mapper.components };
}

/** Create a mapper that keeps component names stable across multiple mapped types. */
export function createSchemaMapper(): SchemaMapper {
  const context: SchemaContext = {
    components: {},
    componentNamesByTypeId: new Map<number, string>(),
    usedComponentNames: new Set<string>(),
    inProgressTypeIds: new Set<number>(),
    inliningTypeIds: new Set<number>(),
  };

  return {
    components: context.components,
    mapType(type: Type): Schema {
      return toSchema(type, context);
    },
  };
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

interface SchemaContext {
  components: Components;
  componentNamesByTypeId: Map<number, string>;
  usedComponentNames: Set<string>;
  inProgressTypeIds: Set<number>;
  inliningTypeIds: Set<number>;
}

function uniqueComponentName(baseName: string, usedNames: Set<string>): string {
  if (!usedNames.has(baseName)) {
    usedNames.add(baseName);
    return baseName;
  }

  let suffix = 2;
  while (usedNames.has(`${baseName}${suffix}`)) suffix += 1;
  const name = `${baseName}${suffix}`;
  usedNames.add(name);
  return name;
}

function toSchema(type: Type, context: SchemaContext): Schema {
  if (type.isString()) return { type: 'string' };
  if (type.isNumber()) return { type: 'number' };
  if (type.isBoolean()) return { type: 'boolean' };
  if (type.isStringLiteral()) return { type: 'string', enum: [type.getLiteralValue()] };

  if (type.isArray()) {
    return {
      type: 'array',
      items: toSchema(type.getArrayElementTypeOrThrow(), context),
    };
  }

  if (type.isUnion()) {
    // Strip null/undefined, then group members: same-kind literals collapse
    // into one enum schema, booleans recombine (TS expands `boolean` to
    // `true | false`), everything else maps individually. A single resulting
    // schema is returned directly; several become a `oneOf`.
    const defined = type.getUnionTypes().filter((p) => !p.isUndefined() && !p.isNull());
    const stringLiterals: string[] = [];
    const numberLiterals: number[] = [];
    let hasBoolean = false;
    const others: Type[] = [];

    for (const part of defined) {
      if (part.isStringLiteral()) stringLiterals.push(part.getLiteralValue() as string);
      else if (part.isNumberLiteral()) numberLiterals.push(part.getLiteralValue() as number);
      else if (part.isBooleanLiteral() || part.isBoolean()) hasBoolean = true;
      else others.push(part);
    }

    const schemas: Schema[] = [];
    if (stringLiterals.length > 0) schemas.push({ type: 'string', enum: stringLiterals });
    if (numberLiterals.length > 0) schemas.push({ type: 'number', enum: numberLiterals });
    if (hasBoolean) schemas.push({ type: 'boolean' });
    for (const other of others) schemas.push(toSchema(other, context));

    if (schemas.length === 0) return {};
    if (schemas.length === 1) return schemas[0];
    return { oneOf: schemas };
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
      const id = typeId(type);
      let componentName = context.componentNamesByTypeId.get(id);

      if (!componentName) {
        componentName = uniqueComponentName(hoistName, context.usedComponentNames);
        context.componentNamesByTypeId.set(id, componentName);
      }

      if (!Object.hasOwn(context.components, componentName)) {
        context.components[componentName] = {};
      }

      if (!context.inProgressTypeIds.has(id) && Object.keys(context.components[componentName]).length === 0) {
        context.inProgressTypeIds.add(id);
        context.components[componentName] = objectSchema(type, context);
        context.inProgressTypeIds.delete(id);
      }

      return { $ref: `#/components/schemas/${componentName}` };
    }

    // Inlined (non-hoisted) objects can be self-referential — e.g. recursive
    // type aliases or library types like express's Request. Truncate cycles
    // to an empty schema instead of recursing forever.
    const id = typeId(type);
    if (context.inliningTypeIds.has(id)) return {};
    context.inliningTypeIds.add(id);
    const schema = objectSchema(type, context);
    context.inliningTypeIds.delete(id);
    return schema;
  }

  return {};
}

function objectSchema(type: Type, context: SchemaContext): Schema {
  const properties: Record<string, Schema> = {};
  const required: string[] = [];

  for (const prop of type.getProperties()) {
    const declaration = prop.getDeclarations()[0];
    if (!declaration) continue;
    const propType = prop.getTypeAtLocation(declaration);
    properties[prop.getName()] = toSchema(propType, context);
    const optional = Node.isPropertySignature(declaration) && declaration.hasQuestionToken();
    if (!optional) required.push(prop.getName());
  }

  const schema: Schema = { type: 'object', properties };
  if (required.length > 0) schema.required = required;
  return schema;
}
