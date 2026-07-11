import type { ParameterDeclaration, Type } from 'ts-morph';
import { pathTokens } from '../route-paths.js';
import type { ParamType, ResolvedRoute } from '../types.js';

/** Best name for a type: alias name first, then symbol name. */
export function typeName(type: Type): string | undefined {
  return type.getAliasSymbol()?.getName() ?? type.getSymbol()?.getName();
}

/** File path of the declaration that introduced this type, if any. */
export function declarationPath(type: Type): string | undefined {
  const symbol = type.getAliasSymbol() ?? type.getSymbol();
  return symbol?.getDeclarations()[0]?.getSourceFile().getFilePath();
}

/** True when the path contains the given package name as a segment (e.g. node_modules/koa/...). */
export function fromPackage(type: Type, pkg: string): boolean {
  const path = declarationPath(type);
  if (!path) return false;
  return new RegExp(`(^|/)(@types/)?${pkg}([./]|$)`).test(path);
}

/** Reject types that carry no usable information. */
export function usable(type: Type | undefined): Type | undefined {
  return type && !type.isAny() && !type.isUnknown() && !type.isNever() ? type : undefined;
}

/** A concrete object type with named properties (no index signatures) → named params. */
export function objectParams(
  type: Type | undefined,
  location: ParameterDeclaration,
): ParamType[] | undefined {
  const t = usable(type);
  if (!t?.isObject() || t.getStringIndexType() || t.getNumberIndexType()) return undefined;
  const props = t.getProperties();
  if (props.length === 0) return undefined;
  return props.map((p) => ({ name: p.getName(), type: p.getTypeAtLocation(location) }));
}

export function usableObject(type: Type | undefined): Type | undefined {
  const t = usable(type);
  return t?.isObject() ? t : undefined;
}

/** Path `:tokens` as untyped (string) path params — the universal fallback. */
export function tokenParams(route: ResolvedRoute): ParamType[] {
  return pathTokens(route.path).map((name) => ({ name }));
}

export function unwrapPromise(type: Type): Type {
  if (type.getSymbol()?.getName() === 'Promise') {
    const args = type.getTypeArguments();
    if (args.length === 1) return args[0];
  }
  return type;
}

/** Reject unusable response types (any/unknown/never/void). */
export function usableResponse(type: Type | undefined): Type | undefined {
  const t = usable(type);
  if (!t || t.getText() === 'void') return undefined;
  return t;
}
