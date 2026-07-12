import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import { expect, test } from 'vitest';
import { buildOpenApi } from '../src/openapi-builder.js';
import { scanTrpcRoutes } from '../src/trpc-routes.js';
import { createProjectWithSource } from './support/project.js';

const here = dirname(fileURLToPath(import.meta.url));
const exampleDir = join(here, '..', 'examples', 'trpc');

// Analyzed as an in-memory source file (not via the example's own node_modules
// install) so this test doesn't depend on `examples/trpc` having been `npm
// install`ed — every other example app is likewise never installed by the
// root test suite.
test('the tRPC example app produces the checked-in openapi.yaml', () => {
  const source = readFileSync(join(exampleDir, 'src', 'app.ts'), 'utf8');
  const project = createProjectWithSource(source, 'app.ts');

  const doc = buildOpenApi(scanTrpcRoutes(project), { title: 'Orders API (tRPC)', version: '1.0.0' });
  const expected = parse(readFileSync(join(exampleDir, 'openapi.yaml'), 'utf8'));

  expect(doc).toEqual(expected);
});
