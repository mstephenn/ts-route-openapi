import { Node, type Type } from 'ts-morph';
import type { ResponseType, RouteHandler } from '../types.js';

/**
 * Scan an Express-style handler body for response chains on `res`:
 * `res.status(N).json(x)` / `res.status(N).send(x)` / `res.status(N).end()`
 * and bare `res.json(x)` / `res.send(x)` (implicit 200).
 * Returns one entry per distinct status; first payload type per status wins.
 */
export function expressStatusResponses(
  handler: RouteHandler,
  resName: string,
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
      if (inner.getExpression().getText() !== resName) return;
      const arg = receiver.getArguments()[0];
      if (!arg || !Node.isNumericLiteral(arg)) return;
      status = Number(arg.getLiteralValue());
    } else if (receiver.getText() !== resName) {
      return;
    }

    const payload = method === 'end' ? undefined : node.getArguments()[0]?.getType();
    if (!found.has(status)) found.set(status, payload);
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
  replyName: string | undefined,
  payloadType: Type | undefined,
): ResponseType[] {
  const codes = new Set<number>();

  if (replyName) {
    handler.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression();
      if (!Node.isPropertyAccessExpression(callee)) return;
      if (callee.getName() !== 'code' && callee.getName() !== 'status') return;
      if (callee.getExpression().getText() !== replyName) return;
      const arg = node.getArguments()[0];
      if (arg && Node.isNumericLiteral(arg)) codes.add(Number(arg.getLiteralValue()));
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
