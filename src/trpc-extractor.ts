import { Node, type CallExpression, type FunctionLikeDeclaration, type Type } from 'ts-morph';
import { callChain, resolveIdentifierDeclaration } from './ast-helpers.js';
import { unwrapPromise } from './frameworks/shared.js';
import { schemaFromZodExpression } from './validator-schemas.js';
import type { TrpcProcedure } from './trpc-scanner.js';
import type { Schema } from './types.js';

export interface TrpcProcedureIO {
  /** From `.input(<zodSchema>)`, when present. */
  inputSchema?: Schema;
  /** From `.output(<zodSchema>)`, when present — takes precedence over `responseType`. */
  outputSchema?: Schema;
  /** Resolver return type (Promise-unwrapped); only computed when there's no `.output()` schema. */
  responseType?: Type;
  /** The resolver, resolved to its function-like declaration when it's a named/hoisted reference. */
  resolverFn?: FunctionLikeDeclaration;
}

function chainSchema(call: CallExpression, method: string): Schema | undefined {
  const methodCall = callChain(call).find((entry) => entry.method === method);
  const [arg] = methodCall?.node.getArguments() ?? [];
  return arg && Node.isExpression(arg) ? schemaFromZodExpression(arg) : undefined;
}

/** The function-like declaration a resolver node is or refers to, following a named/hoisted function reference. */
export function resolverFunction(resolver: Node): FunctionLikeDeclaration | undefined {
  if (Node.isFunctionLikeDeclaration(resolver)) return resolver;

  const target = resolveIdentifierDeclaration(resolver);
  return Node.isFunctionLikeDeclaration(target) ? target : undefined;
}

/** Extract a tRPC procedure's `.input()`/`.output()` schemas and (Promise-unwrapped) resolver return type. */
export function extractTrpcProcedureIO(procedure: TrpcProcedure): TrpcProcedureIO {
  const inputSchema = chainSchema(procedure.call, 'input');
  const outputSchema = chainSchema(procedure.call, 'output');
  const resolverFn = resolverFunction(procedure.resolver);
  const responseType = outputSchema || !resolverFn ? undefined : unwrapPromise(resolverFn.getReturnType());

  return { inputSchema, outputSchema, responseType, resolverFn };
}
