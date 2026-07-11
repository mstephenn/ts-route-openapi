import { Node, type ParameterDeclaration, type Type } from 'ts-morph';
import type { ResponseType, RouteHandler } from '../types.js';

/**
 * Resolve a status-code argument to its number via the type checker — covers
 * numeric literals, const references, and enum members (e.g. HttpStatus.CREATED).
 */
export function literalStatus(node: Node | undefined): number | undefined {
  if (!node) return undefined;
  const literal = node.getType().getLiteralValue();
  return typeof literal === 'number' ? literal : undefined;
}

/** True when the expression resolves to the given parameter declaration (shadow-safe). */
function refersToParam(receiver: Node, param: ParameterDeclaration): boolean {
  if (!Node.isIdentifier(receiver)) return false;
  return receiver.getSymbol()?.getDeclarations()[0] === param;
}

/**
 * Scan an Express-style handler body for response chains on `res`:
 * `res.status(N).json(x)` / `res.status(N).send(x)` / `res.status(N).end()`
 * and bare `res.json(x)` / `res.send(x)` (implicit 200).
 * Returns one entry per distinct status; first payload type per status wins.
 */
export function expressStatusResponses(
  handler: RouteHandler,
  resParam: ParameterDeclaration,
  fallbackType: Type | undefined,
): ResponseType[] {
  const found = new Map<number, Type | undefined>();

  handler.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return;
    const method = callee.getName();
    if (method !== 'json' && method !== 'send' && method !== 'end') return;

    const receiver = callee.getExpression();
    let status = 200;
    if (Node.isCallExpression(receiver)) {
      // res.status(N).json(...)
      const inner = receiver.getExpression();
      if (!Node.isPropertyAccessExpression(inner) || inner.getName() !== 'status') return;
      if (!refersToParam(inner.getExpression(), resParam)) return;
      const resolved = literalStatus(receiver.getArguments()[0]);
      if (resolved === undefined) return;
      status = resolved;
    } else if (!refersToParam(receiver, resParam)) {
      return;
    }

    if (found.has(status)) return;
    found.set(status, method === 'end' ? undefined : node.getArguments()[0]?.getType());
  });

  if (found.size === 0) return [];
  // Prefer the extractor's response type over an inferred payload for 200.
  if (found.has(200) && fallbackType) found.set(200, found.get(200) ?? fallbackType);
  return [...found.entries()]
    .sort(([a], [b]) => a - b)
    .map(([status, type]) => ({ status, type }));
}

/**
 * Scan a Fastify handler body for `reply.code(N)` / `reply.status(N)` calls.
 * A 2xx code claims the handler's payload type; 4xx/5xx codes are schema-less.
 * Without any 2xx code call, the payload stays on 200.
 */
export function fastifyStatusResponses(
  handler: RouteHandler,
  replyParam: ParameterDeclaration | undefined,
  payloadType: Type | undefined,
): ResponseType[] {
  const codes = new Set<number>();

  if (replyParam) {
    handler.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression();
      if (!Node.isPropertyAccessExpression(callee)) return;
      const method = callee.getName();
      if (method !== 'code' && method !== 'status') return;
      if (!refersToParam(callee.getExpression(), replyParam)) return;
      const resolved = literalStatus(node.getArguments()[0]);
      if (resolved !== undefined) codes.add(resolved);
    });
  }

  if (codes.size === 0) return [];
  const successCode = [...codes].find((c) => c >= 200 && c < 300) ?? 200;
  const statuses = new Set([successCode, ...codes]);
  return [...statuses]
    .sort((a, b) => a - b)
    .map((status) => ({
      status,
      type: status === successCode ? payloadType : undefined,
    }));
}
