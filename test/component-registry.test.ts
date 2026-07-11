import { expect, test, vi } from 'vitest';
import { createComponentRegistry } from '../src/component-registry.js';
import { createProjectWithFiles } from './support/project.js';
import { typesOfDeclarations } from './support/types.js';

test('resolveRef assigns a stable name and only computes the schema once', () => {
  const registry = createComponentRegistry();
  const [type] = typesOfDeclarations(
    `interface User { id: string } declare const value: User;`,
    ['value'],
  );
  const compute = vi.fn(() => ({ type: 'object', properties: {} }));

  const first = registry.resolveRef('User', type, compute);
  const second = registry.resolveRef('User', type, compute);

  expect(first).toEqual({ $ref: '#/components/schemas/User' });
  expect(second).toEqual({ $ref: '#/components/schemas/User' });
  expect(compute).toHaveBeenCalledTimes(1);
  expect(registry.components.User).toEqual({ type: 'object', properties: {} });
});

test('resolveRef disambiguates and warns when two distinct types share a base name', () => {
  const registry = createComponentRegistry();
  const project = createProjectWithFiles({
    '/public.ts': `export interface User { a: string }`,
    '/admin.ts': `export interface User { b: number }`,
    '/t.ts': `import type { User as AUser } from './public';
     import type { User as BUser } from './admin';
     declare const a: AUser;
     declare const b: BUser;`,
  });
  const sf = project.getSourceFileOrThrow('/t.ts');
  const aType = sf.getVariableDeclarationOrThrow('a').getType();
  const bType = sf.getVariableDeclarationOrThrow('b').getType();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  const aRef = registry.resolveRef('User', aType, () => ({ type: 'object', properties: { a: {} } }));
  const bRef = registry.resolveRef('User', bType, () => ({ type: 'object', properties: { b: {} } }));

  expect(aRef).toEqual({ $ref: '#/components/schemas/User' });
  expect(bRef).toEqual({ $ref: '#/components/schemas/User_admin' });
  expect(warn).toHaveBeenCalledWith(
    'ts-route-openapi: component name collision for "User"; emitted "User_admin" for a distinct schema.',
  );

  warn.mockRestore();
});
