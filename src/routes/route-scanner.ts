import { Node, type Project } from 'ts-morph';
import { methodCallsIn } from '../shared/index.js';
import type { HttpVerb, RouteBinding } from '../shared/index.js';
import { joinPaths } from './route-paths.js';

const DEFAULT_VERBS: HttpVerb[] = ['get', 'post', 'put', 'patch', 'delete'];
const MIDDLEWARE_METHODS = new Set(['use', 'addHook']);

interface ScopedMiddleware {
  receiver: string;
  prefix: string;
  middlewareExpressions: Node[];
  position: number;
}

interface MountedReceiver {
  receiver: string;
  mounted: string;
  prefix: string;
  middlewareExpressions: Node[];
  position: number;
}

/**
 * Find route-registration call-sites (e.g. `app.get('/users/:id', handler)`).
 * A call matches when the callee is a property access whose name is one of
 * `verbs`, its first argument is a string literal, and it has a second argument.
 */
export function scanRoutes(project: Project, verbs: HttpVerb[] = DEFAULT_VERBS): RouteBinding[] {
  const verbSet = new Set<string>(verbs);
  const bindings: RouteBinding[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const scopedMiddleware: ScopedMiddleware[] = [];
    const mountedReceivers: MountedReceiver[] = [];
    for (const { node, method, receiver } of methodCallsIn(sourceFile, MIDDLEWARE_METHODS)) {
      const receiverName = receiverKey(receiver);
      if (!receiverName) continue;
      if (method === 'use') {
        const registration = middlewareRegistration(node.getArguments());
        if (!registration) continue;
        const mounted =
          registration.middlewareExpressions.length > 1
            ? mountedReceiver(registration.middlewareExpressions.at(-1))
            : undefined;
        if (mounted) {
          mountedReceivers.push({
            receiver: receiverName,
            mounted,
            prefix: registration.prefix,
            middlewareExpressions: registration.middlewareExpressions.slice(0, -1),
            position: node.getStart(),
          });
          continue;
        }
        scopedMiddleware.push({
          receiver: receiverName,
          prefix: registration.prefix,
          middlewareExpressions: registration.middlewareExpressions,
          position: node.getStart(),
        });
      }

      if (method === 'addHook') {
        const registration = fastifyHookRegistration(node.getArguments());
        if (!registration) continue;
        scopedMiddleware.push({
          receiver: receiverName,
          prefix: '',
          middlewareExpressions: [registration],
          position: node.getStart(),
        });
      }
    }

    for (const { node, method, receiver } of methodCallsIn(sourceFile, verbSet)) {
      const args = node.getArguments();
      if (args.length < 2) continue;
      const pathArg = args[0];
      if (!Node.isStringLiteral(pathArg)) continue;
      const handlerIndex = lastHandlerIndex(args);
      if (handlerIndex < 1) continue;
      const routeReceiver = receiverKey(receiver);
      const mount = mountedReceivers
        .filter((entry) => routeReceiver && entry.mounted === routeReceiver && entry.position < node.getStart())
        .at(-1);
      const routePath = mount ? joinPaths(mount.prefix, pathArg.getLiteralValue()) : pathArg.getLiteralValue();
      const inheritedMiddleware = scopedMiddleware
        .filter((entry) => routeReceiver && entry.receiver === routeReceiver && entry.position < node.getStart())
        .filter((entry) => entry.prefix === '' || routePath === entry.prefix || routePath.startsWith(`${entry.prefix}/`))
        .flatMap((entry) => entry.middlewareExpressions);

      bindings.push({
        verb: method as HttpVerb,
        path: routePath,
        handlerExpression: args[handlerIndex],
        middlewareExpressions: [...(mount?.middlewareExpressions ?? []), ...inheritedMiddleware, ...args.slice(1, handlerIndex)],
        receiver,
      });
    }
  }

  return bindings;
}

function middlewareRegistration(args: Node[]): { prefix: string; middlewareExpressions: Node[] } | undefined {
  if (args.length === 0) return undefined;
  const [first, ...rest] = args;
  if (Node.isStringLiteral(first)) return { prefix: first.getLiteralValue(), middlewareExpressions: rest };
  return { prefix: '', middlewareExpressions: args };
}

function fastifyHookRegistration(args: Node[]): Node | undefined {
  const [hookName, middleware] = args;
  if (!Node.isStringLiteral(hookName) || !middleware) return undefined;
  return ['onRequest', 'preHandler', 'preValidation'].includes(hookName.getLiteralValue()) ? middleware : undefined;
}

function mountedReceiver(node: Node | undefined): string | undefined {
  if (!node || !Node.isIdentifier(node)) return undefined;
  return node.getText();
}

function receiverKey(node: Node): string | undefined {
  if (Node.isIdentifier(node) || Node.isPropertyAccessExpression(node)) return node.getText();
  return undefined;
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
