import { Project } from 'ts-morph';
import { expect, test } from 'vitest';
import { scanRoutes } from './route-scanner.js';

function projectWith(code: string): Project {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('bootstrap.ts', code);
  return project;
}

test('scanRoutes finds verb, path and handler expression', () => {
  const project = projectWith(`
    declare const app: any;
    const UsersController = { getById(id: string) { return id; } };
    app.get('/users/:id', UsersController.getById);
    app.post('/users', UsersController.getById);
  `);

  const bindings = scanRoutes(project);

  expect(bindings.map((b) => [b.verb, b.path])).toEqual([
    ['get', '/users/:id'],
    ['post', '/users'],
  ]);
  expect(bindings[0].handlerExpression.getText()).toBe('UsersController.getById');
});

test('scanRoutes accepts middleware between path and handler', () => {
  const project = projectWith(`
    declare const app: any;
    declare const mw1: any;
    declare const mw2: any;
    const handler = () => {};
    app.post('/users', mw1, mw2, handler);
  `);

  const [binding] = scanRoutes(project);

  expect(binding.handlerExpression.getText()).toBe('handler');
  expect(binding.middlewareExpressions.map((expr) => expr.getText())).toEqual(['mw1', 'mw2']);
});

test('scanRoutes ignores non-route method calls and calls without a string path', () => {
  const project = projectWith(`
    declare const app: any;
    app.listen(3000);
    app.get(someVar, () => {});
  `);
  expect(scanRoutes(project)).toEqual([]);
});
