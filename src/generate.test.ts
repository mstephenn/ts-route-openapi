import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import { generate } from './generate.js';

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
