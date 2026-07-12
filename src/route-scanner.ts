import { Node, type Project } from 'ts-morph';
import { methodCallsIn } from './ast-calls.js';
import type { HttpVerb, RouteBinding } from './types.js';

const DEFAULT_VERBS: HttpVerb[] = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * Find route-registration call-sites (e.g. `app.get('/users/:id', handler)`).
 * A call matches when the callee is a property access whose name is one of
 * `verbs`, its first argument is a string literal, and it has a second argument.
 */
export function scanRoutes(project: Project, verbs: HttpVerb[] = DEFAULT_VERBS): RouteBinding[] {
  const verbSet = new Set<string>(verbs);
  const bindings: RouteBinding[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    for (const { node, method } of methodCallsIn(sourceFile, verbSet)) {
      const args = node.getArguments();
      if (args.length < 2) continue;
      const pathArg = args[0];
      if (!Node.isStringLiteral(pathArg)) continue;
      const handlerIndex = lastHandlerIndex(args);
      if (handlerIndex < 1) continue;

      bindings.push({
        verb: method as HttpVerb,
        path: pathArg.getLiteralValue(),
        handlerExpression: args[handlerIndex],
        middlewareExpressions: args.slice(1, handlerIndex),
      });
    }
  }

  return bindings;
}

function lastHandlerIndex(args: Node[]): number {
  for (let index = args.length - 1; index >= 1; index -= 1) {
    const arg = args[index];
    if (
      Node.isArrowFunction(arg) ||
      Node.isFunctionExpression(arg) ||
      Node.isIdentifier(arg) ||
      Node.isPropertyAccessExpression(arg)
    ) {
      return index;
    }
  }
  return -1;
}
