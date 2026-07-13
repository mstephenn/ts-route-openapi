import { Node, type Decorator } from 'ts-morph';
import type { SecurityRequirement } from '../config.js';
import { createWarnOnce, type ResolvedRoute } from '../shared/index.js';

export interface InferredSecurity {
  schemes: Record<string, Record<string, unknown>>;
  security: SecurityRequirement[];
}

interface SchemeEvidence {
  name: string;
  scheme: Record<string, unknown>;
}

const warnOnce = createWarnOnce();

export function inferRouteSecurity(route: ResolvedRoute): InferredSecurity | undefined {
  const middlewareExpressions = route.middlewareExpressions ?? [];
  const evidence = [
    ...middlewareExpressions.flatMap(securityFromExpression),
    ...securityFromNestDecorators(route),
  ];
  if (evidence.length === 0) return undefined;

  const schemes: Record<string, Record<string, unknown>> = {};
  const requirement: SecurityRequirement = {};
  for (const item of evidence) {
    schemes[item.name] ??= item.scheme;
    requirement[item.name] ??= [];
  }
  return { schemes, security: [requirement] };
}

function securityFromExpression(node: Node): SchemeEvidence[] {
  if (Node.isObjectLiteralExpression(node)) return securityFromObjectLiteral(node);
  if (Node.isArrayLiteralExpression(node)) return node.getElements().flatMap(securityFromExpression);

  const resolved = Node.isIdentifier(node) ? node.getSymbol()?.getDeclarations()[0] : undefined;
  const nameText = expressionName(node);
  const fromName = nameText ? securityFromName(nameText) : undefined;
  const fromCall = Node.isCallExpression(node) ? securityFromCall(node) : undefined;
  const fromDeclaration = resolved ? securityFromDeclaration(resolved) : undefined;
  const evidence = [fromCall, fromName, fromDeclaration].filter((x): x is SchemeEvidence => Boolean(x));
  if (evidence.length === 0) warnIfSecurityRelevant(node.getText(), 'ambiguous security scheme');
  return evidence;
}

function securityFromObjectLiteral(node: Node): SchemeEvidence[] {
  if (!Node.isObjectLiteralExpression(node)) return [];
  const relevant = new Set(['preHandler', 'onRequest', 'preValidation']);
  const evidence: SchemeEvidence[] = [];
  for (const prop of node.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;
    const name = prop.getName();
    if (!relevant.has(name)) continue;
    evidence.push(...securityFromExpression(prop.getInitializerOrThrow()));
  }
  return evidence;
}

function securityFromNestDecorators(route: ResolvedRoute): SchemeEvidence[] {
  if (!route.method) return [];
  const decorators = [
    ...decoratorsOf(route.method.getParent()),
    ...decoratorsOf(route.method),
  ];
  return decorators.flatMap(securityFromDecorator);
}

function securityFromDecorator(decorator: Decorator): SchemeEvidence[] {
  if (decorator.getName() !== 'UseGuards') return [];
  return decorator.getArguments().map(securityFromGuardArgument).filter((x): x is SchemeEvidence => Boolean(x));
}

function securityFromGuardArgument(node: Node): SchemeEvidence | undefined {
  if (Node.isIdentifier(node) || Node.isPropertyAccessExpression(node)) {
    return securityFromName(node.getText());
  }
  if (Node.isCallExpression(node)) {
    return securityFromCall(node) ?? securityFromName(node.getExpression().getText());
  }
  return undefined;
}

function securityFromCall(call: Node): SchemeEvidence | undefined {
  if (!Node.isCallExpression(call)) return undefined;
  const callee = call.getExpression();
  const name = callee.getText();
  const args = call.getArguments();

  if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'authenticate') {
    const strategy = stringArg(args[0])?.toLowerCase();
    if (strategy === 'jwt' || strategy === 'bearer') return bearer();
    if (strategy === 'basic') return basic();
  }

  const apiKey = apiKeyFromFactory(name, args);
  return apiKey ?? securityFromName(name);
}

function securityFromDeclaration(node: Node): SchemeEvidence | undefined {
  if (Node.isFunctionDeclaration(node) || Node.isVariableDeclaration(node) || Node.isClassDeclaration(node)) {
    const name = node.getName();
    return name ? securityFromName(name) : undefined;
  }
  return undefined;
}

function securityFromName(name: string): SchemeEvidence | undefined {
  const normalized = name.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (!/(auth|guard|passport|jwt|bearer|basic|apikey|api)/.test(normalized)) return undefined;
  if (normalized.includes('jwt') || normalized.includes('bearer')) return bearer();
  if (normalized.includes('basic') && /(auth|guard|passport)/.test(normalized)) return basic();
  return undefined;
}

function apiKeyFromFactory(name: string, args: Node[]): SchemeEvidence | undefined {
  const normalized = name.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (!normalized.includes('apikey')) return undefined;

  const keyName = stringArg(args[0]);
  if (!keyName) {
    warnIfSecurityRelevant(name, 'dynamic apiKey name');
    return undefined;
  }

  if (normalized.includes('header')) return apiKey('apiKeyHeader', 'header', keyName);
  if (normalized.includes('query')) return apiKey('apiKeyQuery', 'query', keyName);
  if (normalized.includes('cookie')) return apiKey('apiKeyCookie', 'cookie', keyName);
  warnIfSecurityRelevant(name, 'ambiguous apiKey location');
  return undefined;
}

function expressionName(node: Node): string | undefined {
  if (Node.isIdentifier(node) || Node.isPropertyAccessExpression(node)) return node.getText();
  if (Node.isCallExpression(node)) return node.getExpression().getText();
  return undefined;
}

function decoratorsOf(node: Node | undefined): Decorator[] {
  const decorated = node as { getDecorators?: () => Decorator[] } | undefined;
  return decorated?.getDecorators?.() ?? [];
}

function stringArg(node: Node | undefined): string | undefined {
  return node && Node.isStringLiteral(node) ? node.getLiteralValue() : undefined;
}

function bearer(): SchemeEvidence {
  return { name: 'bearerAuth', scheme: { type: 'http', scheme: 'bearer' } };
}

function basic(): SchemeEvidence {
  return { name: 'basicAuth', scheme: { type: 'http', scheme: 'basic' } };
}

function apiKey(name: string, location: string, keyName: string): SchemeEvidence {
  return { name, scheme: { type: 'apiKey', in: location, name: keyName } };
}

function warnIfSecurityRelevant(text: string, reason: string): void {
  if (!/(auth|guard|passport|jwt|bearer|basic|api.?key)/i.test(text)) return;
  warnOnce(`${reason}:${text}`, `ts-route-openapi: skipped security inference for ${text.slice(0, 80)} (${reason}).`);
}
