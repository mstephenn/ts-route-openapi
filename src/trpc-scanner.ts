import { Node, type CallExpression, type Project } from 'ts-morph';

export interface TrpcProcedure {
  /** Dotted procedure path, e.g. `users.getById`. */
  path: string;
  kind: 'query' | 'mutation';
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

/** Resolve a property value to the router call it names, whether inline or via a variable reference. */
function resolveRouterCall(value: Node): CallExpression | undefined {
  if (isRouterCall(value)) return value;

  if (Node.isIdentifier(value)) {
    const declaration = value.getSymbol()?.getDeclarations()[0];
    if (declaration && Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      if (initializer && isRouterCall(initializer)) return initializer;
    }
  }

  return undefined;
}

/** Mark every router call reachable (inline or by identifier) from `call`'s properties as nested, not a root. */
function collectNestedRouterCalls(call: CallExpression, nested: Set<CallExpression>): void {
  const [arg] = call.getArguments();
  if (!Node.isObjectLiteralExpression(arg)) return;

  for (const prop of arg.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;
    const value = prop.getInitializer();
    if (!value) continue;

    const nestedCall = resolveRouterCall(value);
    if (nestedCall && !nested.has(nestedCall)) {
      nested.add(nestedCall);
      collectNestedRouterCalls(nestedCall, nested);
    }
  }
}

/** A property value shaped `<procedureBuilder chain>.query(fn)` / `.mutation(fn)`. */
function procedureFromChain(value: Node, path: string): TrpcProcedure | undefined {
  if (!Node.isCallExpression(value)) return undefined;
  const callee = value.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;

  const method = callee.getName();
  if (method !== 'query' && method !== 'mutation') return undefined;

  const [resolver] = value.getArguments();
  if (!resolver) return undefined;

  return { path, kind: method, resolver };
}

function proceduresFromRouter(call: CallExpression, prefix: string): TrpcProcedure[] {
  const [arg] = call.getArguments();
  if (!Node.isObjectLiteralExpression(arg)) return [];

  const procedures: TrpcProcedure[] = [];
  for (const prop of arg.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;
    const value = prop.getInitializer();
    if (!value) continue;

    const name = prop.getName();
    const path = prefix ? `${prefix}.${name}` : name;

    const nestedCall = resolveRouterCall(value);
    if (nestedCall) {
      procedures.push(...proceduresFromRouter(nestedCall, path));
      continue;
    }

    const procedure = procedureFromChain(value, path);
    if (procedure) procedures.push(procedure);
  }

  return procedures;
}

/**
 * Discover tRPC procedures (queries/mutations) from `router({...})` definitions.
 * Routers referenced as a sub-router of another router (inline or via a
 * variable identifier) are flattened under their parent's dotted path rather
 * than reported again as their own root.
 */
export function scanTrpcRouters(project: Project): TrpcProcedure[] {
  const candidates: CallExpression[] = [];
  for (const sourceFile of project.getSourceFiles()) {
    sourceFile.forEachDescendant((node) => {
      if (isRouterCall(node)) candidates.push(node);
    });
  }

  const nested = new Set<CallExpression>();
  for (const call of candidates) collectNestedRouterCalls(call, nested);

  const roots = candidates.filter((call) => !nested.has(call));
  return roots.flatMap((root) => proceduresFromRouter(root, ''));
}
