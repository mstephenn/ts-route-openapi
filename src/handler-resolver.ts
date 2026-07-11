import { Node } from 'ts-morph';
import type { ResolvedRoute, RouteBinding } from './types.js';

/**
 * Resolve a binding's handler expression to the function-like declaration it
 * references: a controller method (`UsersController.getById`), an inline
 * arrow/function expression, or an identifier pointing at a function.
 * Returns null when nothing resolvable is found.
 */
export function resolveHandler(binding: RouteBinding): ResolvedRoute | null {
  const expr = binding.handlerExpression;
  const base = { verb: binding.verb, path: binding.path };

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
    const declaration = expr.getSymbol()?.getDeclarations()[0];
    if (declaration && Node.isFunctionDeclaration(declaration)) {
      return {
        ...base,
        controllerName: '(function)',
        handlerName: expr.getText(),
        method: declaration,
      };
    }
    if (declaration && Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      if (
        initializer &&
        (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
      ) {
        return {
          ...base,
          controllerName: '(function)',
          handlerName: expr.getText(),
          method: initializer,
        };
      }
    }
    return null;
  }

  return null;
}
