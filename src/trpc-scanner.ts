import { Node, type CallExpression, type Project } from 'ts-morph';
import { methodCallInfo, resolveIdentifierInitializer } from './ast-calls.js';

export interface TrpcProcedure {
  /** Dotted procedure path, e.g. `users.getById`. */
  path: string;
  kind: 'query' | 'mutation';
  /** The `.query(...)`/`.mutation(...)` call — its receiver chain carries any `.input()`/`.output()` calls. */
  call: CallExpression;
  /** The function passed to `.query(...)`/`.mutation(...)`. */
  resolver: Node;
}

/** True for `router({...})` / `t.router({...})` call expressions. */
function isRouterCall(node: Node): node is CallExpression {
  if (!Node.isCallExpression(node)) return false;
  const callee = node.getExpression();
  const name = Node.isPropertyAccessExpression(callee)
    ? callee.getName()
    : Node.isIdentifier(callee)
      ? callee.getText()
      : undefined;
  if (name !== 'router') return false;

  const [arg] = node.getArguments();
  return !!arg && Node.isObjectLiteralExpression(arg);
}

/** `{ name, value }` for each `name: value` (or shorthand `{ name }`) property of a router call's object-literal argument. */
function routerProperties(call: CallExpression): { name: string; value: Node }[] {
  const [arg] = call.getArguments();
  if (!Node.isObjectLiteralExpression(arg)) return [];

  const entries: { name: string; value: Node }[] = [];
  for (const prop of arg.getProperties()) {
    if (Node.isPropertyAssignment(prop)) {
      const value = prop.getInitializer();
      if (value) entries.push({ name: prop.getName(), value });
    } else if (Node.isShorthandPropertyAssignment(prop)) {
      // `{ userRouter }`: the name node's own symbol is the property itself, not
      // the referenced variable — getValueSymbol() resolves the reference.
      const declaration = prop.getValueSymbol()?.getDeclarations()[0];
      const initializer = declaration && Node.isVariableDeclaration(declaration)
        ? declaration.getInitializer()
        : undefined;
      if (initializer) entries.push({ name: prop.getName(), value: initializer });
    }
  }
  return entries;
}

/** Resolve a property value to the router call it names, whether inline or via a variable reference. */
function resolveRouterCall(value: Node, cache: Map<Node, CallExpression | undefined>): CallExpression | undefined {
  const cached = cache.get(value);
  if (cached !== undefined || cache.has(value)) return cached;

  const resolvedValue = resolveIdentifierInitializer(value) ?? value;
  const resolved = isRouterCall(resolvedValue) ? resolvedValue : undefined;

  cache.set(value, resolved);
  return resolved;
}

/** Mark every router call reachable (inline or by identifier) from `call`'s properties as nested, not a root. */
function collectNestedRouterCalls(
  call: CallExpression,
  nested: Set<CallExpression>,
  cache: Map<Node, CallExpression | undefined>,
): void {
  for (const { value } of routerProperties(call)) {
    const nestedCall = resolveRouterCall(value, cache);
    if (nestedCall && !nested.has(nestedCall)) {
      nested.add(nestedCall);
      collectNestedRouterCalls(nestedCall, nested, cache);
    }
  }
}

/** A property value shaped `<procedureBuilder chain>.query(fn)` / `.mutation(fn)`. */
function procedureFromChain(value: Node, path: string): TrpcProcedure | undefined {
  const info = methodCallInfo(value);
  if (!info || (info.method !== 'query' && info.method !== 'mutation')) return undefined;

  const [resolver] = info.node.getArguments();
  if (!resolver) return undefined;

  return { path, kind: info.method, call: info.node, resolver };
}

function proceduresFromRouter(
  call: CallExpression,
  prefix: string,
  cache: Map<Node, CallExpression | undefined>,
): TrpcProcedure[] {
  const procedures: TrpcProcedure[] = [];

  for (const { name, value } of routerProperties(call)) {
    const path = prefix ? `${prefix}.${name}` : name;

    const nestedCall = resolveRouterCall(value, cache);
    if (nestedCall) {
      procedures.push(...proceduresFromRouter(nestedCall, path, cache));
      continue;
    }

    const procedure = procedureFromChain(resolveIdentifierInitializer(value) ?? value, path);
    if (procedure) procedures.push(procedure);
  }

  return procedures;
}

/**
 * Discover tRPC procedures (queries/mutations) from `router({...})` definitions.
 * Routers referenced as a sub-router of another router (inline or via a
 * variable identifier) are flattened under their parent's dotted path rather
 * than reported again as their own root.
 *
 * Known limitations (out of scope for this scanner): a router assigned to a
 * variable that's also referenced standalone elsewhere is only ever reported
 * under its parent's dotted path, never additionally as its own root; router
 * composition via `mergeRouters(...)` or object-spread isn't recognized as
 * nesting; and passing a named object (rather than an inline literal) as
 * `router()`'s argument isn't recognized as a router call at all.
 */
export function scanTrpcRouters(project: Project): TrpcProcedure[] {
  const candidates: CallExpression[] = [];
  for (const sourceFile of project.getSourceFiles()) {
    sourceFile.forEachDescendant((node) => {
      if (isRouterCall(node)) candidates.push(node);
    });
  }

  const cache = new Map<Node, CallExpression | undefined>();
  const nested = new Set<CallExpression>();
  for (const call of candidates) {
    if (!nested.has(call)) collectNestedRouterCalls(call, nested, cache);
  }

  const roots = candidates.filter((call) => !nested.has(call));
  return roots.flatMap((root) => proceduresFromRouter(root, '', cache));
}
