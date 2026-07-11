import { Node, type Type } from 'ts-morph';
import { jsDocText } from './jsdoc.js';

type Schema = Record<string, unknown>;
type Components = Record<string, Schema>;

interface ComponentRecord {
  baseName: string;
  name: string;
  schema: Schema;
}

export interface SchemaResult {
  schema: Schema;
  components: Components;
}

export interface SchemaMapper {
  components: Components;
  mapType(type: Type): Schema;
}

export interface SchemaMapperOptions {
  descriptions?: boolean;
}

/** Convert a TS type to an OpenAPI schema, hoisting named object types into components. */
export function mapType(type: Type, options: SchemaMapperOptions = {}): SchemaResult {
  const mapper = createSchemaMapper(options);
  const schema = mapper.mapType(type);
  return { schema, components: mapper.components };
}

/** Create a mapper that keeps component names stable across multiple mapped types. */
export function createSchemaMapper(options: SchemaMapperOptions = {}): SchemaMapper {
  const context: SchemaContext = {
    components: {},
    componentNamesByTypeId: new Map<number, string>(),
    componentRecordsByBaseName: new Map<string, ComponentRecord[]>(),
    usedComponentNames: new Set<string>(),
    inProgressTypeIds: new Set<number>(),
    inliningTypeIds: new Set<number>(),
    warnedCollisions: new Set<string>(),
    descriptions: options.descriptions ?? false,
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
  componentRecordsByBaseName: Map<string, ComponentRecord[]>;
  usedComponentNames: Set<string>;
  inProgressTypeIds: Set<number>;
  inliningTypeIds: Set<number>;
  warnedCollisions: Set<string>;
  descriptions: boolean;
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

function disambiguatedComponentName(baseName: string, type: Type, usedNames: Set<string>): string {
  const suffix = declarationModuleSuffix(type) ?? 'variant';
  const preferred = `${baseName}_${suffix}`;
  if (!usedNames.has(preferred)) {
    usedNames.add(preferred);
    return preferred;
  }

  let index = 2;
  while (usedNames.has(`${preferred}${index}`)) index += 1;
  const name = `${preferred}${index}`;
  usedNames.add(name);
  return name;
}

function declarationModuleSuffix(type: Type): string | undefined {
  const declaration = type.getAliasSymbol()?.getDeclarations()[0] ?? type.getSymbol()?.getDeclarations()[0];
  const sourceFile = declaration?.getSourceFile();
  if (!sourceFile) return undefined;

  const fileName = sourceFile.getBaseNameWithoutExtension();
  const sanitized = fileName.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return sanitized || undefined;
}

function stableSchemaString(schema: Schema, ownName?: string, baseName?: string): string {
  return JSON.stringify(stableValue(schema, ownName, baseName));
}

function stableValue(value: unknown, ownName?: string, baseName?: string): unknown {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry, ownName, baseName));
  if (!value || typeof value !== 'object') return value;

  const objectValue = value as Record<string, unknown>;
  if (
    typeof objectValue.$ref === 'string' &&
    ownName &&
    baseName &&
    objectValue.$ref === `#/components/schemas/${ownName}`
  ) {
    return { ...objectValue, $ref: `#/components/schemas/${baseName}` };
  }

  return Object.fromEntries(
    Object.entries(objectValue)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, stableValue(entry, ownName, baseName)]),
  );
}

function schemasEqual(
  a: Schema,
  b: Schema,
  aOwnName: string,
  bOwnName: string,
  baseName: string,
): boolean {
  return stableSchemaString(a, aOwnName, baseName) === stableSchemaString(b, bOwnName, baseName);
}

function warnCollisionOnce(baseName: string, componentName: string, context: SchemaContext): void {
  const key = `${baseName}:${componentName}`;
  if (context.warnedCollisions.has(key)) return;
  context.warnedCollisions.add(key);
  console.warn(
    `ts-route-openapi: component name collision for "${baseName}"; emitted "${componentName}" for a distinct schema.`,
  );
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
        const existingRecords = context.componentRecordsByBaseName.get(hoistName) ?? [];
        componentName =
          existingRecords.length === 0
            ? uniqueComponentName(hoistName, context.usedComponentNames)
            : disambiguatedComponentName(hoistName, type, context.usedComponentNames);
        context.componentNamesByTypeId.set(id, componentName);
      }

      if (!Object.hasOwn(context.components, componentName)) {
        context.components[componentName] = {};
      }

      if (!context.inProgressTypeIds.has(id) && Object.keys(context.components[componentName]).length === 0) {
        context.inProgressTypeIds.add(id);
        const schema = objectSchema(type, context);
        context.inProgressTypeIds.delete(id);

        const candidateName = componentName;
        const records = context.componentRecordsByBaseName.get(hoistName) ?? [];
        const duplicate = records.find((record) =>
          schemasEqual(record.schema, schema, record.name, candidateName, hoistName),
        );
        if (duplicate) {
          delete context.components[componentName];
          context.usedComponentNames.delete(componentName);
          context.componentNamesByTypeId.set(id, duplicate.name);
          componentName = duplicate.name;
        } else {
          context.components[componentName] = schema;
          records.push({ baseName: hoistName, name: componentName, schema });
          context.componentRecordsByBaseName.set(hoistName, records);

          if (records.length > 1) {
            warnCollisionOnce(hoistName, componentName, context);
          }
        }
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
    const propSchema = toSchema(propType, context);
    if (context.descriptions) {
      const docs = jsDocText(declaration);
      const description = [docs.summary, docs.description].filter(Boolean).join('\n');
      if (description) propSchema.description = description;
    }
    properties[prop.getName()] = propSchema;
    const optional = Node.isPropertySignature(declaration) && declaration.hasQuestionToken();
    if (!optional) required.push(prop.getName());
  }

  const schema: Schema = { type: 'object', properties };
  if (required.length > 0) schema.required = required;
  return schema;
}
