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

/** Every call in `call`'s own receiver chain, outermost first (e.g. `.query()`, then `.output()`, then `.input()`). */
export function callChain(call: CallExpression): CallExpression[] {
  const calls: CallExpression[] = [];
  let current: Node = call;
  while (Node.isCallExpression(current)) {
    calls.push(current);
    const info = methodCallInfo(current);
    if (!info) break;
    current = info.receiver;
  }
  return calls;
}
