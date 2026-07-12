import { Node } from 'ts-morph';
import { expect, test } from 'vitest';
import { resolveHandler } from '../src/routes/index.js';
import { scanRoutes } from '../src/routes/index.js';
import { createProjectWithSource } from './support/project.js';

function firstBinding(code: string) {
  return scanRoutes(createProjectWithSource(code))[0];
}

test('resolveHandler resolves a static controller method', () => {
  const binding = firstBinding(`
    class UsersController {
      static getById(id: string): string { return id; }
    }
    declare const app: any;
    app.get('/users/:id', UsersController.getById);
  `);

  const route = resolveHandler(binding)!;

  expect(route.controllerName).toBe('UsersController');
  expect(route.handlerName).toBe('getById');
  expect(Node.isMethodDeclaration(route.method) && route.method.getName()).toBe('getById');
  expect(route.verb).toBe('get');
  expect(route.path).toBe('/users/:id');
});

test('resolveHandler resolves inline arrow handlers', () => {
  const binding = firstBinding(`
    declare const app: any;
    app.get('/x', () => {});
  `);
  const route = resolveHandler(binding)!;
  expect(route.controllerName).toBe('(inline)');
  expect(Node.isArrowFunction(route.method)).toBe(true);
});

test('resolveHandler returns null when handler is not function-like', () => {
  const binding = firstBinding(`
    declare const app: any;
    const notAFunction = 42;
    app.get('/x', notAFunction);
  `);
  expect(resolveHandler(binding)).toBeNull();
});
