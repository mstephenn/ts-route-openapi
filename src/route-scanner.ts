import { Node, type Project } from 'ts-morph';
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
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression();
      if (!Node.isPropertyAccessExpression(callee)) return;
      if (!verbSet.has(callee.getName())) return;

      const args = node.getArguments();
      if (args.length < 2) return;
      const pathArg = args[0];
      if (!Node.isStringLiteral(pathArg)) return;

      bindings.push({
        verb: callee.getName() as HttpVerb,
        path: pathArg.getLiteralValue(),
        handlerExpression: args[1],
      });
    });
  }

  return bindings;
}
