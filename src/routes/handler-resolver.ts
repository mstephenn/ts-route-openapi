import { Node } from 'ts-morph';
import { resolveIdentifierDeclaration } from '../shared/index.js';
import type { ResolvedRoute, RouteBinding } from '../shared/index.js';

/**
 * Resolve a binding's handler expression to the function-like declaration it
 * references: a controller method (`UsersController.getById`), an inline
 * arrow/function expression, or an identifier pointing at a function.
 * Returns null when nothing resolvable is found.
 */
export function resolveHandler(binding: RouteBinding): ResolvedRoute | null {
  const expr = binding.handlerExpression;
  const base = {
    verb: binding.verb,
    path: binding.path,
    middlewareExpressions: binding.middlewareExpressions,
  };

  if (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr)) {
    return {
      ...base,
      controllerName: '(inline)',
      handlerName: `${binding.verb} ${binding.path}`,
      method: expr,
    };
  }

  if (Node.isPropertyAccessExpression(expr)) {
    const declaration = expr.getNameNode().getSymbol()?.getDeclarations()[0];
    if (!declaration || !Node.isMethodDeclaration(declaration)) return null;
    return {
      ...base,
      controllerName: expr.getExpression().getText(),
      handlerName: expr.getName(),
      method: declaration,
    };
  }

  if (Node.isIdentifier(expr)) {
    const target = resolveIdentifierDeclaration(expr);
    if (Node.isFunctionDeclaration(target) || Node.isArrowFunction(target) || Node.isFunctionExpression(target)) {
      return {
        ...base,
        controllerName: '(function)',
        handlerName: expr.getText(),
        method: target,
      };
    }
    return null;
  }

  return null;
}
