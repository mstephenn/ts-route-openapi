import { Node, type Decorator, type MethodDeclaration, type Project } from 'ts-morph';
import {
  objectParams,
  unwrapPromise,
  usableObject,
  usableResponse,
  literalStatus,
  withThrownStatuses,
} from './frameworks/index.js';
import { joinPaths } from './route-paths.js';
import { syntheticRoute } from './synthetic-route.js';
import type { HttpVerb, ParamType, ResolvedRoute, RouteTypes } from '../shared/index.js';

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
            route: syntheticRoute({
              verb,
              path,
              controllerName: cls.getName() ?? '(anonymous)',
              handlerName: method.getName(),
              method,
            }),
            types: extractNestTypes(method, verb),
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

/** Nest's status: @HttpCode(N) wins (literal, const, or HttpStatus enum member); otherwise POST defaults to 201, everything else 200. */
function nestStatus(method: MethodDeclaration, verb: HttpVerb): number {
  const decorator = method.getDecorator('HttpCode');
  const status = literalStatus(decorator?.getArguments()[0]);
  if (status !== undefined) return status;
  return verb === 'post' ? 201 : 200;
}

function extractNestTypes(method: MethodDeclaration, verb: HttpVerb): RouteTypes {
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

  const response = usableResponse(unwrapPromise(method.getReturnType()));
  const status = nestStatus(method, verb);
  const types: RouteTypes = {
    pathParams,
    query,
    body,
    response,
    responses: status !== 200 ? [{ status, type: response }] : undefined,
  };

  return { ...types, responses: withThrownStatuses(types, method) };
}
