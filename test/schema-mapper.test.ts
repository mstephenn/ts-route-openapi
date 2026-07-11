import { expect, test, vi } from 'vitest';
import { mapType } from '../src/schema-mapper.js';
import { typeOfAnnotation as typeOf, typesOfDeclarations, typesOfDeclarationsIn } from './support/types.js';

test('maps primitives and arrays', () => {
  expect(mapType(typeOf('string')).schema).toEqual({ type: 'string' });
  expect(mapType(typeOf('number')).schema).toEqual({ type: 'number' });
  expect(mapType(typeOf('boolean[]')).schema).toEqual({
    type: 'array',
    items: { type: 'boolean' },
  });
});

test('maps a string-literal union to an enum', () => {
  expect(mapType(typeOf("'a' | 'b'")).schema).toEqual({
    type: 'string',
    enum: ['a', 'b'],
  });
});

test('inlines anonymous objects with required tracking', () => {
  expect(mapType(typeOf('{ a: string; b?: number }')).schema).toEqual({
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'number' } },
    required: ['a'],
  });
});

test('hoists named interfaces into components and references them', () => {
  const [type] = typesOfDeclarations(
    `interface User { id: string } declare const value: User;`,
    ['value'],
  );

  const result = mapType(type);

  expect(result.schema).toEqual({ $ref: '#/components/schemas/User' });
  expect(result.components.User).toEqual({
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  });
});

test('adds property descriptions from JSDoc when enabled', () => {
  const [type] = typesOfDeclarations(
    `interface User {
       /**
        * User display name.
        * Shown in profile pages.
        */
       name: string
     }
     declare const value: User;`,
    ['value'],
  );

  const result = mapType(type, { descriptions: true });

  expect(result.components.User.properties).toEqual({
    name: { type: 'string', description: 'User display name.\nShown in profile pages.' },
  });
});

test('maps Date-typed properties to string/date-time without hoisting Date methods', () => {
  const result = mapType(typeOf('{ createdAt: Date }'));

  expect(result.schema).toEqual({
    type: 'object',
    properties: { createdAt: { type: 'string', format: 'date-time' } },
    required: ['createdAt'],
  });
  expect(result.components).toEqual({});
});

test('skips function-typed properties instead of hoisting their signatures', () => {
  const result = mapType(typeOf('{ onClick: () => void }'));

  expect(result.schema).toEqual({
    type: 'object',
    properties: { onClick: {} },
    required: ['onClick'],
  });
  expect(result.components).toEqual({});
});

test('never emits invalid component names or method components for builtin types', () => {
  const result = mapType(typeOf('{ createdAt: Date; onClick: () => void }'));

  const componentNames = Object.keys(result.components);
  for (const name of componentNames) {
    expect(name).toMatch(/^[A-Za-z0-9_.-]+$/);
  }
  expect(componentNames).not.toContain('toString');
  expect(componentNames).not.toContain('valueOf');
});

test('collapses an optional boolean property to a boolean schema', () => {
  const result = mapType(typeOf('{ b?: boolean }'));

  expect(result.schema).toEqual({
    type: 'object',
    properties: { b: { type: 'boolean' } },
  });
  expect(result.schema.required).toBeUndefined();
});

test('recursive project-source aliases hoist and self-reference via $ref', () => {
  const [type] = typesOfDeclarations(
    `type LinkedNode = { value: string; next: LinkedNode }; declare const value: LinkedNode;`,
    ['value'],
  );

  const result = mapType(type);

  expect(result.schema).toEqual({ $ref: '#/components/schemas/LinkedNode' });
  expect(result.components.LinkedNode).toEqual({
    type: 'object',
    properties: {
      value: { type: 'string' },
      next: { $ref: '#/components/schemas/LinkedNode' },
    },
    required: ['value', 'next'],
  });
});

test('hoists named type aliases like interfaces', () => {
  const [type] = typesOfDeclarations(
    `type User = { id: string; name?: string }; declare const value: User;`,
    ['value'],
  );

  const result = mapType(type);

  expect(result.schema).toEqual({ $ref: '#/components/schemas/User' });
  expect(result.components.User).toEqual({
    type: 'object',
    properties: { id: { type: 'string' }, name: { type: 'string' } },
    required: ['id'],
  });
});

test('aliases to unions keep their enum mapping (not hoisted)', () => {
  const [type] = typesOfDeclarations(
    `type Status = 'a' | 'b'; declare const value: Status;`,
    ['value'],
  );

  expect(mapType(type).schema).toEqual({ type: 'string', enum: ['a', 'b'] });
});

