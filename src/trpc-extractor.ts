import { Node, type CallExpression, type FunctionLikeDeclaration, type Type } from 'ts-morph';
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
}

/** Every call in `call`'s receiver chain, outermost first (e.g. `.query()`, then `.output()`, then `.input()`). */
function chainCalls(call: CallExpression): CallExpression[] {
  const calls: CallExpression[] = [];
  let current: Node = call;
  while (Node.isCallExpression(current)) {
    calls.push(current);
    const callee = current.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) break;
    current = callee.getExpression();
  }
  return calls;
}

/** Find the `.input(...)`/`.output(...)` call in `call`'s receiver chain, if present. */
function chainCall(call: CallExpression, method: string): CallExpression | undefined {
  return chainCalls(call).find((entry) => {
    const callee = entry.getExpression();
    return Node.isPropertyAccessExpression(callee) && callee.getName() === method;
  });
}

function chainSchema(call: CallExpression, method: string): Schema | undefined {
  const methodCall = chainCall(call, method);
  const [arg] = methodCall?.getArguments() ?? [];
  return arg && Node.isExpression(arg) ? schemaFromZodExpression(arg) : undefined;
}

/** The function-like declaration a resolver node is or refers to, following a named/hoisted function reference. */
export function resolverFunction(resolver: Node): FunctionLikeDeclaration | undefined {
  if (Node.isFunctionLikeDeclaration(resolver)) return resolver;

  if (Node.isIdentifier(resolver)) {
    const declaration = resolver.getSymbol()?.getDeclarations()[0];
    if (Node.isFunctionLikeDeclaration(declaration)) return declaration;
    if (declaration && Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      if (Node.isFunctionLikeDeclaration(initializer)) return initializer;
    }
  }

  return undefined;
}

function resolverReturnType(resolver: Node): Type | undefined {
  const fn = resolverFunction(resolver);
  return fn ? unwrapPromise(fn.getReturnType()) : undefined;
}

/** Extract a tRPC procedure's `.input()`/`.output()` schemas and (Promise-unwrapped) resolver return type. */
export function extractTrpcProcedureIO(procedure: TrpcProcedure): TrpcProcedureIO {
  const inputSchema = chainSchema(procedure.call, 'input');
  const outputSchema = chainSchema(procedure.call, 'output');
  const responseType = outputSchema ? undefined : resolverReturnType(procedure.resolver);

  return { inputSchema, outputSchema, responseType };
}
