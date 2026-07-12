import type { ParameterDeclaration } from 'ts-morph';
import type { ResolvedRoute, RouteTypes } from '../../shared/index.js';
import { extractExpress } from './express.js';
import { extractFastify } from './fastify.js';
import { extractHono } from './hono.js';
import { extractKoa } from './koa.js';

type FrameworkExtractor = (
  route: ResolvedRoute,
  params: ParameterDeclaration[],
) => RouteTypes | null;

const EXTRACTORS: FrameworkExtractor[] = [extractExpress, extractFastify, extractHono, extractKoa];

/** Try each known framework's extractor; null when none recognizes the handler. */
export function tryFrameworkExtractors(
  route: ResolvedRoute,
  params: ParameterDeclaration[],
): RouteTypes | null {
  for (const extract of EXTRACTORS) {
    const result = extract(route, params);
    if (result) return result;
  }
  return null;
}

export * from './shared.js';
export * from './status-calls.js';
export * from './thrown-status.js';
