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

/** Follow an `Identifier` to its variable declaration's initializer, if any. */
export function resolveIdentifierInitializer(node: Node): Node | undefined {
  if (!Node.isIdentifier(node)) return undefined;
  const declaration = node.getSymbol()?.getDeclarations()[0];
  if (!declaration || !Node.isVariableDeclaration(declaration)) return undefined;
  return declaration.getInitializer();
}
