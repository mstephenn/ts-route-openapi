import type { Type } from 'ts-morph';

type Schema = Record<string, unknown>;
type Components = Record<string, Schema>;

interface ComponentRecord {
  baseName: string;
  name: string;
  schema: Schema;
}

/** Identity of a type for cycle detection / component identity (compiler-internal id). */
export function typeId(type: Type): number {
  return (type.compilerType as unknown as { id?: number }).id ?? -1;
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

export interface ComponentRegistry {
  /** Live components map; mutated in place as schemas are hoisted. */
  components: Components;
  /**
   * Resolve (assigning a name on first sight, deduping against structurally
   * identical sibling schemas, and warning on genuine name collisions) the
   * component for `type` under `baseName`, computing its schema lazily via
   * `computeSchema` at most once per distinct type identity. Returns a
   * `$ref` schema pointing at the resolved component name.
   */
  resolveRef(baseName: string, type: Type, computeSchema: () => Schema): Schema;
}

/** Create a fresh, isolated component registry (naming, dedupe, collision bookkeeping). */
export function createComponentRegistry(): ComponentRegistry {
  const components: Components = {};
  const componentNamesByTypeId = new Map<number, string>();
  const componentRecordsByBaseName = new Map<string, ComponentRecord[]>();
  const usedComponentNames = new Set<string>();
  const inProgressTypeIds = new Set<number>();
  const warnedCollisions = new Set<string>();

  function warnCollisionOnce(baseName: string, componentName: string): void {
    const key = `${baseName}:${componentName}`;
    if (warnedCollisions.has(key)) return;
    warnedCollisions.add(key);
    console.warn(
      `ts-route-openapi: component name collision for "${baseName}"; emitted "${componentName}" for a distinct schema.`,
    );
  }

  return {
    components,
    resolveRef(baseName: string, type: Type, computeSchema: () => Schema): Schema {
      const id = typeId(type);
      let componentName = componentNamesByTypeId.get(id);

      if (!componentName) {
        const existingRecords = componentRecordsByBaseName.get(baseName) ?? [];
        componentName =
          existingRecords.length === 0
            ? uniqueComponentName(baseName, usedComponentNames)
            : disambiguatedComponentName(baseName, type, usedComponentNames);
        componentNamesByTypeId.set(id, componentName);
      }

      if (!Object.hasOwn(components, componentName)) {
        components[componentName] = {};
      }

      if (!inProgressTypeIds.has(id) && Object.keys(components[componentName]).length === 0) {
        inProgressTypeIds.add(id);
        const schema = computeSchema();
        inProgressTypeIds.delete(id);

        const candidateName = componentName;
        const records = componentRecordsByBaseName.get(baseName) ?? [];
        const duplicate = records.find((record) =>
          schemasEqual(record.schema, schema, record.name, candidateName, baseName),
        );
        if (duplicate) {
          delete components[componentName];
          usedComponentNames.delete(componentName);
          componentNamesByTypeId.set(id, duplicate.name);
          componentName = duplicate.name;
        } else {
          components[componentName] = schema;
          records.push({ baseName, name: componentName, schema });
          componentRecordsByBaseName.set(baseName, records);

          if (records.length > 1) {
            warnCollisionOnce(baseName, componentName);
          }
        }
      }

      return { $ref: `#/components/schemas/${componentName}` };
    },
  };
}
