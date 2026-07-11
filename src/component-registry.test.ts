import { Project, type Type } from 'ts-morph';
import { expect, test, vi } from 'vitest';
import { createComponentRegistry } from './component-registry.js';

function typesOf(source: string, ...names: string[]): Type[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile('t.ts', source);
  return names.map((n) => sf.getVariableDeclarationOrThrow(n).getType());
}

test('resolveRef assigns a stable name and only computes the schema once', () => {
  const registry = createComponentRegistry();
  const [type] = typesOf(
    `interface User { id: string } declare const value: User;`,
    'value',
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
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('/public.ts', `export interface User { a: string }`);
  project.createSourceFile('/admin.ts', `export interface User { b: number }`);
  const sf = project.createSourceFile(
    '/t.ts',
    `import type { User as AUser } from './public';
     import type { User as BUser } from './admin';
     declare const a: AUser;
     declare const b: BUser;`,
  );
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
