import { Project } from 'ts-morph';
import { expect, test } from 'vitest';
import { scanNestRoutes } from './nest-scanner.js';

function projectWith(code: string): Project {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { experimentalDecorators: true },
  });
  project.createSourceFile(
    'decorators.ts',
    `
    export function Controller(path?: string): ClassDecorator { return () => {}; }
    export function Get(path?: string): MethodDecorator { return () => {}; }
    export function Post(path?: string): MethodDecorator { return () => {}; }
    export function Param(name?: string): ParameterDecorator { return () => {}; }
    export function Query(name?: string): ParameterDecorator { return () => {}; }
    export function Body(): ParameterDecorator { return () => {}; }
    export function HttpCode(n: number): MethodDecorator { return () => {}; }
    `,
  );
  project.createSourceFile('app.ts', code);
  return project;
}

test('scans @Controller classes and extracts decorated params', () => {
  const project = projectWith(`
    import { Controller, Get, Post, Param, Query, Body } from './decorators.js';

    interface CreateUserDto { name: string }

    @Controller('users')
    class UsersController {
      @Get(':id')
      getById(@Param('id') id: string, @Query('verbose') verbose: boolean): Promise<{ name: string }> {
        return Promise.resolve({ name: 'x' });
      }

      @Post()
      create(@Body() input: CreateUserDto): { ok: boolean } {
        return { ok: true };
      }
    }
  `);

  const routes = scanNestRoutes(project);

  expect(routes.map((r) => [r.route.verb, r.route.path])).toEqual([
    ['get', '/users/:id'],
    ['post', '/users'],
  ]);

  const [getRoute, postRoute] = routes;
  expect(getRoute.types.pathParams.map((p) => [p.name, p.type?.getText()])).toEqual([
    ['id', 'string'],
  ]);
  expect(getRoute.types.query.map((q) => q.name)).toEqual(['verbose']);
  expect(getRoute.types.response?.getText()).toBe('{ name: string; }');
  expect(postRoute.types.body?.getText()).toBe('CreateUserDto');
});

test('ignores classes without @Controller', () => {
  const project = projectWith(`
    class NotAController {
      getById(id: string): string { return id; }
    }
  `);
  expect(scanNestRoutes(project)).toEqual([]);
});

test('nest: POST defaults to 201 and @HttpCode overrides', () => {
  const project = projectWith(`
    import { Controller, Get, Post, Body, HttpCode } from './decorators.js';

    @Controller('things')
    class ThingsController {
      @Post()
      create(@Body() input: { name: string }): { id: string } {
        return { id: 'x' };
      }

      @Post('bulk')
      @HttpCode(202)
      bulk(@Body() input: { items: string[] }): { accepted: boolean } {
        return { accepted: true };
      }

      @Get()
      list(): string[] { return []; }
    }
  `);

  const routes = scanNestRoutes(project);
  const byPathVerb = Object.fromEntries(routes.map((r) => [`${r.route.verb} ${r.route.path}`, r.types]));

  expect(byPathVerb['post /things'].responses?.map((x) => x.status)).toEqual([201]);
  expect(byPathVerb['post /things/bulk'].responses?.map((x) => x.status)).toEqual([202]);
  expect(byPathVerb['get /things'].responses).toBeUndefined();
});
