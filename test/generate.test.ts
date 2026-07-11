import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import { generate } from '../src/generate.js';

const here = dirname(fileURLToPath(import.meta.url));
const sampleDir = join(here, '__fixtures__', 'sample');

test('generate produces the expected OpenAPI document for the sample project', () => {
  const doc = generate(join(sampleDir, 'tsconfig.json'), { title: 'Sample', version: '1.0.0' });
  const expected = JSON.parse(readFileSync(join(sampleDir, 'expected-openapi.json'), 'utf8'));
  expect(doc).toEqual(expected);
});

test('generate can include JSDoc descriptions when enabled', () => {
  const doc = generate(
    join(sampleDir, 'tsconfig.json'),
    { title: 'Sample', version: '1.0.0' },
    { descriptions: true },
  ) as any;

  const get = doc.paths['/users/{id}'].get;
  expect(get.summary).toBe('Get a user by id.');
  expect(get.description).toBe('Returns the public user profile.');
  expect(doc.components.schemas.CreateUserInput.properties.name.description).toBe(
    'Full display name.',
  );
});

test('generate discovers security config next to the tsconfig', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ts-route-openapi-'));
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext' },
      include: ['app.ts'],
    }),
  );
  writeFileSync(
    join(dir, 'app.ts'),
    `
      declare const app: any;
      app.get('/health', () => ({ ok: true }));
    `,
  );
  writeFileSync(
    join(dir, 'ts-route-openapi.config.json'),
    JSON.stringify({
      securitySchemes: { apiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' } },
      security: [{ apiKeyAuth: [] }],
    }),
  );

  const doc = generate(join(dir, 'tsconfig.json')) as any;

  expect(doc.components.securitySchemes.apiKeyAuth).toEqual({
    type: 'apiKey',
    in: 'header',
    name: 'x-api-key',
  });
  expect(doc.paths['/health'].get.security).toEqual([{ apiKeyAuth: [] }]);
});
