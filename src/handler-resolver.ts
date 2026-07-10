import { Node } from 'ts-morph';
import type { ResolvedRoute, RouteBinding } from './types.js';

/**
 * Resolve a binding's handler expression (e.g. `UsersController.getById`) to the
 * controller method declaration it references. Returns null when the expression
 * is not a property access resolving to a method.
 */
export function resolveHandler(binding: RouteBinding): ResolvedRoute | null {
  const expr = binding.handlerExpression;
  if (!Node.isPropertyAccessExpression(expr)) return null;

  const handlerName = expr.getName();
  const controllerName = expr.getExpression().getText();

  const symbol = expr.getNameNode().getSymbol();
  const declaration = symbol?.getDeclarations()[0];
  if (!declaration || !Node.isMethodDeclaration(declaration)) return null;

  return {
    verb: binding.verb,
    path: binding.path,
    controllerName,
    handlerName,
    method: declaration,
  };
}
