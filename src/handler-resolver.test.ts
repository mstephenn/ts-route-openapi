import { Project } from 'ts-morph';
import { expect, test } from 'vitest';
import { resolveHandler } from './handler-resolver.js';
import { scanRoutes } from './route-scanner.js';

function firstBinding(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('bootstrap.ts', code);
  return scanRoutes(project)[0];
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
  expect(route.method.getName()).toBe('getById');
  expect(route.verb).toBe('get');
  expect(route.path).toBe('/users/:id');
});

test('resolveHandler returns null when handler is not a resolvable method', () => {
  const binding = firstBinding(`
    declare const app: any;
    app.get('/x', () => {});
  `);
  expect(resolveHandler(binding)).toBeNull();
});
