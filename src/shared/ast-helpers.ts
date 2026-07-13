import { Node, type CallExpression, type Expression } from 'ts-morph';

export interface MethodCall {
  node: CallExpression;
  method: string;
  receiver: Expression;
}

/** `{ node, method, receiver }` for a call shaped `<receiver>.<method>(...)`, or undefined otherwise. */
export function methodCallInfo(node: Node): MethodCall | undefined {
  if (!Node.isCallExpression(node)) return undefined;
  const callee = node.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  return { node, method: callee.getName(), receiver: callee.getExpression() };
}

/** Descendants of `root` shaped `<receiver>.<method>(...)` whose method name is in `methodNames`. */
export function methodCallsIn(root: Node, methodNames: Set<string>): MethodCall[] {
  const calls: MethodCall[] = [];
  root.forEachDescendant((node) => {
    const info = methodCallInfo(node);
    if (info && methodNames.has(info.method)) calls.push(info);
  });
  return calls;
}

/** Every method call in `call`'s own receiver chain, outermost first (e.g. `.query()`, then `.output()`, then `.input()`). */
export function callChain(call: CallExpression): MethodCall[] {
  const calls: MethodCall[] = [];
  let info = methodCallInfo(call);
  while (info) {
    calls.push(info);
    info = methodCallInfo(info.receiver);
  }
  return calls;
}

/** The symbol an `Identifier` refers to, following import aliases to their originating declaration. */
function resolvedSymbol(node: Node): import('ts-morph').Symbol | undefined {
  if (!Node.isIdentifier(node)) return undefined;
  const symbol = node.getSymbol();
  if (!symbol) return undefined;
  return symbol.isAlias() ? symbol.getAliasedSymbol() : symbol;
}

/** Follow an `Identifier` to its variable declaration's initializer, if any. */
export function resolveIdentifierInitializer(node: Node): Node | undefined {
  const declaration = resolvedSymbol(node)?.getDeclarations()[0];
  if (!declaration || !Node.isVariableDeclaration(declaration)) return undefined;
  return declaration.getInitializer();
}

/**
 * An `Identifier`'s own declaration (e.g. a bare `function foo(){}` reference), or —
 * if that declaration is a variable — that variable's initializer. One symbol lookup
 * either way, for callers that want to accept both "identifier names a declaration
 * directly" and "identifier names a variable holding one" without resolving twice.
 */
export function resolveIdentifierDeclaration(node: Node): Node | undefined {
  const declaration = resolvedSymbol(node)?.getDeclarations()[0];
  if (!declaration) return undefined;
  return Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : declaration;
}