test('does not blow the stack on recursive library types (inlined, cycle-truncated)', () => {
  const [type] = typesOfDeclarationsIn(
    {
      '/node_modules/somelib/index.d.ts': `export interface Chain { next: Chain; label: string }`,
      '/t.ts': `import type { Chain } from 'somelib'; declare const value: Chain;`,
    },
    '/t.ts',
    ['value'],
  );

  const result = mapType(type);

  expect(result.schema).toEqual({
    type: 'object',
    properties: { next: {}, label: { type: 'string' } },
    required: ['next', 'label'],
  });
  expect(result.components).toEqual({});
});

test('numeric-literal unions map to a number enum', () => {
  expect(mapType(typeOf('1 | 2 | 3')).schema).toEqual({ type: 'number', enum: [1, 2, 3] });
});

test('mixed multi-type unions map to oneOf', () => {
  expect(mapType(typeOf('string | number')).schema).toEqual({
    oneOf: [{ type: 'string' }, { type: 'number' }],
  });
  expect(mapType(typeOf("'a' | 'b' | number")).schema).toEqual({
    oneOf: [{ type: 'string', enum: ['a', 'b'] }, { type: 'number' }],
  });
});

test('discriminated object unions hoist members and reference them in oneOf', () => {
  const [type] = typesOfDeclarations(
    `interface Cat { kind: 'cat'; lives: number }
     interface Dog { kind: 'dog'; good: boolean }
     declare const value: Cat | Dog;`,
    ['value'],
  );

  const result = mapType(type);

  expect(result.schema).toEqual({
    oneOf: [
      { $ref: '#/components/schemas/Cat' },
      { $ref: '#/components/schemas/Dog' },
    ],
  });
  expect(Object.keys(result.components).sort()).toEqual(['Cat', 'Dog']);
});

test('disambiguates distinct project types that share a component name', () => {
  const [type] = typesOfDeclarationsIn(
    {
      '/public.ts': `export interface User { a: string }`,
      '/admin.ts': `export interface User { b: number }`,
      '/t.ts': `import type { User as AUser } from './public';
     import type { User as BUser } from './admin';
     declare const value: AUser | BUser;`,
    },
    '/t.ts',
    ['value'],
  );
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  const result = mapType(type);

  expect(result.schema).toEqual({
    oneOf: [{ $ref: '#/components/schemas/User' }, { $ref: '#/components/schemas/User_admin' }],
  });
  expect(result.components.User).toEqual({
    type: 'object',
    properties: { a: { type: 'string' } },
    required: ['a'],
  });
  expect(result.components.User_admin).toEqual({
    type: 'object',
    properties: { b: { type: 'number' } },
    required: ['b'],
  });
  expect(warn).toHaveBeenCalledWith(
    'ts-route-openapi: component name collision for "User"; emitted "User_admin" for a distinct schema.',
  );
  warn.mockRestore();
});

test('dedupes same-named project types with identical schemas', () => {
  const [type] = typesOfDeclarationsIn(
    {
      '/public.ts': `export interface User { id: string }`,
      '/admin.ts': `export interface User { id: string }`,
      '/t.ts': `import type { User as PublicUser } from './public';
     import type { User as AdminUser } from './admin';
     declare const value: PublicUser | AdminUser;`,
    },
    '/t.ts',
    ['value'],
  );
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  const result = mapType(type);

  expect(result.schema).toEqual({
    oneOf: [{ $ref: '#/components/schemas/User' }, { $ref: '#/components/schemas/User' }],
  });
  expect(result.components).toEqual({
    User: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  });
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('dedupes same-named recursive project types with identical schemas', () => {
  const [type] = typesOfDeclarationsIn(
    {
      '/public.ts': `export interface Node { id: string; next?: Node }`,
      '/admin.ts': `export interface Node { id: string; next?: Node }`,
      '/t.ts': `import type { Node as PublicNode } from './public';
     import type { Node as AdminNode } from './admin';
     declare const value: PublicNode | AdminNode;`,
    },
    '/t.ts',
    ['value'],
  );
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  const result = mapType(type);

  expect(result.schema).toEqual({
    oneOf: [{ $ref: '#/components/schemas/Node' }, { $ref: '#/components/schemas/Node' }],
  });
  expect(result.components).toEqual({
    Node: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        next: { $ref: '#/components/schemas/Node' },
      },
      required: ['id'],
    },
  });
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});
