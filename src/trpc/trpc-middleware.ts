import { Node, type CallExpression } from 'ts-morph';
import { createWarnOnce, methodCallInfo, resolveIdentifierDeclaration, resolveIdentifierInitializer } from '../shared/index.js';

const warnOnce = createWarnOnce();

/**
 * Every `.use(fn)` middleware function feeding into a `.query(...)`/`.mutation(...)` call,
 * walking back through the procedure-builder chain — through `.use()`/`.input()`/`.output()`
 * links, an `Identifier` receiver naming a base procedure variable, and a factory call (e.g.
 * `createAdminSiteProcedure("label")`) whose body reduces to a single returned expression.
 * Stops silently at `t.procedure`, any other unresolvable receiver, or a factory whose body
 * isn't a single returned expression (warning in that last case, since it looks structured
 * enough that a reader would expect it to resolve).
 */
export function resolveProcedureMiddleware(call: CallExpression): Node[] {
  const middleware: Node[] = [];
  walk(call, middleware);
  return middleware;
}

function walk(node: Node, middleware: Node[]): void {
  const info = methodCallInfo(node);
  if (info) {
    if (info.method === 'use') {
      const [fn] = info.node.getArguments();
      if (fn) middleware.push(fn);
    }
    walk(info.receiver, middleware);
    return;
  }

  if (Node.isIdentifier(node)) {
    const initializer = resolveIdentifierInitializer(node);
    if (initializer) walk(initializer, middleware);
    return;
  }

  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    if (!Node.isIdentifier(callee)) return;

    const declaration = resolveIdentifierDeclaration(callee);
    if (!declaration) return;

    const returned = singleReturnedExpression(declaration);
    if (returned) {
      walk(returned, middleware);
      return;
    }
    warnGaveUp(node, 'non-single-return middleware factory body');
  }
}

/** The one expression a function-like declaration returns — an expression-bodied arrow, or a block with exactly one `return <expr>` statement — or undefined for anything else. */
function singleReturnedExpression(declaration: Node): Node | undefined {
  if (!Node.isArrowFunction(declaration) && !Node.isFunctionExpression(declaration) && !Node.isFunctionDeclaration(declaration)) {
    return undefined;
  }

  const body = declaration.getBody();
  if (!body) return undefined;
  if (!Node.isBlock(body)) return body;

  const statements = body.getStatements();
  if (statements.length !== 1 || !Node.isReturnStatement(statements[0])) return undefined;
  return statements[0].getExpression();
}

function warnGaveUp(node: Node, reason: string): void {
  const text = node.getText().slice(0, 80);
  warnOnce(`${reason}:${text}`, `ts-route-openapi: skipped middleware inference for ${text} (${reason}).`);
}
