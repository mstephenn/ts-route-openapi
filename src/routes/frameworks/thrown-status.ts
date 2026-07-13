import { Node, SyntaxKind, type ClassDeclaration } from 'ts-morph';
import {
  methodCallInfo,
  resolveIdentifierDeclaration,
  type ResolvedRoute,
  type ResponseType,
  type RouteHandler,
} from '../../shared/index.js';
import { expressStatusResponses, literalStatus, sameAppInstance } from './status-calls.js';

/** NestJS built-in `HttpException` subclasses (`@nestjs/common`) and the status each maps to. */
const NEST_HTTP_EXCEPTIONS: Record<string, number> = {
  BadRequestException: 400,
  UnauthorizedException: 401,
  ForbiddenException: 403,
  NotFoundException: 404,
  MethodNotAllowedException: 405,
  NotAcceptableException: 406,
  RequestTimeoutException: 408,
  ConflictException: 409,
  GoneException: 410,
  PayloadTooLargeException: 413,
  UnsupportedMediaTypeException: 415,
  UnprocessableEntityException: 422,
  InternalServerErrorException: 500,
  NotImplementedException: 501,
  BadGatewayException: 502,
  ServiceUnavailableException: 503,
  GatewayTimeoutException: 504,
  HttpVersionNotSupportedException: 505,
};

/** A class's own `status`/`statusCode` property initializer, walking a local `extends` chain. */
function classStatusLiteral(cls: ClassDeclaration): number | undefined {
  for (const propName of ['status', 'statusCode']) {
    const initializer = cls.getProperty(propName)?.getInitializer();
    const literal = literalStatus(initializer);
    if (literal !== undefined) return literal;
  }
  const base = cls.getBaseClass();
  return base ? classStatusLiteral(base) : undefined;
}

/** Resolve a `throw new X(...)` expression's status via Nest built-ins, `HttpException(_, status)`, or a local class's status property. */
function resolveThrownStatus(expr: Node): number | undefined {
  if (!Node.isNewExpression(expr)) return undefined;
  const ctor = expr.getExpression();
  const name = Node.isIdentifier(ctor) ? ctor.getText() : undefined;

  if (name !== undefined && name in NEST_HTTP_EXCEPTIONS) return NEST_HTTP_EXCEPTIONS[name];
  if (name === 'HttpException') return literalStatus(expr.getArguments()[1]);

  const declaration = Node.isIdentifier(ctor)
    ? ctor.getSymbol()?.getDeclarations().find(Node.isClassDeclaration)
    : undefined;
  return declaration ? classStatusLiteral(declaration) : undefined;
}

/** Statuses from `throw new X(...)` in a handler body — schema-less, one entry per distinct status. */
export function thrownStatusResponses(handler: RouteHandler): ResponseType[] {
  const statuses = new Set<number>();
  handler.forEachDescendant((node) => {
    if (!Node.isThrowStatement(node)) return;
    const status = resolveThrownStatus(node.getExpression());
    if (status !== undefined) statuses.add(status);
  });
  return [...statuses].sort((a, b) => a - b).map((status) => ({ status }));
}

/** A function-like node with exactly 4 parameters — Express's `(err, req, res, next)` error-handler shape. */
function asErrorHandler(node: Node | undefined): RouteHandler | undefined {
  if (!node) return undefined;
  const declaration = Node.isIdentifier(node) ? resolveIdentifierDeclaration(node) : node;
  const handler =
    declaration &&
    (Node.isArrowFunction(declaration) ||
      Node.isFunctionExpression(declaration) ||
      Node.isFunctionDeclaration(declaration))
      ? declaration
      : undefined;
  return handler && handler.getParameters().length === 4 ? handler : undefined;
}

/**
 * Statuses set by an Express error-handling middleware — `app.use((err, req, res, next) => ...)` —
 * applied to a route when the middleware is in the route's own file (unconditionally) or is
 * registered on the same app/router instance (by symbol identity) anywhere else in the project.
 */
export function expressErrorMiddlewareStatuses(route: ResolvedRoute): ResponseType[] {
  const statuses = new Set<number>();
  const routeFile = route.method.getSourceFile();

  for (const sourceFile of routeFile.getProject().getSourceFiles()) {
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const info = methodCallInfo(call);
      if (!info || info.method !== 'use') continue;
      const handler = asErrorHandler(info.node.getArguments()[0]);
      const resParam = handler?.getParameters()[2];
      if (!handler || !resParam) continue;

      const sameFile = sourceFile === routeFile;
      if (!sameFile && !sameAppInstance(info.receiver, route.receiver)) continue;

      for (const { status } of expressStatusResponses(handler, resParam, undefined)) {
        if (status !== 200) statuses.add(status);
      }
    }
  }

  return [...statuses].sort((a, b) => a - b).map((status) => ({ status }));
}

/** Merge additional schema-less statuses into an existing response list, keeping any already-present entry (and its type/schema) for a shared status. */
export function mergeResponses(base: ResponseType[], additions: ResponseType[]): ResponseType[] {
  const merged = new Map(base.map((r) => [r.status, r]));
  for (const addition of additions) {
    if (!merged.has(addition.status)) merged.set(addition.status, addition);
  }
  return [...merged.values()].sort((a, b) => a.status - b.status);
}

/** Fold thrown-exception statuses into a route's response list, converting a single implicit 200 into an explicit list only when new statuses are found. */
export function withThrownStatuses(
  types: { response?: ResponseType['type']; responses?: ResponseType[] },
  handler: RouteHandler,
): ResponseType[] | undefined {
  const thrown = thrownStatusResponses(handler);
  if (thrown.length === 0) return types.responses;
  const base = types.responses ?? [{ status: 200, type: types.response }];
  return mergeResponses(base, thrown);
}
