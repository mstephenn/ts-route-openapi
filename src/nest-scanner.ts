import { Node, type Decorator, type MethodDeclaration, type Project } from 'ts-morph';
import { objectParams, unwrapPromise, usableObject, usableResponse } from './frameworks/shared.js';
import type { HttpVerb, ParamType, ResolvedRoute, RouteTypes } from './types.js';

const VERB_DECORATORS: Record<string, HttpVerb> = {
  Get: 'get',
  Post: 'post',
  Put: 'put',
  Patch: 'patch',
  Delete: 'delete',
};

export interface NestRoute {
  route: ResolvedRoute;
  types: RouteTypes;
}

/**
 * NestJS: routes are declared with decorators, not registration call-sites.
 * Scan for `@Controller('base')` classes, read `@Get('/path')`-style method
 * decorators, and classify parameters by their `@Param/@Query/@Body` decorators.
 */
export function scanNestRoutes(project: Project): NestRoute[] {
  const results: NestRoute[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.isInNodeModules()) continue;
    for (const cls of sourceFile.getClasses()) {
      const controller = cls.getDecorator('Controller');
      if (!controller) continue;
      const basePath = decoratorPathArg(controller);

      for (const method of cls.getMethods()) {
        for (const [decoratorName, verb] of Object.entries(VERB_DECORATORS)) {
          const decorator = method.getDecorator(decoratorName);
          if (!decorator) continue;
          const path = joinPaths(basePath, decoratorPathArg(decorator));
          results.push({
            route: {
              verb,
              path,
              controllerName: cls.getName() ?? '(anonymous)',
              handlerName: method.getName(),
              method,
            },
            types: extractNestTypes(method),
          });
        }
      }
    }
  }

  return results;
}

function decoratorPathArg(decorator: Decorator): string {
  const arg = decorator.getArguments()[0];
  return arg && Node.isStringLiteral(arg) ? arg.getLiteralValue() : '';
}

function joinPaths(base: string, sub: string): string {
  const clean = (s: string) => s.replace(/^\/+|\/+$/g, '');
  const joined = [clean(base), clean(sub)].filter(Boolean).join('/');
  return `/${joined}`;
}

function extractNestTypes(method: MethodDeclaration): RouteTypes {
  const pathParams: ParamType[] = [];
  const query: ParamType[] = [];
  let body: RouteTypes['body'];

  for (const param of method.getParameters()) {
    const decorators = new Map(param.getDecorators().map((d) => [d.getName(), d]));

    const paramDecorator = decorators.get('Param');
    const queryDecorator = decorators.get('Query');
    const bodyDecorator = decorators.get('Body');

    if (paramDecorator) {
      pathParams.push({
        name: decoratorPathArg(paramDecorator) || param.getName(),
        type: param.getType(),
      });
    } else if (queryDecorator) {
      const named = decoratorPathArg(queryDecorator);
      if (named) {
        query.push({ name: named, type: param.getType() });
      } else {
        // `@Query() q: FilterDto` — expand the object's properties.
        query.push(...(objectParams(param.getType(), param) ?? []));
      }
    } else if (bodyDecorator) {
      body = usableObject(param.getType()) ?? param.getType();
    }
  }

  return {
    pathParams,
    query,
    body,
    response: usableResponse(unwrapPromise(method.getReturnType())),
  };
}
