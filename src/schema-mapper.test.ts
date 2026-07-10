import { Project, type Type } from 'ts-morph';
import { expect, test } from 'vitest';
import { mapType } from './schema-mapper.js';

/** Build a Type from the annotation of `declare const value: <annotation>`. */
function typeOf(annotation: string): Type {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile('t.ts', `declare const value: ${annotation};`);
  return sf.getVariableDeclarationOrThrow('value').getType();
}

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
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile(
    't.ts',
    `interface User { id: string } declare const value: User;`,
  );
  const type = sf.getVariableDeclarationOrThrow('value').getType();

  const result = mapType(type);

  expect(result.schema).toEqual({ $ref: '#/components/schemas/User' });
  expect(result.components.User).toEqual({
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
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
